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
  localDateKeyForMs,
  NON_CAUSAL_FRAMING,
  INSUFFICIENCY_COPY,
  CI_SPANS_ZERO_COPY,
  SMALL_EFFECT_COPY,
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
    confounders: [...(template.confounders || [])],
    whatThisDoesNotProve: [...(template.whatThisDoesNotProve || [])],
    // Fixed to 'UTC' for every fixture in this file (deterministic,
    // independent of the host machine's timezone) — dedicated tests below
    // (`local calendar days + frozen timezone`) exercise a real non-UTC
    // zone explicitly instead.
    timezone: 'UTC',
    ...(template.splitMode === 'binary' ? { splitMode: 'binary' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(y, m, d, hour = 12) {
  return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
}

/** ISO string `offsetDays` (+ optional `hour`) after `baseMs` (a UTC epoch ms). Avoids manual calendar-boundary arithmetic for multi-month fixtures. */
function isoAtOffset(baseMs, offsetDays, hour = 12) {
  const day = new Date(baseMs + offsetDays * DAY_MS);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour)).toISOString();
}

function dateKeyFor(y, m, d) {
  return isoDay(y, m, d, 0).slice(0, 10);
}

/**
 * PARTIAL START DAY RULE (Michael review hardening, EX2 item 2, plan-pinned):
 * the experiment window is whole LOCAL calendar days starting the day AFTER
 * `experiment.startAt` — day 1 is the first FULL local day, and the
 * calendar day `startAt` itself falls on is excluded entirely (only
 * partially observed). Every fixture in this file is written with `startAt`
 * meaning "the first full data day" (the pre-EX2 convention, and the
 * intuitive one for hand-verified fixtures) — `baseExperiment` shifts the
 * REAL stored `experiment.startAt` field back by exactly one day
 * internally, so `day1` (computed inside `computeExperimentResult` as
 * `shiftLocalDateKey(startLocalKey, 1)`) lands EXACTLY back on the caller's
 * given `startAt` value. This keeps every hand-computed pair count/coverage
 * total in this file's fixtures numerically unchanged from their pre-EX2
 * values while still exercising the real partial-start-day rule (dedicated
 * tests below assert the day-0 exclusion directly). An invalid `startAt`
 * (e.g. the deliberate `'nope'` fixture) is passed through UNSHIFTED so the
 * existing "throws on invalid startAt" test still exercises
 * `computeExperimentResult`'s own validation, not a NaN from this helper.
 */
const DAY_MS_TEST = 24 * 60 * 60 * 1000;
function dayBefore(iso) {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms - DAY_MS_TEST).toISOString();
}

function baseExperiment({ template, params = {}, startAt, endAt, durationDays, excludedObservations = [], scope = null }) {
  const shiftedStartAt = dayBefore(startAt);
  return {
    id: 'exp-test',
    question: 'test question',
    template: template.id,
    analysisPlan: buildAnalysisPlan(template, params),
    scope,
    status: 'running',
    startAt: shiftedStartAt,
    endAt,
    durationDays,
    excludedObservations,
    createdAt: shiftedStartAt,
    updatedAt: shiftedStartAt,
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
      // Production-scale input: mood_score captured 0-1, normalized to
      // 0-100 at the series boundary (Michael review hardening, item 1) —
      // dividing by 100 here means every hand-computed expectation below
      // (in 0-100 "points") is numerically unchanged from this fixture's
      // pre-EX2 values, while genuinely exercising the real normalization.
      analysis: { mood_score: (hours * 10) / 100 },
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
    // `experiment.startAt` (the real stored field) is one day BEFORE
    // GOLDEN_START — see `baseExperiment`'s doc comment (partial-start-day
    // rule): GOLDEN_START is written to mean "the first full data day".
    expect(result.receipt.timeWindow).toEqual({ start: dayBefore(GOLDEN_START), end: GOLDEN_END });

    expect(result.narrative.summary).toContain(NON_CAUSAL_FRAMING);
    expect(result.narrative.summary).toContain('35 points (0-100) higher');
    expect(result.narrative.alternatives).toEqual(SLEEP_TEMPLATE.confounders);
    expect(result.narrative.whatThisDoesNotProve).toEqual(SLEEP_TEMPLATE.whatThisDoesNotProve);
    expect(result.narrative).not.toHaveProperty('insufficiency');
    // `reasons` is an insufficient-only field (absence, not undefined).
    expect(result).not.toHaveProperty('reasons');
  });
});

