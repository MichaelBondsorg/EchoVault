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
