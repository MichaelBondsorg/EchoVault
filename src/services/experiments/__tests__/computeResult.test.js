/**
 * Tests for Personal Experiments result computation (R3 Task 5).
 *
 * Spec reference: docs/quality/experiments-data-method.md
 * Golden fixtures show their arithmetic in comments so expected values can
 * be checked by hand, mirroring estimator.test.js's own convention.
 */
import { describe, it, expect } from 'vitest';
import {
  computeExperimentResult,
  exposureValueForEntry,
  outcomeValueForEntry,
  buildDaySeries,
  NON_CAUSAL_FRAMING,
  INSUFFICIENCY_COPY,
} from '../computeResult';
import { getTemplateById } from '../templates';
import { MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } from '../estimator';

const SLEEP_TEMPLATE = getTemplateById('sleep-hours-mood-same-day');
const SLEEP_LAG1_TEMPLATE = getTemplateById('sleep-hours-mood-lag1');
const EXERCISE_TEMPLATE = getTemplateById('exercise-minutes-mood');
const TAG_TEMPLATE = getTemplateById('tag-presence-mood');

/**
 * A minimal, LOCAL stand-in for `experimentsService.js`'s
 * `buildAnalysisPlan` (same output shape), deliberately NOT imported here:
 * `experimentsService.js` imports the real (unmocked) Firebase client SDK
 * via `../../config/firebase`, which triggers an async messaging-init side
 * effect in this jsdom test environment (an unhandled rejection —
 * `experimentsService.test.js` avoids it by mocking that import; this file
 * stays a fully pure consumer of `computeResult.js`/`templates.js`/
 * `estimator.js` instead, matching this module's own "no Firebase" posture).
 */
function buildAnalysisPlan(template, params = {}) {
  const exposure = { ...template.exposure };
  if (template.exposure.source === 'tags') {
    exposure.tag = params.tag;
  }
  return {
    templateId: template.id,
    lag: template.lag,
    exposure,
    outcome: { ...template.outcome },
    minPairedObservations: MIN_PAIRED_OBSERVATIONS,
    coverageFloor: COVERAGE_FLOOR,
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function isoDay(y, m, d, hour = 12) {
  return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
}

function dateKeyFor(y, m, d) {
  return isoDay(y, m, d, 0).slice(0, 10);
}

function baseExperiment({ template, params = {}, startAt, endAt, durationDays, excludedObservations = [], scope = null }) {
  return {
    id: 'exp-test',
    question: 'test question',
    template: template.id,
    analysisPlan: buildAnalysisPlan(template, params),
    scope,
    status: 'running',
    startAt,
    endAt,
    durationDays,
    excludedObservations,
    createdAt: startAt,
    updatedAt: startAt,
  };
}

/** Deep-clones a result and strips `receipt.versions.generatedAt` (real-wall-clock metadata, not part of the determinism contract — see computeResult.js's module doc comment). */
function stripGeneratedAt(result) {
  const clone = JSON.parse(JSON.stringify(result));
  if (clone?.receipt?.versions) delete clone.receipt.versions.generatedAt;
  return clone;
}

// ---------------------------------------------------------------------------
// Golden fixture: 28 days, Jan 1-28 2026 (UTC). sleepHours[i] cycles
// 4,5,6,7,8,9,10 repeating (4 full cycles = 28 days), mood_score = sleepHours
// * 10 exactly (perfect linear relationship — same construction idea as
// estimator.test.js's own golden fixture, extended to 28 points).
//
// Sorted sleepHours (28 values, 4 copies of each of 4..10):
//   4x4, 5x4, 6x4, 7x4, 8x4, 9x4, 10x4
// median (n=28 even): average of sorted[13], sorted[14] -> both land in the
//   "7" block (0-indexed positions 12-15) -> median = 7.
// split rule: exposure > median -> HIGH; exposure <= median (ties) -> LOW.
//   HIGH group: exposure 8,9,10 (4 each) = 12 pairs
//   LOW  group: exposure 4,5,6,7 (4 each) = 16 pairs
// mood = exposure * 10:
//   HIGH outcomes: 80x4, 90x4, 100x4 -> sum = 4*(80+90+100) = 1080 -> mean = 90
//   LOW  outcomes: 40x4, 50x4, 60x4, 70x4 -> sum = 4*(40+50+60+70) = 880 -> mean = 55
//   delta = 90 - 55 = 35
// n = 28 (every day pairs same-day, lag 0). pearsonR = 1 exactly (perfect
//   linear transform of exposure).
// ---------------------------------------------------------------------------

function goldenSleepHours(i) {
  return 4 + (i % 7);
}

function buildGoldenEntries() {
  const entries = [];
  for (let i = 0; i < 28; i++) {
    const day = i + 1;
    const hours = goldenSleepHours(i);
    entries.push({
      id: `golden-${day}`,
      createdAt: isoDay(2026, 1, day),
      healthContext: { sleep: { totalHours: hours } },
      analysis: { mood_score: hours * 10 },
    });
  }
  return entries;
}

const GOLDEN_START = isoDay(2026, 1, 1, 0);
const GOLDEN_END = isoDay(2026, 1, 29, 0); // start + 28 days
const GOLDEN_NOW = new Date(isoDay(2026, 2, 5, 0)); // after endAt -> effectiveEnd = endAt

describe('computeExperimentResult — required inputs', () => {
  it('throws without a valid experiment/analysisPlan', () => {
    expect(() => computeExperimentResult({ entries: [], now: GOLDEN_NOW })).toThrow();
    expect(() => computeExperimentResult({ experiment: {}, entries: [], now: GOLDEN_NOW })).toThrow();
  });

  it('throws without a valid `now`', () => {
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    expect(() => computeExperimentResult({ experiment, entries: [] })).toThrow();
    expect(() => computeExperimentResult({ experiment, entries: [], now: 'not-a-date' })).toThrow();
  });

  it('throws with an invalid startAt/endAt', () => {
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: 'nope', endAt: GOLDEN_END, durationDays: 28 });
    expect(() => computeExperimentResult({ experiment, entries: [], now: GOLDEN_NOW })).toThrow();
  });
});

