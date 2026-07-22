/**
 * Nexus insight dismissal persistence (R4 Task 5, DR finding 10).
 *
 * Covers the module directly (`recordInsightDismissal`/
 * `getDismissedInsightIds`) AND the read-time consumption seam in
 * `orchestrator.js`'s `getCachedInsights`: dismiss -> the exact write is
 * asserted (payload matches what firestore.rules' `nexus/{nexusDocId}/
 * insight_engagement/{engagementId}` rule permits: owner read/write, no
 * shape constraint beyond that) -> a fresh `getCachedInsights` read excludes
 * the dismissed id from both `insights` (active) and `history`.
 *
 * `orchestrator.js` is imported for real (for `getCachedInsights`), so its
 * full unconditional import graph (layer1-4, health/whoop, gapDetector,
 * sourceExclusions) is mocked the same way the existing
 * orchestrator.*.test.js suite already does — none of it is exercised by
 * `getCachedInsights` itself, this just keeps import-time inert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

// `insightsDoc` backs the nexus/insights cache doc `getCachedInsights`
// reads via `getDoc`. `engagementStore` backs the
// nexus/insights/insight_engagement subcollection `recordInsightDismissal`/
// `getDismissedInsightIds` read/write via setDoc/getDocs. Kept as two
// separate fakes (rather than one undifferentiated mock) for the same
// reason orchestrator.exclusions.test.js's `doc` mock embeds a path: real
// (unmocked) `getDoc`/`getDocs` calls in this module hit two different
// logical collections and must not corrupt each other.
let insightsDoc = null;
const engagementStore = new Map();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => {
    // insightDismissal.js: doc(collectionRef, insightId) -> last arg is
    // the insightId. orchestrator.js's own doc(db, ..., 'nexus', 'insights')
    // calls don't need a getDoc distinguisher here since `insightsDoc` is
    // the only doc read through getDoc in this file.
    return { __kind: 'doc', __id: args[args.length - 1] };
  }),
  collection: vi.fn(() => ({ __kind: 'collection' })),
  getDoc: vi.fn(async () => ({
    exists: () => insightsDoc !== null,
    data: () => insightsDoc,
  })),
  setDoc: vi.fn(async (ref, data, opts) => {
    if (opts?.merge) {
      engagementStore.set(ref.__id, { ...(engagementStore.get(ref.__id) || {}), ...data });
    } else {
      engagementStore.set(ref.__id, data);
    }
  }),
  getDocs: vi.fn(async () => ({
    forEach: (cb) => {
      for (const [id, data] of engagementStore.entries()) cb({ id, data: () => data });
    },
  })),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
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
  generateCausalSynthesis: vi.fn(async () => ({ success: false })),
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
  generateRecommendations: vi.fn(async () => []),
}));

vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn(async () => new Set()),
}));

const { recordInsightDismissal, getDismissedInsightIds } = await import('../insightDismissal');
const { getCachedInsights } = await import('../orchestrator');

beforeEach(() => {
  insightsDoc = null;
  engagementStore.clear();
  vi.clearAllMocks();
});

describe('recordInsightDismissal', () => {
  it('writes {dismissed: true, dismissedAt} keyed by insightId, merge:true (idempotent)', async () => {
    const ok = await recordInsightDismissal('user-1', 'pattern_anxiety');
    expect(ok).toBe(true);
    expect(engagementStore.get('pattern_anxiety')).toMatchObject({ dismissed: true });
    expect(engagementStore.get('pattern_anxiety').dismissedAt).toBeTruthy();
  });

  it('is a no-op false when userId or insightId is missing', async () => {
    expect(await recordInsightDismissal(null, 'x')).toBe(false);
    expect(await recordInsightDismissal('user-1', null)).toBe(false);
  });
});

describe('getDismissedInsightIds', () => {
  it('returns only ids whose doc has dismissed:true', async () => {
    engagementStore.set('a', { dismissed: true });
    engagementStore.set('b', { dismissed: false });
    const ids = await getDismissedInsightIds('user-1');
    expect(ids).toEqual(new Set(['a']));
  });
});

describe('getCachedInsights — dismissal round-trip (read-time filter)', () => {
  it('a dismissed insight is excluded from both active and history on the next cached read', async () => {
    insightsDoc = {
      active: [
        { id: 'pattern_anxiety', title: 'Anxiety pattern' },
        { id: 'pattern_sleep', title: 'Sleep pattern' },
      ],
      history: [
        { id: 'pattern_anxiety', title: 'Anxiety pattern (older)' },
        { id: 'pattern_gratitude', title: 'Gratitude pattern' },
      ],
      generatedAt: { toMillis: () => Date.now() },
      stale: false,
    };

    // Before dismissing, both lists include pattern_anxiety.
    const before = await getCachedInsights('user-1');
    expect(before.insights.map((i) => i.id)).toContain('pattern_anxiety');
    expect(before.history.map((i) => i.id)).toContain('pattern_anxiety');

    const wrote = await recordInsightDismissal('user-1', 'pattern_anxiety');
    expect(wrote).toBe(true);

    const after = await getCachedInsights('user-1');
    expect(after.insights.map((i) => i.id)).toEqual(['pattern_sleep']);
    expect(after.history.map((i) => i.id)).toEqual(['pattern_gratitude']);
  });

  it('no dismissals at all -> byte-identical passthrough of active/history', async () => {
    insightsDoc = {
      active: [{ id: 'pattern_a' }],
      history: [{ id: 'pattern_b' }],
      generatedAt: { toMillis: () => Date.now() },
      stale: false,
    };
    const cached = await getCachedInsights('user-1');
    expect(cached.insights).toEqual([{ id: 'pattern_a' }]);
    expect(cached.history).toEqual([{ id: 'pattern_b' }]);
  });
});
