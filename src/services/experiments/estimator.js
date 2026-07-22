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
  return { highGroup, lowGroup, median: med };
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
 * meanLow). The high/low group assignment (the median split) is treated as
 * fixed for the whole bootstrap; each resample draws WITH replacement,
 * independently, from each group's outcome values — the standard two-sample
 * bootstrap for a mean difference. `BOOTSTRAP_RESAMPLES` resamples are
 * drawn; the CI is the [alpha/2, 1-alpha/2] percentile of the resulting
 * delta distribution using the nearest-rank method (deterministic, no
 * interpolation ambiguity).
 */
function bootstrapDeltaCI(highValues, lowValues, rng) {
  const nHigh = highValues.length;
  const nLow = lowValues.length;
  const deltas = new Array(BOOTSTRAP_RESAMPLES);

  for (let i = 0; i < BOOTSTRAP_RESAMPLES; i++) {
    let sumHigh = 0;
    for (let j = 0; j < nHigh; j++) {
      sumHigh += highValues[Math.floor(rng() * nHigh)];
    }
    let sumLow = 0;
    for (let j = 0; j < nLow; j++) {
      sumLow += lowValues[Math.floor(rng() * nLow)];
    }
    deltas[i] = sumHigh / nHigh - sumLow / nLow;
  }

  deltas.sort((a, b) => a - b);
  const alpha = (1 - CI_LEVEL) / 2;
  const lastIdx = BOOTSTRAP_RESAMPLES - 1;
  const lowerIdx = Math.max(0, Math.floor(alpha * lastIdx));
  const upperIdx = Math.min(lastIdx, Math.ceil((1 - alpha) * lastIdx));
  return [deltas[lowerIdx], deltas[upperIdx]];
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
 *   pre-declared estimate, not a knob to be tuned after the fact). The one
 *   exception is `plan.lag`: when present, it is used only to VALIDATE that
 *   every pair's actual (outcomeDateKey - dateKey) gap matches the
 *   pre-declared lag (spec default #6) — never to change how the estimate
 *   is computed. A mismatch fails closed (`lag_mismatch`) rather than
 *   silently computing a methodologically-wrong estimate that would still
 *   look plausible. Omit `plan.lag` to skip this check (e.g. callers that
 *   already trust `pairObservations` produced the pairs).
 * @param {number} [args.seed] - seed for the deterministic bootstrap RNG.
 *   If omitted, a seed is derived deterministically from the canonicalized
 *   `pairs` (never from Math.random()/Date.now()) so "no seed passed" is
 *   still reproducible — and, per the canonicalization above, reproducible
 *   regardless of the input pairs' array order.
 * @returns {{status:'ok', estimate:{meanHigh:number, meanLow:number,
 *   delta:number, ci:[number,number], n:number, pearsonR:number|null}} |
 *   {status:'insufficient', reasons: string[]}}
 */
export function runAnalysisPlan({ pairs = [], plan = {}, seed } = {}) {
  const canonicalPairs = canonicalizePairs(pairs);
  const n = canonicalPairs.length;
  const reasons = [];

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
    split = medianSplit(canonicalPairs);
    if (split.highGroup.length === 0 || split.lowGroup.length === 0) {
      reasons.push('degenerate_exposure_split');
    }
  }

  if (reasons.length > 0) {
    return { status: 'insufficient', reasons };
  }

  const { highGroup, lowGroup } = split;
  const meanHigh = mean(highGroup.map((p) => p.outcome));
  const meanLow = mean(lowGroup.map((p) => p.outcome));
  const delta = meanHigh - meanLow;
  const pearsonR = computePearsonR(canonicalPairs);

  const resolvedSeed = Number.isFinite(seed) ? seed >>> 0 : deriveSeedFromPairs(canonicalPairs);
  const rng = mulberry32(resolvedSeed);
  const ci = bootstrapDeltaCI(
    highGroup.map((p) => p.outcome),
    lowGroup.map((p) => p.outcome),
    rng
  );

  return {
    status: 'ok',
    estimate: { meanHigh, meanLow, delta, ci, n, pearsonR },
  };
}

export default {
  MIN_PAIRED_OBSERVATIONS,
  COVERAGE_FLOOR,
  BOOTSTRAP_RESAMPLES,
  CI_LEVEL,
  pairObservations,
  computeCoverage,
  runAnalysisPlan,
};
