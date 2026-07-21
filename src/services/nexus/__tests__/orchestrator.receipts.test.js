/**
 * Full generateInsights() receipts integration test (R2 Task 8: Insight
 * Receipts on Nexus + Basic insights).
 *
 * Exercises multiple generator families in a single generation pass to
 * verify the PRD's 100%-receipts acceptance criterion: after
 * generateInsights, EVERY insight in `active` carries a truthy `.receipt`.
 * Also verifies that generators with real source sets (pattern_correlation,
 * entity_correlation) attach receipts over the EXACT entries they computed
 * over (not the window-level fallback), that Layer 3/4 insights without a
 * precise source set fall back to a capped window-level receipt, and that
 * a scope passed into generateInsights is stamped onto every receipt.
 *
 * Layer 1 pattern detection (`detectPatternsInPeriod`) and the orchestrator's
 * own `computeEntityMoodCorrelations` run for REAL (not mocked) so their
 * receipts reflect genuine entry-id threading. Everything with a Firestore
 * or LLM dependency is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../health/whoop', () => ({
  isWhoopLinked: vi.fn(async () => false),
  getWhoopSummary: vi.fn(async () => null),
  getWhoopHistory: vi.fn(async () => ({ available: false, days: [] })),
}));

vi.mock('../gapDetector', () => ({
  detectGaps: vi.fn(async () => []),
}));

vi.mock('../layer1/threadManager', () => ({
  getActiveThreads: vi.fn(async () => []),
  identifyThreadAssociation: vi.fn(async () => ({})),
}));

vi.mock('../layer1/somaticExtractor', () => ({
  extractSomaticSignals: vi.fn(() => []),
}));

vi.mock('../layer2/stateDetector', () => ({
  detectCurrentState: vi.fn(async () => ({})),
  updateCurrentState: vi.fn(async () => {}),
}));

vi.mock('../layer2/baselineManager', () => ({
  getBaselines: vi.fn(async () => null),
  calculateAndSaveBaselines: vi.fn(async () => {}),
  compareToBaseline: vi.fn(() => ({})),
}));

vi.mock('../layer3/synthesizer', () => ({
  INSIGHT_TYPES: {},
  generateCausalSynthesis: vi.fn(async () => ({
    success: true,
    insight: {
      id: 'synthesis-1',
      type: 'causal_synthesis',
      title: 'Synthesis Insight',
      summary: 'summary',
      body: 'body',
      evidence: { narrative: [], statistical: { sampleSize: 12 } },
    },
  })),
  generateNarrativeArcInsight: vi.fn(async () => null),
}));

vi.mock('../layer3/crossThreadDetector', () => ({
  detectMetaPatterns: vi.fn(async () => []),
  generateMetaPatternInsight: vi.fn(async () => null),
}));

vi.mock('../layer3/beliefDissonance', () => ({
  extractBeliefsFromEntry: vi.fn(() => []),
  refineBeliefsWithLLM: vi.fn(async () => []),
  validateBeliefAgainstData: vi.fn(async () => ({ dissonanceScore: 0 })),
  generateDissonanceInsight: vi.fn(async () => null),
  saveBeliefs: vi.fn(async () => {}),
  getBeliefs: vi.fn(async () => []),
}));

vi.mock('../layer3/counterfactual', () => ({
  identifyMissingInterventions: vi.fn(() => []),
  generateCounterfactualInsight: vi.fn(async () => null),
  findGoodDayActivities: vi.fn(() => []),
}));

vi.mock('../layer4/interventionTracker', () => ({
  updateInterventionData: vi.fn(async () => {}),
  getInterventionData: vi.fn(async () => ({})),
}));

vi.mock('../layer4/recommendationEngine', () => ({
  generateRecommendations: vi.fn(async () => ([
    { summary: 'Take a short walk', body: 'Walking helps you reset.', confidence: 0.8 },
  ])),
}));

const { getDocs } = await import('firebase/firestore');
const { generateInsights } = await import('../orchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 12-entry fixture built to exercise three receipt paths in one pass:
 *  - 4 "interview" entries -> Layer1 `career_anticipation` narrative
 *    pattern -> pattern_correlation insight (precise sources)
 *  - 4 "yoga" entries -> entity correlation (activity: yoga) AND Layer1
 *    `exercise_completion` narrative pattern -> entity_correlation +
 *    a second pattern_correlation insight (precise sources)
 *  - 4 neutral padding entries -> baseline mood, no pattern/entity match
 * `generateCausalSynthesis` (mocked, Layer 3) and `generateRecommendations`
 * (mocked, Layer 4) round out the fixture with insights that have NO
 * precise source set, to exercise the window-level fallback.
 */
