/**
 * Personal Experiments — pure estimator core.
 *
 * Spec: docs/quality/experiments-data-method.md. This module enforces that
 * spec's 8 numbered defaults exactly (thresholds below are copied from it,
 * not re-derived) and is the ONLY place those thresholds live — every other
 * consumer must import the constants from here rather than re-hardcoding.
 *
 * PURE MODULE — zero imports from firebase, Capacitor, or any app service.
 * No network calls, no Date.now()-based defaults, no Math.random anywhere
 * (including implicit defaults): every source of nondeterminism is either
 * an explicit input or derived deterministically from the inputs. This is
 * what lets Task 5's `computeResult` be a deterministic, re-runnable
 * function of (experiment, entries) — rerunning after an observation
 * exclusion must reproduce the same numbers for unaffected inputs.
 *
 * This module is deliberately standalone from the three existing Pearson
 * implementations (`src/utils/statistics.js`,
 * `src/services/basicInsights/utils/statisticalHelpers.js`,
 * `src/services/health/healthMoodCorrelation.js`). Those are untouched by
 * this task. Their shared defect — insufficient data silently becomes a
 * magic `0` or `null` correlation instead of a distinguishable "we don't
 * know" state — is exactly what this module avoids: missing/non-finite
 * values are dropped from pairing (never coerced to 0), and insufficiency
 * is always a structured `{status: 'insufficient', reasons: [...]}` object,
 * never a number that looks like a real answer.
 */

// ---------------------------------------------------------------------------
// Spec constants (data-method spec, defaults 1-3). Import these instead of
// re-hardcoding the thresholds anywhere else in the experiments pipeline.
// ---------------------------------------------------------------------------

/** Default #1: minimum paired observations before an estimate is computed. */
export const MIN_PAIRED_OBSERVATIONS = 10;

/** Default #2: each variable must cover at least this fraction of elapsed days. */
export const COVERAGE_FLOOR = 0.5;

/** Default #3: bootstrap resample count for the 95% CI. */
export const BOOTSTRAP_RESAMPLES = 2000;

/** Default #3: confidence level for the bootstrap CI. */
export const CI_LEVEL = 0.95;

// ---------------------------------------------------------------------------
// Michael's statistical-review hardening (2026-07-22, Task EX1). These four
// constants are new gates/thresholds layered on top of the original 4
// spec defaults above — see docs/quality/experiments-data-method.md's
// "Michael review hardening" section for the full rationale on each.
//
// ROUND-2 (2026-07-22, same day, second pass — Michael's direct review of
// THIS hardening): `RESAMPLE_FALLBACK_LIMIT` renamed to
// `RESAMPLE_DISCARD_LIMIT` (the fallback algorithm it gated is removed
// entirely, replaced by a discard policy — see
// `bootstrapDeltaCIPerResampleSplit`'s docblock); `DEFAULT_MIN_EXPOSURE_CONTRAST`
// added (item 1 — the exposure-contrast guard now reads a PLAN-supplied,
// template-specific minimum instead of a bare `> 0` check); `computeStability`
// rewritten to recompute the split and eligibility gates per LOO iteration
// instead of adjusting the original split's means (item 2). See
// docs/quality/experiments-data-method.md's "Round-2" section for Michael's
// exact directive and the full rationale on each.
// ---------------------------------------------------------------------------

/**
 * Group-size guard: each split group (high/low) must have at least this many
 * paired observations, or the result is insufficient (`group_too_small`).
 * Applies to BOTH split modes (median and binary). A group below this size
 * produces a mean that is itself dominated by a handful of points, even
 * though the OVERALL pair count cleared `MIN_PAIRED_OBSERVATIONS`.
 */
export const MIN_GROUP_SIZE = 5;

/**
 * Group-size guard: the smaller of the two split groups must be at least
 * this fraction of the total paired observations, or the result is
 * insufficient (`groups_too_imbalanced`). Applies to BOTH split modes. This
 * catches lopsided splits (e.g. 27 vs 3) that could individually clear
 * `MIN_GROUP_SIZE` on a larger sample while still being wildly imbalanced.
 */
export const MIN_GROUP_FRACTION = 0.25;

/**
 * Per-resample-split stability guard (item 3; RENAMED from
 * `RESAMPLE_FALLBACK_LIMIT` in Michael's round-2 statistical review,
 * 2026-07-22 — see docs/quality/experiments-data-method.md's "Round-2"
 * section): if more than this fraction of the bootstrap's resamples had
 * their OWN recomputed split degenerate (empty high or low group — see
 * `bootstrapDeltaCIPerResampleSplit`'s docblock) and were DISCARDED as a
 * result, the split itself is judged too unstable to trust and the result is
 * insufficient (`split_unstable`), even though every other gate passed.
 * Comparison is strict `>` (a discard rate of exactly 10% does NOT trigger
 * this) — unchanged threshold value and comparison from the pre-round-2
 * fallback policy, only the numerator's MEANING changed (discarded resamples,
 * not resamples computed via a fallback algorithm).
 */
