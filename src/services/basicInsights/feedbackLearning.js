/**
 * Feedback Learning Service
 *
 * Learns from user feedback on insights to improve future accuracy.
 *
 * Features:
 * - Aggregates feedback per pattern type (activity, theme, people, etc.)
 * - Calculates accuracy rates and confidence multipliers
 * - Temporarily suppresses low-accuracy insights
 * - Learns false positive patterns from entry content
 * - Resurfaces insights when data changes significantly
 *
 * Firestore Path: artifacts/{APP_COLLECTION_ID}/users/{userId}/insightLearning/{patternType}
 */

import { doc, getDoc, setDoc, getDocs, collection, Timestamp, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// Configuration
const CONFIG = {
  // Suppression triggers when accuracy drops below this
  SUPPRESSION_ACCURACY_THRESHOLD: 0.4, // 40%

  // Minimum feedback count before suppression can trigger
  MIN_FEEDBACK_FOR_SUPPRESSION: 3,

  // Confidence multiplier floor (won't go below this)
  MIN_CONFIDENCE_MULTIPLIER: 0.3,

  // How much stronger the signal needs to be to resurface (multiplier)
  RESURFACE_STRENGTH_MULTIPLIER: 1.5,

  // Days after which suppression expires regardless
  SUPPRESSION_EXPIRY_DAYS: 30,

  // Minimum new entries before re-evaluating suppression
  MIN_NEW_ENTRIES_FOR_REEVALUATION: 5
};

/**
 * Get the Firestore reference for a pattern's learning data
 */
const getLearningRef = (userId, patternType) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insightLearning', patternType);
};

/**
 * Get all learning data for a user
 */
const getLearningCollectionRef = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insightLearning');
};

/**
 * Initialize or get existing learning data for a pattern
 * @param {string} userId
 * @param {string} patternType - e.g., "activity_journaling", "theme_gratitude"
 * @returns {Object} Learning data
 */
export const getPatternLearning = async (userId, patternType) => {
  try {
    const ref = getLearningRef(userId, patternType);
    const snapshot = await getDoc(ref);

    if (snapshot.exists()) {
      return snapshot.data();
    }

    // Return default structure
    return {
      patternType,
      totalFeedback: 0,
      accurateFeedback: 0,
      inaccurateFeedback: 0,
      accuracyRate: null, // null until we have feedback
      confidenceMultiplier: 1.0,
      suppressed: false,
      suppressedAt: null,
      suppressReason: null,
      lastMoodDelta: null,
      requiredMoodDeltaToResurface: null,
      falsePositiveEntryIds: [],
      falsePositivePatterns: [],
      entriesAtLastEvaluation: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    };
  } catch (error) {
    console.error('[FeedbackLearning] Failed to get pattern learning:', error);
    return null;
  }
};

/**
 * Get all learning data for a user (for batch processing)
 * @param {string} userId
 * @returns {Map} Map of patternType -> learning data
 */
export const getAllPatternLearning = async (userId) => {
  try {
    const collRef = getLearningCollectionRef(userId);
    const snapshot = await getDocs(collRef);

    const learningMap = new Map();
    snapshot.forEach(doc => {
      learningMap.set(doc.id, doc.data());
    });

    return learningMap;
  } catch (error) {
    console.error('[FeedbackLearning] Failed to get all learning:', error);
    return new Map();
  }
};

/**
 * Record feedback and update learning
 * @param {string} userId
 * @param {Object} feedback - Feedback data from UI
 * @param {Array} citedEntries - Full entry objects for analysis
 * @returns {Object} Updated learning data
 */