function buildEntries({ spaceId } = {}) {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [];

  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `interview-${i}`,
      createdAt: new Date(now - i * DAY_MS).toISOString(),
      text: `Had another interview today, feeling good about it. Entry number ${i}.`,
      analysis: { mood_score: 80 },
      ...(spaceId ? { spaceId } : {}),
    });
  }

  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - (i + 4) * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
      analysis: { mood_score: 85 },
      ...(spaceId ? { spaceId } : {}),
    });
  }

  for (let i = 0; i < 4; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 8) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 50 },
      ...(spaceId ? { spaceId } : {}),
    });
  }

  return entries;
}

function mockEntriesSnapshot(entries) {
  return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
}

describe('generateInsights - receipts (R2 Task 8)', () => {
  beforeEach(() => {
    getDocs.mockReset();
  });

  it('attaches a truthy, well-formed receipt to every insight in `active` (100%-receipts invariant)', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');

    expect(result.success).toBe(true);
    // Sanity: the fixture actually produced insights from more than one
    // generator family, otherwise this test would trivially pass.
    const types = new Set(result.insights.map((i) => i.type));
    expect(types.size).toBeGreaterThanOrEqual(3);

    for (const insight of result.insights) {
      expect(insight.receipt).toBeTruthy();
      expect(Array.isArray(insight.receipt.sources)).toBe(true);
      expect(insight.receipt.timeWindow.start).toEqual(expect.any(String));
      expect(insight.receipt.timeWindow.end).toEqual(expect.any(String));
      expect(typeof insight.receipt.sampleSize).toBe('number');
      expect(insight.receipt.versions.computationVersion).toBe(1);
      expect(insight.receipt.versions.generator).toEqual(expect.any(String));
      expect(insight.receipt.versions.generatedAt).toEqual(expect.any(String));
    }
  });

  it('pattern_correlation insight carries the exact entry ids the pattern was detected over', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    const careerInsight = result.insights.find((i) => i.id === 'pattern_career_anticipation');

    expect(careerInsight).toBeTruthy();
    expect(careerInsight.type).toBe('pattern_correlation');
    const sourceIds = careerInsight.receipt.sources.map((s) => s.entryId).sort();
    expect(sourceIds).toEqual(['interview-0', 'interview-1', 'interview-2', 'interview-3']);
    expect(careerInsight.receipt.versions.generator).toBe('pattern_correlation');
    expect(careerInsight.receipt.sampleSize).toBe(4);
    // Excerpts come from the real entry text, not a placeholder.
    expect(careerInsight.receipt.sources[0].excerpt).toMatch(/interview/);
  });

  it('entity_correlation insight carries the exact matching entry ids', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    const entityInsight = result.insights.find((i) => i.type === 'entity_correlation');

    expect(entityInsight).toBeTruthy();
    const sourceIds = entityInsight.receipt.sources.map((s) => s.entryId).sort();
    expect(sourceIds).toEqual(['yoga-0', 'yoga-1', 'yoga-2', 'yoga-3']);
    expect(entityInsight.receipt.versions.generator).toBe('entity_correlation');
  });

  it('window-level generators (Layer 3 synthesis, Layer 4 intervention) fall back to a capped window receipt', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    const synthesisInsight = result.insights.find((i) => i.type === 'causal_synthesis');
    const interventionInsight = result.insights.find((i) => i.type === 'intervention');

    expect(synthesisInsight).toBeTruthy();
    expect(synthesisInsight.receipt.sources.length).toBeLessThanOrEqual(10);
    expect(synthesisInsight.receipt.sampleSize).toBe(12); // full window entries count
    expect(synthesisInsight.receipt.versions.generator).toBe('causal_synthesis');
    // Statistical/non-LLM-plumbed generator -> model/promptVersion stay null.
    expect(synthesisInsight.receipt.versions.model).toBeNull();
    expect(synthesisInsight.receipt.versions.promptVersion).toBeNull();

    expect(interventionInsight).toBeTruthy();
    expect(interventionInsight.receipt.sources.length).toBeLessThanOrEqual(10);
    expect(interventionInsight.receipt.versions.generator).toBe('intervention');
  });

  it('stamps scope onto every receipt when generateInsights is called with a scope', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries({ spaceId: 'work' })));

    const result = await generateInsights('user-1', { scope: { spaceId: 'work' } });

    expect(result.insights.length).toBeGreaterThan(0);
    for (const insight of result.insights) {
      expect(insight.receipt.scope).toEqual({ spaceId: 'work' });
    }
  });

  it('scope is null (all-spaces) when generateInsights is called without one', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    for (const insight of result.insights) {
      expect(insight.receipt.scope).toBeNull();
    }
  });
});