// ---------------------------------------------------------------------------
// CRITICAL review fix: coverage floor (data-method spec default #2) — every
// TEST below reproduces/guards the reviewer's finding that
// `computeExperimentResult` was accepting a sparse-but-lucky sample as `ok`
// because `estimator.runAnalysisPlan` deliberately delegates this check to
// its caller (see its own docblock) and nothing was calling it. RED/GREEN
// evidence for the reproduction case is in task-5-report.md (verified by
// running this exact test against the pre-fix commit before adding the fix).
// ---------------------------------------------------------------------------

describe('computeExperimentResult — coverage floor (spec default #2) enforcement', () => {
  const SPARSE_BASE_MS = Date.UTC(2027, 0, 1); // 2027-01-01T00:00:00.000Z
  const SPARSE_START = new Date(SPARSE_BASE_MS).toISOString();
  const SPARSE_END = new Date(SPARSE_BASE_MS + 60 * DAY_MS).toISOString(); // 60-day window
  const SPARSE_NOW = new Date(SPARSE_BASE_MS + 90 * DAY_MS); // well after end

  /** 60 days; sleep data (exposure) present on only the first `exposureDays` of them; mood (outcome) present every day. */
  function buildSparseExposureEntries(exposureDays) {
    const entries = [];
    for (let i = 0; i < 60; i++) {
      entries.push({
        id: `sparse60-${i + 1}`,
        createdAt: isoAtOffset(SPARSE_BASE_MS, i),
        healthContext: i < exposureDays ? { sleep: { totalHours: 6 + (i % 3) } } : undefined,
        analysis: { mood_score: (50 + (i % 10)) / 100 }, // present every day -> outcome coverage 60/60
      });
    }
    return entries;
  }

  it('CRITICAL regression: 12 of 60 exposure days (20%), all 12 paired -> insufficient, not a full estimate', () => {
    const entries = buildSparseExposureEntries(12);
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: SPARSE_START,
      endAt: SPARSE_END,
      durationDays: 60,
    });
    const result = computeExperimentResult({ experiment, entries, now: SPARSE_NOW });

    // The biased-sample scenario the spec's default #2 rationale names: 12
    // pairs clears MIN_PAIRED_OBSERVATIONS (10) on raw count alone, but 12
    // of 60 days (20%) is well under the 50% coverage floor.
    expect(result.coverage.exposure).toEqual({ covered: 12, total: 60, label: '12 of 60 days' });
    expect(result.coverage.outcome).toEqual({ covered: 60, total: 60, label: '60 of 60 days' });
    expect(result.status).toBe('insufficient');
    expect(result).not.toHaveProperty('estimate');
    expect(result.narrative).not.toHaveProperty('summary');
    expect(result.narrative.insufficiency).toBe(INSUFFICIENCY_COPY);
    expect(result.reasons).toEqual(['exposure_coverage_below_floor']);
    // Receipt invariant still holds even here.
    expect(result.receipt.versions.generator).toBe('experiment_v1');
  });

  it('exactly 50% coverage passes the floor (operator is >=, matching the spec doc)', () => {
    // 24-day window, 12 of 24 exposure days (exactly 50%), all paired -> 12
    // pairs (>= MIN_PAIRED_OBSERVATIONS), isolating the floor check alone.
    //
    // Michael review hardening update (EX1 group-size guards, H1 AND H3):
    // the original `6 + (i%3)` cycling formula produced a 4-high/8-low
    // split that now correctly trips `group_too_small` (nHigh=4 <
    // MIN_GROUP_SIZE=5) — this test's whole point is isolating the
    // COVERAGE floor check alone, so the fixture is reshaped (not the
    // assertion) to clear the newer, independent group-size AND
    // per-resample-split-stability guards without changing what's being
    // tested. `4 + (i%6)` gives six distinct graduated values (4-9, two
    // each) rather than only two distinct values — a two-value fixture
    // (e.g. six 5's/six 9's) turned out to be exactly the tie-heavy shape
    // H3's per-resample bootstrap split reliably degenerates on
    // (`split_unstable`), same root cause as H2's tag-presence finding.
    // Sorted: 4,4,5,5,6,6,7,7,8,8,9,9 -> median = avg(sorted[5],sorted[6])
    // = avg(6,7) = 6.5 -> HIGH (>6.5) = {7,7,8,8,9,9}, LOW (<=6.5) =
    // {4,4,5,5,6,6}: nHigh=nLow=6, both >= MIN_GROUP_SIZE(5), fraction
    // 6/12=0.5 >= MIN_GROUP_FRACTION(0.25), and graduated enough that the
    // bootstrap's per-resample split stays comfortably under the 10%
    // fallback limit.
    const entries = buildSparseExposureEntries(12).slice(0, 24).map((e, i) => ({
      ...e,
      healthContext: i < 12 ? { sleep: { totalHours: 4 + (i % 6) } } : undefined,
    }));
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: SPARSE_START,
      endAt: new Date(SPARSE_BASE_MS + 24 * DAY_MS).toISOString(),
      durationDays: 24,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(SPARSE_BASE_MS + 40 * DAY_MS) });

    expect(result.coverage.exposure).toEqual({ covered: 12, total: 24, label: '12 of 24 days' });
    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(12);
  });

  it('one day under 50% coverage fails the floor (11 of 24 days)', () => {
    const entries = buildSparseExposureEntries(12).slice(0, 24).map((e, i) => ({
      ...e,
      healthContext: i < 11 ? { sleep: { totalHours: 6 + (i % 3) } } : undefined,
    }));
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: SPARSE_START,
      endAt: new Date(SPARSE_BASE_MS + 24 * DAY_MS).toISOString(),
      durationDays: 24,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(SPARSE_BASE_MS + 40 * DAY_MS) });

    expect(result.coverage.exposure).toEqual({ covered: 11, total: 24, label: '11 of 24 days' });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['exposure_coverage_below_floor']);
    // Isolation check: 11 pairs would have cleared MIN_PAIRED_OBSERVATIONS
    // (10) on raw count alone — the failure is purely the coverage floor.
    expect(result.reasons).not.toContain('insufficient_paired_observations');
  });

  it('outcome coverage below floor fails independently of full exposure coverage', () => {
    const entries = [];
    for (let i = 0; i < 24; i++) {
      entries.push({
        id: `outcome-floor-${i + 1}`,
        createdAt: isoAtOffset(SPARSE_BASE_MS, i),
        healthContext: { sleep: { totalHours: 6 + (i % 3) } }, // full exposure coverage
        analysis: i < 11 ? { mood_score: (50 + (i % 10)) / 100 } : undefined, // 11 of 24 outcome days (below floor)
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: SPARSE_START,
      endAt: new Date(SPARSE_BASE_MS + 24 * DAY_MS).toISOString(),
      durationDays: 24,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(SPARSE_BASE_MS + 40 * DAY_MS) });

    expect(result.coverage.exposure).toEqual({ covered: 24, total: 24, label: '24 of 24 days' });
    expect(result.coverage.outcome).toEqual({ covered: 11, total: 24, label: '11 of 24 days' });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['outcome_coverage_below_floor']);
  });

  it('coverage-floor and pair-count reasons accumulate together when both are true', () => {
    // 5 of 60 exposure days -> both below the 50% floor AND below
    // MIN_PAIRED_OBSERVATIONS (10) on raw pair count.
    const entries = buildSparseExposureEntries(5);
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: SPARSE_START,
      endAt: SPARSE_END,
      durationDays: 60,
    });
    const result = computeExperimentResult({ experiment, entries, now: SPARSE_NOW });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['exposure_coverage_below_floor', 'insufficient_paired_observations']);
  });
});