export const recordFeedbackAndLearn = async (userId, feedback, citedEntries = []) => {
  const { insightId, category, insightText, moodDelta, activityKey, themeKey, peopleKey, entryIds } = feedback;
  const isAccurate = feedback.feedback === 'accurate';

  // Determine pattern type from the insight
  const patternType = activityKey ? `activity_${activityKey}` :
                      themeKey ? `theme_${themeKey}` :
                      peopleKey ? `people_${peopleKey}` :
                      insightId || category;

  try {
    // Get existing learning data
    const learning = await getPatternLearning(userId, patternType);
    if (!learning) return null;

    // Update feedback counts
    learning.totalFeedback += 1;
    if (isAccurate) {
      learning.accurateFeedback += 1;
    } else {
      learning.inaccurateFeedback += 1;
      // Track false positive entries
      if (entryIds && entryIds.length > 0) {
        learning.falsePositiveEntryIds = [
          ...new Set([...learning.falsePositiveEntryIds, ...entryIds])
        ].slice(-50); // Keep last 50
      }
    }

    // Calculate accuracy rate
    learning.accuracyRate = learning.accurateFeedback / learning.totalFeedback;

    // Calculate confidence multiplier
    // Formula: starts at 1.0, reduces based on inaccuracy, floors at MIN_CONFIDENCE_MULTIPLIER
    const inaccuracyPenalty = (1 - learning.accuracyRate) * 0.7; // Max 70% penalty
    learning.confidenceMultiplier = Math.max(
      CONFIG.MIN_CONFIDENCE_MULTIPLIER,
      1.0 - inaccuracyPenalty
    );

    // Analyze false positive patterns from entry content
    if (!isAccurate && citedEntries.length > 0) {
      learning.falsePositivePatterns = analyzeFalsePositivePatterns(
        citedEntries,
        learning.falsePositivePatterns
      );
    }

    // Record the mood delta for resurface calculations
    learning.lastMoodDelta = moodDelta;

    // Check if we should suppress this pattern
    const shouldSuppress =
      learning.totalFeedback >= CONFIG.MIN_FEEDBACK_FOR_SUPPRESSION &&
      learning.accuracyRate < CONFIG.SUPPRESSION_ACCURACY_THRESHOLD;

    if (shouldSuppress && !learning.suppressed) {
      learning.suppressed = true;
      learning.suppressedAt = Timestamp.now();
      learning.suppressReason = 'low_accuracy';
      // To resurface, need a stronger signal
      learning.requiredMoodDeltaToResurface = Math.abs(moodDelta) * CONFIG.RESURFACE_STRENGTH_MULTIPLIER;
      console.log(`[FeedbackLearning] Suppressing pattern "${patternType}" (accuracy: ${(learning.accuracyRate * 100).toFixed(0)}%)`);
    }

    // Check if suppression should be lifted (positive feedback can help)
    if (learning.suppressed && learning.accuracyRate >= CONFIG.SUPPRESSION_ACCURACY_THRESHOLD) {
      learning.suppressed = false;
      learning.suppressedAt = null;
      learning.suppressReason = null;
      learning.requiredMoodDeltaToResurface = null;
      console.log(`[FeedbackLearning] Lifting suppression for "${patternType}" (accuracy improved)`);
    }

    learning.updatedAt = Timestamp.now();

    // Save to Firestore
    const ref = getLearningRef(userId, patternType);
    await setDoc(ref, learning);

    console.log(`[FeedbackLearning] Updated "${patternType}": accuracy=${(learning.accuracyRate * 100).toFixed(0)}%, multiplier=${learning.confidenceMultiplier.toFixed(2)}, suppressed=${learning.suppressed}`);

    return learning;
  } catch (error) {
    console.error('[FeedbackLearning] Failed to record feedback:', error);
    return null;
  }
};

/**
 * Analyze entry content to identify false positive patterns
 * @param {Array} entries - Entries marked as false positives
 * @param {Array} existingPatterns - Previously identified patterns
 * @returns {Array} Updated false positive patterns
 */
