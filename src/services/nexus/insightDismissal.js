/**
 * Nexus Insight Dismissal Persistence (R4 Task 5 + T5b fix, DR finding 10)
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
 * `artifacts/{APP}/users/{userId}/nexus/insights/insight_engagement/{key}`.
 *
 * ## Stable dismissal keys (T5b fix)
 *
 * Not every Nexus insight has a stable `id`. Causal synthesis
 * (`layer3/synthesizer.js`, `insight_${Date.now()}`), recommendations
 * (`orchestrator.js`, `recommendation_${Date.now()}`), and entity
 * correlations (`orchestrator.js`, `entity_${name}_${Date.now()}`) all mint
 * a fresh id every generation — including on Nexus's 30-minute auto-refresh
 * — so keying a dismissal doc by the raw `insight.id` made dismissal a
 * no-op for exactly the insight types most likely to resurface: the same
 * claim would come back with a different id and never match. `dismissalKeyFor`
 * derives a deterministic, CONTENT-based key for those three types instead
 * (documented per-type below) so the SAME claim, id churn and all, still
 * matches. Already-stable ids (`pattern_*`, `calibration`,
 * `crossThreadDetector`'s hardcoded ids like `control_anxiety`, and any
 * other id shape not explicitly churn-prone) use the id itself — unchanged
 * from the original T5 behavior.
 *
 * Honest boundary: if a regeneration reworks the claim's actual content
 * (a different title/intervention/entity+direction), the dismissal key
 * changes and the "new" insight legitimately resurfaces. That's the same
 * claim-identity question the diagnostic feedback taxonomy (Phase 1) will
 * eventually need to answer properly — this is a pragmatic, content-derived
 * approximation, not a semantic dedup.
 *
 * `dismissalKeyFor` below MUST stay in sync with the server-side mirror at
 * `functions/src/reports/dismissalKey.js` (R4 P0-closure Important 3 —
 * weekly/monthly/etc. reports filter dismissed insights out of their inputs
 * server-side, and need the SAME key derivation this client uses, or a
 * dismissed insight could still recur in a report even though it never
 * resurfaces in-app). Same duplicated-on-purpose precedent as
 * `functions/src/safety/crisisKeywords.js` <-> this repo's CRISIS_KEYWORDS.
 *
 * Split into its own module (rather than living directly in orchestrator.js
 * alongside `getCachedInsights`) so `InsightsPage.jsx` can import
 * `recordInsightDismissal`/`dismissalKeyFor` without pulling in
 * orchestrator.js's much heavier layer1-4/health/LLM import graph — this
 * file's only dependency is `firebase/firestore` + config. `orchestrator.js`
 * imports `getDismissedKeys` from here for its own read-time filter seam.
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

const normalizeKeyText = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Derive a stable dismissal key for a Nexus insight (T5b fix — see module
 * doc comment above for the full rationale). Pure, no I/O.
 *
 * @param {Object} insight
 * @returns {string|null}
 */
export const dismissalKeyFor = (insight) => {
  if (!insight) return null;
  const id = insight.id;

  if (typeof id === 'string' && id.startsWith('insight_')) {
    // Causal synthesis (layer3/synthesizer.js) — id is `insight_${Date.now()}`.
    // Content-derived: normalized title (falls back to summary — the LLM
    // output always carries at least one of the two).
    return `synthesis:${normalizeKeyText(insight.title || insight.summary)}`;
  }

  if (typeof id === 'string' && id.startsWith('recommendation_')) {
    // Recommendations (orchestrator.js, wraps layer4/recommendationEngine.js)
    // — id is `recommendation_${Date.now()}`. `intervention` is the
    // recommendation engine's own stable key (e.g. 'pet_walk',
    // 'acts_of_service'), spread directly onto the insight — prefer it;
    // fall back to the normalized title for any shape that lacks it.
    return `recommendation:${insight.intervention || normalizeKeyText(insight.title)}`;
  }

  if (typeof id === 'string' && id.startsWith('entity_')) {
    // Entity correlations (orchestrator.js) — id has a Date.now() suffix.
    // entityName/direction aren't first-class fields on the insight, but
    // the title ("X Effect") and evidence.statistical.moodDelta's sign are.
    const entityName = normalizeKeyText((insight.title || '').replace(/\s+effect$/i, ''));
    const moodDelta = insight.evidence?.statistical?.moodDelta;
    const direction = typeof moodDelta === 'number' ? (moodDelta > 0 ? 'boosts' : 'lowers') : '';
    return `entity_correlation:${entityName}:${direction}`;
  }

  // Already-stable ids (pattern_*, calibration, cross-thread's hardcoded
  // ids, and anything else not explicitly churn-prone above) — the id
  // itself IS the stable key. Non-string/absent ids fall through to null.
  return typeof id === 'string' ? id : null;
};

/**
 * Persist a Nexus insight dismissal so it survives reload AND regeneration
 * (R1's "dismissal-is-final" posture, extended to Nexus). Keyed by the
 * insight's `dismissalKeyFor` value (NOT its raw `id` — see module doc
 * comment) so a content-stable insight stays dismissed even when its own
 * id churns on the next generation. Idempotent per key — a repeat dismiss
 * of the "same" insight just re-merges the same doc.
 *
 * @param {string} userId
 * @param {Object} insight - the full insight object (needed to derive the key)
 * @returns {Promise<boolean>} true if the write succeeded
 */
export const recordInsightDismissal = async (userId, insight) => {
  const key = dismissalKeyFor(insight);
  if (!userId || !key) return false;
  try {
    const ref = doc(getInsightEngagementCollectionRef(userId), key);
    await setDoc(ref, {
      dismissed: true,
      dismissedAt: Timestamp.now(),
      dismissalKey: key,
      insightId: insight?.id ?? null,
    }, { merge: true });
    return true;
  } catch (error) {
    console.error('[InsightDismissal] Failed to persist insight dismissal:', error);
    return false;
  }
};

/**
 * Read every durably-dismissed insight's dismissalKey for a user.
 * @param {string} userId
 * @returns {Promise<Set<string>>}
 */
export const getDismissedKeys = async (userId) => {
  if (!userId) return new Set();
  try {
    const snapshot = await getDocs(getInsightEngagementCollectionRef(userId));
    const keys = new Set();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data?.dismissed) keys.add(data.dismissalKey || docSnap.id);
    });
    return keys;
  } catch (error) {
    console.error('[InsightDismissal] Failed to load dismissed insight keys:', error);
    return new Set();
  }
};

export default {
  dismissalKeyFor,
  recordInsightDismissal,
  getDismissedKeys,
};