export const RESAMPLE_DISCARD_LIMIT = 0.1;

/**
 * Practical-significance threshold (item 5) — DISPLAY-SCALE (0-100), i.e.
 * "points" on the 0-100 mood/outcome scale EX2 introduces at the series
 * boundary. This module itself stays unit-agnostic (it never compares
 * `delta` to this constant internally) — it is exported here purely so
 * there is exactly ONE source of truth for the number, and EX2's
 * classification/UI layer imports it rather than re-hardcoding `5`
 * somewhere else. See docs/quality/experiments-data-method.md for the
 * exact wording shown to users when a result falls under this threshold.
 */
export const SMALL_EFFECT_DELTA = 5;

/**
 * Default exposure-contrast minimum for a LEGACY plan that doesn't declare
 * its own `minExposureContrast` (Michael's round-2 statistical review,
 * 2026-07-22, item 1 — see docs/quality/experiments-data-method.md's
 * "Round-2" section). `runAnalysisPlan` reads `plan.minExposureContrast ??
 * DEFAULT_MIN_EXPOSURE_CONTRAST` — every REAL v1 template now declares its
 * own (template-specific, unit-aware) minimum via `templates.js` and
 * `experimentsService.buildAnalysisPlan` freezes it onto the plan, so this
 * `0` floor only ever applies to a plan built by test code or a pre-round-2
 * legacy plan that predates the field. At `0` the guard is the original
 * (pre-round-2) `contrast > 0` check — structurally unreachable for a
 * non-degenerate split, exactly as EX1 documented — so "legacy plan without
 * the field -> old behavior" holds exactly.
 */
export const DEFAULT_MIN_EXPOSURE_CONTRAST = 0;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Date-key helpers — all arithmetic goes through Date.UTC so pairing and
// coverage are timezone-independent (never depend on the host's local TZ).
// ---------------------------------------------------------------------------

/** Parse a 'YYYY-MM-DD' dateKey to its UTC midnight epoch ms, or null if malformed. */
function parseDateKeyToUtcMs(dateKey) {
  if (typeof dateKey !== 'string') return null;
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return null;
  const [, y, mo, d] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d));
}

/** Format a UTC midnight epoch ms back to a 'YYYY-MM-DD' dateKey. */
function formatUtcMsToDateKey(ms) {
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Shift a dateKey by `days` (may be negative), correct across month/year boundaries. */
function shiftDateKey(dateKey, days) {
  const ms = parseDateKeyToUtcMs(dateKey);
  if (ms === null) return null;
  return formatUtcMsToDateKey(ms + days * DAY_MS);
}

// ---------------------------------------------------------------------------
// pairObservations
// ---------------------------------------------------------------------------

/**
 * Pair an exposure series with an outcome series by date, per the template's
 * declared lag (data-method spec default #6 — lag is pre-declared per
 * template, not chosen at analysis time).
 *
 * @param {Object} args
 * @param {{dateKey: string, value: number}[]} args.exposureSeries
 * @param {{dateKey: string, value: number}[]} args.outcomeSeries
 * @param {number} [args.lag=0] - 0 = same-day pairing; 1 = exposure day D
 *   pairs with outcome day D+1 (next calendar day, UTC arithmetic).
 * @returns {{dateKey: string, outcomeDateKey: string, exposure: number, outcome: number}[]}
 *   One entry per paired day, sorted by `dateKey` then `outcomeDateKey`
 *   (canonical order — NOT `exposureSeries` input order). Non-finite or
 *   missing values (NaN, null, undefined, Infinity) on EITHER side are
 *   dropped from pairing entirely — never coerced to 0 (the magic-zero bug
 *   class in the three existing Pearson implementations).
 *
 *   Sorting the output is deliberate hygiene, not just cosmetic: callers
 *   (Firestore reads, in particular) do not guarantee a stable document
 *   order, and `runAnalysisPlan` also independently canonicalizes its
 *   `pairs` input before use — see that function's docblock for why input
 *   order must never affect the computed estimate.
 */
export function pairObservations({ exposureSeries = [], outcomeSeries = [], lag = 0 } = {}) {
  const outcomeByDate = new Map();
  for (const obs of outcomeSeries || []) {
    if (!obs || typeof obs.dateKey !== 'string') continue;
    if (!Number.isFinite(obs.value)) continue; // drop, don't coerce
    outcomeByDate.set(obs.dateKey, obs.value);
  }

  const pairs = [];
  for (const obs of exposureSeries || []) {
    if (!obs || typeof obs.dateKey !== 'string') continue;
    if (!Number.isFinite(obs.value)) continue; // drop, don't coerce
    const outcomeDateKey = lag === 0 ? obs.dateKey : shiftDateKey(obs.dateKey, lag);
    if (outcomeDateKey === null) continue;
    if (!outcomeByDate.has(outcomeDateKey)) continue;
    pairs.push({
      dateKey: obs.dateKey,
      outcomeDateKey,
      exposure: obs.value,
      outcome: outcomeByDate.get(outcomeDateKey),
    });
  }
  return canonicalizePairs(pairs);
}

/**
 * Sort a copy of `pairs` by `dateKey` then `outcomeDateKey` (stable,
 * deterministic order independent of input array order). This is the
 * canonicalization step that makes both the derived-seed hash and the
 * bootstrap resampling order-independent — see `runAnalysisPlan`'s
 * docblock.
 */
function canonicalizePairs(pairs) {
  return [...pairs].sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    if (a.outcomeDateKey !== b.outcomeDateKey) return a.outcomeDateKey < b.outcomeDateKey ? -1 : 1;
    return 0;
  });
}