// ---------------------------------------------------------------------------
// IMPORTANT review fix (R3 final review): the plan's OWN frozen
// `minPairedObservations`/`coverageFloor` snapshot must actually be honored,
// not just carried on the doc decoratively. Reproduction: a plan with a
// STRICTER frozen threshold than the module's live constants must still
// gate a result that the module constants alone would have let through as
// `ok` — proving `computeExperimentResult` reads the plan, not just
// `estimator.js`'s live `MIN_PAIRED_OBSERVATIONS`/`COVERAGE_FLOOR`.
// ---------------------------------------------------------------------------

describe('computeExperimentResult — plan-frozen thresholds are honored (Important review fix)', () => {
  const THRESH_BASE_MS = Date.UTC(2028, 0, 1);
  const THRESH_START = new Date(THRESH_BASE_MS).toISOString();
  const THRESH_END = new Date(THRESH_BASE_MS + 20 * DAY_MS).toISOString(); // 20-day window
  const THRESH_NOW = new Date(THRESH_BASE_MS + 40 * DAY_MS); // well after end

  /** 20 days; sleep (exposure) present on only the first `exposureDays`; mood present every day. */
  function buildEntries(exposureDays) {
    const entries = [];
    for (let i = 0; i < 20; i++) {
      entries.push({
        id: `thresh-${i + 1}`,
        createdAt: isoAtOffset(THRESH_BASE_MS, i),
        healthContext: i < exposureDays ? { sleep: { totalHours: 4 + (i % 7) } } : undefined,
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    return entries;
  }

  it('plan snapshot 12/0.6: 11 pairs (55% coverage) is insufficient with BOTH a coverage reason and a pair-count reason, proving the plan (not the module defaults) wins', () => {
    const entries = buildEntries(11); // 11 of 20 days -> 55% exposure coverage, 11 pairs
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: THRESH_START,
      endAt: THRESH_END,
      durationDays: 20,
    });
    experiment.analysisPlan = {
      ...experiment.analysisPlan,
      minPairedObservations: 12,
      coverageFloor: 0.6,
    };
    const result = computeExperimentResult({ experiment, entries, now: THRESH_NOW });

    expect(result.coverage.exposure).toEqual({ covered: 11, total: 20, label: '11 of 20 days' });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['exposure_coverage_below_floor', 'insufficient_paired_observations']);
  });

  it('the SAME data with the module-default thresholds (10/0.5) is `ok` — isolates that the stricter numbers above came from the plan snapshot, not some other confound', () => {
    const entries = buildEntries(11);
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: THRESH_START,
      endAt: THRESH_END,
      durationDays: 20,
    });
    // analysisPlan already carries the module defaults (10/0.5) via
    // baseExperiment's local buildAnalysisPlan helper — asserted explicitly
    // here so the contrast with the test above is visible in this file.
    expect(experiment.analysisPlan.minPairedObservations).toBe(MIN_PAIRED_OBSERVATIONS);
    expect(experiment.analysisPlan.coverageFloor).toBe(COVERAGE_FLOOR);
    const result = computeExperimentResult({ experiment, entries, now: THRESH_NOW });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(11);
  });

  it('a LEGACY plan with no minPairedObservations/coverageFloor keys falls back to the module constants (10/0.5) — same result as passing them explicitly', () => {
    const entries = buildEntries(11);
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: THRESH_START,
      endAt: THRESH_END,
      durationDays: 20,
    });
    const { minPairedObservations, coverageFloor, ...legacyPlan } = experiment.analysisPlan;
    experiment.analysisPlan = legacyPlan;

    const result = computeExperimentResult({ experiment, entries, now: THRESH_NOW });
    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(11);
  });

  it('a plan threshold LOWER than the module constant is still blocked by the estimator\'s own internal floor-of-last-resort', () => {
    // 8 pairs, full coverage on both variables (so the coverage-floor check
    // never fires) — clears a plan-frozen minPairedObservations of 5, but
    // NOT the estimator's own hardcoded MIN_PAIRED_OBSERVATIONS (10). This
    // pins that runAnalysisPlan's internal gate is never bypassed, even
    // when a plan (hypothetically) snapshots a lower number.
    //
    // Michael review hardening update (EX1 group-size guards, H1): with
    // n=8, ANY median split necessarily puts fewer than MIN_GROUP_SIZE (5)
    // pairs in at least one group (5+5=10 > 8) — `group_too_small` now
    // ALSO legitimately fires here, accumulating with
    // `insufficient_paired_observations` per the existing "reasons
    // accumulate" convention (see estimator.js's runAnalysisPlan docblock).
    // This fixture's split is exactly 4-high/4-low (sleepHours
    // 4,5,6,7,8,9,10,4 -> sorted 4,4,5,6,7,8,9,10 -> median 6.5 -> high
    // {7,8,9,10}, low {4,4,5,6}), verified by hand.
    const entries = [];
    for (let i = 0; i < 8; i++) {
      entries.push({
        id: `floor-${i + 1}`,
        createdAt: isoAtOffset(THRESH_BASE_MS, i),
        healthContext: { sleep: { totalHours: 4 + (i % 7) } },
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: THRESH_START,
      endAt: new Date(THRESH_BASE_MS + 8 * DAY_MS).toISOString(),
      durationDays: 14,
    });
    experiment.analysisPlan = {
      ...experiment.analysisPlan,
      minPairedObservations: 5,
      coverageFloor: 0.5,
    };
    const result = computeExperimentResult({ experiment, entries, now: THRESH_NOW });

    expect(result.coverage.exposure).toEqual({ covered: 8, total: 8, label: '8 of 8 days' });
    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['insufficient_paired_observations', 'group_too_small']);
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
        analysis: { mood_score: (60 + i) / 100 },
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
    // 5 of 28 days (~18%) is also below the coverage floor, so both a
    // coverage reason and the pair-count reason accumulate.
    expect(result.reasons).toEqual([
      'exposure_coverage_below_floor',
      'outcome_coverage_below_floor',
      'insufficient_paired_observations',
    ]);

    // Receipt invariant: every result, ok AND insufficient, carries a receipt.
    expect(result.receipt).toBeTruthy();
    expect(result.receipt.versions.generator).toBe('experiment_v1');
    expect(result.receipt.sampleSize).toBe(5);
    expect(result.coverage.exposure.covered).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// IMPORTANT review fix: narrative caveats are read from the FROZEN plan
// snapshot (experiment.analysisPlan.confounders/whatThisDoesNotProve), not
// re-looked-up from the (mutable) template catalog by templateId at result
// time — a post-freeze catalog edit or template removal must never change
// or blank out an already-`completed` result's safety-caveat text.
// ---------------------------------------------------------------------------

describe('computeExperimentResult — narrative caveats come from the frozen plan snapshot, not a live catalog lookup', () => {
  it('a plan whose snapshotted confounders/whatThisDoesNotProve differ from the CURRENT catalog text still shows the frozen (plan) text', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    // Simulate "the catalog was edited after this plan was frozen" by
    // hand-diverging the plan's snapshot from what SLEEP_TEMPLATE currently
    // says, WITHOUT touching the (frozen, Object.freeze'd) real catalog.
    const frozenConfounders = ['OLD confounder text, frozen at create time.'];
    const frozenWhatThisDoesNotProve = ['OLD what-this-does-not-prove text, frozen at create time.'];
    experiment.analysisPlan = {
      ...experiment.analysisPlan,
      confounders: frozenConfounders,
      whatThisDoesNotProve: frozenWhatThisDoesNotProve,
    };

    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.narrative.alternatives).toEqual(frozenConfounders);
    expect(result.narrative.whatThisDoesNotProve).toEqual(frozenWhatThisDoesNotProve);
    // Proves it's NOT reading the live catalog: the current SLEEP_TEMPLATE
    // text is different and must NOT appear.
    expect(result.narrative.alternatives).not.toEqual(SLEEP_TEMPLATE.confounders);
  });

  it('a plan whose templateId no longer resolves in the catalog (template removed) still shows its frozen text — no [] collapse', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    const frozenConfounders = ['Frozen confounder, survives template removal.'];
    const frozenWhatThisDoesNotProve = ['Frozen caveat, survives template removal.'];
    experiment.analysisPlan = {
      ...experiment.analysisPlan,
      templateId: 'removed-template-id', // getTemplateById(...) would return undefined
      confounders: frozenConfounders,
      whatThisDoesNotProve: frozenWhatThisDoesNotProve,
    };

    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.narrative.alternatives).toEqual(frozenConfounders);
    expect(result.narrative.whatThisDoesNotProve).toEqual(frozenWhatThisDoesNotProve);
    // The bug this guards against: falling back to a catalog lookup that
    // resolves to `undefined` would silently collapse these to `[]`.
    expect(result.narrative.alternatives).not.toEqual([]);
    expect(result.narrative.whatThisDoesNotProve).not.toEqual([]);
  });

  it('a LEGACY plan with no snapshotted confounders/whatThisDoesNotProve falls back to the current catalog lookup by templateId', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    // Simulate a pre-fix plan (written before this snapshot existed) by
    // deleting the two keys entirely.
    const { confounders, whatThisDoesNotProve, ...legacyPlan } = experiment.analysisPlan;
    experiment.analysisPlan = legacyPlan;

    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.narrative.alternatives).toEqual(SLEEP_TEMPLATE.confounders);
    expect(result.narrative.whatThisDoesNotProve).toEqual(SLEEP_TEMPLATE.whatThisDoesNotProve);
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
      analysis: { mood_score: (50 + i) / 100 },
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
        analysis: { mood_score: (50 + day) / 100 },
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
        analysis: { mood_score: (day % 2 === 0 ? 40 : 70) / 100 },
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
        analysis: { mood_score: (50 + day) / 100 },
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
        analysis: { mood_score: 0.6 },
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

  it('tags: no tags array on a journaled entry -> UNKNOWN, dropped (Michael review hardening, item 4)', () => {
    expect(exposureValueForEntry({}, { source: 'tags', field: 'tags' }, '@person:spencer')).toBeNull();
  });

  it('tags: tag present -> 1', () => {
    expect(exposureValueForEntry({ tags: ['@person:spencer'] }, { source: 'tags', field: 'tags' }, '@person:spencer')).toBe(1);
  });

  // MINOR review fix: known-zero precision is on the RAW field, not just
  // "an activity object exists". A partially-populated activity object
  // (one field present, the other never recorded) must not make the
  // ABSENT field look like a known zero.
  it('partially-populated activity: steps present (even at 0) but the exercise key is entirely absent -> exercise missing, steps kept', () => {
    const entry = { healthContext: { activity: { stepsToday: 0 } } }; // no totalExerciseMinutes key at all
    expect(exposureValueForEntry(entry, { source: 'health', field: 'exerciseMinutes' })).toBeNull();
    expect(exposureValueForEntry(entry, { source: 'health', field: 'steps' })).toBe(0);
  });

  it('partially-populated activity, other direction: exercise present (even at 0) but the steps key is entirely absent -> steps missing, exercise kept', () => {
    const entry = { healthContext: { activity: { totalExerciseMinutes: 0 } } }; // no stepsToday key at all
    expect(exposureValueForEntry(entry, { source: 'health', field: 'exerciseMinutes' })).toBe(0);
    expect(exposureValueForEntry(entry, { source: 'health', field: 'steps' })).toBeNull();
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

// ---------------------------------------------------------------------------
// Michael review hardening — EX2 new-behavior tests (items 1, 2, 5)
// ---------------------------------------------------------------------------

describe('computeExperimentResult — unknown outcome unit fails closed (item 1)', () => {
  it('a plan with no outcome.unit (legacy) fails closed with reasons:["unknown_outcome_unit"], no estimate', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    const { unit, ...outcomeNoUnit } = experiment.analysisPlan.outcome;
    experiment.analysisPlan = { ...experiment.analysisPlan, outcome: outcomeNoUnit };

    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['unknown_outcome_unit']);
    expect(result).not.toHaveProperty('estimate');
    expect(result.narrative.insufficiency).toBe(INSUFFICIENCY_COPY);
    // Receipt invariant still holds.
    expect(result.receipt).toBeTruthy();
    expect(result.receipt.versions.generator).toBe('experiment_v1');
    expect(result.sensitiveObservationCount).toBe(0);
  });

  it('a plan with an unrecognized outcome.unit string also fails closed the same way', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    experiment.analysisPlan = {
      ...experiment.analysisPlan,
      outcome: { ...experiment.analysisPlan.outcome, unit: 'mood_0_1' },
    };

    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });

    expect(result.status).toBe('insufficient');
    expect(result.reasons).toEqual(['unknown_outcome_unit']);
  });

  it('the recognized unit (mood_0_100) reaches a real estimate — sanity contrast', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    expect(experiment.analysisPlan.outcome.unit).toBe('mood_0_100');
    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });
    expect(result.status).toBe('ok');
  });
});

