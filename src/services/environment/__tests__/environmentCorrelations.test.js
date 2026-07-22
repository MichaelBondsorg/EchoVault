/**
 * environmentCorrelations tests (R4 Task 1b).
 *
 * Audited for the same `average([])` -> `0` false-difference class as
 * `healthCorrelations.js` (plan finding 4). Unlike `healthCorrelations.js`,
 * EVERY branch here already gates on an explicit `>= 2`/`>= 3` count check
 * (or, in `weatherMood`'s case, nulls the average out entirely when a group
 * is too small: `sunnyEntries.length >= 2 ? average(...) : null`) BEFORE
 * using the averaged value in a comparison — so no fix was needed. This
 * test documents that with a regression case per branch: an empty
 * comparison group must never produce a fabricated insight.
 */
import { describe, it, expect } from 'vitest';
import { computeEnvironmentMoodCorrelations } from '../environmentCorrelations';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-21T12:00:00.000Z');

const entry = (id, dayOffset, mood, environmentContext) => ({
  id,
  createdAt: new Date(now - dayOffset * DAY_MS).toISOString(),
  analysis: { mood_score: mood },
  environmentContext,
});

describe('computeEnvironmentMoodCorrelations — already-guarded empty-group check', () => {
  it('sunshineMood: no insight when the low-sunshine (<30%) group is empty', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      entry(`sun-${i}`, i, 0.7, { daySummary: { sunshinePercent: 80 } }) // all high, none low
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.sunshineMood).toBeUndefined();
  });

  it('weatherMood: no insight when the cloudy group is empty (nulled, not averaged to 0)', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      entry(`w-${i}`, i, 0.7, { weatherLabel: 'sunny' }) // no cloudy entries at all
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.weatherMood).toBeUndefined();
  });

  it('daylightMood: no insight when the short-day (<10h) group is empty', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(`d-${i}`, i, 0.7, { daylightHours: 14 }) // all long days
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.daylightMood).toBeUndefined();
  });

  it('lightContextMood: no insight when the dark group is empty', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      entry(`l-${i}`, i, 0.7, { lightContext: 'daylight', isAfterDark: false })
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.lightContextMood).toBeUndefined();
  });

  it('temperatureMood: no insight when the cool (<50F) group is empty', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry(`t-${i}`, i, 0.7, { temperature: 85 }) // all warm
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.temperatureMood).toBeUndefined();
  });

  it('lowSunshineWarning: no insight when the normal-day group is empty', () => {
    const entries = Array.from({ length: 7 }, (_, i) =>
      entry(`ls-${i}`, i, 0.3, { daySummary: { isLowSunshine: true } }) // every day is low-sunshine
    );
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.lowSunshineWarning).toBeUndefined();
  });

  it('sunshineMood: still fires normally when both groups are genuinely populated', () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => entry(`high-${i}`, i, 0.8, { daySummary: { sunshinePercent: 80 } })),
      ...Array.from({ length: 4 }, (_, i) => entry(`low-${i}`, i + 10, 0.4, { daySummary: { sunshinePercent: 10 } })),
    ];
    const correlations = computeEnvironmentMoodCorrelations(entries);
    expect(correlations?.sunshineMood).toBeTruthy();
  });
});