/**
 * Days between a pair's exposure day and its outcome day (outcomeDateKey -
 * dateKey), via UTC epoch-ms arithmetic. Used by `runAnalysisPlan`'s
 * lag-consistency check. Returns null if either dateKey is malformed.
 */
function pairLagDays(pair) {
  const startMs = parseDateKeyToUtcMs(pair.dateKey);
  const endMs = parseDateKeyToUtcMs(pair.outcomeDateKey);
  if (startMs === null || endMs === null) return null;
  return Math.round((endMs - startMs) / DAY_MS);
}

// ---------------------------------------------------------------------------
// computeCoverage
// ---------------------------------------------------------------------------

/**
 * Data-method spec default #2 — "N of M days" coverage for one variable's
 * series over an explicit window. Conceptually mirrors
 * `src/services/insights/receipts.js`'s `computeMissingness` day-bucketing,
 * but is pure and takes explicit ms bounds instead of reading a timeWindow
 * object or importing receipts.js (this module has zero app dependencies).
 *
 * @param {{dateKey: string, value: number}[]} series
 * @param {number} startMs - inclusive window start (UTC epoch ms)
 * @param {number} endMs - exclusive window end (UTC epoch ms)
 * @returns {{covered: number, total: number, label: string}}
 */
export function computeCoverage(series, startMs, endMs) {
  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS));
  const daysWithValue = new Set();
  for (const obs of series || []) {
    if (!obs || typeof obs.dateKey !== 'string') continue;
    if (!Number.isFinite(obs.value)) continue;
    const ms = parseDateKeyToUtcMs(obs.dateKey);
    if (ms === null) continue;
    if (ms < startMs || ms >= endMs) continue; // half-open window, matches totalDays count
    daysWithValue.add(obs.dateKey);
  }
  const covered = daysWithValue.size;
  return { covered, total: totalDays, label: `${covered} of ${totalDays} days` };
}

