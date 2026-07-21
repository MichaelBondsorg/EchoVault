/**
 * Source-exclusion filtering for insightReassessment.js's own
 * `fetchRecentEntries` (R2 Task 10 — the "both compose" requirement: BOTH
 * fetchRecentEntries implementations in the codebase must drop excluded
 * ids). This one has no scope filter of its own (unlike orchestrator.js's),
 * so the exclusion filter is applied directly after the Firestore fetch.
 *
 * Everything with a Firestore/health/LLM dependency is mocked — this file
 * only exercises the exported `fetchRecentEntries` function directly, not
 * the full `triggerInsightReassessment` pipeline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({
  auth: {},
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn((...args) => ({ __args: args })),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  Timestamp: { now: vi.fn(() => ({})), fromMillis: vi.fn(() => ({})) },
}));

vi.mock('../../nexus/layer2/baselineManager', () => ({
  calculateAndSaveBaselines: vi.fn(async () => {}),
  getBaselines: vi.fn(async () => null),
}));

vi.mock('../../nexus/layer1/patternDetector', () => ({
  detectPatternsInPeriod: vi.fn(async () => ({ aggregated: {}, rawPatterns: [] })),
}));

vi.mock('../../health/healthMoodCorrelation', () => ({
  analyzeHealthMoodCorrelations: vi.fn(() => ({})),
}));

vi.mock('../../health/whoop', () => ({
  getWhoopHistory: vi.fn(async () => ({ available: false, days: [] })),
  isWhoopLinked: vi.fn(async () => false),
}));

vi.mock('../../nexus/orchestrator', () => ({
  generateInsights: vi.fn(async () => ({ success: true, insights: [] })),
}));

vi.mock('../../insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn(async () => new Set()),
}));

const { getDocs } = await import('firebase/firestore');
const { fetchRecentEntries } = await import('../insightReassessment.js');

function mockSnapshot(entries) {
  return { docs: entries.map((e) => ({ id: e.id, data: () => ({ ...e }) })) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insightReassessment fetchRecentEntries - exclusion filter (R2 Task 10)', () => {
  it('drops entries whose id is in excludedIds', async () => {
    getDocs.mockResolvedValueOnce(mockSnapshot([
      { id: 'entry-1', text: 'a' },
      { id: 'entry-2', text: 'b' },
      { id: 'entry-3', text: 'c' },
    ]));

    const result = await fetchRecentEntries('user-1', 90, new Set(['entry-2']));
    expect(result.map((e) => e.id).sort()).toEqual(['entry-1', 'entry-3']);
  });

  it('is a no-op when excludedIds is null (default)', async () => {
    getDocs.mockResolvedValueOnce(mockSnapshot([
      { id: 'entry-1', text: 'a' },
      { id: 'entry-2', text: 'b' },
    ]));

    const result = await fetchRecentEntries('user-1', 90);
    expect(result.map((e) => e.id).sort()).toEqual(['entry-1', 'entry-2']);
  });

  it('is a no-op when excludedIds is an empty Set', async () => {
    getDocs.mockResolvedValueOnce(mockSnapshot([
      { id: 'entry-1', text: 'a' },
    ]));

    const result = await fetchRecentEntries('user-1', 90, new Set());
    expect(result.map((e) => e.id)).toEqual(['entry-1']);
  });
});