describe('computeExperimentResult — golden fixture (end-to-end, hand-computed)', () => {
  it('computes the hand-verified estimate for a 28-day perfect-linear sleep/mood fixture', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: GOLDEN_START,
      endAt: GOLDEN_END,
      durationDays: 28,
    });
    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(28);
    expect(result.estimate.meanHigh).toBeCloseTo(90, 10);
    expect(result.estimate.meanLow).toBeCloseTo(55, 10);
    expect(result.estimate.delta).toBeCloseTo(35, 10);
    expect(result.estimate.pearsonR).toBeCloseTo(1, 10);
    // Bootstrap CI is deterministic but not hand-computable by construction;
    // sanity-check it brackets the observed delta and, given this fixture's
    // clean separation, sits clear of zero.
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(result.estimate.delta);
    expect(result.estimate.ci[1]).toBeGreaterThanOrEqual(result.estimate.delta);
    expect(result.estimate.ci[0]).toBeGreaterThan(0);

    expect(result.coverage.exposure).toEqual({ covered: 28, total: 28, label: '28 of 28 days' });
    expect(result.coverage.outcome).toEqual({ covered: 28, total: 28, label: '28 of 28 days' });

    expect(result.receipt.versions.generator).toBe('experiment_v1');
    // sampleSize is the TRUE pair count (28); receipt.sources is capped by
    // buildReceipt's default `maxSources` (20) same as every other receipt
    // in the app — the two are deliberately independent (buildReceipt's
    // `sampleSize` override exists exactly so a capped source list doesn't
    // understate the real sample size).
    expect(result.receipt.sampleSize).toBe(28);
    expect(result.receipt.sources).toHaveLength(20);
    expect(result.receipt.timeWindow).toEqual({ start: GOLDEN_START, end: GOLDEN_END });

    expect(result.narrative.summary).toContain(NON_CAUSAL_FRAMING);
    expect(result.narrative.summary).toContain('35 points higher');
    expect(result.narrative.alternatives).toEqual(SLEEP_TEMPLATE.confounders);
    expect(result.narrative.whatThisDoesNotProve).toEqual(SLEEP_TEMPLATE.whatThisDoesNotProve);
    expect(result.narrative).not.toHaveProperty('insufficiency');
  });
});