describe('computeExperimentResult — partial start day rule (item 2, plan-pinned)', () => {
  it('excludes the calendar day `startAt` falls on entirely, even when an entry exists on it (day 1 = first FULL local day, in UTC here)', () => {
    // startAt is mid-afternoon on March 1 (UTC) — a partial day. One entry
    // exists ON that same day; it must be excluded entirely (not partially
    // counted), and the window's day 1 is March 2.
    const startAt = isoDay(2026, 3, 1, 15); // 15:00 UTC, March 1
    const endAt = isoDay(2026, 3, 15, 0); // exclusive end: March 15 00:00 UTC
    const entries = [
      { id: 'day0', createdAt: isoDay(2026, 3, 1, 20), healthContext: { sleep: { totalHours: 7 } }, analysis: { mood_score: 0.5 } },
    ];
    for (let i = 0; i < 10; i++) {
      entries.push({
        id: `full-${i}`,
        createdAt: isoDay(2026, 3, 2 + i, 12),
        healthContext: { sleep: { totalHours: 4 + (i % 6) } },
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    const experiment = {
      id: 'exp-partial-start',
      question: 'q',
      analysisPlan: {
        templateId: SLEEP_TEMPLATE.id,
        lag: 0,
        exposure: { ...SLEEP_TEMPLATE.exposure },
        outcome: { ...SLEEP_TEMPLATE.outcome },
        minPairedObservations: MIN_PAIRED_OBSERVATIONS,
        coverageFloor: COVERAGE_FLOOR,
        confounders: [...SLEEP_TEMPLATE.confounders],
        whatThisDoesNotProve: [...SLEEP_TEMPLATE.whatThisDoesNotProve],
        timezone: 'UTC',
      },
      scope: null,
      status: 'running',
      startAt,
      endAt,
      durationDays: 14,
      excludedObservations: [],
      createdAt: startAt,
      updatedAt: startAt,
    };
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 4, 1, 0)) });

    // Window is March 2 (day 1) through March 14 inclusive (endAt exclusive
    // at March 15) = 13 whole days — March 1's partial day never counts.
    expect(result.coverage.exposure.total).toBe(13);
    // Only the 10 full-day entries count; the day-0 entry is excluded
    // entirely (not even partially).
    expect(result.coverage.exposure.covered).toBe(10);
    expect(result.coverage.outcome.covered).toBe(10);
  });
});

