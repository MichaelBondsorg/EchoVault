/**
 * Basic Insights — false-positive candidate filtering (R4 Task 5, DR
 * finding 10).
 *
 * Proves the wiring in `generateBasicInsights`, not just
 * `filterFalsePositiveCandidates` in isolation (that's covered directly in
 * `feedbackLearning.test.js`): a candidate whose entryIds are entirely
 * explained by a recorded false-positive learning doc never reaches
 * `result.insights`, applied PRE-scoring/receipt-attachment, using the
 * REAL `feedbackLearning` module (only Firestore is mocked, via a simple
 * in-memory store) so this can't drift from the real filter's behavior.
 * `filterInsightsByLearning` (confidence/suppression) is stubbed to a pure
 * pass-through so this file stays focused on the false-positive seam,
 * mirroring the precedent in `basicInsightsOrchestrator.receipts.test.js`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const learningStore = new Map();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  // generateBasicInsights' OWN cache doc read/write (unrelated to
  // insightLearning) — always "no cache" here, this test doesn't exercise
  // caching.
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  collection: vi.fn(() => ({})),
  // getAllPatternLearning's only real read path — returns whatever
  // `learningStore` holds for this test.
  getDocs: vi.fn(async () => ({
    forEach: (cb) => {
      for (const [id, data] of learningStore.entries()) cb({ id, data: () => data });
    },
  })),
  query: vi.fn(),
  where: vi.fn(),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// filterInsightsByLearning (confidence/suppression) stays a pass-through —
// only filterFalsePositiveCandidates (the real module) is under test here.
vi.mock('../feedbackLearning', async () => {
  const actual = await vi.importActual('../feedbackLearning');
  return {
    ...actual,
    filterInsightsByLearning: vi.fn(async (userId, insights) =>
      insights.map((i) => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1 } }))
    ),
  };
});

const { generateBasicInsights } = await import('../basicInsightsOrchestrator');

const DAY_MS = 24 * 60 * 60 * 1000;

function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  const entries = [];
  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `yoga-${i}`,
      createdAt: new Date(now - i * DAY_MS).toISOString(),
      text: `Did yoga this morning, feeling solid. Entry number ${i}.`,
      analysis: { mood_score: 0.9 },
    });
  }
  for (let i = 0; i < 5; i++) {
    entries.push({
      id: `neutral-${i}`,
      createdAt: new Date(now - (i + 5) * DAY_MS).toISOString(),
      text: `A regular day. Nothing special. Entry number ${i}.`,
      analysis: { mood_score: 0.5 },
    });
  }
  return entries;
}

beforeEach(() => {
  learningStore.clear();
  vi.clearAllMocks();
});

describe('generateBasicInsights — false-positive candidate filtering (R4 Task 5)', () => {
  it('candidate present when no learning doc exists for its pattern', async () => {
    const result = await generateBasicInsights('user-1', buildEntries());
    const activityInsight = result.insights.find((i) => i.category === 'activity');
    expect(activityInsight).toBeTruthy();
    expect(activityInsight.activityKey).toBe('yoga');
  });

  it('candidate absent once its exact entryIds are recorded as false positives for that pattern', async () => {
    learningStore.set('activity_yoga', {
      patternType: 'activity_yoga',
      falsePositiveEntryIds: ['yoga-0', 'yoga-1', 'yoga-2', 'yoga-3', 'yoga-4'],
      falsePositivePatterns: [],
    });

    const result = await generateBasicInsights('user-1', buildEntries());
    const activityInsight = result.insights.find((i) => i.category === 'activity');
    expect(activityInsight).toBeUndefined();
  });
});