describe('computeExperimentResult — insufficiency payload-exactness', () => {
  it('below MIN_PAIRED_OBSERVATIONS: absolutely no `estimate`/`summary` keys, insufficiency copy present, receipt still carried', () => {
    const entries = [];
    for (let i = 0; i < 5; i++) {
      // well under MIN_PAIRED_OBSERVATIONS (10)
      const day = i + 1;
      entries.push({
        id: `sparse-${day}`,
        createdAt: isoDay(2026, 3, day),
        healthContext: { sleep: { totalHours: 7 + i } },
        analysis: { mood_score: 60 + i },
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: isoDay(2026, 3, 1, 0),
      endAt: isoDay(2026, 3, 29, 0),
      durationDays: 28,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 4, 5, 0)) });

    expect(result.status).toBe('insufficient');
    // Absence, not undefined — a payload-exactness check via key enumeration.
    expect(Object.keys(result)).not.toContain('estimate');
    expect(result).not.toHaveProperty('estimate');
    expect(Object.keys(result.narrative)).not.toContain('summary');
    expect(result.narrative).not.toHaveProperty('summary');
    expect(result.narrative.insufficiency).toBe(INSUFFICIENCY_COPY);
    expect(result.narrative.alternatives).toEqual([]);
    expect(result.narrative.whatThisDoesNotProve).toEqual([]);

    // Receipt invariant: every result, ok AND insufficient, carries a receipt.
    expect(result.receipt).toBeTruthy();
    expect(result.receipt.versions.generator).toBe('experiment_v1');
    expect(result.receipt.sampleSize).toBe(5);
    expect(result.coverage.exposure.covered).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Exclusion round-trip determinism
// ---------------------------------------------------------------------------

function buildFourteenDayEntries() {
  const entries = [];
  for (let i = 0; i < 14; i++) {
    const day = i + 1;
    entries.push({
      id: `excl-${day}`,
      createdAt: isoDay(2026, 5, day),
      healthContext: { sleep: { totalHours: 4 + i } }, // distinct values 4..17, no ties
      analysis: { mood_score: 50 + i },
    });
  }
  return entries;
}

const EXCL_START = isoDay(2026, 5, 1, 0);
const EXCL_END = isoDay(2026, 5, 15, 0); // start + 14 days
const EXCL_NOW = new Date(isoDay(2026, 6, 5, 0));

describe('computeExperimentResult — exclusion changes exactly its contribution; un-exclude restores the original', () => {
  it('excluding one paired observation drops it from the estimate and receipt; restoring it reproduces the original result bitwise', () => {
    const entries = buildFourteenDayEntries();
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: EXCL_START,
      endAt: EXCL_END,
      durationDays: 14,
    });

    const original = computeExperimentResult({ experiment, entries, now: EXCL_NOW });
    expect(original.status).toBe('ok');
    expect(original.estimate.n).toBe(14);
    expect(original.receipt.sampleSize).toBe(14);

    const excludedDateKey = dateKeyFor(2026, 5, 5); // day 5 of 14
    const excludedEntryId = 'excl-5';
    expect(original.receipt.sources.some((s) => s.entryId === excludedEntryId)).toBe(true);

    const withExclusion = computeExperimentResult({
      experiment: { ...experiment, excludedObservations: [excludedDateKey] },
      entries,
      now: EXCL_NOW,
    });
    expect(withExclusion.status).toBe('ok');
    expect(withExclusion.estimate.n).toBe(13);
    expect(withExclusion.receipt.sampleSize).toBe(13);
    expect(withExclusion.receipt.sources.some((s) => s.entryId === excludedEntryId)).toBe(false);
    // Coverage answers "how much data exists", independent of the exclusion toggle.
    expect(withExclusion.coverage).toEqual(original.coverage);
    // The estimate changes (median split is recomputed fresh on the reduced
    // 13-pair set — removing one point can shift the median itself and
    // therefore which side of the split a DIFFERENT point falls on, not
    // just drop the excluded point's own contribution; that's expected,
    // correct behavior for a median-split estimator, not a bug).
    expect(withExclusion.estimate).not.toEqual(original.estimate);

    const restored = computeExperimentResult({
      experiment: { ...experiment, excludedObservations: [] },
      entries,
      now: EXCL_NOW,
    });
    expect(stripGeneratedAt(restored)).toEqual(stripGeneratedAt(original));
  });
});

// ---------------------------------------------------------------------------
// Safety: flagged entries in stats, out of receipt sources
// ---------------------------------------------------------------------------

describe('computeExperimentResult — safety: flagged entries contribute to the estimate but never appear in receipt sources', () => {
  it('a safety_flagged entry is folded into the stats (n unaffected) but absent from receipt.sources (id AND excerpt)', () => {
    const entries = buildFourteenDayEntries().map((e, i) =>
      i === 4 ? { ...e, content: 'flagged content should never be cited', text: 'flagged content should never be cited', safety_flagged: true } : e,
    );
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: EXCL_START,
      endAt: EXCL_END,
      durationDays: 14,
    });

    const withFlag = computeExperimentResult({ experiment, entries, now: EXCL_NOW });

    // In the stats: the flagged day still pairs and counts (n=14, not 13) —
    // excluding it would bias the mood estimate, per the plan's binding
    // safety posture.
    expect(withFlag.status).toBe('ok');
    expect(withFlag.estimate.n).toBe(14);
    expect(withFlag.receipt.sampleSize).toBe(14);

    // Out of receipt sources: neither the id nor any excerpt/content ever appears.
    expect(withFlag.receipt.sources.some((s) => s.entryId === 'excl-5')).toBe(false);
    expect(withFlag.receipt.sources).toHaveLength(13); // 14 contributing days, 1 filtered out
    const serialized = JSON.stringify(withFlag.receipt);
    expect(serialized).not.toContain('flagged content should never be cited');
  });

  it('has_warning_indicators is filtered from receipt sources the same way as safety_flagged', () => {
    const entries = buildFourteenDayEntries().map((e, i) =>
      i === 9 ? { ...e, has_warning_indicators: true } : e,
    );
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: EXCL_START,
      endAt: EXCL_END,
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: EXCL_NOW });
    expect(result.estimate.n).toBe(14);
    expect(result.receipt.sources.some((s) => s.entryId === 'excl-10')).toBe(false);
    expect(result.receipt.sources).toHaveLength(13);
  });
});