const analyzeFalsePositivePatterns = (entries, existingPatterns = []) => {
  const patternCounts = new Map();

  // Initialize with existing patterns
  existingPatterns.forEach(p => {
    patternCounts.set(p.pattern, p.frequency);
  });

  // Common false positive indicators to look for
  const indicators = [
    // Meta-references (talking about apps/tools)
    /\b(app|application|tool|software|feature)\b/gi,
    // Development work
    /\b(working on|developing|building|coding|implementing)\b/gi,
    // Past tense that might not indicate current activity
    /\b(used to|had been|was going to)\b/gi,
    // Negations
    /\b(didn't|don't|won't|can't|not)\b/gi,
    // Questions/hypotheticals
    /\b(if i|should i|could i|would i|maybe)\b/gi
  ];

  for (const entry of entries) {
    const content = (entry.content || entry.text || '').toLowerCase();

    for (const indicator of indicators) {
      const matches = content.match(indicator);
      if (matches) {
        for (const match of matches) {
          const normalized = match.toLowerCase().trim();
          patternCounts.set(normalized, (patternCounts.get(normalized) || 0) + 1);
        }
      }
    }
  }

  // Convert to array and sort by frequency
  const patterns = Array.from(patternCounts.entries())
    .map(([pattern, frequency]) => ({ pattern, frequency }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10); // Keep top 10

  return patterns;
};

/**
 * Check if an insight should be shown based on learning
 * @param {string} userId
 * @param {Object} insight - The insight to check
 * @param {number} currentEntryCount - Current total entry count
 * @returns {Object} { show: boolean, adjustedConfidence: number, reason: string }
 */
export const shouldShowInsight = async (userId, insight, currentEntryCount = 0) => {
  const patternType = insight.activityKey ? `activity_${insight.activityKey}` :
                      insight.themeKey ? `theme_${insight.themeKey}` :
                      insight.peopleKey ? `people_${insight.peopleKey}` :
                      insight.id;

  try {
    const learning = await getPatternLearning(userId, patternType);

    // No learning data yet - show with full confidence
    if (!learning || learning.totalFeedback === 0) {
      return { show: true, adjustedConfidence: 1.0, reason: 'no_feedback' };
    }

    // Check suppression
    if (learning.suppressed) {
      // Check if suppression has expired
      const suppressedAt = learning.suppressedAt?.toMillis?.() || learning.suppressedAt;
      const expiryMs = CONFIG.SUPPRESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      const isExpired = Date.now() - suppressedAt > expiryMs;

      if (isExpired) {
        return {
          show: true,
          adjustedConfidence: learning.confidenceMultiplier,
          reason: 'suppression_expired'
        };
      }

      // Check if signal is strong enough to resurface
      if (learning.requiredMoodDeltaToResurface &&
          Math.abs(insight.moodDelta) >= learning.requiredMoodDeltaToResurface) {
        return {
          show: true,
          adjustedConfidence: learning.confidenceMultiplier,
          reason: 'strong_signal_override'
        };
      }

      // Check if enough new entries warrant re-evaluation
      const newEntries = currentEntryCount - (learning.entriesAtLastEvaluation || 0);
      if (newEntries >= CONFIG.MIN_NEW_ENTRIES_FOR_REEVALUATION) {
        return {
          show: true,
          adjustedConfidence: learning.confidenceMultiplier * 0.8, // Extra penalty for re-eval
          reason: 'new_data_reevaluation'
        };
      }

      // Still suppressed
      return { show: false, adjustedConfidence: 0, reason: 'suppressed' };
    }

    // Not suppressed - apply confidence multiplier
    return {
      show: true,
      adjustedConfidence: learning.confidenceMultiplier,
      reason: learning.accuracyRate >= 0.7 ? 'high_accuracy' : 'adjusted_confidence'
    };
  } catch (error) {
    console.error('[FeedbackLearning] Failed to check insight:', error);
    return { show: true, adjustedConfidence: 1.0, reason: 'error_fallback' };
  }
};

/**
 * Batch check multiple insights (more efficient)
 * @param {string} userId
 * @param {Array} insights - Array of insights to check
 * @param {number} currentEntryCount
 * @returns {Array} Insights with show/confidence info attached
 */
export const filterInsightsByLearning = async (userId, insights, currentEntryCount = 0) => {
  if (!insights || insights.length === 0) return [];

  try {
    // Get all learning data in one query
    const allLearning = await getAllPatternLearning(userId);

    return insights.map(insight => {
      const patternType = insight.activityKey ? `activity_${insight.activityKey}` :
                          insight.themeKey ? `theme_${insight.themeKey}` :
                          insight.peopleKey ? `people_${insight.peopleKey}` :
                          insight.id;

      const learning = allLearning.get(patternType);

      // No learning data - include with full confidence
      if (!learning || learning.totalFeedback === 0) {
        return { ...insight, _showDecision: { show: true, adjustedConfidence: 1.0, reason: 'no_feedback' } };
      }

      // Check suppression
      if (learning.suppressed) {
        const suppressedAt = learning.suppressedAt?.toMillis?.() || learning.suppressedAt;
        const expiryMs = CONFIG.SUPPRESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
        const isExpired = Date.now() - suppressedAt > expiryMs;

        if (isExpired) {
          return { ...insight, _showDecision: { show: true, adjustedConfidence: learning.confidenceMultiplier, reason: 'suppression_expired' } };
        }

        if (learning.requiredMoodDeltaToResurface &&
            Math.abs(insight.moodDelta) >= learning.requiredMoodDeltaToResurface) {
          return { ...insight, _showDecision: { show: true, adjustedConfidence: learning.confidenceMultiplier, reason: 'strong_signal_override' } };
        }

        const newEntries = currentEntryCount - (learning.entriesAtLastEvaluation || 0);
        if (newEntries >= CONFIG.MIN_NEW_ENTRIES_FOR_REEVALUATION) {
          return { ...insight, _showDecision: { show: true, adjustedConfidence: learning.confidenceMultiplier * 0.8, reason: 'new_data_reevaluation' } };
        }

        return { ...insight, _showDecision: { show: false, adjustedConfidence: 0, reason: 'suppressed' } };
      }

      // Not suppressed
      return { ...insight, _showDecision: { show: true, adjustedConfidence: learning.confidenceMultiplier, reason: 'ok' } };
    });
  } catch (error) {
    console.error('[FeedbackLearning] Failed to filter insights:', error);
    return insights.map(i => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1.0, reason: 'error_fallback' } }));
  }
};

