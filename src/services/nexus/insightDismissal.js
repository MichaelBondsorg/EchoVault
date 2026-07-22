/**
 * Nexus Insight Dismissal Persistence (R4 Task 5, DR finding 10)
 *
 * The "Dismiss insight" button on a Nexus insight card
 * (`src/pages/InsightsPage.jsx`'s `handleDismissInsight`) only ever touched
 * `dismissedInsights`, a local React-state `Set` — an instant, in-tab-only
 * filter that vanished on reload. `recordInsightEngagement`
 * (`src/services/analytics/insightEngagement.js`) *did* write a `dismissed`
 * event to `insight_engagement_events`, but nothing ever read that log
 * back, and it's an append-only event stream anyway (not a per-insight
 * lookup), so it was never usable as a durability seam.
 *
 * This module reuses the collection `firestore.rules` ALREADY grants owner
 * read/write on (`nexus/{nexusDocId}/insight_engagement/{engagementId}`,
 * added pre-R4 and never wired up in code) rather than inventing a new
 * one — `nexusDocId` is `insights`, the same doc
 * `src/services/nexus/orchestrator.js`'s `getCachedInsights` reads, so the
 * subcollection lives at
 * `artifacts/{APP}/users/{userId}/nexus/insights/insight_engagement/{insightId}`,
 * one doc per insight id, keyed so a repeat dismiss is a no-op merge, not a
 * growing log.
 *
 * Split into its own module (rather than living directly in orchestrator.js
 * alongside `getCachedInsights`) so `InsightsPage.jsx` can import
 * `recordInsightDismissal` without pulling in orchestrator.js's much
 * heavier layer1-4/health/LLM import graph — this file's only dependency
 * is `firebase/firestore` + config. `orchestrator.js` imports
 * `getDismissedInsightIds` from here for its own read-time filter seam.
 *
 * Seam choice (read-time, not generation-time, per plan): `generateInsights`
 * itself is untouched — dismissals are filtered ONLY where insights are
 * read back out (`getCachedInsights`), which is cheaper (one extra read per
 * load, not a write-time join on every generation) and never perturbs the
 * receipts/exclusions/suppression pipeline already inside `generateInsights`.
 */

import { doc, setDoc, collection, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

const getInsightEngagementCollectionRef = (userId) =>
  collection(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights', 'insight_engagement'
  );

/**
 * Persist a Nexus insight dismissal so it survives reload (R1's
 * "dismissal-is-final" posture, extended to Nexus). Idempotent per
 * insightId — a repeat dismiss just re-merges the same doc.
 *
 * @param {string} userId
 * @param {string} insightId
 * @returns {Promise<boolean>} true if the write succeeded
 */
export const recordInsightDismissal = async (userId, insightId) => {
  if (!userId || !insightId) return false;
  try {
    const ref = doc(getInsightEngagementCollectionRef(userId), insightId);
    await setDoc(ref, { dismissed: true, dismissedAt: Timestamp.now() }, { merge: true });
    return true;
  } catch (error) {
    console.error('[InsightDismissal] Failed to persist insight dismissal:', error);
    return false;
  }
};

/**
 * Read every durably-dismissed insight id for a user.
 * @param {string} userId
 * @returns {Promise<Set<string>>}
 */
export const getDismissedInsightIds = async (userId) => {
  if (!userId) return new Set();
  try {
    const snapshot = await getDocs(getInsightEngagementCollectionRef(userId));
    const ids = new Set();
    snapshot.forEach((docSnap) => {
      if (docSnap.data()?.dismissed) ids.add(docSnap.id);
    });
    return ids;
  } catch (error) {
    console.error('[InsightDismissal] Failed to load dismissed insight ids:', error);
    return new Set();
  }
};

export default {
  recordInsightDismissal,
  getDismissedInsightIds,
};
