import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const orchestratorMocks = {
  getCachedInsights: vi.fn(),
  generateInsights: vi.fn(),
};
vi.mock('../../services/nexus/orchestrator', () => orchestratorMocks);

const learningMocks = {
  getAllPatternLearning: vi.fn(async () => new Map()),
};
vi.mock('../../services/basicInsights/feedbackLearning', () => learningMocks);

let flagValue = false;
const flagsMocks = {
  getFlag: vi.fn(() => flagValue),
};
vi.mock('../../config/flags', () => flagsMocks);

vi.mock('../../config/firebase', () => ({ db: {} }));

const budgetMocks = {
  readBudgetMode: vi.fn(async () => 'balanced'),
  readShownLog: vi.fn(async () => []),
  applyInsightBudget: vi.fn((insights) => insights),
  recordShownInsights: vi.fn(async () => {}),
};
vi.mock('../../services/insights/insightBudget', () => budgetMocks);

const { useNexusInsights } = await import('../useNexusInsights.js');

const USER = { uid: 'user-1' };

function threeInsights() {
  return [
    { id: 'i1', title: 'One', type: 'pattern', confidence: 0.9, generatedAt: '2026-07-20T00:00:00.000Z' },
    { id: 'i2', title: 'Two', type: 'pattern', confidence: 0.8, generatedAt: '2026-07-19T00:00:00.000Z' },
    { id: 'i3', title: 'Three', type: 'pattern', confidence: 0.7, generatedAt: '2026-07-18T00:00:00.000Z' },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  flagValue = false;
  orchestratorMocks.getCachedInsights.mockResolvedValue({
    insights: threeInsights(),
    history: [],
    generatedAt: Date.now(),
    stale: false,
    expiresAt: Date.now() + 60 * 60 * 1000,
  });
  orchestratorMocks.generateInsights.mockResolvedValue({ success: true, insights: [], generatedAt: Date.now() });
  budgetMocks.readBudgetMode.mockResolvedValue('balanced');
  budgetMocks.readShownLog.mockResolvedValue([]);
  budgetMocks.applyInsightBudget.mockImplementation((insights) => insights);
  budgetMocks.recordShownInsights.mockResolvedValue(undefined);
});

describe('useNexusInsights - Insight Budget wiring (flag off)', () => {
  it('never touches the budget module and returns the untouched suppression-only insights list', async () => {
    flagValue = false;
    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.insights.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(budgetMocks.readBudgetMode).not.toHaveBeenCalled();
    expect(budgetMocks.readShownLog).not.toHaveBeenCalled();
    expect(budgetMocks.applyInsightBudget).not.toHaveBeenCalled();
    expect(budgetMocks.recordShownInsights).not.toHaveBeenCalled();
  });

  it('is a byte-identical (reference-equal) passthrough of the pre-budget array, not a copy that merely matches by value', async () => {
    flagValue = false;
    const { result, rerender } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    const firstInsights = result.current.insights;

    // Force another render with no state change (activeInsights/
    // historyInsights/learningData all stay the same references): the
    // pre-budget array (allInsights) is memoized, so on the flag-off path
    // `insights` must be the EXACT SAME array object, not a fresh copy that
    // simply happens to contain the same ids/values.
    act(() => { rerender(); });

    expect(result.current.insights).toBe(firstInsights);
  });
});

