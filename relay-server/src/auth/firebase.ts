import admin from 'firebase-admin';

// Initialize Firebase Admin SDK
// In Cloud Run, credentials come from the environment
const initializeFirebase = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // Check for service account JSON (for local dev)
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  // In Cloud Run, use default credentials
  return admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
};

const app = initializeFirebase();
const auth = admin.auth(app);
const firestore = admin.firestore(app);

// Collection path for EchoVault
const APP_COLLECTION_ID = 'echo-vault-v5-fresh';

export interface AuthResult {
  success: boolean;
  userId?: string;
  error?: string;
}

/**
 * Verify a Firebase ID token from the client
 */
export const verifyToken = async (token: string): Promise<AuthResult> => {
  try {
    const decodedToken = await auth.verifyIdToken(token);
    return {
      success: true,
      userId: decodedToken.uid,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown auth error';
    console.error('Token verification failed:', message);
    return {
      success: false,
      error: message,
    };
  }
};

/**
 * Get user's usage for the current day
 */
export const getUserUsage = async (userId: string): Promise<{
  date: string;
  realtimeMinutes: number;
  standardMinutes: number;
  estimatedCostUSD: number;
}> => {
  const today = new Date().toISOString().split('T')[0];
  const usageRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('voice_usage')
    .doc(today);

  const doc = await usageRef.get();

  if (!doc.exists) {
    return {
      date: today,
      realtimeMinutes: 0,
      standardMinutes: 0,
      estimatedCostUSD: 0,
    };
  }

  return doc.data() as {
    date: string;
    realtimeMinutes: number;
    standardMinutes: number;
    estimatedCostUSD: number;
  };
};

/**
 * Update user's usage after a session
 */
export const updateUserUsage = async (
  userId: string,
  mode: 'realtime' | 'standard',
  durationMinutes: number,
  costUSD: number
): Promise<void> => {
  const today = new Date().toISOString().split('T')[0];
  const usageRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('voice_usage')
    .doc(today);

  await firestore.runTransaction(async (transaction) => {
    const doc = await transaction.get(usageRef);
    const current = doc.exists
      ? doc.data()!
      : { date: today, realtimeMinutes: 0, standardMinutes: 0, estimatedCostUSD: 0 };

    const update = {
      date: today,
      realtimeMinutes:
        current.realtimeMinutes + (mode === 'realtime' ? durationMinutes : 0),
      standardMinutes:
        current.standardMinutes + (mode === 'standard' ? durationMinutes : 0),
      estimatedCostUSD: current.estimatedCostUSD + costUSD,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(usageRef, update, { merge: true });
  });
};

/**
 * Get user's recent entries for RAG context
 */
export const getRecentEntries = async (
  userId: string,
  limit: number = 5
): Promise<Array<{
  id: string;
  effectiveDate: string;
  title: string;
  text: string;
  moodScore?: number;
}>> => {
  const entriesRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  const snapshot = await entriesRef
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      effectiveDate: data.effectiveDate?.toDate?.()?.toISOString?.()?.split('T')[0] || 'unknown',
      title: data.title || data.analysis?.title || 'Untitled',
      text: data.text || '',
      moodScore: data.analysis?.mood_score,
    };
  });
};

/**
 * Get user's active goals from tags
 */
export const getActiveGoals = async (userId: string): Promise<string[]> => {
  const entriesRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  // Get recent entries that might have goal tags
  const snapshot = await entriesRef
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const goals = new Set<string>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const tags = data.tags || [];
    tags.forEach((tag: string) => {
      if (tag.startsWith('@goal:')) {
        goals.add(tag.replace('@goal:', '').replace(/_/g, ' '));
      }
    });
  });

  return Array.from(goals).slice(0, 5);
};

/**
 * Get user's open situations
 */
export const getOpenSituations = async (userId: string): Promise<string[]> => {
  const entriesRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  const snapshot = await entriesRef
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const situations = new Set<string>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    const tags = data.tags || [];
    tags.forEach((tag: string) => {
      if (tag.startsWith('@situation:')) {
        situations.add(tag.replace('@situation:', '').replace(/_/g, ' '));
      }
    });
  });

  return Array.from(situations).slice(0, 3);
};

/**
 * Get user's mood trajectory
 */
export const getMoodTrajectory = async (
  userId: string
): Promise<{ trend: 'improving' | 'stable' | 'declining'; description: string }> => {
  const entriesRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  const snapshot = await entriesRef
    .orderBy('createdAt', 'desc')
    .limit(7)
    .get();

  const moodScores = snapshot.docs
    .map((doc) => doc.data().analysis?.mood_score)
    .filter((score): score is number => typeof score === 'number');

  if (moodScores.length < 2) {
    return { trend: 'stable', description: 'Not enough data to determine mood trend.' };
  }

  const recentAvg = moodScores.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, moodScores.length);
  const olderAvg = moodScores.slice(3).reduce((a, b) => a + b, 0) / Math.max(1, moodScores.length - 3);

  const diff = recentAvg - olderAvg;

  if (diff > 0.1) {
    return {
      trend: 'improving',
      description: `Your mood has been improving lately (avg ${(recentAvg * 10).toFixed(1)}/10).`,
    };
  } else if (diff < -0.1) {
    return {
      trend: 'declining',
      description: `Your mood has been a bit lower recently (avg ${(recentAvg * 10).toFixed(1)}/10).`,
    };
  }

  return {
    trend: 'stable',
    description: `Your mood has been fairly stable (avg ${(recentAvg * 10).toFixed(1)}/10).`,
  };
};

export { firestore, APP_COLLECTION_ID };
