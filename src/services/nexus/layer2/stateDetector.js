/**
 * State Detector
 *
 * Identifies the user's current life state based on active threads,
 * recent entries, and biometric patterns.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

// ============================================================
// LIFE STATE DEFINITIONS
// ============================================================

export const LIFE_STATES = {
  // Career States
  CAREER_WAITING: {
    id: 'career_waiting',
    displayName: 'Career Waiting Period',
    description: 'Awaiting response on job applications or interviews',
    triggers: {
      threads: ['career'],
      keywords: ['waiting', 'haven\'t heard', 'following up', 'pending'],
      threadStatus: ['active']
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      hrv: { direction: 'depressed', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'mild' }
    },
    typicalDuration: { min: 3, max: 21, unit: 'days' },
    possibleOutcomes: ['career_success', 'career_rejection', 'career_pivot']
  },

  CAREER_ACTIVE: {
    id: 'career_active',
    displayName: 'Active Job Search',
    description: 'Actively interviewing or applying for positions',
    triggers: {
      threads: ['career'],
      keywords: ['interview', 'application', 'recruiter', 'applying'],
      activityLevel: 'high'
    },
    biometricSignature: {
      strain: { direction: 'elevated', magnitude: 'moderate' },
      rhr: { direction: 'elevated', magnitude: 'mild' }
    }
  },

  CAREER_SUCCESS: {
    id: 'career_success',
    displayName: 'Career Win',
    description: 'Positive career outcome achieved',
    triggers: {
      keywords: ['got the job', 'offer', 'accepted', 'start date']
    },
    biometricSignature: {
      hrv: { direction: 'improved', magnitude: 'significant' },
      mood: { direction: 'elevated', magnitude: 'significant' }
    },
    typicalDuration: { min: 3, max: 14, unit: 'days' }
  },

  CAREER_REJECTION: {
    id: 'career_rejection',
    displayName: 'Processing Rejection',
    description: 'Processing a career setback',
    triggers: {
      keywords: ['rejected', 'didn\'t get', 'passed', 'not moving forward']
    },
    biometricSignature: {
      mood: { direction: 'depressed', magnitude: 'significant' },
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'moderate' }
    },
    typicalDuration: { min: 3, max: 21, unit: 'days' }
  },

  // Relationship States
  RELATIONSHIP_GROWTH: {
    id: 'relationship_growth',
    displayName: 'Relationship Growth',
    description: 'Deepening connection with partner',
    triggers: {
      threads: ['relationship'],
      keywords: ['closer', 'connected', 'love', 'future', 'together'],
      sentiment: { min: 0.65 }
    },
    biometricSignature: {
      hrv: { direction: 'improved', magnitude: 'mild' },
      mood: { direction: 'elevated', magnitude: 'moderate' }
    }
  },

  RELATIONSHIP_STRAIN: {
    id: 'relationship_strain',
    displayName: 'Relationship Tension',
    description: 'Navigating relationship challenges',
    triggers: {
      threads: ['relationship'],
      keywords: ['argument', 'frustrated', 'annoyed', 'tension', 'worried about us'],
      sentiment: { max: 0.45 }
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'moderate' },
      hrv: { direction: 'depressed', magnitude: 'moderate' },
      sleep: { direction: 'disrupted', magnitude: 'mild' }
    }
  },

  // Health States
  RECOVERY_MODE: {
    id: 'recovery_mode',
    displayName: 'Recovery Mode',
    description: 'Recovering from illness, injury, or overexertion',
    triggers: {
      threads: ['health', 'somatic'],
      keywords: ['sick', 'recovering', 'rest', 'injury', 'taking it easy'],
      whoopRecovery: { max: 40 }
    },
    biometricSignature: {
      strain: { direction: 'low', magnitude: 'significant' },
      recovery: { direction: 'improving', magnitude: 'gradual' }
    }
  },

  HIGH_PERFORMANCE: {
    id: 'high_performance',
    displayName: 'High Performance',
    description: 'Peak physical and mental state',
    triggers: {
      keywords: ['great workout', 'feeling strong', 'best', 'crushed it'],
      whoopRecovery: { min: 70 },
      mood: { min: 70 }
    },
    biometricSignature: {
      hrv: { direction: 'elevated', magnitude: 'moderate' },
      recovery: { direction: 'high', magnitude: 'stable' }
    }
  },

  BURNOUT_RISK: {
    id: 'burnout_risk',
    displayName: 'Burnout Risk',
    description: 'Signs of approaching burnout',
    triggers: {
      keywords: ['overwhelmed', 'exhausted', 'can\'t keep up', 'too much'],
      whoopRecovery: { max: 35, duration: 3 },
      rhrTrend: { direction: 'elevated', duration: 5 }
    },
    biometricSignature: {
      rhr: { direction: 'elevated', magnitude: 'significant' },
      hrv: { direction: 'depressed', magnitude: 'significant' },
      strain: { direction: 'elevated', magnitude: 'sustained' }
    },
    urgency: 'high'
  },

  // General States
  STABLE: {
    id: 'stable',
    displayName: 'Stable',
    description: 'No significant active state detected',
    triggers: {
      default: true
    },
    biometricSignature: {
      all: { direction: 'normal', magnitude: 'within_baseline' }
    }
  }
};

// ============================================================
// STATE DETECTION
// ============================================================

/**
 * Detect current life state(s) based on multiple signals
 */
