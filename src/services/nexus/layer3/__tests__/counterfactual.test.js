/**
 * R4 Task 3 — Mood01 scale-invariance for counterfactual.js (DR findings 3/7).
 *
 * Runtime `mood`/`analysis.mood_score` is native 0-1 (Mood01). These tests
 * feed 0-1 data and assert the fixed thresholds behave sanely at that
 * scale — the pre-fix code compared against 0-100-scale literals (`< 40`,
 * `>= 60`) and either always or never fired against real data.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  identifyMissingInterventions,
  findGoodDayActivities,
  analyzeCounterfactualPatterns,
} from '../counterfactual';

vi.mock('../../../ai/gemini', () => ({
  callGemini: vi.fn(async () => null),
}));

describe('findGoodDayActivities — Mood01 scale-invariance', () => {
  // findGoodDayActivities requires >=10 entries total; only the "yoga"
  // subset needs to clear `minOccurrences` (default 3).
  it('treats 0.60+ (not 60+) as the good-day mood threshold', () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `yoga-${i}`, text: 'Did yoga this morning', mood: 0.65 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `neutral-${i}`, text: 'A regular day.', mood: 0.5 })),
    ];

    const result = findGoodDayActivities(entries, 3);
    expect(result.some((a) => a.activity === 'yoga')).toBe(true);
  });

  it('does not treat a below-threshold Mood01 value as a good day', () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `yoga-${i}`, text: 'Did yoga this morning', mood: 0.55 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `neutral-${i}`, text: 'A regular day.', mood: 0.5 })),
    ];

    const result = findGoodDayActivities(entries, 3);
    expect(result.some((a) => a.activity === 'yoga')).toBe(false);
  });
});

describe('analyzeCounterfactualPatterns — Mood01 low-mood threshold', () => {
  it('selects days below 0.40 (not 40) as low-mood days', async () => {
    // >=10 entries total: `findGoodDayActivities`, called internally by
    // `analyzeCounterfactualPatterns`, also requires it.
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `low-${i}`, text: 'A hard, rough day at home.', mood: 0.25 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `good-${i}`, text: 'Did yoga this morning.', mood: 0.75 })),
    ];
    const interventionData = {
      interventions: {
        yoga: { effectiveness: { global: { score: 0.9, moodDelta: { mean: 0.2 } }, sampleSize: 4 } },
      },
    };

    const result = await analyzeCounterfactualPatterns(entries, interventionData);
    expect(result).toBeTruthy();
    expect(result.lowMoodDaysAnalyzed).toBe(4);
  });

  it('a fixture whose "low" days are all >= 0.40 finds no low-mood days at all', async () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({ id: `mid-${i}`, text: 'An ordinary day.', mood: 0.55 }));
    const result = await analyzeCounterfactualPatterns(entries, { interventions: {} });
    expect(result).toBeNull();
  });
});

describe('identifyMissingInterventions — no fabricated fallback', () => {
  it('does not invent a moodDelta when interventionTracker has no real one (R4 T3 / decision 4)', () => {
    const badDayEntry = { id: 'bad-1', text: 'A rough day at home.', mood: 0.20 };
    const interventionData = {
      interventions: {
        yoga: { effectiveness: { global: { score: 0.85 /* no moodDelta at all */ } }, totalOccurrences: 5 },
      },
    };

    const missing = identifyMissingInterventions(badDayEntry, interventionData, ['yoga']);
    expect(missing).toHaveLength(1);
    // Previously defaulted to a fabricated `10` — must not invent a number.
    expect(missing[0].expectedMoodBoost).toBeNull();
  });

  it('carries the REAL moodDelta through untouched when interventionTracker has one', () => {
    const badDayEntry = { id: 'bad-1', text: 'A rough day.', mood: 0.20 };
    const interventionData = {
      interventions: {
        yoga: { effectiveness: { global: { score: 0.85, moodDelta: { mean: 0.18 } } }, totalOccurrences: 5 },
      },
    };

    const missing = identifyMissingInterventions(badDayEntry, interventionData, ['yoga']);
    expect(missing[0].expectedMoodBoost).toBe(0.18);
  });
});