describe('computeExperimentResult — local calendar days + frozen timezone (item 2)', () => {
  const TZ = 'America/Los_Angeles';
  const N = 12;

  /** LA calendar day (2026-07-(2+dayOffset)) at 22:00 PDT = 05:00 UTC the NEXT calendar date — a real UTC-midnight crossing. */
  function laEveningIso(dayOffset) {
    return new Date(Date.UTC(2026, 6, 3 + dayOffset, 5, 0, 0)).toISOString();
  }

  function buildLaEntries() {
    const entries = [];
    for (let i = 0; i < N; i++) {
      entries.push({
        id: `la-${i}`,
        createdAt: laEveningIso(i),
        healthContext: { sleep: { totalHours: 4 + (i % 6) } },
        analysis: { mood_score: (50 + i) / 100 },
      });
    }
    return entries;
  }

  const START = '2026-07-01T20:00:00.000Z'; // LA-local July 1 (13:00 PDT) -> day1 = July 2
  const END = '2026-07-14T07:00:00.000Z'; // LA-local midnight, July 14 (00:00 PDT) -> exclusive end (window = July 2..July 13 inclusive = 12 days)
  const NOW = new Date('2026-08-01T00:00:00.000Z');

  function laExperiment() {
    return {
      id: 'exp-la',
      question: 'q',
      analysisPlan: {
        templateId: SLEEP_TEMPLATE.id,
        lag: 0,
        exposure: { ...SLEEP_TEMPLATE.exposure },
        outcome: { ...SLEEP_TEMPLATE.outcome },
        minPairedObservations: MIN_PAIRED_OBSERVATIONS,
        coverageFloor: COVERAGE_FLOOR,
        confounders: [...SLEEP_TEMPLATE.confounders],
        whatThisDoesNotProve: [...SLEEP_TEMPLATE.whatThisDoesNotProve],
        timezone: TZ,
      },
      scope: null,
      status: 'running',
      startAt: START,
      endAt: END,
      durationDays: 14,
      excludedObservations: [],
      createdAt: START,
      updatedAt: START,
    };
  }

  it('sanity check: the fixture really does cross UTC midnight (LA dateKey and UTC dateKey of the same instant disagree)', () => {
    const ms = Date.parse(laEveningIso(0));
    expect(localDateKeyForMs(ms, 'UTC')).toBe('2026-07-03');
    expect(localDateKeyForMs(ms, TZ)).toBe('2026-07-02');
    expect(localDateKeyForMs(ms, TZ)).not.toBe(localDateKeyForMs(ms, 'UTC'));
  });

  it('groups/pairs entries by the FROZEN plan timezone`s local calendar day, not UTC', () => {
    const entries = buildLaEntries();
    const result = computeExperimentResult({ experiment: laExperiment(), entries, now: NOW });

    expect(result.status).toBe('ok');
    // All N entries pair, each on its OWN distinct LA calendar day — had
    // this module grouped by UTC day instead, the evening-PDT entries
    // (05:00 UTC the next date) would still land on distinct UTC days too
    // in this particular fixture (one entry per real day), so the REAL
    // proof is the sanity check above; this assertion pins the practical
    // consequence: nothing gets dropped or double-counted by the local-day
    // grouping.
    expect(result.estimate.n).toBe(N);
    expect(result.coverage.exposure).toEqual({ covered: N, total: N, label: `${N} of ${N} days` });
    expect(result.coverage.outcome).toEqual({ covered: N, total: N, label: `${N} of ${N} days` });
  });
});

