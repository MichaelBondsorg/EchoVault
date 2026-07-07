import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, APP_COLLECTION_ID } from '../../config';

/**
 * Report an AI-generated insight as inappropriate/inaccurate.
 *
 * Google Play's AI-Generated Content policy requires an in-app way to flag
 * offensive AI output without leaving the app. Writes to the user's
 * insight_reports collection for review; never throws to the caller's UI.
 *
 * @param {string} userId
 * @param {object} insight
 * @param {string} [reason]
 * @returns {Promise<boolean>} true if the report was recorded
 */
export async function reportInsight(userId, insight, reason = 'inappropriate') {
  if (!userId || !insight) return false;
  try {
    const ref = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insight_reports');
    await addDoc(ref, {
      insightId: insight.id || null,
      insightType: insight.type || insight.source || null,
      insightTitle: typeof insight.title === 'string' ? insight.title.slice(0, 200) : null,
      reason,
      reportedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('[reportInsight] failed:', e);
    return false;
  }
}
