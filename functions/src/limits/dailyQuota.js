/**
 * Per-user daily rate limiting for AI callables.
 *
 * Firestore-backed quota: a per-user, per-day counter document is read and
 * incremented inside a transaction. When the daily limit is exceeded the
 * caller gets a `resource-exhausted` HttpsError so an authenticated user
 * cannot run up an unbounded LLM bill.
 *
 * Counter doc path:
 *   artifacts/{APP_COLLECTION_ID}/users/{userId}/rate_limits/{key}-{YYYY-MM-DD}
 */

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { APP_COLLECTION_ID } from '../shared/constants.js';

/**
 * UTC date stamp (YYYY-MM-DD) used to bucket the daily counter.
 * @param {Date} [now]
 * @returns {string}
 */
function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Enforce a per-user daily quota for a given operation family.
 *
 * Reads/increments a per-user, per-day counter document inside a transaction
 * and throws `HttpsError('resource-exhausted', ...)` once the limit is hit.
 *
 * @param {string} userId - The authenticated user's uid.
 * @param {object} opts
 * @param {string} opts.key - Operation family key (e.g. 'analyze', 'transcribe').
 * @param {number} opts.limit - Max allowed calls per UTC day for this key.
 * @returns {Promise<number>} The user's count for this key/day after incrementing.
 */
export async function enforceDailyQuota(userId, { key, limit } = {}) {
  if (!userId || typeof userId !== 'string') {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  if (!key || typeof key !== 'string') {
    throw new HttpsError('internal', 'Rate limit key is required');
  }
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    throw new HttpsError('internal', 'Rate limit must be a positive number');
  }

  const db = getFirestore();
  const docId = `${key}-${dayStamp()}`;
  const ref = db.doc(
    `artifacts/${APP_COLLECTION_ID}/users/${userId}/rate_limits/${docId}`
  );

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = (snap.exists && typeof snap.data()?.count === 'number')
        ? snap.data().count
        : 0;

      if (current >= limit) {
        throw new HttpsError(
          'resource-exhausted',
          `Daily limit reached for this operation. Please try again tomorrow.`
        );
      }

      const next = current + 1;
      tx.set(
        ref,
        { count: next, key, day: dayStamp(), updatedAt: new Date() },
        { merge: true }
      );
      return next;
    });
  } catch (e) {
    // Re-throw quota rejections; wrap unexpected transaction failures without
    // ever logging user text (there is none here — only ids/keys).
    if (e instanceof HttpsError) throw e;
    console.error('[enforceDailyQuota] transaction failed', {
      userId,
      key,
      err: e?.message,
    });
    // Fail open on infrastructure errors so a Firestore blip doesn't block
    // legitimate users; the input-size caps still bound abuse.
    return 0;
  }
}

export default enforceDailyQuota;