describe('computeExperimentResult — sensitive-day disclosure (item 5)', () => {
  it('counts PAIRS with a safety_flagged or has_warning_indicators contributing entry; those entries still contribute to the estimate', () => {
    const entries = buildFourteenDayEntries().map((e, i) => {
      if (i === 2) return { ...e, safety_flagged: true };
      if (i === 7) return { ...e, has_warning_indicators: true };
      return e;
    });
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: EXCL_START, endAt: EXCL_END, durationDays: 14 });
    const result = computeExperimentResult({ experiment, entries, now: EXCL_NOW });

    expect(result.status).toBe('ok');
    expect(result.estimate.n).toBe(14); // both flagged days still counted in the statistics
    expect(result.sensitiveObservationCount).toBe(2);
    // Receipt sources still exclude the flagged entries entirely (existing invariant, unchanged).
    expect(result.receipt.sources).toHaveLength(12);
  });

  it('sensitiveObservationCount is 0 when nothing is flagged', () => {
    const entries = buildFourteenDayEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: EXCL_START, endAt: EXCL_END, durationDays: 14 });
    const result = computeExperimentResult({ experiment, entries, now: EXCL_NOW });
    expect(result.sensitiveObservationCount).toBe(0);
  });

  it('sensitiveObservationCount is present (and 0) on an insufficient result too — the observation table renders in both states', () => {
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: isoDay(2026, 3, 1, 0),
      endAt: isoDay(2026, 3, 29, 0),
      durationDays: 28,
    });
    const result = computeExperimentResult({ experiment, entries: [], now: new Date(isoDay(2026, 4, 5, 0)) });
    expect(result.status).toBe('insufficient');
    expect(result.sensitiveObservationCount).toBe(0);
  });
});

