/**
 * rankClaims — the unified feed's client-side ordering (R4 Phase 2, Task 6;
 * plan doc "Shared contracts"). Pure and deterministic: given the same
 * claims array and `now`, always produces the same order — no randomness,
 * no hidden clock reads (callers pass `now` explicitly; `Date.now()` is
 * only a convenience default).
 *
 * rankScore(claim) = TYPE_WEIGHT[claimType]*1e6
 *   + Math.min(|effectMoodPoints|, 50)*1e3
 *   + recencyBoost(createdAt)   // 0..999, days-ago decay
 *
 * The three terms are scaled so a higher-priority claimType always outranks
 * every lower one regardless of effect size or recency (1e6 step), a larger
 * effect size always outranks a smaller one within the same type regardless
 * of recency (1e3 step), and recency only breaks ties within the same type
 * + effect-size bucket. Ties in the full score (identical type, effect, and
 * recency-day) fall back to `createdAt` descending, then `id` ascending —
 * both stable, content-derived, and independent of array input order.
 *
 * `functions/src` intentionally keeps its own byte-similar copy for
 * server-side ranking needs (see plan doc's "Type consistency" note #3):
 * ranking is presentational, not an integrity surface, so parity between
 * the two is not enforced by a test the way claimSchema's CAUSAL_RE is.
 */

export const TYPE_WEIGHT = Object.freeze({
  experiment_result: 3,
  pattern_to_watch: 2,
  observation: 1,
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RECENCY_BOOST = 999;

/**
 * Days-ago decay, clamped to the 0..999 range the contract specifies. A
 * claim created "now" (or in the future, e.g. clock skew) gets the max
 * boost; a claim ≥999 days old gets 0. Missing/unparseable `createdAt`
 * also resolves to 0 (oldest-equivalent — never throws, never inflates a
 * malformed claim's rank).
 *
 * @param {string} createdAt - ISO timestamp (buildClaim's contract).
 * @param {number} now - epoch ms to rank against.
 * @returns {number} 0..999
 */
export function recencyBoost(createdAt, now = Date.now()) {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return 0;

  const daysAgo = (now - createdMs) / MS_PER_DAY;
  return Math.max(0, Math.min(MAX_RECENCY_BOOST, Math.round(MAX_RECENCY_BOOST - daysAgo)));
}

/**
 * @param {object} claim
 * @param {{now?: number}} [options]
 * @returns {number}
 */
export function rankScore(claim, { now = Date.now() } = {}) {
  const typeWeight = TYPE_WEIGHT[claim?.claimType] || 0;
  const effect = Math.min(Math.abs(claim?.evidence?.effectMoodPoints ?? 0), 50);
  return typeWeight * 1e6 + effect * 1e3 + recencyBoost(claim?.createdAt, now);
}

/**
 * @param {object[]} claims
 * @param {{now?: number}} [options]
 * @returns {object[]} a NEW array, sorted highest rankScore first. Never
 *   mutates the input array.
 */
export function rankClaims(claims, { now = Date.now() } = {}) {
  if (!Array.isArray(claims)) return [];

  return [...claims].sort((a, b) => {
    const scoreDiff = rankScore(b, { now }) - rankScore(a, { now });
    if (scoreDiff !== 0) return scoreDiff;

    const aCreated = new Date(a?.createdAt).getTime();
    const bCreated = new Date(b?.createdAt).getTime();
    const createdDiff = (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
    if (createdDiff !== 0) return createdDiff;

    const aId = a?.id ?? '';
    const bId = b?.id ?? '';
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
  });
}

export default rankClaims;
