/**
 * R4 Task 3 — recommendationEngine.js: DR finding 7 ("recommends without
 * personal evidence"), Mood01 threshold fix, deleted fabricated fallback
 * numbers, and the ratified-decision-4 generic-idea relabeling.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../interventionTracker', () => ({
  getInterventionData: vi.fn(),
}));

import { getInterventionData } from '../interventionTracker';
import { generateRecommendations } from '../recommendationEngine';

const baseContext = (overrides = {}) => ({
  currentState: { primary: 'stable' },
  whoopToday: null,
  recentMood: 0.5,
  timeOfDay: 'morning',
  ...overrides,
});

describe('generateRecommendations — MIN_EVIDENCE_OCCURRENCES gate (DR finding 7)', () => {
  it('does not recommend an intervention tracked only once, even with a neutral effectiveness score', async () => {
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        gym: { category: 'physical', totalOccurrences: 1, effectiveness: { global: { score: 0.5 } } },
      },
    });

    const recs = await generateRecommendations('user-1', baseContext({ riskyClaimsEnabled: true }));
    expect(recs.find((r) => r.intervention === 'gym')).toBeUndefined();
  });

  it('DOES recommend an intervention with >= MIN_EVIDENCE_OCCURRENCES and a genuinely strong effectiveness score', async () => {
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        gym: { category: 'physical', totalOccurrences: 10, effectiveness: { global: { score: 0.9 } } },
      },
    });

    const recs = await generateRecommendations('user-1', baseContext({ riskyClaimsEnabled: true }));
    expect(recs.find((r) => r.intervention === 'gym')).toBeTruthy();
  });
});

describe('generateRecommendations — Mood01 recentMood threshold', () => {
  it('a native 0-1 recentMood of 0.30 (genuinely low) boosts acts_of_service, not a 0-100-scale comparison', async () => {
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        acts_of_service: { category: 'behavioral', totalOccurrences: 5, effectiveness: { global: { score: 0.5 } } },
      },
    });

    const lowMoodRecs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'low_mood' },
      recentMood: 0.30,
      riskyClaimsEnabled: true,
    }));
    const neutralMoodRecs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'low_mood' },
      recentMood: 0.60,
      riskyClaimsEnabled: true,
    }));

    const lowScore = lowMoodRecs.find((r) => r.intervention === 'acts_of_service')?.score || 0;
    const neutralScore = neutralMoodRecs.find((r) => r.intervention === 'acts_of_service')?.score || 0;
    expect(lowScore).toBeGreaterThan(neutralScore);
  });
});

describe('generateRecommendations — ratified decision 4: riskyClaimsEnabled gate', () => {
  const interventionData = {
    interventions: {
      gym: { category: 'physical', totalOccurrences: 10, effectiveness: { global: { score: 0.9, moodDelta: { mean: 0.20 }, hrvDelta: { mean: 8 } } } },
    },
  };

  it('defaults to false (generic idea) when riskyClaimsEnabled is omitted', async () => {
    getInterventionData.mockResolvedValueOnce(interventionData);
    const recs = await generateRecommendations('user-1', baseContext());
    const rec = recs.find((r) => r.intervention === 'gym');
    expect(rec).toBeTruthy();
    expect(rec.score).toBeUndefined();
    expect(rec.expectedOutcome).toBeUndefined();
    expect(rec.reasoning).not.toMatch(/historically|your mood|your HRV|points/i);
  });

  it('riskyClaimsEnabled: true surfaces the real score/reasoning/expectedOutcome', async () => {
    getInterventionData.mockResolvedValueOnce(interventionData);
    const recs = await generateRecommendations('user-1', baseContext({ riskyClaimsEnabled: true }));
    const rec = recs.find((r) => r.intervention === 'gym');
    expect(rec.score).toBeGreaterThan(0.5);
    expect(rec.expectedOutcome).toBeTruthy();
  });
});

describe('generateRecommendations — no fabricated fallback numbers (decision 4: deleted outright)', () => {
  it('never writes a hardcoded HRV/mood number when the real data is absent, even for a templated state/intervention pair', async () => {
    // sterling_walk in career_waiting has a hardcoded template that used to
    // fall back to `|| 12`ms when hrvDelta was missing.
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        sterling_walk: { category: 'relational', totalOccurrences: 10, effectiveness: { global: { score: 0.9 /* no hrvDelta */ } } },
      },
    });

    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'career_waiting' },
      riskyClaimsEnabled: true,
    }));

    const rec = recs.find((r) => r.intervention === 'sterling_walk');
    expect(rec).toBeTruthy();
    expect(rec.reasoning).not.toContain('12ms');
    expect(rec.reasoning).not.toMatch(/recovered your HRV by \d/);
  });

  it('predictOutcome returns null (no invented +10-point default) when there is no real mood/HRV data', async () => {
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        creative: { category: 'behavioral', totalOccurrences: 10, effectiveness: { global: { score: 0.9 } } },
      },
    });

    const recs = await generateRecommendations('user-1', baseContext({
      currentState: { primary: 'career_waiting' },
      riskyClaimsEnabled: true,
    }));

    const rec = recs.find((r) => r.intervention === 'creative');
    expect(rec).toBeTruthy();
    expect(rec.expectedOutcome).toBeNull();
  });
});