// ---------------------------------------------------------------------------
// Deterministic seedable RNG (mulberry32) + seed derivation
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic 32-bit PRNG. Returns a fn () => [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit string hash — deterministic, no randomness/time involved. */
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Derive a deterministic seed from the pairs themselves when no seed is
 * supplied. Never falls back to Math.random() or Date.now() — the spec
 * requires the bootstrap to be reproducible from (pairs, seed) alone, and
 * "no seed provided" must still be reproducible, not merely "random but
 * consistent within one process."
 *
 * IMPORTANT: callers must pass an already-canonicalized (sorted) `pairs`
 * array. Hashing in arrival order would make the derived seed — and
 * therefore the whole bootstrap CI — sensitive to how the caller happened
 * to order its input (e.g. Firestore document order), which breaks the
 * "same data, same result" reproducibility guarantee. `runAnalysisPlan`
 * canonicalizes before calling this.
 */
function deriveSeedFromPairs(pairs) {
  let str = '';
  for (const p of pairs) {
    str += `${p.dateKey}|${p.exposure}|${p.outcome};`;
  }
  return fnv1a(str);
}

// ---------------------------------------------------------------------------
// Statistics helpers (local — deliberately not importing the existing
// statistics.js/statisticalHelpers.js modules; this module stays dependency-free)
// ---------------------------------------------------------------------------

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Split pairs into high/low groups by the exposure median.
 * Tie-breaking rule (data-method spec, documented choice): values EQUAL to
 * the median go to the LOW group. The specific direction is arbitrary; what
 * matters is that it is fixed and deterministic so reruns are stable.
 *
 * @returns {{highGroup: object[], lowGroup: object[], splitThreshold: number}}
 *   `splitThreshold` is the computed median value used as the cut point —
 *   surfaced on the estimate (item 6, Michael review hardening) so a caller
 *   can show/receipt exactly where the high/low line was drawn.
 */
function medianSplit(pairs) {
  const med = median(pairs.map((p) => p.exposure));
  const highGroup = [];
  const lowGroup = [];
  for (const p of pairs) {
    if (p.exposure > med) {
      highGroup.push(p);
    } else {
      // p.exposure <= med, including exact ties -> LOW group.
      lowGroup.push(p);
    }
  }
  return { highGroup, lowGroup, splitThreshold: med };
}

/**
 * Binary present-vs-absent split (Michael review hardening, item 2):
 * HIGH = exposure present (> 0), LOW = exposure absent (=== 0). Unlike
 * `medianSplit`, there is no data-derived cut point — the boundary is fixed
 * by definition, not computed from the sample — so `splitThreshold` is
 * PINNED to `null` rather than reporting a fabricated statistic (e.g. `0` or
 * `0.5`) that would misleadingly look like a computed median. This is a
 * deliberate, documented choice (see docs/quality/experiments-data-method.md)
 * over the alternative of reporting a "0.5 boundary" number, because
 * exposure values in binary mode are not necessarily 0/1-coded (e.g.
 * "exercise minutes present" could be any positive number) — a `0.5`
 * threshold would only be meaningful for strictly-binary-coded inputs and
 * would be actively misleading for others.
 *
 * @returns {{highGroup: object[], lowGroup: object[], splitThreshold: null}}
 */
// NEGATIVE-EXPOSURE PIN (EX2, Minor review fix, per estimator.js's own
// binarySplit contract above): an exposure value `<= 0` (not just `=== 0`)
// resolves to LOW, mirroring the "absent" treatment exactly — HIGH is
// reserved for a strictly positive ("present") value, the same rule this
// function already implements below; documented explicitly here because no
// current template produces a negative exposure, so the behavior was
// previously implicit in the code's shape rather than a stated policy.
function binarySplit(pairs) {
  const highGroup = [];
  const lowGroup = [];
  for (const p of pairs) {
    if (p.exposure > 0) {
      highGroup.push(p);
    } else {
      lowGroup.push(p); // exposure === 0 (non-finite already dropped by pairObservations)
    }
  }
  return { highGroup, lowGroup, splitThreshold: null };
}

/** Dispatch to the split function named by `plan.splitMode` ('median' | 'binary'), defaulting to 'median' for back-compat. */
function computeSplit(pairs, splitMode) {
  return splitMode === 'binary' ? binarySplit(pairs) : medianSplit(pairs);
}

/**
 * Pearson r over the raw (exposure, outcome) pairs. Supplementary internal
 * field only — data-method spec default #3 explicitly says this must never
 * headline a result. Returns null (not 0) when the correlation is
 * mathematically undefined (zero variance on either side) — this module
 * never uses 0 as a stand-in for "couldn't compute," which is exactly the
 * bug class the existing three Pearson implementations have.
 */
function computePearsonR(pairs) {
  const n = pairs.length;
  if (n < 2) return null;
  const xs = pairs.map((p) => p.exposure);
  const ys = pairs.map((p) => p.outcome);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  if (denomX === 0 || denomY === 0) return null;
  return num / Math.sqrt(denomX * denomY);
}

/**
 * Nonparametric bootstrap CI for the difference in group means (meanHigh -
 * meanLow), with the split RECOMPUTED WITHIN EACH RESAMPLE (Michael review
 * hardening, item 3) rather than held fixed for the whole bootstrap (the
 * pre-Task-EX1 behavior).
 *
 * Each of `BOOTSTRAP_RESAMPLES` iterations:
 *   1. Draws `n` pairs WITH replacement from the full canonicalized pool
 *      (a standard whole-sample bootstrap resample, size n).
 *   2. Re-splits that resample the SAME way the real estimate was split
 *      (median-of-the-resample with ties->LOW, or binary present/absent) —
 *      this is what makes the split itself, not just the outcome values,
 *      part of what the CI's resampling variance captures.
 *   3. If that re-split produces an empty high OR low group, the resample is
 *      DISCARDED (see below) rather than computing a mean over zero values.
 *
 * DISCARD POLICY (Michael's round-2 statistical review, 2026-07-22 —
 * REPLACES the original ("EX1/H3b") fallback policy; see
 * docs/quality/experiments-data-method.md's "Round-2" section for the full
 * directive and rationale). Michael's own words: "The cleaner options are
 * one predeclared estimand or marking the result insufficient when too many
 * resamples collapse" — a degenerate resample is no longer recomputed via
 * the ORIGINAL (whole-sample) split's fixed groups (the pre-round-2 fallback
 * algorithm, now REMOVED entirely, `fallbackDelta` included) — mixing a
 * "recomputed-split" estimand with an "original-split" estimand inside ONE
 * confidence interval was exactly the two-methods-in-one-CI problem Michael's
 * review flagged. Instead: a degenerate resample contributes NOTHING to the
 * delta distribution — it is discarded outright, and the CI is the
 * percentile of the resamples that DID produce a valid recomputed split. The
 * discard count is tracked (`discardCount`, exposed on the estimate as
 * `resampleDiscardCount` — renamed from `resampleFallbackCount`, since there
 * is no longer a fallback, only a discard) and gates the whole result
 * insufficient (`split_unstable`) when the discard RATE exceeds
 * `RESAMPLE_DISCARD_LIMIT` (unchanged 10% threshold) — the same protection
 * the old fallback-counting policy provided, now with an honest, single
 * estimand instead of two blended together.
 *
 * Determinism is preserved: the SAME seed always produces the SAME sequence
 * of resample draws, the SAME sequence of degenerate/non-degenerate
 * decisions, and therefore the SAME CI and the SAME `discardCount` — a
 * discarded resample simply consumes its `n` rng() draws and contributes no
 * delta, so the rng stream position after each iteration is now IDENTICAL
 * regardless of whether that iteration was discarded (unlike the old
 * fallback path, which consumed extra draws only on a fallback) — a
 * simplification that is itself a nice side effect of the discard policy.
 *
 * The CI itself is the [alpha/2, 1-alpha/2] percentile of the resulting
 * (valid-only) delta distribution using the nearest-rank method
 * (deterministic, no interpolation ambiguity), computed over however many
 * deltas actually survived — NOT over `BOOTSTRAP_RESAMPLES` — so a run with
 * some discards still produces a well-formed CI from its valid subset.
 */
function bootstrapDeltaCIPerResampleSplit({ pairs, splitMode, rng }) {
  const n = pairs.length;
  const deltas = [];
  let discardCount = 0;

  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    const resample = new Array(n);
    for (let j = 0; j < n; j++) {
      resample[j] = pairs[Math.floor(rng() * n)];
    }
    const resplit = computeSplit(resample, splitMode);
    if (resplit.highGroup.length === 0 || resplit.lowGroup.length === 0) {
      discardCount++;
      continue; // discarded: contributes no delta (see docblock)
    }
    const meanHighResample = mean(resplit.highGroup.map((p) => p.outcome));
    const meanLowResample = mean(resplit.lowGroup.map((p) => p.outcome));
    deltas.push(meanHighResample - meanLowResample);
  }

  deltas.sort((a, b) => a - b);
  const alpha = (1 - CI_LEVEL) / 2;
  const lastIdx = deltas.length - 1;
  const lowerIdx = Math.max(0, Math.floor(alpha * lastIdx));
  const upperIdx = Math.min(lastIdx, Math.ceil((1 - alpha) * lastIdx));
  return { ci: [deltas[lowerIdx], deltas[upperIdx]], discardCount };
}

