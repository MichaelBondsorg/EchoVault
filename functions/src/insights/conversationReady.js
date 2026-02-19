/**
 * Conversation-Ready Insight Scoring
 *
 * Processes Nexus insights to score for "conversation-worthiness" and writes
 * a ranked queue to Firestore. The output is consumed by the relay server's
 * insight injector during voice sessions.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID, DEFAULT_REGION, MEMORY, TIMEOUTS, CRISIS_KEYWORDS } from '../shared/constants.js';

const CONFIDENCE_THRESHOLD = 0.7;
const MAX_QUEUE_SIZE = 5;
const STALENESS_DAYS = 30;

// Crisis keyword regex (matches the pattern from constants)
const CRISIS_REGEX = new RegExp(CRISIS_KEYWORDS.join('|'), 'i');

// Mood gate thresholds by emotional tone
const MOOD_THRESHOLDS = {
  encouraging: 0.3,
  reflective: 0.4,
  challenging: 0.5,
};

// Insight type → emotional tone mapping
const TONE_MAP = {
  intervention: 'encouraging',
  counterfactual: 'encouraging',
  pattern_correlation: 'encouraging',
  causal_synthesis: 'reflective',
  narrative_arc: 'reflective',
  pattern_alert: 'reflective',
  state_comparison: 'reflective',
  belief_dissonance: 'challenging',
};

// Insight type → suggested timing mapping
const TIMING_MAP = {
  intervention: 'session_end',
  counterfactual: 'session_end',
  causal_synthesis: 'natural_pause',
  narrative_arc: 'natural_pause',
  pattern_alert: 'natural_pause',
  pattern_correlation: 'natural_pause',
  state_comparison: 'session_start',
  belief_dissonance: 'session_start',
};

/**
 * Classify emotional tone for an insight.
 */
export function classifyEmotionalTone(insight) {
  return TONE_MAP[insight.type] || 'reflective';
}

/**
 * Get mood gate threshold for a given tone.
 */
export function getMoodGateThreshold(tone) {
  return MOOD_THRESHOLDS[tone] ?? 0.4;
}

/**
 * Check if insight content contains crisis-adjacent terms.
 * Also checks if any related entries are safety-flagged.
 *
 * @param {object} insight
 * @param {Set<string>} [safetyFlaggedEntryIds] - Entry IDs with safety_flagged: true
 */
export function isCrisisAdjacent(insight, safetyFlaggedEntryIds) {
  // Check insight text for crisis keywords
  const text = `${insight.summary || ''} ${insight.body || ''}`;
  if (CRISIS_REGEX.test(text)) return true;

  // Check if any related entries are safety-flagged
  if (safetyFlaggedEntryIds?.size) {
    const relatedIds = insight.threadIds || [];
    if (relatedIds.some(id => safetyFlaggedEntryIds.has(id))) return true;
  }

  return false;
}

/**
 * Compute relevance score (0-1) based on recency and entry overlap.
 */
export function computeRelevanceScore(insight, recentEntries) {
  if (!recentEntries?.length) return 0;

  // Recency factor: how recently the insight was generated (0-1, 1 = just now)
  const generatedMs = insight.generatedAt?.toMillis?.();
  const recencyScore = generatedMs
    ? Math.max(0, 1 - (Date.now() - generatedMs) / (STALENESS_DAYS * 86400000))
    : 0.3; // Default to low-medium if missing

  // Priority factor: higher priority insights score higher
  const priorityScore = insight.priority === 1 ? 1.0 : insight.priority === 2 ? 0.7 : 0.5;

  // Confidence factor
  const confidenceScore = insight.confidence || 0;

  // Entry overlap: do any related threads match recent entry IDs?
  const recentIds = new Set(recentEntries.map(e => e.id));
  const relatedIds = insight.threadIds || [];
  const overlapCount = relatedIds.filter(id => recentIds.has(id)).length;
  const overlapScore = relatedIds.length > 0 ? Math.min(1, overlapCount / relatedIds.length) : 0;

  return (recencyScore * 0.3 + priorityScore * 0.2 + confidenceScore * 0.2 + overlapScore * 0.3);
}

/**
 * Assign suggested delivery timing.
 */
function assignSuggestedTiming(insight) {
  return TIMING_MAP[insight.type] || 'natural_pause';
}

/**
 * Score Nexus insights for conversation-worthiness and write the top results
 * to the user's conversation_queue document.
 *
 * @param {string} userId
 * @returns {Promise<{queued: number, filtered: number}>}
 */
