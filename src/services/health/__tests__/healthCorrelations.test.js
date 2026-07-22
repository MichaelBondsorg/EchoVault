/**
 * healthCorrelations tests (R4 Task 1b).
 *
 * Regression coverage for the `average([])` -> `0` false-difference bug
 * (plan finding 4, "healthCorrelations:31" class): `sleepMood`,
 * `sleepQualityMood`, `hrvMood`, and `rhrMood` computed BOTH sides of a
 * high/low split with no guard that either side actually had any members —
 * an empty side silently averaged to `0`, manufacturing a large fabricated
 * "difference" against whatever real value the other side had. Fixed by
 * requiring both sides to have at least one member before the comparison
 * runs at all (that specific correlation abstains — no insight — rather
 * than ever comparing against a phantom zero).
 *
 * `exerciseMood`/`recoveryMood`/`stepsMood` already guarded both sides
 * (>=2 each) before this fix — covered here as a "stays working" check,
 * not because they had the bug.
 */
import { describe, it, expect } from 'vitest';
import { computeHealthMoodCorrelations } from '../healthCorrelations';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-21T12:00:00.000Z');

// Padding entries: healthContext present (so they count toward the >=7
// dataPoints floor) but with NO sleep/hrv/rhr/score field, so they never
// enter those specific sub-analyses' data sets.
const padding = (n, moodValue = 0.5) =>
  Array.from({ length: n }, (_, i) => ({
    id: `pad-${i}`,
    createdAt: new Date(now - (i + 100) * DAY_MS).toISOString(),
    analysis: { mood_score: moodValue },
    healthContext: { heart: { restingRate: null } }, // truthy healthContext, no usable signal
  }));

describe('computeHealthMoodCorrelations — empty-group abstention', () => {
  it('sleepMood: does NOT emit an insight when the poor-sleep (<6h) group is empty (regression for average([])->0)', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `good-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.6 },
        healthContext: { sleep: { totalHours: 8 } }, // all "good" (>=7h) — NO poor-sleep entries at all
      })),
      ...padding(2),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.sleepMood).toBeUndefined();
  });

  it('sleepQualityMood: does NOT emit an insight when the low-score (<60) group is empty', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `high-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.7 },
        healthContext: { sleep: { score: 90 } }, // all high, NO low-score entries at all
      })),
      ...padding(2),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.sleepQualityMood).toBeUndefined();
  });

  it('hrvMood: does NOT emit an insight when the below-median HRV group is empty (all values tied at the median)', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `hrv-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.65 },
        healthContext: { heart: { hrv: 50 } }, // all identical -> median=50 -> "< median" group is empty
      })),
      ...padding(2),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.hrvMood).toBeUndefined();
  });

  it('rhrMood: does NOT emit an insight when the above-median RHR group is empty (all values tied at the median)', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `rhr-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.55 },
        healthContext: { heart: { restingRate: 60 } }, // all identical -> median=60 -> "> median" group is empty
      })),
      ...padding(2),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.rhrMood).toBeUndefined();
  });

  it('sleepMood: still fires normally when both groups are genuinely populated', () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `good-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.8 },
        healthContext: { sleep: { totalHours: 8 } },
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: `poor-${i}`,
        createdAt: new Date(now - (i + 10) * DAY_MS).toISOString(),
        analysis: { mood_score: 0.3 },
        healthContext: { sleep: { totalHours: 5 } },
      })),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.sleepMood).toBeTruthy();
    expect(correlations.sleepMood.goodSleepAvgMood).toBeCloseTo(0.8);
    expect(correlations.sleepMood.poorSleepAvgMood).toBeCloseTo(0.3);
  });

  it('exerciseMood/recoveryMood/stepsMood: already guarded both sides (>=2 each) before this fix — untouched, still fires normally', () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `workout-${i}`,
        createdAt: new Date(now - i * DAY_MS).toISOString(),
        analysis: { mood_score: 0.85 },
        healthContext: { activity: { hasWorkout: true } },
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `rest-${i}`,
        createdAt: new Date(now - (i + 10) * DAY_MS).toISOString(),
        analysis: { mood_score: 0.5 },
        healthContext: { activity: { hasWorkout: false } },
      })),
    ];

    const correlations = computeHealthMoodCorrelations(entries);
    expect(correlations?.exerciseMood).toBeTruthy();
    expect(correlations.exerciseMood.workoutDayMood).toBeCloseTo(0.85);
    expect(correlations.exerciseMood.restDayMood).toBeCloseTo(0.5);
  });
});