/**
 * Leave-one-day-out stability check (Michael review hardening, item 4;
 * REWORKED in Michael's round-2 statistical review, 2026-07-22 — see
 * docs/quality/experiments-data-method.md's "Round-2" section). Michael's
 * own words: "It retains the original group assignments rather than
 * recalculating the median split and eligibility gates after each removed
 * day. Recomputing them is inexpensive at this sample size."
 *
 * For EACH of the `n` paired observations, this now re-runs the FULL
 * deterministic path on the remaining `n-1` pairs — NOT just an O(1) mean
 * adjustment against the ORIGINAL (whole-sample) split, which is what the
 * pre-round-2 version did (and which is exactly the bug Michael's review
 * caught: excluding a day can shift the recomputed MEDIAN enough to move a
 * DIFFERENT, still-present day across the high/low boundary — the old
 * per-pair mean-adjustment silently missed this reassignment entirely,
 * because it never recomputed the split at all):
 *   1. Recompute the split (median-of-the-remaining-pairs with ties->LOW, or
 *      binary present/absent, per `splitMode` — same rule the real estimate
 *      and the bootstrap resamples already use).
 *   2. Recompute the SAME eligibility gates `runAnalysisPlan` enforces on the
 *      full sample: both groups non-empty (else degenerate), both groups
 *      `>= MIN_GROUP_SIZE`, the smaller group `>= MIN_GROUP_FRACTION` of the
 *      n-1 total, and the exposure contrast `>= minExposureContrast`.
 *   3. If ANY of those gates fails for this iteration, the iteration is a
 *      GATE FAILURE — counted in `gateFailures` and treated as instability
 *      in its own right (this iteration's absence of a trustworthy estimate
 *      IS the fragility signal — a day whose removal would leave the
 *      analysis unable to even re-clear its own eligibility bar is not a
 *      day whose removal the result should describe as "stable"). A gate
 *      failure contributes NO delta to `deltaMin`/`deltaMax` (there is no
 *      re-estimate to report), but DOES force `signConsistent: false` for
 *      the whole stability result, per Michael's own framing above.
 *   4. Otherwise, delta = recomputed meanHigh - recomputed meanLow for this
 *      iteration's own fresh split, and its sign is tracked.
 *
 * This is genuinely deterministic (no bootstrap/rng inside LOO — every
 * iteration is a plain re-split + re-check, `O(n log n)` per iteration,
 * `O(n^2 log n)` total, "inexpensive at this sample size" per Michael's own
 * framing) and re-runnable: the SAME (canonicalPairs, splitMode,
 * minExposureContrast) always produces the SAME `stability` object.
 *
 * `signConsistent` is `true` only when: zero gate failures occurred, AND at
 * least one iteration passed its gates, AND every passing iteration's delta
 * shares the same strict sign as every other (all positive, or all
 * negative — a delta of exactly 0 also counts as a break, unchanged from the
 * pre-round-2 rule). `deltaMin`/`deltaMax` are computed ONLY over the
 * iterations that passed their gates — `null` when none did (every single
 * removal made the split ineligible; this can genuinely happen for an
 * experiment sitting exactly at the group-size floor, e.g. an exactly-5/5
 * split at n=10: removing any one pair leaves n-1=9, which can never split
 * two ways both `>= MIN_GROUP_SIZE` (5+5=10 > 9) — that is not a bug in this
 * function, it is an honest description of how fragile a bare-minimum-sized
 * experiment's grouping is).
 *
 * @returns {{deltaMin: number|null, deltaMax: number|null, signConsistent: boolean, gateFailures: number}}
 */