export async function scoreInsightsForConversation(userId) {
  const db = getFirestore();
  const userBase = `artifacts/${APP_COLLECTION_ID}/users/${userId}`;

  try {
    // 1. Check for recent activity (last 30 days)
    const recentEntriesSnap = await db.collection(`${userBase}/entries`)
      .where('createdAt', '>', new Date(Date.now() - STALENESS_DAYS * 86400000))
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    if (recentEntriesSnap.empty) {
      await writeQueue(db, userBase, []);
      return { queued: 0, filtered: 0 };
    }

    const recentEntries = recentEntriesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 2. Read Nexus insights
    const insightsSnap = await db.doc(`${userBase}/nexus/insights`).get();
    if (!insightsSnap.exists) {
      await writeQueue(db, userBase, []);
      return { queued: 0, filtered: 0 };
    }

    const insightsData = insightsSnap.data();
    const activeInsights = insightsData.active || [];
    const history = insightsData.history || [];

    if (activeInsights.length === 0) {
      await writeQueue(db, userBase, []);
      return { queued: 0, filtered: 0 };
    }

    // 3. Build dismissed set from history
    const dismissedIds = new Set(
      history.filter(h => h.engagement?.dismissed).map(h => h.id)
    );

    // 4. Build safety-flagged entry set (check related entries for safety_flagged)
    const allRelatedIds = new Set(activeInsights.flatMap(i => i.threadIds || []));
    const safetyFlaggedEntryIds = new Set();
    if (allRelatedIds.size > 0) {
      const flagChecks = [...allRelatedIds].map(async (entryId) => {
        try {
          const snap = await db.doc(`${userBase}/entries/${entryId}`).get();
          if (snap.exists && snap.data()?.safety_flagged) {
            safetyFlaggedEntryIds.add(entryId);
          }
        } catch { /* skip individual entry read errors */ }
      });
      await Promise.all(flagChecks);
    }

    // 5. Score and filter
    let filtered = 0;
    const scored = [];

    for (const insight of activeInsights) {
      // Confidence filter
      if ((insight.confidence || 0) < CONFIDENCE_THRESHOLD) {
        filtered++;
        continue;
      }

      // Dismissed filter
      if (dismissedIds.has(insight.id)) {
        filtered++;
        continue;
      }

      // Crisis-adjacent filter (checks text + related entry safety flags)
      if (isCrisisAdjacent(insight, safetyFlaggedEntryIds)) {
        filtered++;
        continue;
      }

      // Score it
      const relevanceScore = computeRelevanceScore(insight, recentEntries);
      const emotionalTone = classifyEmotionalTone(insight);

      scored.push({
        insightId: insight.id,
        summary: insight.summary || '',
        fullContext: insight.body || '',
        confidence: insight.confidence || 0,
        emotionalTone,
        relatedEntryIds: insight.threadIds || [],
        suggestedTiming: assignSuggestedTiming(insight),
        moodGateThreshold: getMoodGateThreshold(emotionalTone),
        relevanceScore,
      });
    }

    // 6. Rank and cap
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const queue = scored.slice(0, MAX_QUEUE_SIZE);

    // Remove internal scoring field before writing
    const cleanQueue = queue.map(({ relevanceScore, ...rest }) => rest);

    // 7. Write with optimistic concurrency
    await writeQueue(db, userBase, cleanQueue);

    return { queued: cleanQueue.length, filtered };
  } catch (error) {
    // Log and skip — do not write partial/empty queue on error
    console.error(`[conversationReady] Scoring failed for user:`, error.message);
    return { queued: 0, filtered: 0, error: true };
  }
}

/**
 * Write the conversation queue document with optimistic concurrency.
 */
async function writeQueue(db, userBase, insights) {
  const queueRef = db.doc(`${userBase}/nexus/conversation_queue`);

  await db.runTransaction(async (txn) => {
    const snap = await txn.get(queueRef);
    const currentVersion = snap.exists ? (snap.data().version || 0) : 0;

    txn.set(queueRef, {
      insights,
      lastUpdated: FieldValue.serverTimestamp(),
      version: currentVersion + 1,
    });
  });
}

/**
 * Cloud Function: prepareConversationInsights
 * Callable function to trigger insight scoring for the current user.
 */
export const prepareConversationInsights = onCall({
  region: DEFAULT_REGION,
  memory: MEMORY.standard,
  timeoutSeconds: TIMEOUTS.standard,
}, async (request) => {
  const userId = request.auth?.uid;
  if (!userId) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  try {
    return await scoreInsightsForConversation(userId);
  } catch (error) {
    console.error(`[conversationReady] Error for user ${userId}:`, error.message);
    throw new HttpsError('internal', 'Insight scoring failed');
  }
});
