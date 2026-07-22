/**
 * Versioned cutover tests for basicInsights (R4 Task 6, ratified decision 2
 * — "legacy artifact cutover, not migration").
 *
 * basicInsights has no active/history split (unlike Nexus) — its cache doc
 * is a single flat `basicInsights/current` doc, wholesale-replaced on every
 * generation. There's nothing to "archive": the cutover here is (a) stamp
 * `generatorVersion` on every fresh cache doc, (b) treat an unversioned or
 * stale-versioned cached doc as stale so it's regenerated exactly once —
 * reusing `getCachedBasicInsights`'s existing TTL/entriesCount staleness
 * seam, not a new invalidation path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

// Feedback learning touches Firestore internally; stub it to a pure
// pass-through so this test stays focused on the version stamp, not
// learning (mirrors basicInsightsOrchestrator.receipts.test.js's own mock).
vi.mock('../feedbackLearning', () => ({
  filterFalsePositiveCandidates: vi.fn(async (userId, insights) => insights),
  filterInsightsByLearning: vi.fn(async (userId, insights) =>
    insights.map((i) => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1 } }))
  ),
}));

const { getDoc, setDoc } = await import('firebase/firestore');
const { generateBasicInsights, getCachedBasicInsights } = await import('../basicInsightsOrchestrator');
const { generatorVersion } = await import('../../insights/generatorVersion');

const DAY_MS = 24 * 60 * 60 * 1000;

// Same fixture shape as basicInsightsOrchestrator.receipts.test.js — enough
// real (unmocked) activity-correlation signal to produce a non-empty
// generation, so "stamped on the cache doc" isn't a vacuous check.
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
  vi.clearAllMocks();
  getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
});

describe('generateBasicInsights — stamps generatorVersion on the cache doc (R4 Task 6)', () => {
  it('the persisted setDoc payload carries the current generatorVersion', async () => {
    const result = await generateBasicInsights('user-cutover-bi-1', buildEntries());
    expect(result.success).toBe(true);
    expect(result.generatorVersion).toBe(generatorVersion);

    const persistCall = setDoc.mock.calls.find((call) => call[1] && Array.isArray(call[1].insights));
    expect(persistCall).toBeTruthy();
    expect(persistCall[1].generatorVersion).toBe(generatorVersion);
  });

  it('never writes to insightLearning, insight_exclusions, or source_exclusions — only its own basicInsights/current doc', async () => {
    await generateBasicInsights('user-cutover-bi-2', buildEntries());
    // Exactly one setDoc call in this pipeline (feedbackLearning's writes
    // are stubbed out above); this document is the ONLY thing generation
    // itself ever persists.
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('getCachedBasicInsights — version staleness (R4 Task 6)', () => {
  const freshTimestamp = { toMillis: () => Date.now() + 999999 };

  it('a cache doc with no generatorVersion field at all (pre-R4) is stale, even though TTL/entriesCount both say fresh', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        insights: [],
        expiresAt: freshTimestamp,
        entriesCount: 10,
        // no generatorVersion at all
      }),
    });

    const cached = await getCachedBasicInsights('user-1', 10);
    expect(cached.stale).toBe(true);
  });

  it('a cache doc stamped with an OLDER generatorVersion is stale', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        insights: [],
        expiresAt: freshTimestamp,
        entriesCount: 10,
        generatorVersion: generatorVersion - 1,
      }),
    });

    const cached = await getCachedBasicInsights('user-1', 10);
    expect(cached.stale).toBe(true);
  });

  it('a cache doc stamped with the CURRENT generatorVersion is NOT stale on version grounds (mutation-check control: proves this is a real version check, not "always stale")', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        insights: [],
        expiresAt: freshTimestamp,
        entriesCount: 10,
        generatorVersion,
      }),
    });

    const cached = await getCachedBasicInsights('user-1', 10);
    expect(cached.stale).toBe(false);
  });

  it('the version check does not override an otherwise-fresh doc\'s other staleness reasons independently (TTL/entriesCount still behave)', async () => {
    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        insights: [],
        expiresAt: { toMillis: () => Date.now() - 1 }, // expired
        entriesCount: 10,
        generatorVersion,
      }),
    });

    const cached = await getCachedBasicInsights('user-1', 10);
    expect(cached.stale).toBe(true); // stale via TTL, not version
  });
});
