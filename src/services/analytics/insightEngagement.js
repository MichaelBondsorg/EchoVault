import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, APP_COLLECTION_ID } from '../../config';

/**
 * Record a lightweight engagement event for a Nexus insight card.
 *
 * Instruments which insights get engagement (explored vs dismissed) so we can
 * learn which insight types resonate. Writes to the user's private
 * insight_engagement_events collection. Best-effort — never throws to the
 * caller's UI, and stores only id/type/action (NO insight text or PII).
 *
 * @param {string} userId
 * @param {object} insight
 * @param {'explored'|'dismissed'} action
 * @returns {Promise<boolean>} true if the event was recorded
 */
export async function recordInsightEngagement(userId, insight, action) {
  if (!userId || !insight || !action) return false;
  try {
    const ref = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insight_engagement_events');
    await addDoc(ref, {
      insightId: insight.id ?? null,
      insightType: insight.type ?? insight.source ?? null,
      action,
      recordedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('[recordInsightEngagement] failed:', e);
    return false;
  }
}
