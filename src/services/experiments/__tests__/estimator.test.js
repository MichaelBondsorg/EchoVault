/**
 * Tests for the pure Personal Experiments estimator core.
 *
 * Spec reference: docs/quality/experiments-data-method.md
 * This file is the authoritative fixture set for the 8 numbered defaults in
 * that spec. Golden fixtures show their arithmetic in comments so the
 * expected values can be checked by hand, not just trusted from the code
 * under test.
 */
import { describe, it, expect } from 'vitest';
import {
  pairObservations,
  computeCoverage,
  runAnalysisPlan,
  MIN_PAIRED_OBSERVATIONS,
  COVERAGE_FLOOR,
  BOOTSTRAP_RESAMPLES,
  CI_LEVEL,
  MIN_GROUP_SIZE,
  MIN_GROUP_FRACTION,
  RESAMPLE_FALLBACK_LIMIT,
  SMALL_EFFECT_DELTA,
} from '../estimator';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Golden fixture: n=10 paired days, outcome = exposure * 10 exactly.
//
// Chosen (Michael review hardening, Task EX1) so the split is CLEANLY 5/5 —
// exactly at MIN_GROUP_SIZE (5) on both sides — rather than the pre-hardening
// fixture's 4/6 split, which the new `group_too_small` guard would now
// correctly reject. This single fixture therefore also IS the "exactly
// 5/group" boundary case the plan calls for.
//
// exposure (sorted, already in dateKey order): 1,2,3,4,5,6,7,8,9,10
// median of 10 values: sort => [1..10], mid=5 (0-indexed),
//   n even => median = (sorted[4] + sorted[5]) / 2 = (5 + 6) / 2 = 5.5
// split rule: exposure > median => high group, exposure <= median (ties) => low
//   high group exposure: 6,7,8,9,10   (5 pairs)
//   low group exposure:  1,2,3,4,5    (5 pairs)
// outcome = exposure * 10 (perfect linear relationship => pearsonR = 1)
//   high outcomes: 60,70,80,90,100 -> sum=400 -> mean = 80
//   low outcomes:  10,20,30,40,50  -> sum=150 -> mean = 30
//   delta = 80 - 30 = 50
//   exposureContrast = mean(high exposure 6..10)=8 - mean(low exposure 1..5)=3 = 5
// Leave-one-day-out stability (hand-verified; removing any point shifts the
// AFFECTED group's mean by (sum - value)/(n-1), n=5 groups -> n-1=4):
//   remove low=10 -> newLow=(150-10)/4=35   -> delta=80-35=45   (deltaMin)
//   remove low=20 -> newLow=(150-20)/4=32.5 -> delta=47.5
//   remove low=30 -> newLow=(150-30)/4=30   -> delta=50
//   remove low=40 -> newLow=(150-40)/4=27.5 -> delta=52.5
//   remove low=50 -> newLow=(150-50)/4=25   -> delta=55        (deltaMax, tie)
//   remove high=60  -> newHigh=(400-60)/4=85  -> delta=85-30=55  (deltaMax, tie)
//   remove high=70  -> newHigh=(400-70)/4=82.5 -> delta=52.5
//   remove high=80  -> newHigh=(400-80)/4=80  -> delta=50
//   remove high=90  -> newHigh=(400-90)/4=77.5 -> delta=47.5
//   remove high=100 -> newHigh=(400-100)/4=75 -> delta=45        (deltaMin, tie)
//   => deltaMin=45, deltaMax=55, all ten deltas strictly positive -> signConsistent=true
// ---------------------------------------------------------------------------
const GOLDEN_EXPOSURE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const GOLDEN_DATES = Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);

function buildGoldenSeries() {
  const exposureSeries = GOLDEN_DATES.map((dateKey, i) => ({ dateKey, value: GOLDEN_EXPOSURE[i] }));
  const outcomeSeries = GOLDEN_DATES.map((dateKey, i) => ({ dateKey, value: GOLDEN_EXPOSURE[i] * 10 }));
  return { exposureSeries, outcomeSeries };
}

