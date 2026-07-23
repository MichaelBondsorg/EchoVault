/**
 * R4 T3d — dedicated coverage for `insightIntegration.js`'s `getTodayRecommendations`
 * workout/sunshine reasoning (coordinator Important finding: this
 * function is live-wired at `InsightsPage.jsx:124` and renders directly to
 * the user, but every consumer test mocks the whole module, so this
 * behavior itself had zero direct coverage).
 *
 * R4 Phase 3 T1: the module previously imported `RISKY_CLAIMS_ENABLED` from
 * `./orchestrator` and ternary-gated the workout/pet_walk personal-evidence
 * strings on it (both effectively OFF in production), while the sunshine
 * branch interpolated a personalized percentage completely UNGATED — a live
 * leak. All three personal-evidence branches are now deleted outright (not
 * gated): the module no longer imports `RISKY_CLAIMS_ENABLED` at all, so
 * there is nothing left to toggle. Tests below call `getTodayRecommendations`
 * directly against a single static import.
 *
 * R4 Phase 3 T5 (P3-D1): `interventionTracker.js` (and its `getInterventionData`
 * call this module used to make) is deleted whole.
 *   - The workout idea's `interventions?.interventions?.workout_day
 *     ?.effectiveness?.global?.score > 0.6` inner gate is gone; the idea now
 *     renders unconditionally on the (tracker-independent) recovery >= 67
 *     trigger alone, same generic copy as before. Tests below updated
 *     accordingly — no `getInterventionData` mock needed at all anymore.
 *   - The pet_walk idea is DROPPED, not converted to a static generic idea:
 *     its only trigger was tracked evidence from the deleted tracker (no pet
 *     -ownership signal exists anywhere else), so there is no honest
 *     condition left under which to show it. Its describe block below is
 *     removed; the regression fixture no longer asserts on a pet_walk
 *     recommendation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTodayRecommendations } from '../insightIntegration';

// Static mocks — safe to declare once (hoisted).
vi.mock('../../health/healthCorrelations', () => ({
  computeHealthMoodCorrelations: vi.fn(),
  getTopHealthInsights: vi.fn(),
  checkHealthDataSufficiency: vi.fn(),
}));
vi.mock('../../environment/environmentCorrelations', () => ({
  computeEnvironmentMoodCorrelations: vi.fn(),
  getTopEnvironmentInsights: vi.fn(),
  checkEnvironmentDataSufficiency: vi.fn(),
}));
vi.mock('../../prompts/contextPrompts', () => ({
  generateContextAwarePrompts: vi.fn(),
  getTopContextPrompt: vi.fn(),
  hasHighPriorityContext: vi.fn(),
}));
vi.mock('../layer1/patternDetector', () => ({
  detectPatternsInPeriod: vi.fn(),
}));
const mockGenerateCausalSynthesis = vi.fn();
vi.mock('../layer3/synthesizer', () => ({
  generateCausalSynthesis: (...args) => mockGenerateCausalSynthesis(...args),
}));
vi.mock('../../health/whoop', () => ({
  getWhoopHistory: vi.fn(async () => ({ available: false, days: [] })),
}));

const mockGetBaselines = vi.fn();
vi.mock('../layer2/baselineManager', () => ({
  calculateAndSaveBaselines: vi.fn(),
  getBaselines: (...args) => mockGetBaselines(...args),
}));

import { computeEnvironmentMoodCorrelations } from '../../environment/environmentCorrelations';

beforeEach(() => {
  mockGetBaselines.mockReset();
  mockGenerateCausalSynthesis.mockReset();
  computeEnvironmentMoodCorrelations.mockReset();
  mockGetBaselines.mockResolvedValue({ calculatedAt: { toDate: () => new Date('2026-07-21') } });
});

const GREEN_ZONE_HEALTH = { recovery: { score: 70 } };

describe('getTodayRecommendations — pet_walk idea dropped (R4 Phase 3 T5 per P3-D1)', () => {
  it('never returns a pet-walk recommendation — interventionTracker.js (its only trigger) is deleted', async () => {
    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));
    expect(rec).toBeUndefined();
  });
});

describe('getTodayRecommendations — workout-effectiveness reasoning (R4 Phase 3 T1: personal branch deleted, not gated; T5: tracker-dependent inner gate removed)', () => {
  it('always generic copy, unconditional on the (deleted) tracker: no personalized effectiveness number, no percentage', async () => {
    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
    expect(rec.reasoning).not.toMatch(/\d/); // no personalized number
    expect(rec.reasoning).not.toMatch(/%/); // no percentage
  });

  it('the idea renders purely off the recovery >= 67 trigger — no interventionTracker data exists to gate it further', async () => {
    const result = await getTodayRecommendations('user-1', [], { recovery: { score: 90 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
  });

  it('below the recovery threshold (score < 67, and not red-zone), no workout recommendation is pushed', async () => {
    const result = await getTodayRecommendations('user-1', [], { recovery: { score: 50 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeUndefined();
  });
});

describe('getTodayRecommendations — sunshine reasoning (R4 Phase 3 T1: kills the live ungated percentage leak)', () => {
  it('always generic copy: no personalized mood-delta percentage, regardless of correlation strength', async () => {
    computeEnvironmentMoodCorrelations.mockReturnValue({
      sunshineMood: { strength: 'strong', highSunshineMood: 0.8, lowSunshineMood: 0.3 },
    });

    const result = await getTodayRecommendations(
      'user-1',
      [],
      null,
      { daySummary: { isLowSunshine: true, sunshinePercent: 10 } }
    );
    const rec = result.recommendations.find((r) => r.type === 'environment');

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe("Sunshine tends to help some people's mood — worth getting outside if you can.");
    expect(rec.reasoning).not.toMatch(/\d/); // no personalized number
    expect(rec.reasoning).not.toMatch(/%/); // no percentage
  });
});

/**
 * R4 Phase 3 T1 — the core regression test for this task: a rich
 * health/environment fixture that fires every reasoning-bearing branch at
 * once (recovery red-zone self-care copy doesn't carry a number anyway, but
 * low-sleep, sunny-day sensitivity, and workout all fire together here),
 * asserting NO returned `reasoning` string anywhere contains a percentage
 * digit pattern, and that the generic strings appear verbatim. This is the
 * RED case pre-fix: the sunshine assertion fails against the old code
 * because it renders `Your mood is NN% higher on sunny days` ungated.
 *
 * R4 Phase 3 T5: pet_walk removed from this fixture's expected branches —
 * it is dropped outright, not one of the surviving generic ideas.
 */
