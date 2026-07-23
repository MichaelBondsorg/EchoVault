/**
 * R4 T3d — dedicated coverage for `insightIntegration.js`'s `getTodayRecommendations`
 * pet-walk/workout/sunshine reasoning (coordinator Important finding: this
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

const mockGetInterventionData = vi.fn();
const mockUpdateInterventionData = vi.fn();
vi.mock('../layer4/interventionTracker', () => ({
  updateInterventionData: (...args) => mockUpdateInterventionData(...args),
  getInterventionData: (...args) => mockGetInterventionData(...args),
}));

import { computeEnvironmentMoodCorrelations } from '../../environment/environmentCorrelations';

beforeEach(() => {
  mockGetBaselines.mockReset();
  mockGetInterventionData.mockReset();
  mockUpdateInterventionData.mockReset();
  mockGenerateCausalSynthesis.mockReset();
  computeEnvironmentMoodCorrelations.mockReset();
  mockGetBaselines.mockResolvedValue({ calculatedAt: { toDate: () => new Date('2026-07-21') } });
});

function petWalkInterventions(moodDeltaMean, extra = {}) {
  return {
    interventions: {
      pet_walk: { effectiveness: { global: { moodDelta: { mean: moodDeltaMean } } } },
      ...extra,
    },
  };
}

function workoutIntervention(score, extra = {}) {
  return {
    interventions: {
      workout_day: { effectiveness: { global: { score } } },
      ...extra,
    },
  };
}

const GREEN_ZONE_HEALTH = { recovery: { score: 70 } };

describe('getTodayRecommendations — pet_walk reasoning (R4 Phase 3 T1: personal branch deleted, not gated)', () => {
  it('always generic copy: no personalized number, no percentage, no "Sterling"', async () => {
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.08));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Worth trying — you might find it helps.');
    expect(rec.reasoning).not.toMatch(/\d/); // no personalized number
    expect(rec.reasoning).not.toMatch(/%/); // no percentage
    expect(rec.reasoning.toLowerCase()).not.toContain('sterling');
    expect(rec.action.toLowerCase()).not.toContain('sterling');
  });

  it('generic copy holds regardless of the size of the underlying (unused) moodDelta', async () => {
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.20));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec.reasoning).toBe('Worth trying — you might find it helps.');
  });

  it('the renamed pet_walk key is consumed end-to-end from a fixture interventions doc; a stale pre-rename key is silently ignored (self-healing, not a bug)', async () => {
    // A doc with BOTH the current key and a stale pre-rename key present —
    // only `pet_walk` should ever be read (proves the rename actually
    // changed the lookup path, not just the surrounding code).
    mockGetInterventionData.mockResolvedValue(
      petWalkInterventions(0.20, {
        sterling_walk: { effectiveness: { global: { moodDelta: { mean: 0.99 } } } },
      })
    );

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec).toBeTruthy();
    // If the stale key were still being read, this would be a wildly
    // different (0.99-derived) recommendation set/ordering below.
    expect(result.recommendations).toHaveLength(1);
  });

  it('below the significance threshold (delta <= 0.05), no pet-walk recommendation is pushed at all', async () => {
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.02));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec).toBeUndefined();
  });

  it('no interventions tracked at all -> no pet-walk recommendation, no crash', async () => {
    mockGetInterventionData.mockResolvedValue({ interventions: {} });

    const result = await getTodayRecommendations('user-1', [], null, null);
    expect(result.recommendations).toEqual([]);
  });
});

describe('getTodayRecommendations — workout-effectiveness reasoning (R4 Phase 3 T1: personal branch deleted, not gated)', () => {
  it('always generic copy: no personalized effectiveness number, no percentage', async () => {
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
    expect(rec.reasoning).not.toMatch(/\d/); // no personalized number
    expect(rec.reasoning).not.toMatch(/%/); // no percentage
  });

  it('generic copy holds regardless of the size of the underlying (unused) effectiveness score', async () => {
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.95));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
  });

  it('below the effectiveness threshold (score <= 0.6), no workout recommendation is pushed at all', async () => {
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.5));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeUndefined();
  });
});

describe('getTodayRecommendations — sunshine reasoning (R4 Phase 3 T1: kills the live ungated percentage leak)', () => {
  it('always generic copy: no personalized mood-delta percentage, regardless of correlation strength', async () => {
    mockGetInterventionData.mockResolvedValue({ interventions: {} });
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
 * low-sleep, sunny-day sensitivity, workout, and pet_walk all fire together
 * here), asserting NO returned `reasoning` string anywhere contains a
 * percentage digit pattern, and that the three specific generic strings
 * appear verbatim. This is the RED case pre-fix: the sunshine assertion
 * fails against the old code because it renders
 * `Your mood is NN% higher on sunny days` ungated.
 */
describe('getTodayRecommendations — no percentage leaks anywhere (R4 Phase 3 T1 regression fixture)', () => {
  it('rich fixture (low sleep + sunny-day sensitivity + green-zone workout + pet_walk all firing): every reasoning string is free of digit-percent patterns, and the three generic strings render verbatim', async () => {
    mockGetInterventionData.mockResolvedValue({
      interventions: {
        workout_day: { effectiveness: { global: { score: 0.9 } } },
        pet_walk: { effectiveness: { global: { moodDelta: { mean: 0.35 } } } },
      },
    });
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
    expect(result.recommendations.length).toBeGreaterThanOrEqual(4);

    for (const rec of result.recommendations) {
      expect(rec.reasoning).not.toMatch(/\d+\s*%/);
    }

    const workoutRec = result.recommendations.find((r) => r.action?.toLowerCase().includes('workout'));
    const sunshineRec = result.recommendations.find((r) => r.type === 'environment');
    const petRec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(workoutRec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
    expect(sunshineRec.reasoning).toBe("Sunshine tends to help some people's mood — worth getting outside if you can.");
    expect(petRec.reasoning).toBe('Worth trying — you might find it helps.');
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
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], { recovery: { score: 70 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().recoveryScore >= 67
  });

  it('extractHealthSignals correctly derives sleepHours from a real todayHealth object, driving the low-sleep self-care branch', async () => {
    mockGetInterventionData.mockResolvedValue({ interventions: {} });

    const result = await getTodayRecommendations('user-1', [], { sleep: { totalHours: 4.5 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'self_care');

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().sleepHours < 6
    expect(rec.action).toContain('limited sleep');
  });

  it('extractEnvironmentSignals runs against a real todayEnvironment object without throwing (both formatter symbols exercised together)', async () => {
    mockGetInterventionData.mockResolvedValue({ interventions: {} });

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
