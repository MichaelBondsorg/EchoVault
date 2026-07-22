/**
 * feedbackLearning.js — R4 Task 5 (DR finding 10: "feedback is stored but
 * never consumed").
 *
 * Two independent bugs closed here:
 *  1. `filterFalsePositiveCandidates` (new): generation candidates weren't
 *     filtered against `falsePositiveEntryIds`/`falsePositivePatterns` at
 *     all — a false-positive-flagged pattern's insight kept resurfacing
 *     every generation.
 *  2. The suppression resurfacing bug: `entriesAtLastEvaluation` was only
 *     ever written by `getPatternLearning`'s default-structure literal (0,
 *     forever) — nothing updated it — so `newEntries = currentEntryCount -
 *     0` cleared `MIN_NEW_ENTRIES_FOR_REEVALUATION` (5) on literally the
 *     very next read regardless of whether any new entries had actually
 *     been added since suppression. `recordFeedbackAndLearn` now stamps
 *     `entriesAtLastEvaluation` the moment a pattern transitions into
 *     suppression, when the caller supplies a `currentEntryCount`.
 *
 * Firestore is faked with a simple in-memory Map keyed by patternType (the
 * doc id `getLearningRef`/`getLearningCollectionRef` always resolve to),
 * so `recordFeedbackAndLearn`/`getPatternLearning`/`getAllPatternLearning`
 * all run for real against it — no behavior here is mocked away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const store = new Map();

vi.mock('firebase/firestore', () => ({
  // Doc path args end with the patternType (see getLearningRef) — captured
  // on the ref so getDoc/setDoc below can key off it without re-parsing.
  doc: (...args) => ({ __patternType: args[args.length - 1] }),
  collection: () => ({ __collection: true }),
  getDoc: vi.fn(async (ref) => {
    const data = store.get(ref.__patternType);
    return { exists: () => data !== undefined, data: () => data };
  }),
  setDoc: vi.fn(async (ref, data) => {
    store.set(ref.__patternType, { ...data });
  }),
  getDocs: vi.fn(async () => ({
    forEach: (cb) => {
      for (const [id, data] of store.entries()) cb({ id, data: () => data });
    },
  })),
  query: vi.fn((...args) => args),
  where: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

const {
  recordFeedbackAndLearn,
  filterInsightsByLearning,
  filterFalsePositiveCandidates,
} = await import('../feedbackLearning');

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe('resurfacing bug fix (DR finding 10)', () => {
  it('suppression holds when regenerated against the SAME entry count, and re-evaluates once genuinely new entries exist', async () => {
    // 3 inaccurate feedback events -> accuracyRate 0 < 0.4 threshold ->
    // suppresses on the 3rd call. currentEntryCount=20 stamps the baseline.
    for (let i = 0; i < 3; i++) {
      await recordFeedbackAndLearn(
        'user-1',
        { insightId: 'weekend_insight', feedback: 'inaccurate', moodDelta: 10 },
        [],
        20
      );
    }

    const stored = store.get('weekend_insight');
    expect(stored.suppressed).toBe(true);
    expect(stored.entriesAtLastEvaluation).toBe(20);

    const candidate = { id: 'weekend_insight', moodDelta: 10 };

    // Regenerate with the SAME entry count (no new entries at all) -> stays
    // suppressed. Before the fix, this would have shown it immediately
    // (newEntries computed as 20 - 0 = 20 >= 5).
    const sameCount = await filterInsightsByLearning('user-1', [candidate], 20);
    expect(sameCount[0]._showDecision).toEqual({ show: false, adjustedConfidence: 0, reason: 'suppressed' });

    // Regenerate again with still-insufficient new entries (below the
    // MIN_NEW_ENTRIES_FOR_REEVALUATION=5 threshold) -> still suppressed.
    const almostThere = await filterInsightsByLearning('user-1', [candidate], 24);
    expect(almostThere[0]._showDecision.show).toBe(false);

    // Regenerate with genuinely new entries (>= 5 more than the baseline)
    // -> re-evaluates.
    const moreEntries = await filterInsightsByLearning('user-1', [candidate], 26);
    expect(moreEntries[0]._showDecision.show).toBe(true);
    expect(moreEntries[0]._showDecision.reason).toBe('new_data_reevaluation');
  });

  it('omitting currentEntryCount leaves entriesAtLastEvaluation at its default (backward-compatible, unchanged pre-fix behavior for callers that opt out)', async () => {
    for (let i = 0; i < 3; i++) {
      await recordFeedbackAndLearn(
        'user-2',
        { insightId: 'no_count_pattern', feedback: 'inaccurate', moodDelta: 10 },
        []
      );
    }
    const stored = store.get('no_count_pattern');
    expect(stored.suppressed).toBe(true);
    expect(stored.entriesAtLastEvaluation).toBe(0);
  });
});

describe('filterFalsePositiveCandidates (DR finding 10 — falsePositiveEntryIds/falsePositivePatterns consumed)', () => {
  it('keeps a candidate byte-identical when no learning doc exists for its pattern at all', async () => {
    const candidates = [{ id: 'activity_yoga', activityKey: 'yoga', entryIds: ['e1'] }];
    const result = await filterFalsePositiveCandidates('user-3', candidates, new Map());
    expect(result).toEqual(candidates);
  });

  it('drops a candidate whose entryIds are ALL recorded false positives for that pattern', async () => {
    store.set('activity_yoga', {
      patternType: 'activity_yoga',
      falsePositiveEntryIds: ['e1'],
      falsePositivePatterns: [],
    });
    const candidates = [{ id: 'activity_yoga', activityKey: 'yoga', entryIds: ['e1'] }];
    const result = await filterFalsePositiveCandidates('user-3', candidates, new Map());
    expect(result).toEqual([]);
  });

  it('keeps a candidate when only SOME of its entryIds are flagged false positive', async () => {
    store.set('activity_yoga', {
      falsePositiveEntryIds: ['e1'],
      falsePositivePatterns: [],
    });
    const candidates = [{ id: 'activity_yoga', activityKey: 'yoga', entryIds: ['e1', 'e2'] }];
    const result = await filterFalsePositiveCandidates('user-3', candidates, new Map());
    expect(result).toEqual(candidates);
  });

  it('drops a candidate whose backing entry text matches a recorded false-positive text pattern', async () => {
    store.set('activity_yoga', {
      falsePositiveEntryIds: [],
      falsePositivePatterns: [{ pattern: 'working on', frequency: 4 }],
    });
    const entriesById = new Map([['e9', { text: 'Working on the yoga app today.' }]]);
    const candidates = [{ id: 'activity_yoga', activityKey: 'yoga', entryIds: ['e9'] }];
    const result = await filterFalsePositiveCandidates('user-3', candidates, entriesById);
    expect(result).toEqual([]);
  });

  it('leaves candidates with no entryIds untouched even against a false-positive-heavy learning doc', async () => {
    store.set('health_sleep', { falsePositiveEntryIds: ['e1'], falsePositivePatterns: [] });
    const candidates = [{ id: 'health_sleep', category: 'health' }];
    const result = await filterFalsePositiveCandidates('user-3', candidates, new Map());
    expect(result).toEqual(candidates);
  });
});

describe('filterInsightsByLearning — no-learning-doc behavior stays byte-identical', () => {
  it('returns full-confidence show:true with no learning doc for the pattern', async () => {
    const insight = { id: 'brand_new_pattern', moodDelta: 5 };
    const result = await filterInsightsByLearning('user-4', [insight], 100);
    expect(result[0]._showDecision).toEqual({ show: true, adjustedConfidence: 1.0, reason: 'no_feedback' });
  });
});