// ---------------------------------------------------------------------------
// Known-zero series fix (end-to-end regression test for the carry-forward fix)
// ---------------------------------------------------------------------------

describe('computeExperimentResult — known-zero series fix (end-to-end)', () => {
  it('zero-exercise days pair and count as covered; no-health-data days are dropped, not coerced to zero', () => {
    const NO_DATA_DAYS = new Set([7, 14]);
    const ZERO_EXERCISE_DAYS = new Set([1, 4, 8, 11]);
    const entries = [];
    for (let day = 1; day <= 15; day++) {
      entries.push({
        id: `ex-${day}`,
        createdAt: isoDay(2026, 6, day),
        healthContext: NO_DATA_DAYS.has(day)
          ? undefined
          : { activity: { totalExerciseMinutes: ZERO_EXERCISE_DAYS.has(day) ? 0 : 30 + day, stepsToday: 1000 } },
        analysis: { mood_score: 50 + day },
      });
    }
    const experiment = baseExperiment({
      template: EXERCISE_TEMPLATE,
      startAt: isoDay(2026, 6, 1, 0),
      endAt: isoDay(2026, 6, 16, 0), // 15 days
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 7, 1, 0)) });

    // 15 days total, 2 with no healthContext at all -> dropped (missing).
    // Without the known-zero fix, the 4 ZERO_EXERCISE_DAYS would ALSO have
    // been dropped (the `|| null` coercion bug), leaving only 9 covered days
    // and 9 pairs — below MIN_PAIRED_OBSERVATIONS (10), i.e. `insufficient`.
    // With the fix, all 13 non-missing days count.
    expect(result.coverage.exposure).toEqual({ covered: 13, total: 15, label: '13 of 15 days' });
    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// Tag-source series (end-to-end)
// ---------------------------------------------------------------------------

describe('computeExperimentResult — tag-source series (end-to-end)', () => {
  it('pairs tag-presence exposure against mood; tag absence counts as a known (not missing) day', () => {
    const TAG = '@person:spencer';
    const entries = [];
    for (let day = 1; day <= 14; day++) {
      entries.push({
        id: `tag-${day}`,
        createdAt: isoDay(2026, 8, day),
        tags: day % 2 === 0 ? [TAG] : [],
        analysis: { mood_score: day % 2 === 0 ? 40 : 70 },
      });
    }
    const experiment = baseExperiment({
      template: TAG_TEMPLATE,
      params: { tag: TAG },
      startAt: isoDay(2026, 8, 1, 0),
      endAt: isoDay(2026, 8, 15, 0),
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 9, 1, 0)) });

    expect(result.status).toBe('ok');
    // Every day is "known" (journaled with or without the tag) -> full coverage.
    expect(result.coverage.exposure).toEqual({ covered: 14, total: 14, label: '14 of 14 days' });
    expect(result.estimate.n).toBe(14);
    // median of 7 zeros + 7 ones = 0.5 -> high group (>0.5) = tag-present days
    // (mood 40); low group (<=0.5, i.e. the zeros) = tag-absent days (mood 70).
    expect(result.estimate.meanHigh).toBeCloseTo(40, 10);
    expect(result.estimate.meanLow).toBeCloseTo(70, 10);
    expect(result.estimate.delta).toBeCloseTo(-30, 10);
  });
});

