/**
 * Nexus insight staleness (extracted from orchestrator.js, R2 Task 10).
 *
 * A single, cheap write: flip `nexus/insights.stale = true` so the next
 * dashboard load (or manual refresh) regenerates instead of serving the
 * cached `active` array.
 *
 * This used to be a private helper inside orchestrator.js. It's pulled out
 * into its own leaf module so callers that only need this one write —
 * recompute.js's `onSourcesChanged` fan-out (itself called from source
 * exclusion create/restore and EntryCard's Space re-scope) — don't have to
 * pull in the entire Nexus engine (Layer 1-4, health/whoop, belief
 * dissonance, etc.) just to flip a boolean. orchestrator.js now imports
 * this too, so there is a single implementation, not a fork.
 */
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

/**
 * @param {string} userId
 */
export const markInsightsStale = async (userId) => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );

  await setDoc(insightRef, {
    stale: true,
    staleAt: Timestamp.now()
  }, { merge: true });
};

export default { markInsightsStale };