/**
 * Get suppression status summary for UI display
 * @param {string} userId
 * @returns {Array} List of suppressed patterns with reasons
 */
export const getSuppressedPatterns = async (userId) => {
  try {
    const allLearning = await getAllPatternLearning(userId);
    const suppressed = [];

    allLearning.forEach((learning, patternType) => {
      if (learning.suppressed) {
        suppressed.push({
          patternType,
          accuracyRate: learning.accuracyRate,
          totalFeedback: learning.totalFeedback,
          suppressedAt: learning.suppressedAt,
          requiredMoodDeltaToResurface: learning.requiredMoodDeltaToResurface
        });
      }
    });

    return suppressed;
  } catch (error) {
    console.error('[FeedbackLearning] Failed to get suppressed patterns:', error);
    return [];
  }
};

/**
 * Manually lift suppression for a pattern (user override)
 * @param {string} userId
 * @param {string} patternType
 */
export const liftSuppression = async (userId, patternType) => {
  try {
    const learning = await getPatternLearning(userId, patternType);
    if (!learning) return false;

    learning.suppressed = false;
    learning.suppressedAt = null;
    learning.suppressReason = null;
    learning.requiredMoodDeltaToResurface = null;
    learning.updatedAt = Timestamp.now();

    const ref = getLearningRef(userId, patternType);
    await setDoc(ref, learning);

    console.log(`[FeedbackLearning] Manually lifted suppression for "${patternType}"`);
    return true;
  } catch (error) {
    console.error('[FeedbackLearning] Failed to lift suppression:', error);
    return false;
  }
};

export default {
  getPatternLearning,
  getAllPatternLearning,
  recordFeedbackAndLearn,
  shouldShowInsight,
  filterInsightsByLearning,
  getSuppressedPatterns,
  liftSuppression,
  CONFIG
};
