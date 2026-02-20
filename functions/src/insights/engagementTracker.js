/**
 * Insight Engagement Tracking Pipeline
 *
 * Callable Cloud Function that receives engagement data from the relay server
 * after a voice session ends. Writes individual engagement records to Firestore
 * and feeds aggregated outcome data to the Nexus Layer 4 Intervention Optimizer.
 *
 * Called by: relay-server/src/insights/insightInjector.ts (Section 09)
 * Writes to: users/{userId}/nexus/insight_engagement/{engagementId}
 * Updates: users/{userId}/nexus/intervention_optimizer
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID, DEFAULT_REGION, MEMORY, TIMEOUTS } from '../shared/constants.js';

/** @returns {FirebaseFirestore.Firestore} */
function getDb() { return getFirestore(); }

const VALID_RESPONSES = ['explored', 'dismissed', 'deferred'];
const VALID_TIMINGS = ['session_start', 'natural_pause', 'session_end'];
const VALID_INSIGHT_TYPE_PATTERN = /^[a-z_]+$/;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 4000, 16000]; // exponential backoff
const TRANSIENT_GRPC_CODES = [14, 4, 10]; // UNAVAILABLE, DEADLINE_EXCEEDED, ABORTED

/**
 * Clamp a mood score to the [0, 1] range.
 */
export function clampMood(value) {
  return Math.min(1, Math.max(0, value));
}

/**
 * Sanitize insightType for safe use in Firestore field paths.
 * Only allows lowercase letters and underscores. Falls back to 'unknown'.
 */
export function sanitizeInsightType(insightType) {
  if (!insightType || typeof insightType !== 'string') return 'unknown';
  if (!VALID_INSIGHT_TYPE_PATTERN.test(insightType)) return 'unknown';
  return insightType;
}

/**
 * Validate the engagement payload from the relay server.
 * Throws on invalid data.
 */
export function validateEngagementPayload(payload) {
  if (!payload.userId || typeof payload.userId !== 'string') {
    throw new Error('Invalid payload: userId is required and must be a string');
  }

  if (!Array.isArray(payload.engagements)) {
    throw new Error('Invalid payload: engagements must be an array');
  }

  for (const eng of payload.engagements) {
    if (!eng.insightId || typeof eng.insightId !== 'string') {
      throw new Error('Invalid engagement: insightId is required');
    }
    if (!eng.sessionId || typeof eng.sessionId !== 'string') {
      throw new Error('Invalid engagement: sessionId is required');
    }
    if (!VALID_TIMINGS.includes(eng.deliveryTiming)) {
      throw new Error(`Invalid engagement: deliveryTiming must be one of ${VALID_TIMINGS.join(', ')}`);
    }
    if (!VALID_RESPONSES.includes(eng.userResponse)) {
      throw new Error(`Invalid engagement: userResponse must be one of ${VALID_RESPONSES.join(', ')}`);
    }
    if (typeof eng.explorationDepth !== 'number' || eng.explorationDepth < 0) {
      throw new Error('Invalid engagement: explorationDepth must be a non-negative number');
    }
    if (typeof eng.moodBefore !== 'number') {
      throw new Error('Invalid engagement: moodBefore is required');
    }
    if (typeof eng.moodAfter !== 'number') {
      throw new Error('Invalid engagement: moodAfter is required');
    }
    if (typeof eng.timestamp !== 'number') {
      throw new Error('Invalid engagement: timestamp is required');
    }
  }
}

/**
 * Compute the optimizer update data from a single engagement event.
 */
export function computeOptimizerUpdate(engagement) {
  return {
    insightType: sanitizeInsightType(engagement.insightType),
    deliveryTiming: engagement.deliveryTiming,
    userResponse: engagement.userResponse,
    explorationDepth: engagement.explorationDepth,
    moodDelta: engagement.moodAfter - engagement.moodBefore,
  };
}

/**
 * Build Firestore field updates for the intervention optimizer.
 * Uses FieldValue.increment() for concurrent-safe counter updates.
 */
