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
  RESAMPLE_DISCARD_LIMIT,
  DEFAULT_MIN_EXPOSURE_CONTRAST,
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
    expect(typeof result.estimate.resampleDiscardCount).toBe('number');
    expect(result.estimate.resampleDiscardCount).toBe(0); // hand-verified via probing: this fixture's split is stable
    // Stability (item 2, round-2 recompute — see docs/quality/
    // experiments-data-method.md's "Round-2" section for the full
    // rationale): this fixture sits EXACTLY at n=10 with an exactly-5/5
    // whole-sample split. Removing any ONE pair leaves n-1=9, and no split
    // of 9 pairs can put >= MIN_GROUP_SIZE (5) on BOTH sides at once
    // (5+5=10 > 9) — so EVERY one of the 10 leave-one-out iterations fails
    // the group-size gate, regardless of which specific pair is removed or
    // what the outcome values are. This is a MATHEMATICAL consequence of
    // MIN_GROUP_SIZE=5 at exactly n=10 (proved directly: remove any single
    // exposure value from {1..10} and the 9 remaining values' median split
    // is always 4-vs-5, e.g. removing "1" -> median=6, low={2,3,4,5,6}=5,
    // high={7,8,9,10}=4 < 5), NOT a bug and NOT specific to this fixture's
    // hand-picked values — an experiment sitting at the bare minimum sample
    // size is, honestly, exactly this fragile. `deltaMin`/`deltaMax` are
    // `null` because zero of the 10 iterations produced a trustworthy
    // re-estimate to report a range over.
    expect(result.estimate.stability).toEqual({ deltaMin: null, deltaMax: null, signConsistent: false, gateFailures: 10 });
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
    expect(RESAMPLE_DISCARD_LIMIT).toBe(0.1);
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

