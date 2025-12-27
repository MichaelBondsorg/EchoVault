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

/**
 * Search entries by text content for RAG
 * Returns entries matching the query with relevant excerpts
 */
export const searchEntries = async (
  userId: string,
  query: string,
  options?: {
    dateHint?: string;
    entityType?: 'person' | 'goal' | 'situation' | 'event' | 'place' | 'any';
    limit?: number;
  }
): Promise<Array<{
  id: string;
  effectiveDate: string;
  title: string;
  excerpt: string;
  moodScore?: number;
  relevanceReason: string;
}>> => {
  const entriesRef = firestore
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  const limit = options?.limit || 5;

  // Normalize query for matching
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

  // Get entries to search through
  // For now, search through recent entries (could be optimized with full-text index later)
  let baseQuery = entriesRef.orderBy('createdAt', 'desc');

  // If date hint provided, try to filter by date range
  if (options?.dateHint) {
    const dateRange = parseDateHint(options.dateHint);
    if (dateRange) {
      baseQuery = entriesRef
        .where('effectiveDate', '>=', dateRange.start)
        .where('effectiveDate', '<=', dateRange.end)
        .orderBy('effectiveDate', 'desc');
    }
  }

  const snapshot = await baseQuery.limit(50).get();

  const results: Array<{
    id: string;
    effectiveDate: string;
    title: string;
    excerpt: string;
    moodScore?: number;
    relevanceReason: string;
    score: number;
  }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const text = (data.text || '').toLowerCase();
    const title = (data.title || data.analysis?.title || '').toLowerCase();
    const tags = (data.tags || []).map((t: string) => t.toLowerCase());

    // Calculate relevance score
    let score = 0;
    const reasons: string[] = [];

    // Check title match
    if (title.includes(queryLower)) {
      score += 3;
      reasons.push('title match');
    }

    // Check word matches in text
    let matchedWords = 0;
    for (const word of queryWords) {
      if (text.includes(word)) {
        matchedWords++;
      }
    }
    if (matchedWords > 0) {
      score += matchedWords;
      reasons.push(`${matchedWords} keyword${matchedWords > 1 ? 's' : ''} in text`);
    }

    // Check entity type matches in tags
    if (options?.entityType && options.entityType !== 'any') {
      const prefix = `@${options.entityType}:`;
      const hasEntityTag = tags.some((t: string) => t.startsWith(prefix) && t.includes(queryLower));
      if (hasEntityTag) {
        score += 2;
        reasons.push(`${options.entityType} tag match`);
      }
    }

    // Check for person mentions
    if (queryWords.some(w => text.includes(`@person:${w}`) || tags.includes(`@person:${w}`))) {
      score += 2;
      reasons.push('person mention');
    }

    if (score > 0) {
      // Extract relevant excerpt
      const excerpt = extractExcerpt(data.text || '', queryWords);

      results.push({
        id: doc.id,
        effectiveDate: data.effectiveDate?.toDate?.()?.toISOString?.()?.split('T')[0] || 'unknown',
        title: data.title || data.analysis?.title || 'Untitled',
        excerpt,
        moodScore: data.analysis?.mood_score,
        relevanceReason: reasons.join(', '),
        score,
      });
    }
  }

  // Sort by score and return top results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...rest }) => rest);
};

/**
 * Parse natural language date hints into date ranges
 */
const parseDateHint = (hint: string): { start: Date; end: Date } | null => {
  const now = new Date();
  const hintLower = hint.toLowerCase();

  // Handle common patterns
  if (hintLower.includes('yesterday')) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: yesterday, end: yesterday };
  }

  if (hintLower.includes('last week')) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { start, end };
  }

  if (hintLower.includes('two weeks ago') || hintLower.includes('2 weeks ago')) {
    const end = new Date(now);
    end.setDate(end.getDate() - 7);
    const start = new Date(now);
    start.setDate(start.getDate() - 14);
    return { start, end };
  }

  if (hintLower.includes('last month')) {
    const end = new Date(now);
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    return { start, end };
  }

  // Handle day names
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (const day of days) {
    if (hintLower.includes(`last ${day}`)) {
      const targetDay = days.indexOf(day);
      const diff = (now.getDay() - targetDay + 7) % 7 || 7;
      const target = new Date(now);
      target.setDate(target.getDate() - diff);
      return { start: target, end: target };
    }
  }

  return null;
};

/**
 * Extract a relevant excerpt around matching words
 */
const extractExcerpt = (text: string, queryWords: string[]): string => {
  const maxLength = 200;
  const textLower = text.toLowerCase();

  // Find first match position
  let matchPos = -1;
  for (const word of queryWords) {
    const pos = textLower.indexOf(word);
    if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
      matchPos = pos;
    }
  }

  if (matchPos === -1) {
    // No match found, return beginning of text
    return text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
  }

  // Extract context around match
  const start = Math.max(0, matchPos - 50);
  const end = Math.min(text.length, matchPos + 150);

  let excerpt = text.slice(start, end);
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt += '...';

  return excerpt;
};

export { firestore, APP_COLLECTION_ID };