function buildOptimizerUpdates(optimizerUpdates) {
  const fields = {};

  for (const update of optimizerUpdates) {
    const { insightType, deliveryTiming, userResponse, moodDelta, explorationDepth } = update;

    // Insight type stats
    fields[`insightTypeStats.${insightType}.totalDelivered`] = FieldValue.increment(1);
    fields[`insightTypeStats.${insightType}.${userResponse}`] = FieldValue.increment(1);
    fields[`insightTypeStats.${insightType}.totalMoodDelta`] = FieldValue.increment(moodDelta);
    fields[`insightTypeStats.${insightType}.totalExplorationDepth`] = FieldValue.increment(explorationDepth);

    // Timing stats
    fields[`timingStats.${deliveryTiming}.totalDelivered`] = FieldValue.increment(1);
    fields[`timingStats.${deliveryTiming}.${userResponse}`] = FieldValue.increment(1);
    fields[`timingStats.${deliveryTiming}.totalMoodDelta`] = FieldValue.increment(moodDelta);

    // Last updated
    fields['lastUpdated'] = FieldValue.serverTimestamp();
  }

  return fields;
}

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is a transient gRPC error that should be retried.
 */
function isTransientError(error) {
  return TRANSIENT_GRPC_CODES.includes(error?.code);
}

/**
 * Process engagement data: validate, write records, update optimizer.
 * Retries on transient Firestore errors.
 */
export async function processEngagement(payload) {
  validateEngagementPayload(payload);

  const { userId, engagements } = payload;

  if (engagements.length === 0) {
    return { success: true, recordsWritten: 0 };
  }

  const basePath = `artifacts/${APP_COLLECTION_ID}/users/${userId}/nexus`;
  const engagementCollectionPath = `${basePath}/insight_engagement`;
  const optimizerDocPath = `${basePath}/intervention_optimizer`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const db = getDb();
      const batch = db.batch();
      const optimizerUpdates = [];

      // Write individual engagement records
      for (const eng of engagements) {
        const docRef = db.collection(engagementCollectionPath).doc();
        const moodBefore = clampMood(eng.moodBefore);
        const moodAfter = clampMood(eng.moodAfter);

        batch.set(docRef, {
          insightId: eng.insightId,
          sessionId: eng.sessionId,
          deliveryTiming: eng.deliveryTiming,
          userResponse: eng.userResponse,
          explorationDepth: eng.explorationDepth,
          moodBefore,
          moodAfter,
          timestamp: Timestamp.fromMillis(eng.timestamp),
          insightType: sanitizeInsightType(eng.insightType),
          createdAt: FieldValue.serverTimestamp(),
        });

        optimizerUpdates.push(
          computeOptimizerUpdate({ ...eng, moodBefore, moodAfter })
        );
      }

      // Update intervention optimizer with aggregated stats
      const optimizerRef = db.doc(optimizerDocPath);
      const optimizerFields = buildOptimizerUpdates(optimizerUpdates);
      batch.set(optimizerRef, optimizerFields, { merge: true });

      await batch.commit();

      return { success: true, recordsWritten: engagements.length };
    } catch (error) {
      if (isTransientError(error) && attempt < MAX_RETRIES - 1) {
        console.warn(
          `[engagementTracker] Transient error on attempt ${attempt + 1}, retrying in ${RETRY_DELAYS[attempt]}ms:`,
          error.message
        );
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }

      console.error(
        `[engagementTracker] Failed to write engagement for user ${userId} after ${attempt + 1} attempts:`,
        error
      );
      return { success: false, error: 'write_failed' };
    }
  }

  return { success: false, error: 'write_failed' };
}

/**
 * trackInsightEngagement - Callable Cloud Function (Gen2)
 *
 * Receives insight engagement data from the relay server after a voice session
 * ends. Validates the payload, writes engagement records, and updates the
 * Nexus Layer 4 Intervention Optimizer.
 */
export const trackInsightEngagement = onCall(
  {
    region: DEFAULT_REGION,
    timeoutSeconds: TIMEOUTS.standard,
    memory: MEMORY.standard,
  },
  async (request) => {
    // Auth check: require authenticated caller
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const data = request.data;

    // Verify caller matches userId or has admin privileges
    if (data.userId && data.userId !== request.auth.uid) {
      // Allow service accounts (relay server) that have admin token
      if (!request.auth.token?.admin) {
        throw new HttpsError('permission-denied', 'Cannot write engagement data for another user');
      }
    }

    try {
      return await processEngagement(data);
    } catch (error) {
      if (error.message?.startsWith('Invalid')) {
        throw new HttpsError('invalid-argument', error.message);
      }
      throw new HttpsError('internal', 'Failed to process engagement data');
    }
  }
);
