/**
 * useBasicInsights — source exclusions wiring (R2 final review, Important 2a).
 *
 * Before this fix, `useBasicInsights` passed the raw `entries` array straight
 * into `generateBasicInsights`, never consulting
 * `src/services/insights/sourceExclusions.js` — a permanently-excluded entry
 * (appliesTo:'all') kept feeding basic-insight generation even though the
 * exact same exclusion already worked for Nexus.
 *
 * Integration style: `sourceExclusions.js` (the real module) is exercised
 * against a mocked `config/firebase` (controllable `getDocs`/`collection`),
 * and `generateBasicInsights` is spied at the boundary via `vi.importActual`
 * + `vi.fn(actual.generateBasicInsights)` so the REAL generator runs (real
 * correlation math, real receipts) — the spy only lets us inspect the
 * `entries` argument the hook actually handed it, without re-mocking away
 * the invariant under test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// --- config/firebase: controllable Firestore surface for sourceExclusions.js
// (real, unmocked) and this hook's own `db` import. Both resolve to the same
// absolute file, so one mock covers both call sites.
const firebaseMocks = {
  db: {},
  collection: vi.fn((_db, path) => ({ __col: path })),
  getDocs: vi.fn(async () => ({ docs: [], forEach: (fn) => [].forEach(fn) })),
  doc: vi.fn((...args) => ({ __doc: args })),
  addDoc: vi.fn(async () => ({ id: 'x' })),
  deleteDoc: vi.fn(async () => {}),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((...args) => ({ __where: args })),
  limit: vi.fn((n) => ({ __limit: n })),
};
vi.mock('../../config/firebase', () => firebaseMocks);
vi.mock('../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

// --- generateBasicInsights: real implementation, wrapped in a spy so we can
// inspect what `entries` argument the hook actually passed, without
// mocking away the correlation logic itself.
vi.mock('../../services/basicInsights/basicInsightsOrchestrator', async () => {
  const actual = await vi.importActual('../../services/basicInsights/basicInsightsOrchestrator');
  return {
    ...actual,
    generateBasicInsights: vi.fn(actual.generateBasicInsights),
  };
});

// basicInsightsOrchestrator.js itself talks to `firebase/firestore` directly
// (doc/getDoc/setDoc/deleteDoc/Timestamp) for its own cache doc — stub those
// so `saveBasicInsights` doesn't hit a real SDK.
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

// Feedback learning touches Firestore internally; stub to a pure pass-through
// (same precedent as basicInsightsOrchestrator.receipts.test.js) so this test
// stays focused on the exclusion-filtering seam, not learning suppression.
vi.mock('../../services/basicInsights/feedbackLearning', () => ({
  filterFalsePositiveCandidates: vi.fn(async (userId, insights) => insights),
  filterInsightsByLearning: vi.fn(async (userId, insights) =>
    insights.map((i) => ({ ...i, _showDecision: { show: true, adjustedConfidence: 1 } }))
  ),
}));

const { useBasicInsights } = await import('../useBasicInsights.js');
const { generateBasicInsights } = await import('../../services/basicInsights/basicInsightsOrchestrator');

const USER = { uid: 'user-1' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** 6 entries (above THRESHOLDS.MIN_ENTRIES=5) with mood data, one flagged as excluded. */
function buildEntries() {
  const now = Date.parse('2026-07-21T12:00:00.000Z');
  return Array.from({ length: 6 }, (_, i) => ({
    id: `e${i + 1}`,
    createdAt: new Date(now - i * DAY_MS).toISOString(),
    text: `Entry number ${i + 1}.`,
    analysis: { mood_score: 0.5 + (i % 2 === 0 ? 0.2 : -0.1) },
  }));
}

function docsSnapshot(rows) {
  return {
    docs: rows.map((r) => ({ data: () => r })),
    forEach(fn) { rows.forEach((r) => fn({ data: () => r })); },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  firebaseMocks.getDocs.mockResolvedValue(docsSnapshot([]));
});

