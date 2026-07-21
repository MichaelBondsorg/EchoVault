/**
 * Recompute / staleness fan-out (R2 Task 10).
 *
 * Whenever the set of "sources" feeding derived artifacts (Nexus insights,
 * dashboard daily summaries, weekly digests) changes — a source exclusion
 * is created or restored, or an entry moves Context Space — every derived
 * artifact needs to know it's stale so the next view regenerates instead of
 * showing content built from a source set the user no longer wants
 * included.
 *
 * PRD acceptance: "stale within 10 seconds". Every write below is an
 * immediate, awaited Firestore write — no debounce, no queue — so a caller
 * that awaits `onSourcesChanged` is guaranteed all three are marked stale
 * before it returns (in practice, orders of magnitude under 10s).
 *
 * `db` is accepted for call-site symmetry with the exclusion mutators that
 * call this (`excludeSource`/`restoreSource` in sourceExclusions.js, which
 * use it directly for their own doc writes) — the fan-out functions here
 * each resolve their own `db` from `config/firebase` internally, same as
 * `markInsightsStale`/`invalidateDailySummary`/`invalidateWeeklyDigest`
 * already do.
 */
import { markInsightsStale } from '../nexus/staleness';
import { invalidateDailySummary, invalidateWeeklyDigest } from '../dashboard';

const CATEGORIES = ['personal', 'work'];

/**
 * @param {object} db
 * @param {string} uid
 */
export async function onSourcesChanged(db, uid) {
  const now = new Date();

  await Promise.all([
    markInsightsStale(uid),
    ...CATEGORIES.map((category) => invalidateDailySummary(uid, category, now)),
    ...CATEGORIES.map((category) => invalidateWeeklyDigest(uid, category, now)),
  ]);
}

export default { onSourcesChanged };