describe('pairObservations', () => {
  it('pairs same-day (lag 0) observations by dateKey', () => {
    const { exposureSeries, outcomeSeries } = buildGoldenSeries();
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    expect(pairs).toHaveLength(10);
    expect(pairs[0]).toEqual({
      dateKey: '2026-01-01',
      outcomeDateKey: '2026-01-01',
      exposure: 1,
      outcome: 10,
    });
    expect(pairs[9]).toEqual({
      dateKey: '2026-01-10',
      outcomeDateKey: '2026-01-10',
      exposure: 10,
      outcome: 100,
    });
  });

  it('pairs lag-1 (exposure day D -> outcome day D+1)', () => {
    const exposureSeries = [{ dateKey: '2026-03-05', value: 7 }];
    const outcomeSeries = [{ dateKey: '2026-03-06', value: 75 }];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });

    expect(pairs).toEqual([
      { dateKey: '2026-03-05', outcomeDateKey: '2026-03-06', exposure: 7, outcome: 75 },
    ]);
  });

  it('does NOT pair lag-1 exposure with a same-day outcome', () => {
    const exposureSeries = [{ dateKey: '2026-03-05', value: 7 }];
    const outcomeSeries = [{ dateKey: '2026-03-05', value: 75 }]; // same day, not D+1
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });

    expect(pairs).toEqual([]);
  });

  it('handles lag-1 month boundary: Jan 31 -> Feb 1', () => {
    const exposureSeries = [{ dateKey: '2026-01-31', value: 6 }];
    const outcomeSeries = [{ dateKey: '2026-02-01', value: 60 }];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });

    expect(pairs).toEqual([
      { dateKey: '2026-01-31', outcomeDateKey: '2026-02-01', exposure: 6, outcome: 60 },
    ]);
  });

  it('handles lag-1 year boundary: Dec 31 -> Jan 1', () => {
    const exposureSeries = [{ dateKey: '2025-12-31', value: 5 }];
    const outcomeSeries = [{ dateKey: '2026-01-01', value: 50 }];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });

    expect(pairs).toEqual([
      { dateKey: '2025-12-31', outcomeDateKey: '2026-01-01', exposure: 5, outcome: 50 },
    ]);
  });

  it('is timezone-independent (UTC date arithmetic, not local-date shifting)', () => {
    // A Feb month-end boundary, chosen specifically because local-date
    // arithmetic (new Date('2026-02-28').setDate(+1)) can shift by a day
    // depending on the host TZ offset if it round-trips through a
    // non-UTC Date constructor. 2026 is not a leap year, so Feb 28 -> Mar 1
    // (as opposed to Feb 29 -> Mar 1 in a leap year) — either way this
    // exercises the same UTC-arithmetic code path.
    const exposureSeries = [{ dateKey: '2026-02-28', value: 3 }];
    const outcomeSeries = [{ dateKey: '2026-03-01', value: 30 }];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });

    expect(pairs).toEqual([
      { dateKey: '2026-02-28', outcomeDateKey: '2026-03-01', exposure: 3, outcome: 30 },
    ]);
  });

  it('drops non-finite/missing exposure values instead of coercing to 0', () => {
    const exposureSeries = [
      { dateKey: '2026-01-01', value: NaN },
      { dateKey: '2026-01-02', value: undefined },
      { dateKey: '2026-01-03', value: null },
      { dateKey: '2026-01-04', value: Infinity },
      { dateKey: '2026-01-05', value: 7 }, // the only valid one
    ];
    const outcomeSeries = [
      { dateKey: '2026-01-01', value: 10 },
      { dateKey: '2026-01-02', value: 20 },
      { dateKey: '2026-01-03', value: 30 },
      { dateKey: '2026-01-04', value: 40 },
      { dateKey: '2026-01-05', value: 70 },
    ];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    expect(pairs).toEqual([
      { dateKey: '2026-01-05', outcomeDateKey: '2026-01-05', exposure: 7, outcome: 70 },
    ]);
  });

  it('drops non-finite/missing outcome values instead of coercing to 0', () => {
    const exposureSeries = [
      { dateKey: '2026-01-01', value: 5 },
      { dateKey: '2026-01-02', value: 6 },
    ];
    const outcomeSeries = [
      { dateKey: '2026-01-01', value: NaN },
      { dateKey: '2026-01-02', value: 60 },
    ];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    expect(pairs).toEqual([
      { dateKey: '2026-01-02', outcomeDateKey: '2026-01-02', exposure: 6, outcome: 60 },
    ]);
  });

  it('returns an empty array for empty series', () => {
    expect(pairObservations({ exposureSeries: [], outcomeSeries: [], lag: 0 })).toEqual([]);
  });
});

describe('computeCoverage', () => {
  // Window: 2026-01-01T00:00Z .. 2026-01-11T00:00Z = exactly 10 elapsed days
  const startMs = Date.UTC(2026, 0, 1);
  const endMs = Date.UTC(2026, 0, 11);

  it('reports covered/total/label for a partial series', () => {
    const series = [
      { dateKey: '2026-01-01', value: 1 },
      { dateKey: '2026-01-02', value: 2 },
      { dateKey: '2026-01-03', value: 3 },
    ];
    const result = computeCoverage(series, startMs, endMs);
    expect(result).toEqual({ covered: 3, total: 10, label: '3 of 10 days' });
  });

  it('passes the coverage floor at exactly 50% (5 of 10 days)', () => {
    const series = ['01', '02', '03', '04', '05'].map((d) => ({ dateKey: `2026-01-${d}`, value: 1 }));
    const result = computeCoverage(series, startMs, endMs);
    expect(result).toEqual({ covered: 5, total: 10, label: '5 of 10 days' });
    expect(result.covered / result.total).toBeCloseTo(COVERAGE_FLOOR, 10);
    expect(result.covered / result.total >= COVERAGE_FLOOR).toBe(true);
  });

  it('fails the coverage floor just under 50% (4 of 10 days)', () => {
    const series = ['01', '02', '03', '04'].map((d) => ({ dateKey: `2026-01-${d}`, value: 1 }));
    const result = computeCoverage(series, startMs, endMs);
    expect(result).toEqual({ covered: 4, total: 10, label: '4 of 10 days' });
    expect(result.covered / result.total >= COVERAGE_FLOOR).toBe(false);
  });

  it('does not count days outside the [startMs, endMs) window', () => {
    const series = [
      { dateKey: '2025-12-31', value: 1 }, // before window
      { dateKey: '2026-01-11', value: 1 }, // window end is exclusive
      { dateKey: '2026-01-05', value: 1 }, // inside window
    ];
    const result = computeCoverage(series, startMs, endMs);
    expect(result).toEqual({ covered: 1, total: 10, label: '1 of 10 days' });
  });

  it('does not count non-finite/missing values as coverage', () => {
    const series = [
      { dateKey: '2026-01-01', value: NaN },
      { dateKey: '2026-01-02', value: undefined },
      { dateKey: '2026-01-03', value: 5 },
    ];
    const result = computeCoverage(series, startMs, endMs);
    expect(result).toEqual({ covered: 1, total: 10, label: '1 of 10 days' });
  });
});