function computeStability(canonicalPairs, splitMode, minExposureContrast) {
  const n = canonicalPairs.length;
  let deltaMin = Infinity;
  let deltaMax = -Infinity;
  let sawPositive = false;
  let sawNegative = false;
  let sawZero = false;
  let gateFailures = 0;
  let anyPassed = false;

  for (let i = 0; i < n; i++) {
    const remaining = canonicalPairs.slice(0, i).concat(canonicalPairs.slice(i + 1));
    const resplit = computeSplit(remaining, splitMode);
    const nHighI = resplit.highGroup.length;
    const nLowI = resplit.lowGroup.length;

    let gateFailed = nHighI === 0 || nLowI === 0; // degenerate: no split at all
    if (!gateFailed) {
      const smaller = Math.min(nHighI, nLowI);
      if (smaller < MIN_GROUP_SIZE) {
        gateFailed = true;
      } else if (smaller / remaining.length < MIN_GROUP_FRACTION) {
        gateFailed = true;
      } else {
        const contrastI = mean(resplit.highGroup.map((p) => p.exposure)) - mean(resplit.lowGroup.map((p) => p.exposure));
        if (contrastI < minExposureContrast) gateFailed = true;
      }
    }

    if (gateFailed) {
      gateFailures += 1;
      continue; // no delta to report for this iteration; forces signConsistent:false below
    }

    anyPassed = true;
    const mHigh = mean(resplit.highGroup.map((p) => p.outcome));
    const mLow = mean(resplit.lowGroup.map((p) => p.outcome));
    const d = mHigh - mLow;
    if (d < deltaMin) deltaMin = d;
    if (d > deltaMax) deltaMax = d;
    if (d > 0) sawPositive = true;
    else if (d < 0) sawNegative = true;
    else sawZero = true; // exact 0 -> treated as a sign break, see docblock
  }

  const signConsistent = gateFailures === 0 && anyPassed && !sawZero && sawPositive !== sawNegative;
  return {
    deltaMin: anyPassed ? deltaMin : null,
    deltaMax: anyPassed ? deltaMax : null,
    signConsistent,
    gateFailures,
  };
}

// ---------------------------------------------------------------------------
// runAnalysisPlan
// ---------------------------------------------------------------------------

