/**
 * Nexus insight dismissal persistence (R4 Task 5 + T5b fix, DR finding 10).
 *
 * Covers:
 *  - `dismissalKeyFor` (pure, per insight-type derivation) — the T5b fix:
 *    causal-synthesis/recommendation/entity-correlation ids churn every
 *    generation (`Date.now()`-minted), so dismissal must key on
 *    content-derived stable keys for those types, not the raw id.
 *  - `recordInsightDismissal`/`getDismissedKeys` — the write payload
 *    (dismissed/dismissedAt/dismissalKey/insightId — accepted as-is by
 *    firestore.rules' unconstrained `nexus/{nexusDocId}/insight_engagement/
 *    {engagementId}` owner-read/write rule, no shape validation exists to
 *    violate) and the read-side key extraction.
 *  - `orchestrator.js`'s `getCachedInsights` read-time consumption seam:
 *    dismiss -> regenerate with the SAME content but a churned id -> still
 *    filtered; reworded content -> legitimately resurfaces (documented
 *    boundary); stable-id types (pattern_*) keep working exactly as T5
 *    shipped them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

// `insightsDoc` backs the nexus/insights cache doc `getCachedInsights`
// reads via `getDoc`. `engagementStore` backs the
// nexus/insights/insight_engagement subcollection `recordInsightDismissal`/
// `getDismissedKeys` read/write via setDoc/getDocs, keyed by dismissalKey
// (the doc id passed to `doc(collectionRef, key)`).
let insightsDoc = null;
const engagementStore = new Map();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((...args) => ({ __kind: 'doc', __id: args[args.length - 1] })),
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

// beliefDissonance.js / counterfactual.js mocks deleted R4-P3 per P3-D1
// (superseded by claims+experiments; legacy Firestore belief docs may
// remain, harmless). layer4/interventionTracker.js mock deleted R4-P3
// Task 5 per P3-D1 — the module is deleted whole; orchestrator.js no
// longer imports it.

vi.mock('../layer4/recommendationEngine', () => ({
  generateRecommendations: vi.fn(async () => []),
}));

vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn(async () => new Set()),
}));

const { dismissalKeyFor, recordInsightDismissal, getDismissedKeys } = await import('../insightDismissal');
const { getCachedInsights } = await import('../orchestrator');

beforeEach(() => {
  insightsDoc = null;
  engagementStore.clear();
  vi.clearAllMocks();
});

describe('dismissalKeyFor — per-type stable key derivation (T5b fix)', () => {
  it('causal synthesis (insight_<timestamp> ids): keys on normalized title, ignoring the churning id', () => {
    const a = { id: 'insight_1721600000000', type: 'causal', title: 'Evening walks calm you down', summary: 'x' };
    const b = { id: 'insight_1721699999999', type: 'causal', title: '  Evening   walks calm you down  ', summary: 'x' };
    expect(dismissalKeyFor(a)).toBe(dismissalKeyFor(b));
    expect(dismissalKeyFor(a)).toBe('synthesis:evening walks calm you down');
  });

  it('causal synthesis: a genuinely reworded title produces a different key (documented boundary — legitimately resurfaces)', () => {
    const original = { id: 'insight_1', title: 'Evening walks calm you down' };
    const reworded = { id: 'insight_2', title: 'Morning runs lift your mood' };
    expect(dismissalKeyFor(original)).not.toBe(dismissalKeyFor(reworded));
  });

  it('recommendations (recommendation_<timestamp> ids): keys on the stable `intervention` field, ignoring the churning id', () => {
    const a = { id: 'recommendation_1721600000000', type: 'intervention', title: 'An Idea to Try', intervention: 'pet_walk' };
    const b = { id: 'recommendation_1721699999999', type: 'intervention', title: 'An Idea to Try', intervention: 'pet_walk' };
    expect(dismissalKeyFor(a)).toBe(dismissalKeyFor(b));
    expect(dismissalKeyFor(a)).toBe('recommendation:pet_walk');
  });

  it('recommendations: a different intervention produces a different key', () => {
    const a = { id: 'recommendation_1', intervention: 'pet_walk' };
    const b = { id: 'recommendation_2', intervention: 'acts_of_service' };
    expect(dismissalKeyFor(a)).not.toBe(dismissalKeyFor(b));
  });

  it('entity correlations (entity_<name>_<timestamp> ids): keys on normalized entity name + direction, ignoring the churning id', () => {
    const a = {
      id: 'entity_sarah_1721600000000',
      type: 'entity_correlation',
      title: 'Sarah Effect',
      evidence: { statistical: { moodDelta: 15 } },
    };
    const b = {
      id: 'entity_sarah_1721699999999',
      type: 'entity_correlation',
      title: 'Sarah Effect',
      evidence: { statistical: { moodDelta: 22 } },
    };
    expect(dismissalKeyFor(a)).toBe(dismissalKeyFor(b));
    expect(dismissalKeyFor(a)).toBe('entity_correlation:sarah:boosts');
  });

  it('entity correlations: direction flips the key (boosts vs lowers are different claims)', () => {
    const boosts = { id: 'entity_sarah_1', title: 'Sarah Effect', evidence: { statistical: { moodDelta: 15 } } };
    const lowers = { id: 'entity_sarah_2', title: 'Sarah Effect', evidence: { statistical: { moodDelta: -15 } } };
    expect(dismissalKeyFor(boosts)).not.toBe(dismissalKeyFor(lowers));
  });

  it('already-stable ids (pattern_*, calibration, cross-thread hardcoded ids) use the id itself, unchanged from T5', () => {
    expect(dismissalKeyFor({ id: 'pattern_journaling_frequency' })).toBe('pattern_journaling_frequency');
    expect(dismissalKeyFor({ id: 'calibration' })).toBe('calibration');
    expect(dismissalKeyFor({ id: 'control_anxiety' })).toBe('control_anxiety');
  });

  it('returns null for a missing/non-string id (nothing stable to key on)', () => {
    expect(dismissalKeyFor({})).toBeNull();
    expect(dismissalKeyFor({ message: 'no id here' })).toBeNull();
    expect(dismissalKeyFor(null)).toBeNull();
  });
});

describe('recordInsightDismissal', () => {
  it('writes {dismissed, dismissedAt, dismissalKey, insightId} keyed by the DISMISSAL KEY (not the raw id), merge:true', async () => {
    const insight = { id: 'insight_1721600000000', title: 'Evening walks calm you down' };
    const ok = await recordInsightDismissal('user-1', insight);
    expect(ok).toBe(true);

    const key = dismissalKeyFor(insight);
    expect(key).toBe('synthesis:evening walks calm you down');
    const written = engagementStore.get(key);
    expect(written).toMatchObject({
      dismissed: true,
      dismissalKey: key,
      insightId: 'insight_1721600000000',
    });
    expect(written.dismissedAt).toBeTruthy();
    // Nothing was written under the raw id — proves the pre-T5b id-keyed
    // no-op bug is actually closed, not just papered over.
    expect(engagementStore.has('insight_1721600000000')).toBe(false);
  });

  it('is a no-op false when userId is missing or no dismissal key can be derived', async () => {
    expect(await recordInsightDismissal(null, { id: 'pattern_x' })).toBe(false);
    expect(await recordInsightDismissal('user-1', {})).toBe(false);
  });
});

describe('getDismissedKeys', () => {
  it('returns only dismissalKeys whose doc has dismissed:true', async () => {
    engagementStore.set('pattern_a', { dismissed: true, dismissalKey: 'pattern_a' });
    engagementStore.set('pattern_b', { dismissed: false, dismissalKey: 'pattern_b' });
    const keys = await getDismissedKeys('user-1');
    expect(keys).toEqual(new Set(['pattern_a']));
  });
});

describe('getCachedInsights — dismissal survives id churn AND regeneration (T5b)', () => {
  it('a dismissed causal-synthesis insight stays filtered when regenerated with the SAME content but a NEW Date.now id', async () => {
    const originalInsight = { id: 'insight_1721600000000', title: 'Evening walks calm you down', summary: 'calmer' };
    await recordInsightDismissal('user-1', originalInsight);

    // Regeneration minted a brand-new id for the identical claim — exactly
    // what happens on Nexus's 30-minute auto-refresh.
    insightsDoc = {
      active: [
        { id: 'insight_1721699999999', title: 'Evening walks calm you down', summary: 'calmer' },
        { id: 'pattern_sleep', title: 'Sleep pattern' },
      ],
      history: [],
      generatedAt: { toMillis: () => Date.now() },
      stale: false,
    };

    const cached = await getCachedInsights('user-1');
    expect(cached.insights.map((i) => i.id)).toEqual(['pattern_sleep']);
  });

  it('reworded content legitimately resurfaces (documented boundary — different key, treated as a new claim)', async () => {
    await recordInsightDismissal('user-1', { id: 'insight_1', title: 'Evening walks calm you down' });

    insightsDoc = {
      active: [{ id: 'insight_2', title: 'Morning runs lift your mood' }],
      history: [],
      generatedAt: { toMillis: () => Date.now() },
      stale: false,
    };

    const cached = await getCachedInsights('user-1');
    expect(cached.insights.map((i) => i.id)).toEqual(['insight_2']);
  });

  it('stable-id types (pattern_*) keep working exactly as T5 shipped them', async () => {
    await recordInsightDismissal('user-1', { id: 'pattern_anxiety', title: 'Anxiety pattern' });

    insightsDoc = {
      active: [
        { id: 'pattern_anxiety', title: 'Anxiety pattern' },
        { id: 'pattern_sleep', title: 'Sleep pattern' },
      ],
      history: [{ id: 'pattern_anxiety', title: 'Anxiety pattern (older)' }],
      generatedAt: { toMillis: () => Date.now() },
      stale: false,
    };

    const cached = await getCachedInsights('user-1');
    expect(cached.insights.map((i) => i.id)).toEqual(['pattern_sleep']);
    expect(cached.history).toEqual([]);
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