export const detectCurrentState = async (userId, entries, whoopToday, threads) => {
  if (!userId) return { primary: 'stable', secondary: [], confidence: 0.5 };

  const recentEntries = entries.slice(0, 5); // First 5 entries (assuming sorted desc)
  const recentText = recentEntries.map(e => e.text || '').join(' ').toLowerCase();
  const recentMood = recentEntries
    .map(e => e.analysis?.mood_score)
    .filter(m => m != null);
  const avgMood = recentMood.length > 0
    ? (recentMood.reduce((a, b) => a + b, 0) / recentMood.length) * 100
    : 50;

  const activeThreadCategories = (threads || [])
    .filter(t => t.status === 'active')
    .map(t => t.category);

  const detectedStates = [];

  for (const [key, state] of Object.entries(LIFE_STATES)) {
    if (state.triggers.default) continue; // Skip default state

    let score = 0;
    let maxScore = 0;

    // Check thread triggers
    if (state.triggers.threads) {
      maxScore += 30;
      const matchingThreads = state.triggers.threads.filter(t =>
        activeThreadCategories.includes(t)
      );
      score += matchingThreads.length * 15;
    }

    // Check keyword triggers
    if (state.triggers.keywords) {
      maxScore += 40;
      const matchingKeywords = state.triggers.keywords.filter(kw =>
        recentText.includes(kw.toLowerCase())
      );
      score += Math.min(matchingKeywords.length * 10, 40);
    }

    // Check sentiment triggers
    if (state.triggers.sentiment) {
      maxScore += 20;
      if (state.triggers.sentiment.min && avgMood >= state.triggers.sentiment.min * 100) {
        score += 20;
      }
      if (state.triggers.sentiment.max && avgMood <= state.triggers.sentiment.max * 100) {
        score += 20;
      }
    }

    // Check Whoop triggers
    if (whoopToday && state.triggers.whoopRecovery) {
      maxScore += 20;
      const recovery = whoopToday.recovery?.score;
      if (recovery != null) {
        if (state.triggers.whoopRecovery.min && recovery >= state.triggers.whoopRecovery.min) {
          score += 20;
        }
        if (state.triggers.whoopRecovery.max && recovery <= state.triggers.whoopRecovery.max) {
          score += 20;
        }
      }
    }

    // Check mood triggers
    if (state.triggers.mood) {
      maxScore += 15;
      if (state.triggers.mood.min && avgMood >= state.triggers.mood.min) {
        score += 15;
      }
      if (state.triggers.mood.max && avgMood <= state.triggers.mood.max) {
        score += 15;
      }
    }

    const confidence = maxScore > 0 ? score / maxScore : 0;

    if (confidence >= 0.4) { // Minimum threshold
      detectedStates.push({
        stateId: state.id,
        displayName: state.displayName,
        description: state.description,
        confidence,
        biometricSignature: state.biometricSignature,
        urgency: state.urgency || 'normal'
      });
    }
  }

  // Sort by confidence
  detectedStates.sort((a, b) => b.confidence - a.confidence);

  // Determine primary and secondary states
  const primary = detectedStates[0]?.stateId || 'stable';
  const secondary = detectedStates.slice(1, 3).map(s => s.stateId);

  return {
    primary,
    secondary,
    confidence: detectedStates[0]?.confidence || 0.5,
    allDetected: detectedStates,
    detectedAt: new Date().toISOString()
  };
};

/**
 * Get historical state data
 */
export const getStateHistory = async (userId) => {
  if (!userId) return { currentState: null, stateHistory: [] };

  try {
    const stateRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'states'
    );

    const stateDoc = await getDoc(stateRef);
    if (!stateDoc.exists()) return { currentState: null, stateHistory: [] };

    return stateDoc.data();
  } catch (error) {
    console.error('[StateDetector] Failed to get state history:', error);
    return { currentState: null, stateHistory: [] };
  }
};

/**
 * Update current state
 */
export const updateCurrentState = async (userId, stateData) => {
  if (!userId) return;

  try {
    const stateRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'states'
    );

    const existing = await getStateHistory(userId);
    const now = Timestamp.now();

    // Check if state changed
    const previousState = existing.currentState;
    const stateChanged = previousState?.primary !== stateData.primary;

    // If state changed, add previous to history
    let newHistory = existing.stateHistory || [];
    if (stateChanged && previousState) {
      newHistory.push({
        state: previousState.primary,
        startedAt: previousState.startedAt,
        endedAt: now,
        durationDays: previousState.startedAt
          ? Math.round((now.toMillis() - previousState.startedAt.toMillis()) / (1000 * 60 * 60 * 24))
          : null,
        averageMood: null, // Calculate from entries if needed
        outcome: stateData.primary // New state is the outcome
      });

      // Keep last 20 states
      if (newHistory.length > 20) {
        newHistory = newHistory.slice(-20);
      }
    }

    await setDoc(stateRef, {
      currentState: {
        ...stateData,
        startedAt: stateChanged ? now : (previousState?.startedAt || now),
        durationDays: stateChanged ? 0 : ((previousState?.durationDays || 0) + 1)
      },
      stateHistory: newHistory,
      updatedAt: now
    }, { merge: true });
  } catch (error) {
    console.error('[StateDetector] Failed to update state:', error);
  }
};

/**
 * Find similar past states for comparison
 */
export const findSimilarPastStates = async (userId, currentState) => {
  const history = await getStateHistory(userId);

  const similar = (history.stateHistory || [])
    .filter(s => s.state === currentState)
    .map(s => ({
      ...s,
      durationDays: s.durationDays,
      outcome: s.outcome
    }));

  return similar;
};