describe('useBasicInsights — source exclusions (no exclusions present)', () => {
  it('passes the full entries array through unchanged when there are no exclusions', async () => {
    const entries = buildEntries();
    const { result } = renderHook(() => useBasicInsights(USER, entries, { autoRefresh: true, refreshOnMount: true }));

    await waitFor(() => expect(generateBasicInsights).toHaveBeenCalledTimes(1));

    const [, poolEntries] = generateBasicInsights.mock.calls[0];
    expect(poolEntries.map((e) => e.id).sort()).toEqual(entries.map((e) => e.id).sort());
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

describe('useBasicInsights — source exclusions (exclusion present)', () => {
  it('drops the excluded entry from the pool actually passed to the real generateBasicInsights', async () => {
    firebaseMocks.getDocs.mockResolvedValue(
      docsSnapshot([{ entryId: 'e3', appliesTo: 'all', reason: 'excluded_by_user', permanent: true }])
    );

    const entries = buildEntries();
    const { result } = renderHook(() => useBasicInsights(USER, entries, { autoRefresh: true, refreshOnMount: true }));

    await waitFor(() => expect(generateBasicInsights).toHaveBeenCalledTimes(1));

    const [uid, poolEntries] = generateBasicInsights.mock.calls[0];
    expect(uid).toBe(USER.uid);
    expect(poolEntries.map((e) => e.id)).not.toContain('e3');
    expect(poolEntries).toHaveLength(entries.length - 1);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('does not filter out a pattern-scoped exclusion (appliesTo !== "all") — only the all-surfaces exclusion removes an entry', async () => {
    firebaseMocks.getDocs.mockResolvedValue(
      docsSnapshot([{ entryId: 'e3', appliesTo: 'activity_yoga', reason: 'wrong_source', permanent: true }])
    );

    const entries = buildEntries();
    renderHook(() => useBasicInsights(USER, entries, { autoRefresh: true, refreshOnMount: true }));

    await waitFor(() => expect(generateBasicInsights).toHaveBeenCalledTimes(1));
    const [, poolEntries] = generateBasicInsights.mock.calls[0];
    expect(poolEntries.map((e) => e.id)).toContain('e3');
    expect(poolEntries).toHaveLength(entries.length);
  });
});

describe('useBasicInsights — exclusions read failure (fail-closed)', () => {
  it('never calls generateBasicInsights when the exclusions read throws, and surfaces an error instead of generating over the unfiltered pool', async () => {
    firebaseMocks.getDocs.mockRejectedValue(new Error('firestore unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const entries = buildEntries();
    const { result } = renderHook(() => useBasicInsights(USER, entries, { autoRefresh: true, refreshOnMount: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(generateBasicInsights).not.toHaveBeenCalled();
    expect(result.current.error).toBe('firestore unavailable');
    errorSpy.mockRestore();
  });
});

// Fix C (2026-07-24 brief): `refreshFromCache` is the read-only counterpart
// to `regenerate` — the unified "Rebuild insights" orchestration
// (rebuildInsights.js) already ran generateBasicInsights itself; this hook
// must be able to pull the fresh cache into its own displayed state WITHOUT
// triggering a second generation.
describe('useBasicInsights — refreshFromCache (Fix C)', () => {
  it('reads the cache doc (getDoc) without calling generateBasicInsights again', async () => {
    const { getDoc } = await import('firebase/firestore');
    const entries = buildEntries();
    const { result } = renderHook(() => useBasicInsights(USER, entries, { autoRefresh: true, refreshOnMount: true }));

    await waitFor(() => expect(generateBasicInsights).toHaveBeenCalledTimes(1));
    generateBasicInsights.mockClear();
    getDoc.mockClear();

    await act(async () => { await result.current.refreshFromCache(); });

    expect(generateBasicInsights).not.toHaveBeenCalled();
    expect(getDoc).toHaveBeenCalledTimes(1);
  });

  it('is a no-op with no user (never reads the cache)', async () => {
    const { getDoc } = await import('firebase/firestore');
    const { result } = renderHook(() => useBasicInsights(null, buildEntries()));
    getDoc.mockClear();

    await act(async () => { await result.current.refreshFromCache(); });

    expect(getDoc).not.toHaveBeenCalled();
  });
});