// ---------------------------------------------------------------------------
// Lag-1 template (end-to-end)
// ---------------------------------------------------------------------------

describe('computeExperimentResult — lag-1 template (end-to-end)', () => {
  it('pairs exposure day D with outcome day D+1, dropping the final day (no D+1 outcome exists)', () => {
    const entries = [];
    for (let day = 1; day <= 15; day++) {
      entries.push({
        id: `lag-${day}`,
        createdAt: isoDay(2026, 9, day),
        healthContext: { sleep: { totalHours: 4 + (day % 8) } },
        analysis: { mood_score: 50 + day },
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_LAG1_TEMPLATE,
      startAt: isoDay(2026, 9, 1, 0),
      endAt: isoDay(2026, 9, 16, 0), // 15 days
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 10, 1, 0)) });

    expect(result.status).toBe('ok');
    // 15 exposure days; day 15's outcome (day 16) doesn't exist -> 14 pairs.
    expect(result.estimate.n).toBe(14);
    // All 15 entries contribute in SOME role (days 1-14 as exposure, days
    // 2-15 as outcome) even though only 14 PAIRS exist — sampleSize (pair
    // count) and receipt.sources.length (unique contributing entries)
    // deliberately differ for a lag template.
    expect(result.receipt.sampleSize).toBe(14);
    expect(result.receipt.sources).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// Coverage window is the experiment's own window, not preflight's fixed 28d
// ---------------------------------------------------------------------------

describe('computeExperimentResult — coverage covers the experiment window, not a fixed 28-day lookback', () => {
  it('a 14-day experiment reports coverage out of 14, not 28', () => {
    const entries = [];
    for (let day = 1; day <= 14; day++) {
      entries.push({
        id: `win-${day}`,
        createdAt: isoDay(2026, 10, day),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: isoDay(2026, 10, 1, 0),
      endAt: isoDay(2026, 10, 15, 0), // 14-day experiment, NOT 28
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 11, 1, 0)) });
    expect(result.coverage.exposure.total).toBe(14);
    expect(result.coverage.exposure.covered).toBe(14);
    // (Constant exposure values -> degenerate split -> insufficient; not the
    // point of this test, but asserted so the fixture's behavior is explicit.)
    expect(result.status).toBe('insufficient');
  });
});

// ---------------------------------------------------------------------------
// Scope filtering (strict, via scopeFilter)
// ---------------------------------------------------------------------------

describe('computeExperimentResult — scope filtering (strict, via scopeFilter)', () => {
  it('a scoped experiment only sees entries in that scope; result matches running the same data unscoped in isolation', () => {
    const inScope = buildGoldenEntries().map((e) => ({ ...e, spaceId: 'space-work' }));
    const outOfScope = buildGoldenEntries().map((e) => ({ ...e, id: `${e.id}-other`, spaceId: 'space-personal' }));
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: GOLDEN_START,
      endAt: GOLDEN_END,
      durationDays: 28,
      scope: { spaceId: 'space-work' },
    });
    const scopedResult = computeExperimentResult({
      experiment,
      entries: [...inScope, ...outOfScope],
      now: GOLDEN_NOW,
    });
    const isolatedResult = computeExperimentResult({
      experiment: { ...experiment, scope: null },
      entries: inScope,
      now: GOLDEN_NOW,
    });
    expect(stripGeneratedAt(scopedResult).estimate).toEqual(stripGeneratedAt(isolatedResult).estimate);
    expect(scopedResult.receipt.sampleSize).toBe(isolatedResult.receipt.sampleSize);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('computeExperimentResult — determinism', () => {
  it('two calls with identical inputs produce identical results (receipt.versions.generatedAt excepted)', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: GOLDEN_START,
      endAt: GOLDEN_END,
      durationDays: 28,
    });
    const r1 = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });
    const r2 = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });
    expect(stripGeneratedAt(r1)).toEqual(stripGeneratedAt(r2));
    expect(r1.receipt.versions.generatedAt).toEqual(expect.any(String));
    expect(r2.receipt.versions.generatedAt).toEqual(expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// Shared series-builder helper — direct unit coverage
// ---------------------------------------------------------------------------

describe('exposureValueForEntry — shared series-builder helper', () => {
  it('known-zero: healthContext.activity present, extractor value coerced to null by the `|| null` bug -> 0', () => {
    const entry = { healthContext: { activity: { totalExerciseMinutes: 0, stepsToday: 0 } } };
    expect(exposureValueForEntry(entry, { source: 'health', field: 'exerciseMinutes' })).toBe(0);
    expect(exposureValueForEntry(entry, { source: 'health', field: 'steps' })).toBe(0);
  });

  it('missing: no healthContext.activity at all -> null (dropped), not coerced to 0', () => {
    const entry = { healthContext: { sleep: { totalHours: 7 } } };
    expect(exposureValueForEntry(entry, { source: 'health', field: 'exerciseMinutes' })).toBeNull();
  });

  it('no health data at all -> null', () => {
    expect(exposureValueForEntry({}, { source: 'health', field: 'exerciseMinutes' })).toBeNull();
  });

  it('non-activity health fields keep drop-on-null semantics (sleep, unaffected by the known-zero fix)', () => {
    const entry = { healthContext: { activity: { totalExerciseMinutes: 30 } } }; // no sleep key at all
    expect(exposureValueForEntry(entry, { source: 'health', field: 'sleepHours' })).toBeNull();
  });

  it('tags: no tags array on a journaled entry -> known absent (0)', () => {
    expect(exposureValueForEntry({}, { source: 'tags', field: 'tags' }, '@person:spencer')).toBe(0);
  });

  it('tags: tag present -> 1', () => {
    expect(exposureValueForEntry({ tags: ['@person:spencer'] }, { source: 'tags', field: 'tags' }, '@person:spencer')).toBe(1);
  });
});

describe('outcomeValueForEntry', () => {
  it('reads analysis.mood_score', () => {
    expect(outcomeValueForEntry({ analysis: { mood_score: 72 } }, { field: 'analysis.mood_score' })).toBe(72);
  });
  it('returns null for a missing/non-finite mood_score', () => {
    expect(outcomeValueForEntry({}, { field: 'analysis.mood_score' })).toBeNull();
    expect(outcomeValueForEntry({ analysis: { mood_score: 'x' } }, { field: 'analysis.mood_score' })).toBeNull();
  });
});

describe('buildDaySeries', () => {
  it('averages multiple same-day values and sorts the result by dateKey, independent of input order', () => {
    const entries = [
      { createdAt: isoDay(2026, 1, 2), analysis: { mood_score: 80 } },
      { createdAt: isoDay(2026, 1, 1), analysis: { mood_score: 60 } },
      { createdAt: isoDay(2026, 1, 1), analysis: { mood_score: 40 } }, // second entry, same day
    ];
    const series = buildDaySeries(entries, (e) => outcomeValueForEntry(e, { field: 'analysis.mood_score' }));
    expect(series).toEqual([
      { dateKey: '2026-01-01', value: 50 }, // mean(60, 40)
      { dateKey: '2026-01-02', value: 80 },
    ]);
  });

  it('drops days with no usable value entirely', () => {
    const entries = [{ createdAt: isoDay(2026, 1, 1) }];
    const series = buildDaySeries(entries, (e) => outcomeValueForEntry(e, { field: 'analysis.mood_score' }));
    expect(series).toEqual([]);
  });
});
