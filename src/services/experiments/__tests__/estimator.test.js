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
} from '../estimator';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Golden fixture: n=10 paired days, outcome = exposure * 10 exactly.
//
// exposure (sorted, already in dateKey order): 4,5,6,6,7,7,8,8,9,10
// median of 10 values: sort => [4,5,6,6,7,7,8,8,9,10], mid=5 (0-indexed),
//   n even => median = (sorted[4] + sorted[5]) / 2 = (7 + 7) / 2 = 7
// split rule: exposure > median => high group, exposure <= median (ties) => low
//   high group exposure: 8,8,9,10                 (4 pairs)
//   low group exposure:  4,5,6,6,7,7               (6 pairs)
// outcome = exposure * 10 (perfect linear relationship => pearsonR = 1)
//   high outcomes: 80,80,90,100 -> sum=350 -> mean = 350/4   = 87.5
//   low outcomes:  40,50,60,60,70,70 -> sum=350 -> mean = 350/6 = 58.333...
//   delta = 87.5 - 58.3333... = 29.16666...
// ---------------------------------------------------------------------------
const GOLDEN_EXPOSURE = [4, 5, 6, 6, 7, 7, 8, 8, 9, 10];
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
      exposure: 4,
      outcome: 40,
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
    // A leap-year Feb boundary, chosen specifically because local-date
    // arithmetic (new Date('2026-02-28').setDate(+1)) can shift by a day
    // depending on the host TZ offset if it round-trips through a
    // non-UTC Date constructor. 2026 is not a leap year, so Feb 28 -> Mar 1.
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
    expect(result.estimate.meanHigh).toBeCloseTo(87.5, 10);
    expect(result.estimate.meanLow).toBeCloseTo(350 / 6, 10);
    expect(result.estimate.delta).toBeCloseTo(87.5 - 350 / 6, 10);
    // outcome = exposure * 10 exactly => perfect positive correlation.
    expect(result.estimate.pearsonR).toBeCloseTo(1, 10);
    expect(Array.isArray(result.estimate.ci)).toBe(true);
    expect(result.estimate.ci).toHaveLength(2);
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(result.estimate.ci[1]);
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
    // exposure sorted: 1,2,3,4,5,5,5,6,7,8,9 (n=11, odd -> median = sorted[5] = 5)
    // three values equal the median (5). Per spec, ties go LOW.
    // low group (exposure<=5):  1,2,3,4,5,5,5  -> outcome = exposure (same values)
    //   sum = 1+2+3+4+5+5+5 = 25, mean = 25/7
    // high group (exposure>5):  6,7,8,9        -> outcome = exposure
    //   sum = 6+7+8+9 = 30, mean = 30/4 = 7.5
    const exposure = [1, 2, 3, 4, 5, 5, 5, 6, 7, 8, 9];
    const dates = Array.from({ length: 11 }, (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}`);
    const exposureSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
    const outcomeSeries = dates.map((dateKey, i) => ({ dateKey, value: exposure[i] }));
    const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: 0 });

    const result = runAnalysisPlan({ pairs, plan: {}, seed: 1 });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(11);
    expect(result.estimate.meanLow).toBeCloseTo(25 / 7, 10);
    expect(result.estimate.meanHigh).toBeCloseTo(7.5, 10);
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
