/**
 * R4 Task 3 — risky-claim suppression seam + the real crossThreadDetector
 * call chain (ratified decision 4:
 * docs/superpowers/plans/2026-07-22-r4-insight-integrity.md).
 *
 * Two things this file proves that layer3/layer4 unit tests can't:
 *  1. With the internal RISKY_CLAIMS_ENABLED gate at its production value
 *     (false), none of the remaining risky claim types (an
 *     interventionData-fed causal_synthesis, and personalized
 *     recommendation wording) reach the persisted insight set — even
 *     though the underlying Mood01 scale fixes would otherwise make them
 *     fire. (Two of the original four risky claim types — counterfactual,
 *     belief_dissonance — were deleted whole-module R4-P3 per P3-D1;
 *     their suppression assertions here were removed with them, superseded
 *     by claims+experiments. Legacy Firestore belief docs may remain,
 *     harmless.)
 *  2. `generateInsights(userId, { riskyClaimsEnabled: true })` (test-only
 *     override) exercises the corrected code end to end, including the
 *     REAL `detectMetaPatterns`/`generateMetaPatternInsight` call chain
 *     (crossThreadDetector is NOT mocked here) — proving the
 *     `activeThreads`/`recentEntries` destructuring seam fix works against
 *     orchestrator's actual `synthesisContext` shape, not just a
 *     hand-rolled unit-test context object.
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

const THREADS = [
  { id: 'thread-career', category: 'career', displayName: 'Job search', entryCount: 5, somaticSignals: [] },
  { id: 'thread-relationship', category: 'relationship', displayName: 'Partner stuff', entryCount: 5, somaticSignals: [] },
];

vi.mock('../layer1/threadManager', () => ({
  getActiveThreads: vi.fn(async () => THREADS),
  identifyThreadAssociation: vi.fn(async () => ({})),
}));

vi.mock('../layer1/somaticExtractor', () => ({
  extractSomaticSignals: vi.fn(() => []),
}));

vi.mock('../layer1/patternDetector', () => ({
  detectPatternsInPeriod: vi.fn(async () => ({ aggregated: {}, rawPatterns: [] })),
}));

vi.mock('../layer2/stateDetector', () => ({
  detectCurrentState: vi.fn(async () => ({ primary: 'career_waiting', confidence: 0.8 })),
  updateCurrentState: vi.fn(async () => {}),
}));

vi.mock('../layer2/baselineManager', () => ({
  getBaselines: vi.fn(async () => null),
  calculateAndSaveBaselines: vi.fn(async () => {}),
  compareToBaseline: vi.fn(() => ({})),
}));

// Layer 3 synthesis is mocked so this file stays focused on (a) the
// suppression gate and (b) the REAL crossThreadDetector call chain
// (deliberately NOT mocked below). beliefDissonance.js / counterfactual.js
// mocks deleted R4-P3 per P3-D1 (superseded by claims+experiments; legacy
// Firestore belief docs may remain, harmless).
vi.mock('../layer3/synthesizer', () => ({
  INSIGHT_TYPES: {},
  generateCausalSynthesis: vi.fn(async () => ({ success: false })),
  generateNarrativeArcInsight: vi.fn(async () => null),
}));

vi.mock('../layer4/interventionTracker', () => ({
  updateInterventionData: vi.fn(async () => {}),
  getInterventionData: vi.fn(async () => ({
    interventions: {
      yoga: { category: 'physical', totalOccurrences: 10, effectiveness: { global: { score: 0.9, moodDelta: { mean: 0.2 } } } },
    },
  })),
}));

// callGemini mocked once, shared by the real synthesizer/crossThreadDetector
// call chain exercised in the "gate on" test below.
vi.mock('../../ai/gemini', () => ({
  callGemini: vi.fn(async () => JSON.stringify({
    title: 'The Waiting Room Loop',
    realization: 'Career and relationship waiting feel the same in your body.',
    explanation: 'Two paragraphs about the shared pattern.',
    unified_intervention: { action: 'A grounding walk', why: 'Regulates the nervous system either way.' },
  })),
}));

vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn(async () => new Set()),
}));

const { getDocs, setDoc } = await import('firebase/firestore');
const { generateInsights } = await import('../orchestrator');
const { generateRecommendations } = await import('../layer4/recommendationEngine');

function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  // >=10 entries: both the belief-dissonance and causal-synthesis blocks
  // gate on `entries.length >= 10`.
  return Array.from({ length: 10 }, (_, i) => ({
    id: `entry-${i}`,
    createdAt: new Date(now - i * DAY_MS).toISOString(),
    text: `Still waiting to hear back, feeling low today. Entry ${i}.`,
    analysis: { mood_score: 0.30 },
  }));
}

function mockEntriesSnapshot(entries) {
  return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
}

describe('generateInsights — risky-claim suppression seam (R4 T3, ratified decision 4)', () => {
  beforeEach(() => {
    getDocs.mockReset();
    setDoc.mockClear();
  });

  // The "gate OFF: no counterfactual or belief_dissonance insight reaches
  // `active`" test was deleted here (R4-P3 per P3-D1) — those two insight
  // types no longer exist at all post-deletion, so the assertion is moot;
  // superseded by claims+experiments. Legacy Firestore belief docs may
  // remain, harmless.

  it('gate OFF: a surfaced recommendation is relabeled as a generic idea — no score, no personalized reasoning', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    const idea = result.insights.find((i) => i.type === 'intervention');

    expect(idea).toBeTruthy();
    expect(idea.title).toBe('An Idea to Try');
    expect(idea.score).toBeUndefined();
    expect(idea.reasoning).not.toMatch(/historically|your mood|your HRV/i);
  });

  it('gate ON (test-only override): a surfaced recommendation is fully personalized ("Recommended Action"), proving the scale-corrected code works underneath the gate', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1', { riskyClaimsEnabled: true });

    // (counterfactual/belief_dissonance surfacing assertions removed here —
    // R4-P3 per P3-D1, see file header.)
    const idea = result.insights.find((i) => i.type === 'intervention');
    expect(idea.title).toBe('Recommended Action');
  });

  it('real call chain: detectMetaPatterns + generateMetaPatternInsight (crossThreadDetector, NOT mocked) produce a meta_pattern insight through orchestrator\'s actual synthesisContext shape', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');

    // Before the seam fix, generateMetaPatternInsight destructured
    // `threads`/`entries` off a context object that only has
    // `activeThreads`/`recentEntries` — both were `undefined`,
    // `affectedThreads` was always `[]`, and the function always returned
    // `null` before ever calling the LLM. This assertion fails on the old
    // code and passes on the fixed seam.
    const metaInsight = result.insights.find((i) => i.type === 'meta_pattern');
    expect(metaInsight).toBeTruthy();
    expect(metaInsight.title).toBe('The Waiting Room Loop');
    expect(metaInsight.affectedThreads).toEqual(
      expect.arrayContaining(['thread-career', 'thread-relationship'])
    );
  });
});

describe('generateRecommendations — MIN_EVIDENCE_OCCURRENCES (R4 T3, DR finding 7)', () => {
  it('does not recommend an intervention with fewer than MIN_EVIDENCE_OCCURRENCES tracked occurrences, even with favorable context boosts', async () => {
    const { getInterventionData } = await import('../layer4/interventionTracker');
    getInterventionData.mockResolvedValueOnce({
      interventions: {
        // Only ONE tracked occurrence ever — old code would still start
        // scoreRecommendation at a neutral 0.5 and could clear the
        // recommend threshold via boosts alone.
        gym: { category: 'physical', totalOccurrences: 1, effectiveness: { global: { score: 0.5 } } },
      },
    });

    const recs = await generateRecommendations('user-1', {
      currentState: { primary: 'stable' },
      whoopToday: null,
      recentMood: 0.5,
      timeOfDay: 'morning',
      riskyClaimsEnabled: true,
    });

    expect(recs.find((r) => r.intervention === 'gym')).toBeUndefined();
  });
});
