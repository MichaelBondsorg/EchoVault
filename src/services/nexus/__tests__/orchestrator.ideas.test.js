/**
 * R4 Phase 3 Task 5 (P3-D1) — was `orchestrator.riskyClaims.test.js`,
 * retired/renamed: `RISKY_CLAIMS_ENABLED` and `interventionTracker.js` are
 * both deleted (docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md).
 * There is nothing left to gate ON, so the gate-ON test and the
 * MIN_EVIDENCE_OCCURRENCES describe block (both exercised deleted code
 * paths) are gone. What survives, relocated here:
 *
 *  1. Ideas always surface generically: a recommendation insight is always
 *     titled 'An Idea to Try', and never carries a score, expectedOutcome,
 *     or personalized-evidence wording. There is no gate anymore — this is
 *     the only behavior.
 *  2. The real crossThreadDetector call chain (`detectMetaPatterns` +
 *     `generateMetaPatternInsight`, NOT mocked here) through orchestrator's
 *     actual `synthesisContext` shape. This assertion has nothing to do
 *     with risky claims — it was co-located here (not in
 *     `layer3/__tests__/crossThreadDetector.test.js`) because it needs
 *     orchestrator's full mock harness (whoop, gapDetector, threadManager,
 *     stateDetector, baselineManager, sourceExclusions, firestore) to
 *     exercise the REAL context-shape seam end-to-end; crossThreadDetector's
 *     own test file unit-tests the same fix directly against a hand-built
 *     context, with none of that harness, so duplicating it there would add
 *     mocking weight without new coverage. Kept here under its own
 *     non-risky describe block per this task's relocation choice — not
 *     dropped.
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

// Layer 3 synthesis is mocked so this file stays focused on (a) the ideas
// contract and (b) the REAL crossThreadDetector call chain (deliberately
// NOT mocked below). beliefDissonance.js / counterfactual.js mocks deleted
// R4-P3 per P3-D1 (superseded by claims+experiments; legacy Firestore
// belief docs may remain, harmless).
vi.mock('../layer3/synthesizer', () => ({
  INSIGHT_TYPES: {},
  generateCausalSynthesis: vi.fn(async () => ({ success: false })),
  generateNarrativeArcInsight: vi.fn(async () => null),
}));

// layer4/interventionTracker.js mock deleted R4-P3 Task 5 per P3-D1 — the
// module is deleted whole; recommendationEngine.js no longer imports it,
// so `generateRecommendations` runs for real here with zero mocking.

// callGemini mocked once, shared by the real synthesizer/crossThreadDetector
// call chain exercised in the meta-pattern test below.
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

function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const DAY_MS = 24 * 60 * 60 * 1000;
  // >=10 entries: the causal-synthesis block gates on `entries.length >= 10`.
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

describe('generateInsights — ideas always generic (R4-P3 Task 5, RISKY_CLAIMS_ENABLED retired)', () => {
  beforeEach(() => {
    getDocs.mockReset();
    setDoc.mockClear();
  });

  it('a surfaced recommendation is always titled "An Idea to Try" — no score, no expectedOutcome, no personalized reasoning', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1');
    const idea = result.insights.find((i) => i.type === 'intervention');

    expect(idea).toBeTruthy();
    expect(idea.title).toBe('An Idea to Try');
    expect(idea.score).toBeUndefined();
    expect(idea.expectedOutcome).toBeUndefined();
    expect(idea.reasoning).not.toMatch(/historically|your mood|your HRV/i);
  });

  it('passing a (now-inert) riskyClaimsEnabled option changes nothing — the seam is retired, not just defaulted', async () => {
    getDocs.mockResolvedValueOnce(mockEntriesSnapshot(buildEntries()));

    const result = await generateInsights('user-1', { riskyClaimsEnabled: true });
    const idea = result.insights.find((i) => i.type === 'intervention');

    expect(idea.title).toBe('An Idea to Try');
    expect(idea.score).toBeUndefined();
    expect(idea.expectedOutcome).toBeUndefined();
  });
});

describe('generateInsights — real call chain: crossThreadDetector meta-pattern (relocated from the former risky-claims file, non-risky)', () => {
  beforeEach(() => {
    getDocs.mockReset();
    setDoc.mockClear();
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