describe('computeExperimentResult — CI-spans-zero copy (Task EX1 wording update, consumed here)', () => {
  it('uses the NEW spec wording verbatim when the CI spans zero', () => {
    // Equal high/low group means by construction, real within-group spread
    // (mirrors estimator.test.js's own CI-spans-zero fixture idea).
    const entries = [];
    const hours = [4, 5, 6, 15, 16, 17, 4, 5, 6, 15, 16, 17]; // low {4,5,6}x2, high {15,16,17}x2
    const moods = [40, 60, 80, 40, 60, 80, 40, 60, 80, 40, 60, 80]; // same mood pattern regardless of group -> equal means
    for (let i = 0; i < 12; i++) {
      entries.push({
        id: `zero-${i}`,
        createdAt: isoDay(2026, 5, i + 1),
        healthContext: { sleep: { totalHours: hours[i] } },
        analysis: { mood_score: moods[i] / 100 },
      });
    }
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: isoDay(2026, 5, 1, 0),
      endAt: isoDay(2026, 5, 13, 0),
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(isoDay(2026, 6, 1, 0)) });

    expect(result.status).toBe('ok');
    expect(result.estimate.ci[0]).toBeLessThanOrEqual(0);
    expect(result.estimate.ci[1]).toBeGreaterThanOrEqual(0);
    expect(result.narrative.summary).toContain(CI_SPANS_ZERO_COPY);
    expect(CI_SPANS_ZERO_COPY).toBe(
      'These recorded days are compatible with both higher and lower mood; no consistent direction appears.',
    );
    // No small-effect suffix layered on top of the CI-spans-zero copy.
    expect(result.narrative.summary).not.toContain(SMALL_EFFECT_COPY);
  });
});

