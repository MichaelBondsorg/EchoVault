/**
 * R4 T3d — dedicated coverage for `insightIntegration.js`'s `getTodayRecommendations`
 * pet-walk gate branching (coordinator Important finding: this function is
 * live-wired at `InsightsPage.jsx:124` and renders directly to the user,
 * but every consumer test mocks the whole module, so the gate behavior
 * itself had zero direct coverage).
 *
 * `RISKY_CLAIMS_ENABLED` is imported live from `./orchestrator` at
 * `insightIntegration.js`'s module top level, so varying it across tests
 * requires a fresh module instance per value — `vi.doMock` + `vi.resetModules()`
 * + a dynamic `import()` per test (mirrors the technique
 * `orchestrator.riskyClaims.test.js` uses for its own gate-toggle tests,
 * adapted here because the gate lives in a DIFFERENT module than the one
 * under test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The "real gate" test imports the REAL './orchestrator' (to prove
// production wiring, not just a stub), which pulls in every layer1-4
// module PLUS config/firebase transitively — mock firebase so this file
// never touches a real Firebase app.
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  query: vi.fn((...args) => ({ __args: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// Static mocks — not gate-dependent, safe to declare once (hoisted).
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

/**
 * Fresh module instance of insightIntegration.js with `./orchestrator`'s
 * `RISKY_CLAIMS_ENABLED` substituted to `riskyClaimsEnabled` for this
 * import only. `vi.resetModules()` clears the instance cache (NOT the
 * mock-factory registrations above, which persist and re-apply), so each
 * call gets its own live binding to the gate value.
 */
async function loadWithGate(riskyClaimsEnabled) {
  vi.resetModules();
  vi.doMock('../orchestrator', () => ({ RISKY_CLAIMS_ENABLED: riskyClaimsEnabled }));
  return import('../insightIntegration');
}

/** Real default: no mock at all — proves production wiring, not just a stub. */
async function loadWithRealGate() {
  vi.resetModules();
  vi.doUnmock('../orchestrator');
  return import('../insightIntegration');
}

beforeEach(() => {
  mockGetBaselines.mockReset();
  mockGetInterventionData.mockReset();
  mockUpdateInterventionData.mockReset();
  mockGenerateCausalSynthesis.mockReset();
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

describe('getTodayRecommendations — pet_walk gate branching (R4 T3d)', () => {
  it('gate OFF via the REAL orchestrator import (current production default): generic copy, no personalized number, no "Sterling"', async () => {
    const { getTodayRecommendations } = await loadWithRealGate();
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

  it('gate OFF (explicit mock, same assertion set): confirms the branch is driven by the gate value, not incidental', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.08));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec.reasoning).toBe('Worth trying — you might find it helps.');
  });

  it('gate ON: the number renders correctly scaled (0.08 Mood01 delta -> "8 points", never "0 points")', async () => {
    const { getTodayRecommendations } = await loadWithGate(true);
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.08));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toContain('8 points');
    expect(rec.reasoning).not.toContain('0 points');
    // Pre-fix this was `Math.round(moodDelta.mean)` treating the raw
    // Mood01 delta as if already a 0-100 percentage — `Math.round(0.08)`
    // rounds to 0, silently claiming "0 points" of improvement.
  });

  it('gate ON with a larger real delta scales correctly too (0.20 -> "20 points")', async () => {
    const { getTodayRecommendations } = await loadWithGate(true);
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.20));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec.reasoning).toContain('20 points');
  });

  it('the renamed pet_walk key is consumed end-to-end from a fixture interventions doc; a stale pre-rename key is silently ignored (self-healing, not a bug)', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
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
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue(petWalkInterventions(0.02));

    const result = await getTodayRecommendations('user-1', [], null, null);
    const rec = result.recommendations.find((r) => r.action?.toLowerCase().includes('pet'));

    expect(rec).toBeUndefined();
  });

  it('no interventions tracked at all -> no pet-walk recommendation, no crash', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue({ interventions: {} });

    const result = await getTodayRecommendations('user-1', [], null, null);
    expect(result.recommendations).toEqual([]);
  });
});

/**
 * R4 P0-closure Important 1 — the workout/exercise-effectiveness claim
 * ("Exercise has been effective for you (X% effectiveness)") reached
 * InsightsPage's RecommendationsSection with the RISKY_CLAIMS_ENABLED gate
 * OFF. Gated identically to the pet_walk claim above (same seam).
 */