/**
 * Apply the data-method spec's estimator (default #3) to a set of already-
 * paired observations. This is the single place spec thresholds are
 * enforced for the estimate itself; missingness/coverage thresholds
 * (default #2) are checked by the caller against `computeCoverage`'s output
 * BEFORE calling this function — but this function's own `reasons` array is
 * still built to hold more than one machine-readable reason, because more
 * than one of ITS OWN checks (pair count, degenerate split, lag mismatch)
 * can fail at once, and a caller merging in upstream coverage reasons should
 * be able to concat onto the same shape.
 *
 * ORDER-INDEPENDENCE: `pairs` is canonicalized (sorted by `dateKey` then
 * `outcomeDateKey`) as the very first step, before anything else reads it —
 * including the derived-seed hash and the arrays fed into the bootstrap.
 * Without this, two callers passing the SAME pairs in different orders
 * (e.g. because Firestore doesn't guarantee document read order) would get
 * different derived seeds AND different resample-index-to-value mappings,
 * producing visibly different CIs for identical data. That would silently
 * violate this module's core reproducibility promise, so canonicalization
 * happens unconditionally, not just when `seed` is omitted.
 *
 * @param {Object} args
 * @param {{dateKey: string, outcomeDateKey?: string, exposure: number, outcome: number}[]} args.pairs
 *   - output of `pairObservations` (any order — this function canonicalizes).
 * @param {Object} [args.plan] - the experiment's frozen analysis plan.
 *   Accepted for forward-compatibility with callers (e.g. logging/receipt
 *   context) and NEVER used to override the spec thresholds — those are
 *   fixed constants, not configurable per-experiment (spec default #7: one
 *   pre-declared estimate, not a knob to be tuned after the fact). Two
 *   exceptions:
 *     - `plan.lag`: when present, it is used only to VALIDATE that every
 *       pair's actual (outcomeDateKey - dateKey) gap matches the
 *       pre-declared lag (spec default #6) — never to change how the
 *       estimate is computed. A mismatch fails closed (`lag_mismatch`)
 *       rather than silently computing a methodologically-wrong estimate
 *       that would still look plausible. Omit `plan.lag` to skip this check
 *       (e.g. callers that already trust `pairObservations` produced the
 *       pairs).
 *     - `plan.splitMode`: `'median'` (default) or `'binary'` (Michael
 *       review hardening, item 2) — selects which split function partitions
 *       the pairs into high/low groups. This is a MODE selection, not a
 *       threshold override: unlike a tunable knob, the choice must be made
 *       at template-declaration time (mirrors the lag pre-declaration
 *       rationale in spec default #6) and is frozen into the plan, not
 *       chosen post-hoc. Any value other than the string `'binary'`
 *       (including omission) resolves to `'median'`.
 * @param {number} [args.seed] - seed for the deterministic bootstrap RNG.
 *   If omitted, a seed is derived deterministically from the canonicalized
 *   `pairs` (never from Math.random()/Date.now()) so "no seed passed" is
 *   still reproducible — and, per the canonicalization above, reproducible
 *   regardless of the input pairs' array order.
 *     - `plan.minExposureContrast`: template-specific minimum exposure
 *       contrast, in the exposure's OWN units (Michael's round-2 statistical
 *       review, 2026-07-22, item 1 — see docs/quality/experiments-data-method.md's
 *       "Round-2" section). Frozen onto the plan by
 *       `experimentsService.buildAnalysisPlan` from the template catalog.
 *       Falls back to `DEFAULT_MIN_EXPOSURE_CONTRAST` (0) for a legacy plan
 *       that predates this field — see that constant's docblock.
 * @returns {{status:'ok', estimate:{
 *   meanHigh:number, meanLow:number, delta:number, ci:[number,number],
 *   n:number, pearsonR:number|null,
 *   nHigh:number, nLow:number, splitThreshold:number|null,
 *   exposureContrast:number, resampleDiscardCount:number,
 *   stability:{deltaMin:number|null, deltaMax:number|null, signConsistent:boolean, gateFailures:number}}} |
 *   {status:'insufficient', reasons: string[]}}
 *
 * New machine-readable insufficiency reasons (Michael review hardening,
 * items 1 and 3 — see docs/quality/experiments-data-method.md):
 *   - `group_too_small`: the smaller split group has fewer than
 *     `MIN_GROUP_SIZE` (5) paired observations.
 *   - `groups_too_imbalanced`: the smaller split group is under
 *     `MIN_GROUP_FRACTION` (25%) of the total paired observations.
 *   - `exposure_contrast_too_small`: high-group mean exposure minus
 *     low-group mean exposure is below `plan.minExposureContrast` (round-2
 *     item 1 — GENUINELY reachable now that the plan supplies a real,
 *     template-specific, unit-aware minimum; see `docs/quality/
 *     experiments-data-method.md`'s "Round-2" section for the pinned v1
 *     values). For a LEGACY plan with no `minExposureContrast`, the check
 *     falls back to `DEFAULT_MIN_EXPOSURE_CONTRAST` (0), which is
 *     structurally unreachable for a non-degenerate split — the ORIGINAL
 *     (EX1) behavior, preserved unchanged for that case.
 *   - `split_unstable`: more than `RESAMPLE_DISCARD_LIMIT` (10%) of the
 *     bootstrap's resamples had a degenerate per-resample split and were
 *     discarded (see `bootstrapDeltaCIPerResampleSplit`'s docblock).
 * The three group/contrast checks are evaluated together, immediately after
 * a NON-degenerate split (i.e. they never run when
 * `degenerate_exposure_split` already applies — that case already means
 * one whole side is empty, which the group-size checks would only restate).
 * Like every other reason in this function, they ACCUMULATE with whatever
 * else already failed (existing convention — see `reasons` below).
 */