describe('useNexusInsights - Insight Budget wiring (flag on)', () => {
  it('reads mode + shownLog once, pipes post-suppression insights through applyInsightBudget, and records what is displayed', async () => {
    flagValue = true;
    budgetMocks.readBudgetMode.mockResolvedValue('quiet');
    budgetMocks.readShownLog.mockResolvedValue([{ id: 'old', theme: null, title: 'Old', shownAt: '2026-06-01T00:00:00.000Z' }]);
    budgetMocks.applyInsightBudget.mockImplementation((insights) => insights.slice(0, 1));

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(budgetMocks.readBudgetMode).toHaveBeenCalledWith({}, 'user-1'));
    expect(budgetMocks.readShownLog).toHaveBeenCalledWith({}, 'user-1');

    await waitFor(() => {
      expect(budgetMocks.applyInsightBudget).toHaveBeenCalled();
    });
    const [insightsArg, optionsArg] = budgetMocks.applyInsightBudget.mock.calls.at(-1);
    expect(insightsArg.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(optionsArg.mode).toBe('quiet');
    expect(optionsArg.shownLog).toEqual([{ id: 'old', theme: null, title: 'Old', shownAt: '2026-06-01T00:00:00.000Z' }]);

    expect(result.current.insights.map((i) => i.id)).toEqual(['i1']);

    await waitFor(() => expect(budgetMocks.recordShownInsights).toHaveBeenCalled());
    const [dbArg, uidArg, recordedArg] = budgetMocks.recordShownInsights.mock.calls[0];
    expect(dbArg).toEqual({});
    expect(uidArg).toBe('user-1');
    expect(recordedArg.map((i) => i.id)).toEqual(['i1']);
  });

  it('records each distinct id only once per mount, not on every re-render', async () => {
    flagValue = true;
    budgetMocks.applyInsightBudget.mockImplementation((insights) => insights);

    const { result, rerender } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(budgetMocks.recordShownInsights).toHaveBeenCalledTimes(1));

    rerender();
    rerender();

    // No new ids appeared, so no further recordShownInsights calls.
    expect(budgetMocks.recordShownInsights).toHaveBeenCalledTimes(1);
  });

  it('does not re-record an id already present in the persisted shownLog (persistent guard across remounts)', async () => {
    flagValue = true;
    // i1 was already shown and persisted in a previous mount/session — the
    // ref-based same-mount guard alone (a fresh empty Set on every mount)
    // would NOT catch this; only checking the freshly-read shownLog does.
    budgetMocks.readShownLog.mockResolvedValue([
      { id: 'i1', theme: null, title: 'One', shownAt: '2026-07-19T00:00:00.000Z' },
    ]);
    budgetMocks.applyInsightBudget.mockImplementation((insights) => insights);

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(budgetMocks.readShownLog).toHaveBeenCalled());

    await waitFor(() => expect(budgetMocks.recordShownInsights).toHaveBeenCalled());
    const [, , recordedArg] = budgetMocks.recordShownInsights.mock.calls[0];
    expect(recordedArg.map((i) => i.id)).not.toContain('i1');
    expect(recordedArg.map((i) => i.id).sort()).toEqual(['i2', 'i3']);
  });
});

describe('useNexusInsights - Insight Budget freshness (day-boundary drift fix)', () => {
  it('recomputes applyInsightBudget with a freshly-read `now` when the freshness tick fires (visibility bump) — nothing pins it to a stale closed-over timestamp', async () => {
    flagValue = true;
    budgetMocks.applyInsightBudget.mockImplementation((insights) => insights);

    const beforeMidnight = new Date('2026-07-20T23:59:55.000Z').getTime();
    const afterMidnight = new Date('2026-07-21T00:00:05.000Z').getTime();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(beforeMidnight);

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(budgetMocks.applyInsightBudget).toHaveBeenCalled());

    const firstNow = budgetMocks.applyInsightBudget.mock.calls.at(-1)[1].now;
    expect(firstNow).toBe(beforeMidnight);
    const callsBefore = budgetMocks.applyInsightBudget.mock.calls.length;

    // Cross midnight with no unrelated state change — only the freshness
    // tick (foregrounding) should force a re-evaluation with a fresh `now`.
    nowSpy.mockReturnValue(afterMidnight);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(budgetMocks.applyInsightBudget.mock.calls.length).toBeGreaterThan(callsBefore));
    const lastNow = budgetMocks.applyInsightBudget.mock.calls.at(-1)[1].now;
    expect(lastNow).toBe(afterMidnight);

    nowSpy.mockRestore();
  });

  it('does not touch applyInsightBudget on a freshness tick when the flag is off', async () => {
    flagValue = false;

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(budgetMocks.applyInsightBudget).not.toHaveBeenCalled();
  });
});

