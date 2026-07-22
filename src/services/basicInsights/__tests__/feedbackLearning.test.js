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
  setDoc: vi.fn(async (ref, data, opts) => {
    if (opts?.merge) {
      store.set(ref.__patternType, { ...(store.get(ref.__patternType) || {}), ...data });
    } else {
      store.set(ref.__patternType, { ...data });
    }
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
  shouldShowInsight,
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

  it('omitting currentEntryCount leaves entriesAtLastEvaluation unstamped at suppression time (the doc alone does not self-heal until it is next evaluated)', async () => {
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

describe('R4 T5b — suppression fails toward holding (lazy stamping)', () => {
  it("the reviewer's exact reproduction: omitting currentEntryCount at suppression time, then the very next filter call, still holds (does NOT resurface immediately)", async () => {
    for (let i = 0; i < 3; i++) {
      await recordFeedbackAndLearn(
        'user-5',
        { insightId: 'unstamped_pattern', feedback: 'inaccurate', moodDelta: 10 },
        []
        // currentEntryCount omitted -> entriesAtLastEvaluation left at 0
      );
    }
    expect(store.get('unstamped_pattern').entriesAtLastEvaluation).toBe(0);

    // Before the T5b fix: newEntries = 20 - 0 = 20 >= 5 -> would have shown
    // immediately on this very next call, with zero genuinely new entries.
    const result = await filterInsightsByLearning('user-5', [{ id: 'unstamped_pattern', moodDelta: 10 }], 20);
    expect(result[0]._showDecision).toEqual({ show: false, adjustedConfidence: 0, reason: 'suppressed' });

    // Self-heal: the doc now carries a real baseline for future reads.
    expect(store.get('unstamped_pattern').entriesAtLastEvaluation).toBe(20);
  });

  it('a pre-T5b legacy suppressed doc (entriesAtLastEvaluation absent entirely, not just 0) also holds and self-heals — zero migration needed', async () => {
    // Simulates a doc written before entriesAtLastEvaluation existed on the
    // schema at all (field absent, not defaulted to 0) — the `!!` check
    // must treat both the same way.
    store.set('legacy_pattern', {
      patternType: 'legacy_pattern',
      totalFeedback: 5,
      accurateFeedback: 0,
      inaccurateFeedback: 5,
      accuracyRate: 0,
      confidenceMultiplier: 0.3,
      suppressed: true,
      suppressedAt: { toMillis: () => Date.now() },
      suppressReason: 'low_accuracy',
      requiredMoodDeltaToResurface: 15,
      falsePositiveEntryIds: [],
      falsePositivePatterns: [],
      // entriesAtLastEvaluation intentionally omitted
    });

    const result = await filterInsightsByLearning('user-6', [{ id: 'legacy_pattern', moodDelta: 10 }], 500);
    expect(result[0]._showDecision.show).toBe(false);
    expect(store.get('legacy_pattern').entriesAtLastEvaluation).toBe(500);
  });

  it('a properly-stamped suppressed doc still re-evaluates normally once genuinely new entries exist (no regression from the lazy-stamp path)', async () => {
    store.set('stamped_pattern', {
      patternType: 'stamped_pattern',
      totalFeedback: 3,
      accurateFeedback: 0,
      accuracyRate: 0,
      confidenceMultiplier: 0.3,
      suppressed: true,
      suppressedAt: { toMillis: () => Date.now() },
      requiredMoodDeltaToResurface: 15,
      entriesAtLastEvaluation: 100,
    });

    const stillHolds = await filterInsightsByLearning('user-7', [{ id: 'stamped_pattern', moodDelta: 10 }], 102);
    expect(stillHolds[0]._showDecision.show).toBe(false);
    // No lazy-stamp side effect fires for an already-stamped doc — baseline
    // stays exactly as it was.
    expect(store.get('stamped_pattern').entriesAtLastEvaluation).toBe(100);

    const reevaluates = await filterInsightsByLearning('user-7', [{ id: 'stamped_pattern', moodDelta: 10 }], 106);
    expect(reevaluates[0]._showDecision.show).toBe(true);
    expect(reevaluates[0]._showDecision.reason).toBe('new_data_reevaluation');
  });

  it('shouldShowInsight (single-insight path) gets the same lazy-stamp fix as filterInsightsByLearning (shared logic, cannot drift)', async () => {
    store.set('single_path_pattern', {
      patternType: 'single_path_pattern',
      totalFeedback: 3,
      accuracyRate: 0,
      confidenceMultiplier: 0.3,
      suppressed: true,
      suppressedAt: { toMillis: () => Date.now() },
      requiredMoodDeltaToResurface: 15,
      // entriesAtLastEvaluation absent
    });

    const decision = await shouldShowInsight('user-8', { id: 'single_path_pattern', moodDelta: 10 }, 40);
    expect(decision).toEqual({ show: false, adjustedConfidence: 0, reason: 'suppressed' });
    expect(store.get('single_path_pattern').entriesAtLastEvaluation).toBe(40);
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