describe('runAnalysisPlan — golden fixture (n=10, exactly at MIN_PAIRED_OBSERVATIONS)', () => {
  it('computes the hand-verified estimate at exactly 10 pairs (ok boundary)', () => {
    const { exposureSeries, outcomeSeries } = buildGoldenSeries();
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
    expect(pairs).toHaveLength(MIN_PAIRED_OBSERVATIONS);

    const result = runAnalysisPlan({ pairs, plan: { lag: 0 }, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(10);
    expect(result.estimate.meanHigh).toBeCloseTo(80, 10);
    expect(result.estimate.meanLow).toBeCloseTo(30, 10);
    expect(result.estimate.delta).toBeCloseTo(50, 10);
    // outcome = exposure * 10 exactly => perfect positive correlation.
    expect(result.estimate.pearsonR).toBeCloseTo(1, 10);
    expect(Array.isArray(result.estimate.ci)).toBe(true);
    expect(result.estimate.ci).toHaveLength(2);
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(result.estimate.ci[1]);

    // Michael review hardening (item 6): new estimate fields.
    expect(result.estimate.nHigh).toBe(5);
    expect(result.estimate.nLow).toBe(5);
    expect(result.estimate.splitThreshold).toBeCloseTo(5.5, 10);
    expect(result.estimate.exposureContrast).toBeCloseTo(5, 10);
    expect(typeof result.estimate.resampleFallbackCount).toBe('number');
    expect(result.estimate.resampleFallbackCount).toBe(0); // hand-verified via probing: this fixture's split is stable
    expect(result.estimate.stability).toEqual({ deltaMin: 45, deltaMax: 55, signConsistent: true });
  });

  it('is insufficient at exactly 9 pairs (one below MIN_PAIRED_OBSERVATIONS)', () => {
    const { exposureSeries, outcomeSeries } = buildGoldenSeries();
    const pairs = pairObservations({
      exposureSeries: exposureSeries.slice(0, 9),
      outcomeSeries: outcomeSeries.slice(0, 9),
      lag: 0,
    });
    expect(pairs).toHaveLength(9);

    const result = runAnalysisPlan({ pairs, plan: { lag: 0 }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('insufficient_paired_observations');
    expect(result.estimate).toBeUndefined();
  });
});

describe('runAnalysisPlan — determinism', () => {
  const { exposureSeries, outcomeSeries } = buildGoldenSeries();
  const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

  it('same seed produces an identical CI to full precision', () => {
    const a = runAnalysisPlan({ pairs, plan: {}, seed: 42 });
    const b = runAnalysisPlan({ pairs, plan: {}, seed: 42 });
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(a.estimate.ci).toEqual(b.estimate.ci);
  });

  it('different seeds produce different CIs', () => {
    const a = runAnalysisPlan({ pairs, plan: {}, seed: 42 });
    const b = runAnalysisPlan({ pairs, plan: {}, seed: 43 });
    expect(a.estimate.ci).not.toEqual(b.estimate.ci);
  });

  it('no seed derives one deterministically from the pairs (repeatable, no Math.random)', () => {
    const a = runAnalysisPlan({ pairs, plan: {} });
    const b = runAnalysisPlan({ pairs, plan: {} });
    expect(a.estimate.ci).toEqual(b.estimate.ci);
  });

  it('bootstrap uses exactly BOOTSTRAP_RESAMPLES=2000 and CI_LEVEL=0.95 (spec constants)', () => {
    expect(BOOTSTRAP_RESAMPLES).toBe(2000);
    expect(CI_LEVEL).toBe(0.95);
  });

  // Regression coverage: a prior version hashed/resampled pairs in arrival
  // order, so the SAME 10 pairs reversed produced a DIFFERENT no-seed CI
  // ([18.33, 40.83] vs [18.33, 41.67]) — a rerun of the identical
  // experiment data (e.g. after a Firestore read returned docs in a
  // different order) would show a visibly different result to the user.
  // `runAnalysisPlan` now canonicalizes `pairs` (sort by dateKey, then
  // outcomeDateKey) before EITHER the seed derivation or the bootstrap
  // resampling, so order must never leak into the output.
  it('is bitwise-identical for reordered pairs with no explicit seed (order-independence)', () => {
    const reversed = [...pairs].reverse();
    const forward = runAnalysisPlan({ pairs, plan: {} });
    const backward = runAnalysisPlan({ pairs: reversed, plan: {} });

    expect(forward.status).toBe('ok');
    expect(backward.status).toBe('ok');
    expect(backward.estimate).toEqual(forward.estimate);
  });

  it('is bitwise-identical for reordered pairs with an explicit seed (order-independence)', () => {
    const shuffled = [pairs[4], pairs[0], pairs[9], pairs[2], pairs[7], pairs[1], pairs[8], pairs[3], pairs[6], pairs[5]];
    const forward = runAnalysisPlan({ pairs, plan: {}, seed: 99 });
    const shuffledResult = runAnalysisPlan({ pairs: shuffled, plan: {}, seed: 99 });

    expect(forward.status).toBe('ok');
    expect(shuffledResult.status).toBe('ok');
    expect(shuffledResult.estimate).toEqual(forward.estimate);
  });
});

describe('runAnalysisPlan — lag-consistency check (plan.lag, fail-closed)', () => {
  it('passes when every pair matches the declared lag', () => {
    const exposureSeries = [
      { dateKey: '2026-04-01', value: 5 },
      { dateKey: '2026-04-02', value: 60 },
    ];
    const outcomeSeries = [
      { dateKey: '2026-04-02', value: 50 }, // D+1 from 04-01
      { dateKey: '2026-04-03', value: 65 }, // D+1 from 04-02
    ];
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });
    expect(pairs).toHaveLength(2);

    // Only 2 pairs, so this can't reach 'ok' on its own — the point of
    // this test is narrower: confirm the lag check does NOT add
    // 'lag_mismatch' when every pair's actual gap matches plan.lag.
    const result = runAnalysisPlan({ pairs, plan: { lag: 1 }, seed: 1 });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).not.toContain('lag_mismatch');
    expect(result.reasons).toContain('insufficient_paired_observations');
  });

  it('passes the lag check (no lag_mismatch) at full sample size and reaches ok', () => {
    // 10 lag-1 pairs, exposure = index, outcome = index*10, all D -> D+1.
    const dates = Array.from({ length: 11 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`);
    const exposureSeries = dates.slice(0, 10).map((dateKey, i) => ({ dateKey, value: i + 1 }));
    const outcomeSeries = dates.slice(1, 11).map((dateKey, i) => ({ dateKey, value: (i + 1) * 10 }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });
    expect(pairs).toHaveLength(10);

    const result = runAnalysisPlan({ pairs, plan: { lag: 1 }, seed: 1 });
    expect(result.status).toBe('ok');
  });

  it('fails closed with lag_mismatch when one pair does not match the declared lag', () => {
    // Build a valid lag-1 pairing, then hand-corrupt one pair's
    // outcomeDateKey to simulate a mismatched/miscomputed pair reaching
    // runAnalysisPlan directly (bypassing pairObservations).
    const dates = Array.from({ length: 11 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`);
    const exposureSeries = dates.slice(0, 10).map((dateKey, i) => ({ dateKey, value: i + 1 }));
    const outcomeSeries = dates.slice(1, 11).map((dateKey, i) => ({ dateKey, value: (i + 1) * 10 }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 1 });
    const corrupted = pairs.map((p, i) => (i === 0 ? { ...p, outcomeDateKey: p.dateKey } : p)); // lag 0, not 1

    const result = runAnalysisPlan({ pairs: corrupted, plan: { lag: 1 }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('lag_mismatch');
    expect(result.estimate).toBeUndefined();
  });

  it('skips the lag check entirely when plan.lag is absent (back-compat)', () => {
    const { exposureSeries, outcomeSeries } = buildGoldenSeries();
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
    // Corrupt one pair's outcomeDateKey so it would fail a lag check if one ran.
    const corrupted = pairs.map((p, i) => (i === 0 ? { ...p, outcomeDateKey: '2099-01-01' } : p));

    const result = runAnalysisPlan({ pairs: corrupted, plan: {}, seed: 1 }); // no plan.lag

    expect(result.status).toBe('ok');
    expect(result.reasons).toBeUndefined();
  });
});

describe('runAnalysisPlan — CI classification support (spans zero)', () => {
  it('exposes ci bounds sufficient for a caller to classify "spans zero"', () => {
    // Exposure split 5/5 around the median; outcomes constructed with equal
    // group means (50 each) but real spread, so the bootstrap CI for the
    // mean difference is expected to straddle 0.
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const outcomeHighGroup = [40, 60, 50, 55, 45]; // for exposure 6..10, mean 50
    const outcomeLowGroup = [45, 55, 40, 60, 50]; // for exposure 1..5, mean 50
    const outcome = [...outcomeLowGroup, ...outcomeHighGroup];
    const dates = GOLDEN_DATES;
    const exposureSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: outcome[i] }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 7 });

    expect(result.status).toBe('ok');
    expect(result.estimate.delta).toBeCloseTo(0, 10);
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(0);
    expect(result.estimate.ci[1]).toBeGreaterThanOrEqual(0);
  });
});

describe('runAnalysisPlan — median-tie split (ties go to the LOW group)', () => {
  it('pins tied-at-median values to the low group', () => {
    // exposure sorted: 1,2,3,4,5,6,6,6,7,8,9,10,11 (n=13, odd -> median =
    //   sorted[6] = 6). Three values equal the median (6). Per spec, ties go LOW.
    // Also doubles as an "exactly at MIN_GROUP_SIZE" boundary case for the
    // Michael-review-hardening group-size guard: nHigh lands at EXACTLY 5.
    // low group (exposure<=6):  1,2,3,4,5,6,6,6 (8 pairs) -> outcome = exposure
    //   sum = 1+2+3+4+5+6+6+6 = 33, mean = 33/8 = 4.125
    // high group (exposure>6):  7,8,9,10,11     (5 pairs) -> outcome = exposure
    //   sum = 7+8+9+10+11 = 45, mean = 45/5 = 9
    //   delta = 9 - 4.125 = 4.875
    //   exposureContrast = 9 - 4.125 = 4.875 (outcome === exposure here)
    //   fraction = min(5,8)/13 = 5/13 ≈ 0.3846 >= MIN_GROUP_FRACTION (0.25) -> passes
    const exposure = [1, 2, 3, 4, 5, 6, 6, 6, 7, 8, 9, 10, 11];
    const dates = Array.from({ length: 13 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const exposureSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(13);
    expect(result.estimate.meanLow).toBeCloseTo(33 / 8, 10);
    expect(result.estimate.meanHigh).toBeCloseTo(9, 10);
    expect(result.estimate.delta).toBeCloseTo(4.875, 10);
    expect(result.estimate.nHigh).toBe(5); // exactly at MIN_GROUP_SIZE
    expect(result.estimate.nLow).toBe(8);
    expect(result.estimate.splitThreshold).toBe(6);
    expect(result.estimate.exposureContrast).toBeCloseTo(4.875, 10);
  });
});

describe('runAnalysisPlan — degenerate/empty inputs', () => {
  it('returns insufficient (not a crash or NaN CI) when all exposure values are identical', () => {
    const dates = GOLDEN_DATES;
    const exposureSeries = dates.map((dateKey) => ({ dateKey, value: 5 }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: 40 + i }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
    expect(pairs).toHaveLength(10); // meets MIN_PAIRED_OBSERVATIONS on count alone

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('degenerate_exposure_split');
    expect(result.reasons).not.toContain('insufficient_paired_observations');
    expect(result.estimate).toBeUndefined();
  });

  it('returns insufficient for zero pairs without crashing', () => {
    const result = runAnalysisPlan({ pairs: [], plan: {}, seed: 1 });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toContain('insufficient_paired_observations');
  });

  it('combines multiple reasons when both thresholds are violated', () => {
    // 5 identical-exposure pairs: below MIN_PAIRED_OBSERVATIONS AND a
    // degenerate (all-identical) split. Both reasons must be surfaced.
    const dates = GOLDEN_DATES.slice(0, 5);
    const exposureSeries = dates.map((dateKey) => ({ dateKey, value: 3 }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: 30 + i }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['insufficient_paired_observations', 'degenerate_exposure_split'])
    );
    expect(result.reasons.length).toBe(2);
  });
});

describe('exported spec constants', () => {
  it('match the data-method spec defaults exactly', () => {
    expect(MIN_PAIRED_OBSERVATIONS).toBe(10);
    expect(COVERAGE_FLOOR).toBe(0.5);
    expect(BOOTSTRAP_RESAMPLES).toBe(2000);
    expect(CI_LEVEL).toBe(0.95);
  });

  it('match the Michael-review-hardening (Task EX1) defaults exactly', () => {
    expect(MIN_GROUP_SIZE).toBe(5);
    expect(MIN_GROUP_FRACTION).toBe(0.25);
    expect(RESAMPLE_FALLBACK_LIMIT).toBe(0.1);
    expect(SMALL_EFFECT_DELTA).toBe(5);
  });
});

describe('module purity', () => {
  it('exposes no Firebase/app imports (module loads standalone)', async () => {
    const mod = await import('../estimator');
    expect(typeof mod.pairObservations).toBe('function');
    expect(typeof mod.computeCoverage).toBe('function');
    expect(typeof mod.runAnalysisPlan).toBe('function');
  });
});

// Sanity: DAY_MS constant used above must match the module's own day-length
// assumption for the coverage window tests (10 days == 10 * DAY_MS).
describe('coverage window sanity', () => {
  it('10-day window used in computeCoverage tests spans exactly 10 * 24h', () => {
    const startMs = Date.UTC(2026, 0, 1);
    const endMs = Date.UTC(2026, 0, 11);
    expect(endMs - startMs).toBe(10 * DAY_MS);
  });
});

// ===========================================================================
// Michael's statistical review hardening (2026-07-22, Task EX1) — new
// guards/modes/policies. Spec section: "Michael review hardening" in
// docs/quality/experiments-data-method.md.
// ===========================================================================

/** Shared fixture builder: distinct dates + pairObservations, for the new fixtures below. */
function buildPairs(exposure, outcome, dates) {
  const exposureSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
  const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: outcome[i] }));
  return pairObservations({ exposureSeries, outcomeSeries, lag: 0 });
}
function datesFrom(n, prefix) {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`);
}

describe('runAnalysisPlan — group-size guards (item 1: group_too_small, groups_too_imbalanced)', () => {
  it('flags group_too_small in isolation when one group is under MIN_GROUP_SIZE but neither the overall count nor the imbalance ratio would fail', () => {
    // exposure sorted: 1,1,1,1,1,1,2,3,4,5 (n=10, median = avg(sorted[4],sorted[5]) = avg(1,1) = 1)
    //   low group (<=1): six 1's = 6 pairs
    //   high group (>1): 2,3,4,5 = 4 pairs  <- below MIN_GROUP_SIZE (5)
    // fraction = min(6,4)/10 = 0.4 >= MIN_GROUP_FRACTION (0.25) -> imbalance guard PASSES
    // exposureContrast = mean(2,3,4,5)=3.5 - mean(six 1's)=1 = 2.5 > 0 -> contrast guard PASSES
    // So group_too_small is the ONLY reason — isolates this guard from the other two.
    const exposure = [1, 1, 1, 1, 1, 1, 2, 3, 4, 5];
    const outcome = exposure.map((v) => v * 10);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['group_too_small']);
    expect(result.estimate).toBeUndefined();
  });

  it('flags groups_too_imbalanced in isolation when the smaller group clears MIN_GROUP_SIZE but is under 25% of the total', () => {
    // n=24: nineteen 1's + [2,3,4,5,6]. median = avg(sorted[11],sorted[12]),
    //   both indices land inside the block of 1's (idx0..18) -> median = 1.
    //   low group (<=1): nineteen 1's = 19 pairs
    //   high group (>1): 2,3,4,5,6 = 5 pairs  <- exactly AT MIN_GROUP_SIZE (5), so
    //     group_too_small does NOT fire (this isolates the imbalance guard).
    // fraction = min(5,19)/24 = 5/24 ≈ 0.2083 < MIN_GROUP_FRACTION (0.25) -> fails.
    // exposureContrast = mean(2,3,4,5,6)=4 - mean(nineteen 1's)=1 = 3 > 0 -> passes.
    const exposure = [...Array(19).fill(1), 2, 3, 4, 5, 6];
    const outcome = exposure.map((v) => v * 10);
    const dates = datesFrom(24, '2026-01-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['groups_too_imbalanced']);
    expect(result.estimate).toBeUndefined();
  });

  it('accumulates both group_too_small AND groups_too_imbalanced when both are true at once (existing "reasons accumulate" convention)', () => {
    // n=30: twenty-seven 1's + [2,3,4]. median lands inside the 1's block -> median=1.
    //   low group (<=1): 27 pairs. high group (>1): 3 pairs.
    //   3 < MIN_GROUP_SIZE (5) -> group_too_small.
    //   3/30 = 0.1 < MIN_GROUP_FRACTION (0.25) -> groups_too_imbalanced.
    const exposure = [...Array(27).fill(1), 2, 3, 4];
    const outcome = exposure.map((v) => v * 10);
    const dates = datesFrom(30, '2026-02-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(expect.arrayContaining(['group_too_small', 'groups_too_imbalanced']));
    expect(result.reasons.length).toBe(2);
  });

  it('applies both guards in BINARY split mode too (item 1 explicitly applies to both split modes)', () => {
    // exposure: eight 0's (absent) + [1,2] (present). Binary split: low=8, high=2.
    //   2 < MIN_GROUP_SIZE (5) -> group_too_small. 2/10=0.2 < 0.25 -> groups_too_imbalanced.
    const exposure = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2];
    const outcome = exposure.map((v) => v * 10);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'binary' }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(expect.arrayContaining(['group_too_small', 'groups_too_imbalanced']));
  });

  it('does NOT evaluate the new group guards when the split itself is degenerate (all-identical exposure) — degenerate_exposure_split stays the sole reason, unchanged from pre-hardening behavior', () => {
    const dates = GOLDEN_DATES;
    const exposureSeries = dates.map((dateKey) => ({ dateKey, value: 5 }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: 40 + i }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['degenerate_exposure_split']);
  });
});

describe('runAnalysisPlan — exposure-contrast guard (item 1: exposure_contrast_too_small)', () => {
  it('is structurally unreachable via medianSplit/binarySplit as currently defined: contrast stays strictly positive even at a near-zero margin', () => {
    // Six values pinned at exactly 5, six values a few parts-per-ten-million
    // above 5 (5.0000001 .. 5.0000006). median lands between the two
    // clusters, so the split is non-degenerate and BOTH groups are
    // non-empty — but the margin between them is minuscule.
    // This documents the pinned decision (Michael review hardening, item 1):
    // a RELATIVE-magnitude contrast threshold would catch this "technically
    // splittable but practically meaningless" case; the ABSOLUTE `> 0` guard
    // as specified cannot, by construction, ever reject a non-degenerate
    // median or binary split (every value in the high group is, by
    // definition, greater than every value that can appear in the low
    // group's mean). That gap is intentionally left as a documented
    // spec-revisit candidate rather than an invented threshold — see
    // docs/quality/experiments-data-method.md.
    const exposure = [5, 5, 5, 5, 5, 5, 5.0000001, 5.0000002, 5.0000003, 5.0000004, 5.0000005, 5.0000006];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-04-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.nHigh).toBe(6);
    expect(result.estimate.nLow).toBe(6);
    expect(result.estimate.exposureContrast).toBeGreaterThan(0);
    expect(result.estimate.exposureContrast).toBeLessThan(1e-5); // still guard-passing despite being tiny
  });

  it('is likewise unreachable in binary mode: any present value, however close to 0, still yields a strictly positive contrast against the absent (0) group', () => {
    const exposure = [0, 0, 0, 0, 0, 0, 1e-9, 1e-9, 1e-9, 1e-9, 1e-9, 1e-9];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-04-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'binary' }, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.exposureContrast).toBeGreaterThan(0);
    expect(result.estimate.exposureContrast).toBeCloseTo(1e-9, 15);
  });
});

describe('runAnalysisPlan — binary present/absent split mode (item 2)', () => {
  // Shared fixture: 5 absent days (exposure=0), 7 present days (exposure 1..7),
  // outcome = 100 + exposure*10. Deliberately chosen so MEDIAN and BINARY
  // splits disagree (median's cut point of 1.5 pulls the "exposure=1" day
  // into the LOW group; binary's cut is exposure>0, which puts it HIGH) —
  // this proves splitMode is actually selecting a different algorithm, not
  // a no-op.
  const exposure = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7];
  const outcome = exposure.map((v) => 100 + v * 10);
  const dates = datesFrom(12, '2026-05-');

  it('defaults to median split when plan.splitMode is omitted (back-compat)', () => {
    const pairs = buildPairs(exposure, outcome, dates);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    // median of [0,0,0,0,0,1,2,3,4,5,6,7] = avg(sorted[5],sorted[6]) = avg(1,2) = 1.5
    // low (<=1.5): 0,0,0,0,0,1 -> outcomes 100,100,100,100,100,110, sum=610, mean=610/6
    // high (>1.5): 2,3,4,5,6,7 -> outcomes 120,130,140,150,160,170, sum=870, mean=145
    expect(result.status).toBe('ok');
    expect(result.estimate.nHigh).toBe(6);
    expect(result.estimate.nLow).toBe(6);
    expect(result.estimate.splitThreshold).toBeCloseTo(1.5, 10);
    expect(result.estimate.meanLow).toBeCloseTo(610 / 6, 10);
    expect(result.estimate.meanHigh).toBeCloseTo(145, 10);
  });

  it("plan.splitMode: 'binary' selects present-vs-absent instead, producing a DIFFERENT split on the SAME data", () => {
    const pairs = buildPairs(exposure, outcome, dates);
    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'binary' }, seed: 1 });

    // low (exposure===0): 0,0,0,0,0 -> outcomes 100 x5, mean=100
    // high (exposure>0): 1..7 -> outcomes 110,120,130,140,150,160,170, sum=980, mean=140
    expect(result.status).toBe('ok');
    expect(result.estimate.nHigh).toBe(7);
    expect(result.estimate.nLow).toBe(5);
    // Pinned choice (item 2): binary mode has no data-derived cut point, so
    // splitThreshold is null rather than a fabricated number — see
    // `binarySplit`'s docblock in estimator.js for the full rationale.
    expect(result.estimate.splitThreshold).toBeNull();
    expect(result.estimate.meanLow).toBeCloseTo(100, 10);
    expect(result.estimate.meanHigh).toBeCloseTo(140, 10);
    expect(result.estimate.delta).toBeCloseTo(40, 10);
    expect(result.estimate.exposureContrast).toBeCloseTo(4, 10);
  });

  it('is degenerate (reuses degenerate_exposure_split) when every exposure value is present (no absent day exists)', () => {
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'binary' }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['degenerate_exposure_split']);
  });

  it('is degenerate when every exposure value is absent (all zeros)', () => {
    const exposureAllZero = GOLDEN_DATES.map(() => 0);
    const pairs = buildPairs(exposureAllZero, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'binary' }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['degenerate_exposure_split']);
  });

  it('an unrecognized splitMode value falls back to median (only the literal string "binary" opts in)', () => {
    const pairs = buildPairs(exposure, outcome, dates);
    const result = runAnalysisPlan({ pairs, plan: { splitMode: 'nonsense' }, seed: 1 });
    expect(result.estimate.splitThreshold).toBeCloseTo(1.5, 10); // same as the median-default test above
  });
});

describe('runAnalysisPlan — per-resample split + fallback policy (item 3)', () => {
  it('exposes resampleFallbackCount as 0 for a well-separated, evenly-sized split (the golden fixture) — no fallbacks needed', () => {
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.status).toBe('ok');
    expect(result.estimate.resampleFallbackCount).toBe(0);
  });

  it('exposes a nonzero resampleFallbackCount under the 10% limit for a moderately tie-heavy split, WITHOUT triggering split_unstable', () => {
    // exposure sorted: 1,1,1,2,3,8,9,10,10,10 (n=10, median=avg(3,8)=5.5)
    //   low (<=5.5): 1,1,1,2,3 = 5 pairs; high (>5.5): 8,9,10,10,10 = 5 pairs.
    // Verified by direct execution (deterministic for seed=1): 89 of the
    // 2000 per-resample splits degenerate (a resample landing almost
    // entirely on one tied cluster) and fall back — 89/2000 = 4.45%, well
    // under RESAMPLE_FALLBACK_LIMIT (10%), so the result still reaches `ok`.
    const exposure = [1, 1, 1, 2, 3, 8, 9, 10, 10, 10];
    const outcome = exposure.map((v) => v * 2);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.meanHigh).toBeCloseTo(18.8, 10); // (16+18+20+20+20)/5
    expect(result.estimate.meanLow).toBeCloseTo(3.2, 10); // (2+2+2+4+6)/5
    expect(result.estimate.delta).toBeCloseTo(15.6, 10);
    expect(result.estimate.resampleFallbackCount).toBe(89);
    expect(result.estimate.resampleFallbackCount / BOOTSTRAP_RESAMPLES).toBeLessThan(RESAMPLE_FALLBACK_LIMIT);
    expect(result.estimate.stability).toEqual({ deltaMin: 15.3, deltaMax: 16.3, signConsistent: true });
  });

  it('gates split_unstable when a highly tie-heavy (bimodal) split pushes the fallback rate over 10%', () => {
    // Only two distinct exposure values (five 1's, five 10's): ANY resample
    // drawn mostly or entirely from one original group is, by construction,
    // constant-valued and therefore degenerate under a fresh median split —
    // this fixture was verified by direct execution to exceed the 10%
    // fallback limit for every seed probed (1-15), so the exact seed value
    // is not load-bearing here (unlike the moderate fixture above).
    const exposure = [1, 1, 1, 1, 1, 10, 10, 10, 10, 10];
    const outcome = exposure.map((v) => v * 2);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['split_unstable']);
    expect(result.estimate).toBeUndefined();
  });

  it('the split_unstable boundary comparison is strict ">" — exactly 10% (200 of 2000) does NOT trigger it, 10.05% (201 of 2000) does', () => {
    // Direct arithmetic check of the pinned boundary semantics, independent
    // of hitting this exact count via real bootstrap randomness (which
    // proved impractical to construct by hand — see task-ex1-report.md for
    // the fixture-design notes: fallback rate transitions sharply with tie
    // depth rather than varying smoothly, so no fixture/seed combination
    // found in review landed on precisely 200/2000). The two fixtures above
    // independently verify the gate's behavior on real, non-contrived data
    // both comfortably under and comfortably over the limit.
    expect(RESAMPLE_FALLBACK_LIMIT * BOOTSTRAP_RESAMPLES).toBe(200);
    expect(200 / BOOTSTRAP_RESAMPLES > RESAMPLE_FALLBACK_LIMIT).toBe(false);
    expect(201 / BOOTSTRAP_RESAMPLES > RESAMPLE_FALLBACK_LIMIT).toBe(true);
  });

  it('resampleFallbackCount is itself deterministic (same seed -> same count, repeated calls)', () => {
    const exposure = [1, 1, 1, 2, 3, 8, 9, 10, 10, 10];
    const outcome = exposure.map((v) => v * 2);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const a = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    const b = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(a.estimate.resampleFallbackCount).toBe(b.estimate.resampleFallbackCount);
  });
});

describe('runAnalysisPlan — leave-one-day-out stability (item 4)', () => {
  it('signConsistent is false when a single-day outlier in the low group flips the delta\'s sign upon exclusion', () => {
    // exposure 1..12 (distinct, no ties) -> median = avg(sorted[5],sorted[6]) = avg(6,7) = 6.5
    //   low (<=6.5): exposure 1..6 -> outcomes [10,10,10,10,10,90] (one big outlier), sum=140, mean=140/6=23.333...
    //   high (>6.5): exposure 7..12 -> outcomes all 20, sum=120, mean=20
    //   delta = 20 - 23.333... = -3.333... (negative: high group looks LOWER, driven entirely by the outlier)
    // LOO, hand-verified:
    //   remove the outlier (90) from low: newLow=(140-90)/5=10 -> delta=20-10=10 (positive! deltaMax)
    //   remove any ordinary "10" from low: newLow=(140-10)/5=26 -> delta=20-26=-6 (deltaMin)
    //   remove any high-group point: newHigh=(120-20)/5=20 (unchanged, all 20s) -> delta stays -3.333...
    // => deltaMin=-6 (negative), deltaMax=10 (positive) -> signs disagree -> signConsistent=false.
    // This is exactly the scenario the check exists to surface: the headline
    // "no clear association" / negative-delta reading is entirely an
    // artifact of one recorded day.
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const outcome = [10, 10, 10, 10, 10, 90, 20, 20, 20, 20, 20, 20];
    const dates = datesFrom(12, '2026-03-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 5 });

    expect(result.status).toBe('ok');
    expect(result.estimate.delta).toBeCloseTo(-10 / 3, 10);
    expect(result.estimate.stability.deltaMin).toBeCloseTo(-6, 10);
    expect(result.estimate.stability.deltaMax).toBeCloseTo(10, 10);
    expect(result.estimate.stability.signConsistent).toBe(false);
  });

  it('signConsistent is true for the golden fixture (delta stays positive across every leave-one-out recomputation)', () => {
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.estimate.stability).toEqual({ deltaMin: 45, deltaMax: 55, signConsistent: true });
    expect(result.estimate.stability.deltaMin).toBeGreaterThan(0);
  });

  it('never divides by zero: MIN_GROUP_SIZE (>=5 per group) guarantees every LOO exclusion still leaves >=4 in the affected group', () => {
    // The tie-split fixture's high group sits at exactly nHigh=5 (the
    // smallest group size that can ever reach `ok`) — excluding any one of
    // its 5 members leaves 4, never 0, so no LOO recomputation is ever a
    // division by zero. Re-verifies via the tie-split fixture already
    // established above rather than duplicating its arithmetic.
    const exposure = [1, 2, 3, 4, 5, 6, 6, 6, 7, 8, 9, 10, 11];
    const dates = Array.from({ length: 13 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const pairs = buildPairs(exposure, exposure, dates);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.estimate.nHigh).toBe(5);
    expect(Number.isFinite(result.estimate.stability.deltaMin)).toBe(true);
    expect(Number.isFinite(result.estimate.stability.deltaMax)).toBe(true);
  });
});

describe('SMALL_EFFECT_DELTA (item 5: practical significance)', () => {
  it('is exported as a display-scale (0-100) constant for EX2 to import rather than re-hardcode', () => {
    expect(SMALL_EFFECT_DELTA).toBe(5);
  });

  it('is NOT consumed internally by runAnalysisPlan — the estimator stays unit-agnostic; a delta smaller than SMALL_EFFECT_DELTA still reaches `ok` with no special-cased status or reason', () => {
    // exposure 1..10, outcome constructed so delta is well under 5 in
    // magnitude but the split is otherwise perfectly healthy.
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const outcome = [50, 51, 49, 50, 52, 53, 51, 52, 50, 54]; // small, noisy spread
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    expect(Math.abs(result.estimate.delta)).toBeLessThan(SMALL_EFFECT_DELTA);
    // No reason/gate exists for "small effect" at the estimator layer —
    // classifying/labeling it is EX2's job, per the module's unit-agnostic
    // discipline (see estimator.js's SMALL_EFFECT_DELTA docblock).
    expect(result.reasons).toBeUndefined();
  });
});