// Review finding (important, R4 Phase 2 Task 6): `enabled` (added so the
// unified ClaimFeed can disable this hook entirely with insightClaims ON —
// see the hook's own doc comment) had zero direct test coverage. These pin
// both the disabled no-op contract and that the (unchanged) default/enabled
// path keeps working.
describe('useNexusInsights - enabled option (R4 Phase 2 Task 6)', () => {
  it('enabled:false never fetches (cached insights, learning data, budget mode/log/record) and returns a stable, empty return shape', async () => {
    flagValue = true; // insightBudget ON too — proves the `enabled` gate wins over it, not just that budget was already off.
    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false, enabled: false }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // No Firestore-backed fetch of any kind fires — these mocked functions
    // stand in for the hook's Firestore reads (orchestrator's
    // getCachedInsights/generateInsights, feedbackLearning's
    // getAllPatternLearning, insightBudget's readBudgetMode/readShownLog).
    expect(orchestratorMocks.getCachedInsights).not.toHaveBeenCalled();
    expect(orchestratorMocks.generateInsights).not.toHaveBeenCalled();
    expect(learningMocks.getAllPatternLearning).not.toHaveBeenCalled();
    expect(budgetMocks.readBudgetMode).not.toHaveBeenCalled();
    expect(budgetMocks.readShownLog).not.toHaveBeenCalled();

    // No shown-recording effect (a real Firestore write) fires either — its
    // own effect gates on `enabled` directly.
    expect(budgetMocks.recordShownInsights).not.toHaveBeenCalled();

    // R4 Phase 3 backlog (P3-D7): `budgetedInsights`'s memo now gates
    // directly on `enabled` (an explicit `if (!enabled) return [];`), so
    // `applyInsightBudget` is never invoked at all while disabled — even
    // with the insightBudget flag ON (set above) — rather than merely
    // happening to run over an already-empty array and produce the same
    // `[]` result. Fixes what used to be an implicit/coincidental contract.
    expect(budgetMocks.applyInsightBudget).not.toHaveBeenCalled();

    // Stable, empty return shape.
    expect(result.current.insights).toEqual([]);
    expect(result.current.activeInsights).toEqual([]);
    expect(result.current.historyInsights).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.dataStatus).toBeNull();
    expect(result.current.lastGenerated).toBeNull();
    expect(result.current.isCalibrating).toBe(false);
    expect(result.current.hasInsights).toBe(false);
    expect(result.current.insightCount).toBe(0);
  });

  it('enabled:true (explicit) reproduces the unchanged default happy path: cached insights load and are returned', async () => {
    flagValue = false;
    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false, enabled: true }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(orchestratorMocks.getCachedInsights).toHaveBeenCalledWith('user-1');
    expect(result.current.insights.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
  });
});