export function runAnalysisPlan({ pairs = [], plan = {}, seed } = {}) {
  const canonicalPairs = canonicalizePairs(pairs);
  const n = canonicalPairs.length;
  const reasons = [];
  const splitMode = plan?.splitMode === 'binary' ? 'binary' : 'median';
  const minExposureContrast = Number.isFinite(plan?.minExposureContrast)
    ? plan.minExposureContrast
    : DEFAULT_MIN_EXPOSURE_CONTRAST;

  if (n < MIN_PAIRED_OBSERVATIONS) {
    reasons.push('insufficient_paired_observations');
  }

  if (Number.isFinite(plan?.lag)) {
    const lagMismatch = canonicalPairs.some((p) => pairLagDays(p) !== plan.lag);
    if (lagMismatch) {
      reasons.push('lag_mismatch');
    }
  }

  let split = null;
  if (n > 0) {
    split = computeSplit(canonicalPairs, splitMode);
    if (split.highGroup.length === 0 || split.lowGroup.length === 0) {
      reasons.push('degenerate_exposure_split');
    } else {
      const nHighCheck = split.highGroup.length;
      const nLowCheck = split.lowGroup.length;
      const contrastCheck =
        mean(split.highGroup.map((p) => p.exposure)) - mean(split.lowGroup.map((p) => p.exposure));
      if (Math.min(nHighCheck, nLowCheck) < MIN_GROUP_SIZE) {
        reasons.push('group_too_small');
      }
      if (Math.min(nHighCheck, nLowCheck) / n < MIN_GROUP_FRACTION) {
        reasons.push('groups_too_imbalanced');
      }
      if (contrastCheck < minExposureContrast) {
        reasons.push('exposure_contrast_too_small');
      }
    }
  }

  if (reasons.length > 0) {
    return { status: 'insufficient', reasons };
  }

  const { highGroup, lowGroup, splitThreshold } = split;
  const nHigh = highGroup.length;
  const nLow = lowGroup.length;
  const meanHigh = mean(highGroup.map((p) => p.outcome));
  const meanLow = mean(lowGroup.map((p) => p.outcome));
  const delta = meanHigh - meanLow;
  const exposureContrast =
    mean(highGroup.map((p) => p.exposure)) - mean(lowGroup.map((p) => p.exposure));
  const pearsonR = computePearsonR(canonicalPairs);

  const resolvedSeed = Number.isFinite(seed) ? seed >>> 0 : deriveSeedFromPairs(canonicalPairs);
  const rng = mulberry32(resolvedSeed);
  const { ci, discardCount } = bootstrapDeltaCIPerResampleSplit({
    pairs: canonicalPairs,
    splitMode,
    rng,
  });

  if (discardCount / BOOTSTRAP_RESAMPLES > RESAMPLE_DISCARD_LIMIT) {
    return { status: 'insufficient', reasons: ['split_unstable'] };
  }

  const stability = computeStability(canonicalPairs, splitMode, minExposureContrast);

  return {
    status: 'ok',
    estimate: {
      meanHigh,
      meanLow,
      delta,
      ci,
      n,
      pearsonR,
      nHigh,
      nLow,
      splitThreshold,
      exposureContrast,
      resampleDiscardCount: discardCount,
      stability,
    },
  };
}

export default {
  MIN_PAIRED_OBSERVATIONS,
  COVERAGE_FLOOR,
  BOOTSTRAP_RESAMPLES,
  CI_LEVEL,
  MIN_GROUP_SIZE,
  MIN_GROUP_FRACTION,
  RESAMPLE_DISCARD_LIMIT,
  DEFAULT_MIN_EXPOSURE_CONTRAST,
  SMALL_EFFECT_DELTA,
  pairObservations,
  computeCoverage,
  runAnalysisPlan,
};
