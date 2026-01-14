/**
 * Intervention Tracker (Stub)
 *
 * Full implementation in Phase 3.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';

export const INTERVENTION_PATTERNS = {
  yoga: { category: 'physical', patterns: [/yoga/i, /flow/i, /vinyasa/i] },
  barrys: { category: 'physical', patterns: [/barry'?s/i, /barrys/i] },
  gym: { category: 'physical', patterns: [/gym/i, /lift/i, /workout/i] },
  walk: { category: 'physical', patterns: [/walk/i, /walked/i, /hike/i] },
  sterling_walk: { category: 'relational', patterns: [/sterling/i, /dog.*walk/i] },
  spencer_time: { category: 'relational', patterns: [/spencer/i] },
  social: { category: 'relational', patterns: [/dinner with/i, /friends/i] }
};

/**
 * Detect interventions in an entry
 */
export const detectInterventionsInEntry = (entry) => {
  const text = entry.text || '';
  const detected = [];

  for (const [name, config] of Object.entries(INTERVENTION_PATTERNS)) {
    const matched = config.patterns.some(pattern => pattern.test(text));
    if (matched) {
      detected.push({
        intervention: name,
        category: config.category,
        entryId: entry.id,
        entryDate: entry.effectiveDate || entry.createdAt,
        entryMood: entry.analysis?.mood_score
      });
    }
  }

  return detected;
};

/**
 * Update intervention data (stub)
 */
export const updateInterventionData = async (userId, entries, whoopHistory) => {
  console.log('[InterventionTracker] Stub - full implementation in Phase 3');
  return { interventions: {} };
};

/**
 * Get intervention data
 */
export const getInterventionData = async (userId) => {
  if (!userId) return null;

  try {
    const interventionRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'interventions'
    );

    const docSnap = await getDoc(interventionRef);
    if (!docSnap.exists()) return null;

    return docSnap.data();
  } catch (error) {
    console.error('[InterventionTracker] Failed to get data:', error);
    return null;
  }
};