// ===========================================================================
// Michael's round-2 statistical review (2026-07-22, item 1): the exposure-
// contrast guard now compares against a PLAN-SUPPLIED, template-specific
// minimum (`plan.minExposureContrast`) instead of a bare `> 0` check — see
// docs/quality/experiments-data-method.md's "Round-2" section and
// templates.js's own doc comment for the pinned v1 values. The two tests
// above (both using `plan: {}`/`plan: {splitMode: 'binary'}`, i.e. NO
// `minExposureContrast`) continue to exercise the LEGACY fallback
// (`DEFAULT_MIN_EXPOSURE_CONTRAST` = 0) unchanged — proving "legacy plan
// without the field -> old behavior" directly, alongside the new tests below.
// ===========================================================================
describe('runAnalysisPlan — plan-supplied minExposureContrast (Michael round-2 review, item 1: genuinely reachable exposure_contrast_too_small)', () => {
  // Sleep-hours-shaped fixture: exposure in whole-ish hours, contrast
  // computed the same way as the golden fixture's own template-independent
  // arithmetic — this block doesn't import templates.js (estimator.js stays
  // template-agnostic), it just uses the SAME numeric minimum
  // (1.0) templates.js pins for the sleep-hours templates, to keep the
  // fixture story recognizable.
  const SLEEP_LIKE_MIN_CONTRAST = 1.0;

  it('below-minimum contrast -> insufficient with exposure_contrast_too_small, even though every other gate passes', () => {
    // exposure: six values at 5.0, six values at 5.5 (contrast = 5.5-5.0 =
    // 0.5, BELOW the 1.0 minimum) — median splits cleanly 6/6 (well above
    // MIN_GROUP_SIZE/MIN_GROUP_FRACTION), so this isolates the contrast
    // guard from the group-size guards.
    const exposure = [5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-07-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: { minExposureContrast: SLEEP_LIKE_MIN_CONTRAST }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['exposure_contrast_too_small']);
    expect(result.estimate).toBeUndefined();
  });

  it('at-minimum contrast (exactly equal to plan.minExposureContrast) PASSES — the comparison is `< min`, not `<= min`', () => {
    // Twelve DISTINCT graduated values (not a two-value bimodal cluster —
    // that shape reliably trips the UNRELATED split_unstable bootstrap
    // guard, see the "per-resample split + discard policy" tests above; a
    // mild internal spread keeps the per-resample bootstrap split stable so
    // this test isolates the CONTRAST guard alone). Low cluster centered at
    // 5.0 (spread +/-0.25, mean exactly 5.0), high cluster centered at 6.0
    // (same spread, mean exactly 6.0) -> contrast = 6.0-5.0 = 1.0, exactly
    // equal to the plan's minimum. Clusters don't overlap (max(low)=5.25 <
    // min(high)=5.75), so the median cleanly separates them 6/6.
    const exposure = [4.75, 4.85, 4.95, 5.05, 5.15, 5.25, 5.75, 5.85, 5.95, 6.05, 6.15, 6.25];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-07-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: { minExposureContrast: SLEEP_LIKE_MIN_CONTRAST }, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.exposureContrast).toBeCloseTo(1.0, 10);
  });

  it('a legacy plan without minExposureContrast falls back to the old (DEFAULT_MIN_EXPOSURE_CONTRAST=0) behavior — the SAME shape of data, now with only a 0.5 contrast, still reaches `ok`', () => {
    // Same graduated-cluster construction as above, contrast tightened to
    // exactly 0.5 (below the 1.0 minimum templates.js pins for sleep-hours,
    // but the plan below carries NO minExposureContrast at all).
    const exposure = [4.9, 4.94, 4.98, 5.02, 5.06, 5.1, 5.4, 5.44, 5.48, 5.52, 5.56, 5.6];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-07-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 }); // no minExposureContrast

    expect(result.status).toBe('ok');
    expect(result.estimate.exposureContrast).toBeCloseTo(0.5, 10);
  });

  it('the contrast guard is evaluated per-template-unit — a template-shaped minimum in a completely different unit scale (e.g. steps: 2000) rejects a contrast that would pass a smaller-scale minimum', () => {
    // exposure "steps"-shaped: six values at 3000, six at 4000 (contrast =
    // 1000, below a 2000-step minimum but would pass a 1.0-hour-shaped one).
    const exposure = [3000, 3000, 3000, 3000, 3000, 3000, 4000, 4000, 4000, 4000, 4000, 4000];
    const outcome = exposure.map((v, i) => i * 10);
    const dates = datesFrom(12, '2026-07-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: { minExposureContrast: 2000 }, seed: 1 });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['exposure_contrast_too_small']);
  });

  it('DEFAULT_MIN_EXPOSURE_CONTRAST is exported as 0 (the legacy floor)', () => {
    expect(DEFAULT_MIN_EXPOSURE_CONTRAST).toBe(0);
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

describe('runAnalysisPlan — per-resample split + discard policy (item 3; discard semantics per Michael round-2 review)', () => {
  it('exposes resampleDiscardCount as 0 for a well-separated, evenly-sized split (the golden fixture) — nothing to discard', () => {
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.status).toBe('ok');
    expect(result.estimate.resampleDiscardCount).toBe(0);
  });

  it('exposes a nonzero resampleDiscardCount under the 10% limit for a moderately tie-heavy split, WITHOUT triggering split_unstable', () => {
    // exposure sorted: 1,1,1,2,3,8,9,10,10,10 (n=10, median=avg(3,8)=5.5)
    //   low (<=5.5): 1,1,1,2,3 = 5 pairs; high (>5.5): 8,9,10,10,10 = 5 pairs.
    // Verified by direct execution (deterministic for seed=1, round-2 discard
    // policy): DISCARD_COUNT_MODERATE of the 2000 per-resample splits
    // degenerate (a resample landing almost entirely on one tied cluster)
    // and are discarded outright (no fallback delta computed for them) —
    // well under RESAMPLE_DISCARD_LIMIT (10%), so the result still reaches
    // `ok`, with the CI computed from the remaining valid resamples only.
    const exposure = [1, 1, 1, 2, 3, 8, 9, 10, 10, 10];
    const outcome = exposure.map((v) => v * 2);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    // meanHigh/meanLow/delta come from the WHOLE-SAMPLE split (unaffected by
    // the bootstrap's discard policy) — unchanged from the pre-round-2 value.
    expect(result.estimate.meanHigh).toBeCloseTo(18.8, 10); // (16+18+20+20+20)/5
    expect(result.estimate.meanLow).toBeCloseTo(3.2, 10); // (2+2+2+4+6)/5
    expect(result.estimate.delta).toBeCloseTo(15.6, 10);
    expect(result.estimate.resampleDiscardCount).toBeGreaterThan(0);
    expect(result.estimate.resampleDiscardCount / BOOTSTRAP_RESAMPLES).toBeLessThan(RESAMPLE_DISCARD_LIMIT);
    // CI is still well-formed (bracketing structure), computed from the
    // valid-only resamples' percentiles.
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(result.estimate.ci[1]);
    // Stability (item 2, round-2 recompute): this is an n=10, EXACTLY 5/5
    // whole-sample split. Any single-pair removal leaves n-1=9 pairs, and no
    // split of 9 pairs can put >= MIN_GROUP_SIZE (5) on BOTH sides (5+5=10 >
    // 9) — so EVERY leave-one-out iteration fails the group-size gate,
    // REGARDLESS of this fixture's specific values. This is a mathematical
    // consequence of MIN_GROUP_SIZE=5 at exactly n=10, not a data-dependent
    // result — see the golden-fixture stability test below for the same
    // proof spelled out in full.
    expect(result.estimate.stability).toEqual({ deltaMin: null, deltaMax: null, signConsistent: false, gateFailures: 10 });
  });

  it('gates split_unstable when a highly tie-heavy (bimodal) split pushes the discard rate over 10%', () => {
    // Only two distinct exposure values (five 1's, five 10's): ANY resample
    // drawn mostly or entirely from one original group is, by construction,
    // constant-valued and therefore degenerate under a fresh median split —
    // this fixture was verified by direct execution to exceed the 10%
    // discard limit for every seed probed (1-15), so the exact seed value
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
    // the fixture-design notes: the discard rate transitions sharply with
    // tie depth rather than varying smoothly, so no fixture/seed combination
    // found in review landed on precisely 200/2000). The two fixtures above
    // independently verify the gate's behavior on real, non-contrived data
    // both comfortably under and comfortably over the limit.
    expect(RESAMPLE_DISCARD_LIMIT * BOOTSTRAP_RESAMPLES).toBe(200);
    expect(200 / BOOTSTRAP_RESAMPLES > RESAMPLE_DISCARD_LIMIT).toBe(false);
    expect(201 / BOOTSTRAP_RESAMPLES > RESAMPLE_DISCARD_LIMIT).toBe(true);
  });

  it('resampleDiscardCount is itself deterministic (same seed -> same count, repeated calls)', () => {
    const exposure = [1, 1, 1, 2, 3, 8, 9, 10, 10, 10];
    const outcome = exposure.map((v) => v * 2);
    const pairs = buildPairs(exposure, outcome, GOLDEN_DATES);

    const a = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    const b = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(a.estimate.resampleDiscardCount).toBe(b.estimate.resampleDiscardCount);
    expect(a.estimate.ci).toEqual(b.estimate.ci);
  });

  it('the CI is computed from the valid resamples only — a golden-fixture CI sanity check with hand-shown arithmetic for the discard/percentile mechanics', () => {
    // The golden fixture (n=10, perfectly separated, no ties) has ZERO
    // discards — so this is the simplest possible "valid-only percentile"
    // case: all 2000 resamples are valid, and the percentile indices are
    // exactly the pre-round-2 nearest-rank computation (lastIdx = 2000-1 =
    // 1999; alpha = 0.025; lowerIdx = floor(0.025*1999) = 49;
    // upperIdx = ceil(0.975*1999) = 1950) — the discard-aware code path
    // (lastIdx = deltas.length-1) degenerates to exactly this when nothing
    // was discarded, which is the correctness bar for the new percentile
    // logic: it must reproduce the un-discarded case exactly.
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.estimate.resampleDiscardCount).toBe(0);
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(result.estimate.delta);
    expect(result.estimate.ci[1]).toBeGreaterThanOrEqual(result.estimate.delta);
  });
});

describe('runAnalysisPlan — leave-one-day-out stability (item 4; REWORKED in round-2 to recompute the split + gates per iteration)', () => {
  it('signConsistent is false when a single-day outlier in the low group flips the delta\'s sign upon exclusion (values re-verified for the round-2 recompute semantics)', () => {
    // exposure 1..12 (distinct, no ties) -> median = avg(sorted[5],sorted[6]) = avg(6,7) = 6.5
    //   low (<=6.5): exposure 1..6 -> outcomes [10,10,10,10,10,90] (one big outlier), sum=140, mean=140/6=23.333...
    //   high (>6.5): exposure 7..12 -> outcomes all 20, sum=120, mean=20
    //   delta = 20 - 23.333... = -3.333... (negative: high group looks LOWER, driven entirely by the outlier)
    //
    // ROUND-2 recompute (full re-split + re-gate per iteration, NOT the
    // pre-round-2 fixed-group mean-adjustment — see estimator.js's
    // computeStability docblock). Removing any of exposure {1,2,3,4,5}
    // (n=11 remaining) shifts the recomputed median from 6.5 to 7 (e.g.
    // remove "1": remaining sorted = 2,3,4,5,6,7,8,9,10,11,12, median =
    // sorted[5] = 7), which pulls exposure "7" (outcome 20, ties->LOW) OUT
    // of the high group and INTO the low group alongside the outlier:
    //   remove any of {1..5}: newLow = {remaining of 1-6} + {7} = 6 values,
    //     e.g. remove "1" -> {2,3,4,5,6,7} outcomes 10,10,10,10,90,20 =
    //     150, mean 25; newHigh = {8,9,10,11,12} = 5, all 20, mean 20 ->
    //     delta = 20-25 = -5 (five iterations at exactly -5).
    //   remove "6" (the outlier's own day): remaining median ALSO
    //     recomputes to 7 (same reasoning) -> newLow = {1,2,3,4,5,7}
    //     outcomes 10,10,10,10,10,20 = 70, mean 70/6 = 11.667; newHigh =
    //     {8..12} = 5, mean 20 -> delta = 20-11.667 = 8.333 (deltaMax,
    //     POSITIVE — removing the outlier itself flips the sign).
    //   remove any of {7..12} (ordinary high members, all outcome 20): no
    //     reassignment (median recomputes back to 6) -> low stays {1..6}
    //     (mean 23.333, unchanged), high loses one 20-valued member but
    //     stays all-20s (mean 20) -> delta stays -3.333... (six iterations).
    // => deltaMin=-5, deltaMax=25/3 (8.333...) -> signs disagree ->
    // signConsistent=false. Group sizes stay 6/5 throughout (n-1=11), so
    // gateFailures=0 — every iteration produced a real re-estimate; they
    // just disagree on sign, which is exactly the fragility this check
    // exists to surface.
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const outcome = [10, 10, 10, 10, 10, 90, 20, 20, 20, 20, 20, 20];
    const dates = datesFrom(12, '2026-03-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 5 });

    expect(result.status).toBe('ok');
    expect(result.estimate.delta).toBeCloseTo(-10 / 3, 10);
    expect(result.estimate.stability.deltaMin).toBeCloseTo(-5, 10);
    expect(result.estimate.stability.deltaMax).toBeCloseTo(25 / 3, 10);
    expect(result.estimate.stability.signConsistent).toBe(false);
    expect(result.estimate.stability.gateFailures).toBe(0);
  });

  // -------------------------------------------------------------------------
  // THE EXACT CASE THE OLD (pre-round-2) IMPLEMENTATION MISSED (Michael's
  // round-2 directive, item 2): a fixture deliberately constructed so that
  // removing one paired day shifts the recomputed MEDIAN enough to move a
  // DIFFERENT, still-present day across the high/low boundary — the OLD
  // fixed-group-assignment LOO (which never recomputed the split at all)
  // would have reported this result as perfectly STABLE, when the honest,
  // fully-recomputed answer is that it is NOT.
  // -------------------------------------------------------------------------
  it('demonstrates the old fixed-split LOO missing a real reassignment: old approach says stable, round-2 recompute correctly says unstable', () => {
    // exposure 1..12 (distinct) -> whole-sample median = avg(sorted[5],sorted[6]) = avg(6,7) = 6.5
    //   low (<=6.5) = {1..6}, ALL outcome 10 -> mean = 10
    //   high (>6.5) = {7..12}: exposure 7 -> outcome 90 (one big outlier),
    //     exposure 8-12 -> outcome 20 each -> sum = 90+20*5 = 190, mean = 190/6 = 31.667
    //   whole-sample delta = 31.667 - 10 = 21.667 (large, positive)
    //
    // OLD (pre-round-2) fixed-group LOO — recomputes ONLY the affected
    // group's mean, keeping the ORIGINAL {1..6}/{7..12} assignment fixed:
    //   remove any of {1..6} (all outcome 10): newLow = (60-10)/5 = 10
    //     (unchanged, every value was 10) -> delta stays 21.667 (positive).
    //   remove the outlier "7" (outcome 90): newHigh = (190-90)/5 = 20 ->
    //     delta = 20-10 = 10 (positive).
    //   remove any of {8..12} (outcome 20): newHigh = (190-20)/5 = 34 ->
    //     delta = 34-10 = 24 (positive).
    //   => EVERY old-style LOO delta is positive (range [10, 24]) -> the old
    //   implementation would report signConsistent: true — "stable."
    //
    // ROUND-2 recompute (the actual, fixed behavior) — re-splits the
    // remaining 11 pairs from scratch each time:
    //   remove any of {1,2,3,4,5,6} (n=11 remaining): the new median shifts
    //     to avg(sorted[5],sorted[6]) = 7 (e.g. removing "1": remaining
    //     sorted = 2,3,4,5,6,7,8,9,10,11,12, idx5=7) -> LOW now picks up
    //     exposure "7" (ties->LOW), pulling the 90-outlier INTO the low
    //     group: newLow = {remaining of 1-6} + {7} = 6 values, e.g. for
    //     remove="1": {2,3,4,5,6,7} outcomes 10,10,10,10,10,90 sum=140
    //     mean=23.333; newHigh = {8,9,10,11,12} = 5 values, all 20, mean=20.
    //     delta = 20 - 23.333 = -3.333 (NEGATIVE — the sign FLIPS, because
    //     the outlier that was safely isolated in the high group under the
    //     OLD fixed assignment gets reassigned into the low group once the
    //     split is honestly recomputed). This happens for every removal
    //     among {1,2,3,4,5,6} (six iterations, all delta=-3.333).
    //   remove "7" itself (the outlier): remaining median recomputes to 6
    //     (sorted 1,2,3,4,5,6,8,9,10,11,12, idx5=6) -> low={1..6}=6 (mean
    //     10), high={8..12}=5 (mean 20) -> delta=20-10=10 (positive, no
    //     reassignment since the outlier itself is gone).
    //   remove any of {8,9,10,11,12} (n=11, median recomputes to 6, no
    //     reassignment) -> low={1..6}=6 (mean 10), high = remaining 4 of
    //     {8..12} plus outcome-90 exposure-7 still present = 5 values (one
    //     20-value removed, "7" stays put since 7 <= 6 is false) -> e.g.
    //     remove "12": high={7,8,9,10,11} outcomes 90,20,20,20,20 sum=170
    //     mean=34 -> delta=34-10=24 (positive).
    //   => deltas: six at -3.333 (removing 1-6), one at +10 (removing 7),
    //   five at +24 (removing 8-12). Signs DISAGREE -> signConsistent:
    //   false. deltaMin=-10/3, deltaMax=24. Group sizes stay 6/5 throughout
    //   (n-1=11), so gateFailures=0 — this is a genuine sign flip caught by
    //   recomputation, NOT a gate failure.
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const outcome = [10, 10, 10, 10, 10, 10, 90, 20, 20, 20, 20, 20];
    const dates = datesFrom(12, '2026-06-');
    const pairs = buildPairs(exposure, outcome, dates);

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 3 });

    expect(result.status).toBe('ok');
    expect(result.estimate.delta).toBeCloseTo(21.6666666667, 8); // whole-sample delta, unaffected by LOO
    expect(result.estimate.stability.gateFailures).toBe(0);
    expect(result.estimate.stability.deltaMin).toBeCloseTo(-10 / 3, 8);
    expect(result.estimate.stability.deltaMax).toBeCloseTo(24, 8);
    // THE REGRESSION THIS TEST GUARDS: the fully-recomputed answer is
    // sign-INCONSISTENT (a real reassignment flips the sign for 6 of the 12
    // iterations) — an implementation that only adjusted the ORIGINAL
    // split's fixed-group means (the pre-round-2 bug) would never see this,
    // because it never recomputes which group "7" belongs to.
    expect(result.estimate.stability.signConsistent).toBe(false);
  });

  it('signConsistent is false for the golden fixture — NOT true (round-2 correction): at exactly n=10 with a 5/5 whole-sample split, EVERY leave-one-out iteration fails the group-size gate, mathematically, regardless of the fixture\'s specific values (see the golden-fixture "ok boundary" test above for the full proof)', () => {
    const pairs = buildPairs(GOLDEN_EXPOSURE, GOLDEN_EXPOSURE.map((v) => v * 10), GOLDEN_DATES);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.estimate.stability).toEqual({ deltaMin: null, deltaMax: null, signConsistent: false, gateFailures: 10 });
  });

  it('stability is deterministic — the SAME (pairs, splitMode, minExposureContrast) always produces the SAME stability object, with no rng involved at all', () => {
    const exposure = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const outcome = [10, 10, 10, 10, 10, 10, 90, 20, 20, 20, 20, 20];
    const dates = datesFrom(12, '2026-06-');
    const pairs = buildPairs(exposure, outcome, dates);

    const a = runAnalysisPlan({ pairs, plan: {}, seed: 3 });
    const b = runAnalysisPlan({ pairs, plan: {}, seed: 3 });
    // Different seeds too — stability never touches the rng, so it must be
    // identical regardless of seed.
    const c = runAnalysisPlan({ pairs, plan: {}, seed: 999 });
    expect(a.estimate.stability).toEqual(b.estimate.stability);
    expect(a.estimate.stability).toEqual(c.estimate.stability);
  });

  it('never divides by zero AND correctly gate-fails only the iterations that push a group under MIN_GROUP_SIZE (a MIXED gate-failure/pass fixture — item 2\'s "gate-failure iteration counted" requirement)', () => {
    // The tie-split fixture's high group sits at exactly nHigh=5 (the
    // smallest group size that can ever reach `ok`), nLow=8.
    //   - Removing any of the 5 HIGH members leaves high=4 < MIN_GROUP_SIZE
    //     (5) -> gate failure (5 iterations; no division by zero either —
    //     the recomputed split is just discarded as ineligible, never
    //     divides by a zero-sized group).
    //   - Removing any of the 8 LOW members leaves low=7, high=5 (verified
    //     by hand for every low member, including each of the three tied
    //     "6"s: the median recomputes to 6 in every case, no reassignment)
    //     -> both sides clear MIN_GROUP_SIZE and MIN_GROUP_FRACTION
    //     (5/12=0.4167) -> passes (8 iterations).
    // => gateFailures=5 (exactly the 5 high-member removals), and the 8
    // passing iterations still produce finite deltaMin/deltaMax.
    const exposure = [1, 2, 3, 4, 5, 6, 6, 6, 7, 8, 9, 10, 11];
    const dates = Array.from({ length: 13 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const pairs = buildPairs(exposure, exposure, dates);
    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });
    expect(result.estimate.nHigh).toBe(5);
    expect(result.estimate.stability.gateFailures).toBe(5);
    expect(Number.isFinite(result.estimate.stability.deltaMin)).toBe(true);
    expect(Number.isFinite(result.estimate.stability.deltaMax)).toBe(true);
    // Some iterations passed (gateFailures < n=13), so signConsistent is a
    // real (non-null-forced) determination — here it's false, because
    // gateFailures > 0 forces it per computeStability's pinned rule.
    expect(result.estimate.stability.signConsistent).toBe(false);
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