describe('computeExperimentResult — practical significance / small-effect classification (EX1 H5, wired here)', () => {
  const SMALL_BASE_MS = Date.UTC(2026, 6, 1);

  /** 12 pairs, graduated exposure 4-15 (no ties), LOW group (hours<10) mood exactly 50, HIGH group (hours>=10) mood exactly 53 -> delta=3 (<5), zero within-group variance -> a tight CI clear of zero. */
  function buildSmallEffectEntries() {
    const entries = [];
    for (let i = 0; i < 12; i++) {
      const hours = 4 + i;
      entries.push({
        id: `small-${i}`,
        createdAt: isoAtOffset(SMALL_BASE_MS, i),
        healthContext: { sleep: { totalHours: hours } },
        analysis: { mood_score: (hours < 10 ? 50 : 53) / 100 },
      });
    }
    return entries;
  }

  it('appends SMALL_EFFECT_COPY when |delta| < SMALL_EFFECT_DELTA(5) and the CI does not span zero', () => {
    const entries = buildSmallEffectEntries();
    const experiment = baseExperiment({
      template: SLEEP_TEMPLATE,
      startAt: new Date(SMALL_BASE_MS).toISOString(),
      endAt: new Date(SMALL_BASE_MS + 12 * DAY_MS).toISOString(),
      durationDays: 14,
    });
    const result = computeExperimentResult({ experiment, entries, now: new Date(SMALL_BASE_MS + 30 * DAY_MS) });

    expect(result.status).toBe('ok');
    expect(result.estimate.delta).toBeCloseTo(3, 10);
    expect(Math.abs(result.estimate.delta)).toBeLessThan(5);
    expect(result.estimate.ci[0] > 0 || result.estimate.ci[1] < 0).toBe(true); // does not span zero
    expect(result.narrative.summary).toContain(SMALL_EFFECT_COPY);
    expect(result.narrative.summary).toContain('3 points (0-100) higher');
  });

  it('does NOT append SMALL_EFFECT_COPY for the golden fixture (delta=35, well above the threshold)', () => {
    const entries = buildGoldenEntries();
    const experiment = baseExperiment({ template: SLEEP_TEMPLATE, startAt: GOLDEN_START, endAt: GOLDEN_END, durationDays: 28 });
    const result = computeExperimentResult({ experiment, entries, now: GOLDEN_NOW });
    expect(Math.abs(result.estimate.delta)).toBeGreaterThan(5);
    expect(result.narrative.summary).not.toContain(SMALL_EFFECT_COPY);
  });
});