// Fix B (INS-1, 2026-07-24 brief): "the proactive Nexus feed reads `active`
// only. `history` remains an audit/diagnostic record and is never blended
// into the current feed." This is the missing contract the brief calls out
// explicitly: "no test proves archived items are absent from the live hook
// output." Root-cause quote: "`useNexusInsights` then combines
// `activeInsights + historyInsights` into the user-visible feed" — these
// tests pin that the combination no longer happens, even when history is
// non-empty and contains `legacyVersion: true` items.
describe('useNexusInsights - Fix B (INS-1): history never blends into the feed', () => {
  it('archived/legacyVersion history items never appear in `insights`, even though `historyInsights` still carries them', async () => {
    orchestratorMocks.getCachedInsights.mockResolvedValue({
      insights: [{ id: 'active-1', title: 'Current Card', type: 'pattern', confidence: 0.9 }],
      history: [
        { id: 'legacy-1', title: 'Old Legacy Card', type: 'pattern', confidence: 0.9, legacyVersion: true },
        { id: 'legacy-2', title: 'Another Old Card', type: 'pattern', confidence: 0.9 },
      ],
      generatedAt: Date.now(),
      stale: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The displayed feed is active-only.
    expect(result.current.insights.map((i) => i.id)).toEqual(['active-1']);
    expect(result.current.insights.some((i) => i.legacyVersion)).toBe(false);
    expect(result.current.insights.some((i) => i.id === 'legacy-1' || i.id === 'legacy-2')).toBe(false);

    // History is still tracked (audit/diagnostic use, e.g. historyCount) —
    // it just never gets folded into the display feed.
    expect(result.current.historyInsights.map((i) => i.id)).toEqual(['legacy-1', 'legacy-2']);
    expect(result.current.historyCount).toBe(2);
    expect(result.current.activeCount).toBe(1);
  });

  it('reloading (regenerateInsights re-reading the cache) does not reintroduce historical cards into the feed', async () => {
    orchestratorMocks.getCachedInsights
      .mockResolvedValueOnce({
        insights: [{ id: 'active-1', title: 'Current Card', type: 'pattern', confidence: 0.9 }],
        history: [{ id: 'legacy-1', title: 'Old Legacy Card', type: 'pattern', confidence: 0.9, legacyVersion: true }],
        generatedAt: Date.now(),
        stale: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      })
      // Regeneration re-read (triggered by `refresh()` below): a different
      // active set, same stale history still present in the cache.
      .mockResolvedValueOnce({
        insights: [{ id: 'active-2', title: 'New Current Card', type: 'pattern', confidence: 0.9 }],
        history: [{ id: 'legacy-1', title: 'Old Legacy Card', type: 'pattern', confidence: 0.9, legacyVersion: true }],
        generatedAt: Date.now(),
        stale: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
    orchestratorMocks.generateInsights.mockResolvedValue({ success: true, insights: [], generatedAt: Date.now() });

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.insights.map((i) => i.id)).toEqual(['active-1']);

    await act(async () => { await result.current.refresh(); });

    expect(result.current.insights.map((i) => i.id)).toEqual(['active-2']);
    expect(result.current.insights.some((i) => i.id === 'legacy-1')).toBe(false);
  });

  it('an empty active set with non-empty history displays no cards at all (first post-cutover generation: archives-but-displays-none)', async () => {
    orchestratorMocks.getCachedInsights.mockResolvedValue({
      insights: [],
      history: [
        { id: 'legacy-1', title: 'Old Legacy Card', legacyVersion: true },
        { id: 'legacy-2', title: 'Another Old Card', legacyVersion: true },
      ],
      generatedAt: Date.now(),
      stale: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.insights).toEqual([]);
    expect(result.current.hasInsights).toBe(false);
    expect(result.current.historyCount).toBe(2);
  });
});

// Fix C (2026-07-24 brief): `refreshFromCache` is the read-only counterpart
// to `refresh` — the unified "Rebuild insights" orchestration
// (rebuildInsights.js) already ran generateInsights itself; this hook must
// be able to pull the fresh cache into its own displayed state WITHOUT
// triggering a second generation.
describe('useNexusInsights — refreshFromCache (Fix C)', () => {
  it('re-reads the cache and updates active/history insights WITHOUT calling generateInsights', async () => {
    orchestratorMocks.getCachedInsights.mockResolvedValueOnce({
      insights: threeInsights(),
      history: [],
      generatedAt: 1,
      stale: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    const { result } = renderHook(() => useNexusInsights(USER, { autoRefresh: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(orchestratorMocks.generateInsights).not.toHaveBeenCalled();

    orchestratorMocks.getCachedInsights.mockResolvedValueOnce({
      insights: [{ id: 'fresh-1', title: 'Rebuilt', type: 'pattern', confidence: 0.9 }],
      history: [{ id: 'legacy-1', legacyVersion: true }],
      generatedAt: 2,
      stale: false,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await act(async () => { await result.current.refreshFromCache(); });

    expect(orchestratorMocks.generateInsights).not.toHaveBeenCalled();
    expect(result.current.insights.map((i) => i.id)).toEqual(['fresh-1']);
    expect(result.current.historyCount).toBe(1);
  });

  it('is a no-op when disabled (enabled:false) — never reads the cache', async () => {
    const { result } = renderHook(() => useNexusInsights(USER, { enabled: false }));
    orchestratorMocks.getCachedInsights.mockClear();

    await act(async () => { await result.current.refreshFromCache(); });

    expect(orchestratorMocks.getCachedInsights).not.toHaveBeenCalled();
  });
});