describe('getTodayRecommendations — no percentage leaks anywhere (R4 Phase 3 T1 regression fixture)', () => {
  it('rich fixture (low sleep + sunny-day sensitivity + green-zone workout all firing): every reasoning string is free of digit-percent patterns, and the generic strings render verbatim', async () => {
    computeEnvironmentMoodCorrelations.mockReturnValue({
      sunshineMood: { strength: 'strong', highSunshineMood: 0.9, lowSunshineMood: 0.1 },
    });

    const result = await getTodayRecommendations(
      'user-1',
      [],
      { recovery: { score: 70 }, sleep: { totalHours: 4 } },
      { daySummary: { isLowSunshine: true, sunshinePercent: 5 } }
    );

    // Every branch actually fired — otherwise this fixture isn't exercising
    // what it claims to.
    expect(result.recommendations.length).toBeGreaterThanOrEqual(3);

    for (const rec of result.recommendations) {
      expect(rec.reasoning).not.toMatch(/\d+\s*%/);
    }

    const workoutRec = result.recommendations.find((r) => r.action?.toLowerCase().includes('workout'));
    const sunshineRec = result.recommendations.find((r) => r.type === 'environment');
    const petRec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(workoutRec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
    expect(sunshineRec.reasoning).toBe("Sunshine tends to help some people's mood — worth getting outside if you can.");
    expect(petRec).toBeUndefined();
  });
});

/**
 * R4 P0-closure Important 1 — `extractHealthSignals`/`extractEnvironmentSignals`
 * were previously loaded via `require()` inside `getTodayRecommendations`, a
 * CommonJS call in an ESM module (the repo's historical white-screen bug
 * class — esbuild misses undefined globals; see CLAUDE.md gotchas). This
 * file importing `../insightIntegration` at all already proves the module
 * loads without a top-level ReferenceError; these tests additionally prove
 * the two symbols actually FUNCTION when invoked with real health/environment
 * context (not merely present-but-broken).
 */
describe('getTodayRecommendations — formerly require()-d formatter symbols function correctly (R4 P0-closure Important 1)', () => {
  it('extractHealthSignals correctly derives recoveryScore from a real todayHealth object, driving the green-zone branch', async () => {
    const result = await getTodayRecommendations('user-1', [], { recovery: { score: 70 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().recoveryScore >= 67
  });

  it('extractHealthSignals correctly derives sleepHours from a real todayHealth object, driving the low-sleep self-care branch', async () => {
    const result = await getTodayRecommendations('user-1', [], { sleep: { totalHours: 4.5 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'self_care');

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().sleepHours < 6
    expect(rec.action).toContain('limited sleep');
  });

  it('extractEnvironmentSignals runs against a real todayEnvironment object without throwing (both formatter symbols exercised together)', async () => {
    await expect(
      getTodayRecommendations(
        'user-1',
        [],
        { recovery: { score: 70 }, sleep: { totalHours: 7 } },
        { daySummary: { isLowSunshine: true, sunshinePercent: 15 } }
      )
    ).resolves.toBeTruthy();
  });
});