function workoutIntervention(score, extra = {}) {
  return {
    interventions: {
      workout_day: { effectiveness: { global: { score } } },
      ...extra,
    },
  };
}

const GREEN_ZONE_HEALTH = { recovery: { score: 70 } };

describe('getTodayRecommendations — workout-effectiveness gate branching (R4 P0-closure Important 1)', () => {
  it('gate OFF via the REAL orchestrator import (current production default): generic copy, no personalized effectiveness number', async () => {
    const { getTodayRecommendations } = await loadWithRealGate();
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
    expect(rec.reasoning).not.toMatch(/\d/); // no personalized number
    expect(rec.reasoning).not.toMatch(/%/); // no percentage
  });

  it('gate OFF (explicit mock, same assertion set): confirms the branch is driven by the gate value, not incidental', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec.reasoning).toBe('Worth trying — exercise can be a good use of a high-recovery day.');
  });

  it('gate ON: the personalized effectiveness number renders (0.8 -> "80% effectiveness")', async () => {
    const { getTodayRecommendations } = await loadWithGate(true);
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy();
    expect(rec.reasoning).toBe('Exercise has been effective for you (80% effectiveness)');
  });

  it('below the effectiveness threshold (score <= 0.6), no workout recommendation is pushed at all', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.5));

    const result = await getTodayRecommendations('user-1', [], GREEN_ZONE_HEALTH, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeUndefined();
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
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue(workoutIntervention(0.8));

    const result = await getTodayRecommendations('user-1', [], { recovery: { score: 70 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'activity' && r.action?.toLowerCase().includes('workout'));

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().recoveryScore >= 67
  });

  it('extractHealthSignals correctly derives sleepHours from a real todayHealth object, driving the low-sleep self-care branch', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
    mockGetInterventionData.mockResolvedValue({ interventions: {} });

    const result = await getTodayRecommendations('user-1', [], { sleep: { totalHours: 4.5 } }, null);
    const rec = result.recommendations.find((r) => r.type === 'self_care');

    expect(rec).toBeTruthy(); // only reachable if extractHealthSignals().sleepHours < 6
    expect(rec.action).toContain('limited sleep');
  });

  it('extractEnvironmentSignals runs against a real todayEnvironment object without throwing (both formatter symbols exercised together)', async () => {
    const { getTodayRecommendations } = await loadWithGate(false);
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

/**
 * R4 P0-closure Minor 6 — `generateComprehensiveInsights` is an orphan (no
 * live call site, exported via barrels only — `src/services/nexus/index.js`)
 * but previously passed `interventionData` ungated into the same
 * causal-synthesis prompt `orchestrator.js` gates behind
 * RISKY_CLAIMS_ENABLED. Now threaded through its own `riskyClaimsEnabled`
 * option, default off.
 */
describe('generateComprehensiveInsights — interventionData gated into synthesis (R4 P0-closure Minor 6)', () => {
  function tenEntries() {
    return Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, analysis: { mood_score: 0.5 } }));
  }

  it('default (riskyClaimsEnabled unset -> off): interventionData passed to synthesis is null, even though real intervention data exists', async () => {
    const { generateComprehensiveInsights } = await loadWithGate(false);
    mockUpdateInterventionData.mockResolvedValue({
      interventions: { workout_day: { effectiveness: { global: { score: 0.9 } } } },
    });
    mockGenerateCausalSynthesis.mockResolvedValue({ success: false });

    await generateComprehensiveInsights('user-1', tenEntries(), { includeCorrelations: false });

    expect(mockGenerateCausalSynthesis).toHaveBeenCalledTimes(1);
    const synthesisContext = mockGenerateCausalSynthesis.mock.calls[0][1];
    expect(synthesisContext.interventionData).toBeNull();
  });

  it('explicit riskyClaimsEnabled: true threads the real interventionData through to synthesis', async () => {
    const { generateComprehensiveInsights } = await loadWithGate(false);
    const interventionData = { interventions: { workout_day: { effectiveness: { global: { score: 0.9 } } } } };
    mockUpdateInterventionData.mockResolvedValue(interventionData);
    mockGenerateCausalSynthesis.mockResolvedValue({ success: false });

    await generateComprehensiveInsights('user-1', tenEntries(), {
      includeCorrelations: false,
      riskyClaimsEnabled: true,
    });

    const synthesisContext = mockGenerateCausalSynthesis.mock.calls[0][1];
    expect(synthesisContext.interventionData).toBe(interventionData);
  });
});
