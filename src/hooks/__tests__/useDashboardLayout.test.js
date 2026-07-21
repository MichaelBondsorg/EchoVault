/**
 * Widget drawer flag-gating + saved-layout merge (R2 Task 3).
 *
 * Covers:
 *  - WIDGET_DEFINITIONS.open_loops declares its gating flags.
 *  - availableWidgets excludes flag-gated widgets whose flags aren't all on,
 *    and includes them once every required flag is on.
 *  - Saved-layout users transparently get newly-shipped default widgets
 *    appended (non-destructive merge), without a Firestore write on load.
 *  - removedDefaults suppresses resurrection of a deliberately-removed
 *    default widget.
 *  - Re-adding a previously-removed default clears it from removedDefaults
 *    so it doesn't get re-hidden on the next load.
 *  - removeWidget only writes removedDefaults for ids that are actual
 *    defaults; non-default widgets don't pollute the array.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

let flagValues = {};
vi.mock('../../config/flags', () => ({
  getFlag: vi.fn((name) => flagValues[name] ?? false),
}));

vi.mock('../../config/firebase', () => ({ db: {} }));

const firestoreMocks = {
  doc: vi.fn((...args) => ({ __doc: args.slice(1).join('/') })),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  onSnapshot: vi.fn(() => () => {}),
};
vi.mock('firebase/firestore', () => firestoreMocks);

const {
  useDashboardLayout,
  WIDGET_DEFINITIONS,
  DEFAULT_DASHBOARD_LAYOUT,
} = await import('../useDashboardLayout.js');

const USER_ID = 'user-1';

/** Registers the onSnapshot callback and returns a function to fire it. */
function captureSnapshotHandler() {
  let onNext;
  firestoreMocks.onSnapshot.mockImplementation((_ref, next) => {
    onNext = next;
    return () => {};
  });
  return {
    fire: (snapshot) => onNext(snapshot),
  };
}

function fakeSnapshot(exists, data) {
  return { exists: () => exists, data: () => data };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagValues = {};
  firestoreMocks.onSnapshot.mockImplementation(() => () => {});
  firestoreMocks.setDoc.mockResolvedValue(undefined);
  firestoreMocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
});

describe('WIDGET_DEFINITIONS flags', () => {
  it('gates open_loops behind openLoops + intentExtraction', () => {
    expect(WIDGET_DEFINITIONS.open_loops.flags).toEqual(['openLoops', 'intentExtraction']);
  });
});

describe('availableWidgets flag filtering', () => {
  it('excludes a flag-gated widget from availableWidgets when its flags are not all on', async () => {
    flagValues = { openLoops: false, intentExtraction: false };
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      // Deliberately excluded from the merge (removedDefaults) so the
      // assertion below isolates the flag check, rather than passing
      // vacuously because the non-destructive merge already placed
      // open_loops back onto the dashboard.
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        removedDefaults: ['open_loops'],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.availableWidgets).not.toContain('open_loops');
  });

  it('includes the flag-gated widget once every required flag is on', async () => {
    flagValues = { openLoops: true, intentExtraction: true };
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      // open_loops is itself a default widget, so it must be deliberately
      // excluded from this saved layout (removedDefaults) or the
      // non-destructive merge would put it straight back on the dashboard,
      // making it unavailable in the drawer for an unrelated reason.
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        removedDefaults: ['open_loops'],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.availableWidgets).toContain('open_loops');
  });

  it('partial flag grant (only one of two required flags on) still excludes the widget', async () => {
    flagValues = { openLoops: true, intentExtraction: false };
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        removedDefaults: ['open_loops'],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.availableWidgets).not.toContain('open_loops');
  });

  it('leaves unflagged widgets unaffected by flags being off (no regression for default-layout users)', async () => {
    flagValues = {};
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.availableWidgets).toContain('goals');
    expect(result.current.availableWidgets).toContain('tasks');
  });
});

describe('non-destructive default-layout merge on load', () => {
  it('appends a newly-shipped default widget missing from an old saved layout', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    // Saved layout predates open_loops/quick_stats/mood_heatmap/recent_entries
    // shipping as defaults.
    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [
          { id: 'hero_card', type: 'hero', size: '2x1' },
          { id: 'prompt_card', type: 'prompt', size: '2x1' },
        ],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ids = result.current.layout.map((w) => w.id);
    expect(ids).toEqual([
      'hero_card',
      'prompt_card',
      'open_loops',
      'quick_stats',
      'mood_heatmap',
      'recent_entries',
    ]);
  });

  it('is resilient to a doc with no removedDefaults field (treats as empty)', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        // no removedDefaults field at all
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ids = result.current.layout.map((w) => w.id);
    // Every other default should have been merged back in.
    expect(ids).toContain('prompt_card');
    expect(ids).toContain('open_loops');
  });

  it('does not write to Firestore during the load/merge (in-memory only)', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.layout.length).toBeGreaterThan(1); // merge did happen locally
    expect(firestoreMocks.setDoc).not.toHaveBeenCalled();
    expect(firestoreMocks.updateDoc).not.toHaveBeenCalled();
  });

  it('suppresses resurrection of a deliberately-removed default via removedDefaults', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        removedDefaults: ['prompt_card'],
      }));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ids = result.current.layout.map((w) => w.id);
    expect(ids).not.toContain('prompt_card');
    // Other defaults not deliberately removed still merge back in.
    expect(ids).toContain('open_loops');
    expect(ids).toContain('quick_stats');
  });
});

describe('removeWidget persistence of removedDefaults', () => {
  it('adds a removed default widget id to removedDefaults on persist', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, { layout: DEFAULT_DASHBOARD_LAYOUT }));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeWidget('quick_stats');
    });

    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = firestoreMocks.setDoc.mock.calls[0];
    expect(payload.removedDefaults).toEqual(['quick_stats']);
    expect(payload.layout.map((w) => w.id)).not.toContain('quick_stats');
  });

  it('does not add a non-default widget id to removedDefaults', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [...DEFAULT_DASHBOARD_LAYOUT, { id: 'goals', type: 'goals', size: '2x1' }],
      }));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeWidget('goals');
    });

    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = firestoreMocks.setDoc.mock.calls[0];
    expect(payload.removedDefaults).toBeUndefined();
    expect(payload.layout.map((w) => w.id)).not.toContain('goals');
  });
});

describe('addWidget clears removedDefaults suppression', () => {
  it('re-adding a previously-removed default widget clears it from removedDefaults', async () => {
    const handler = captureSnapshotHandler();
    const { result } = renderHook(() => useDashboardLayout(USER_ID));

    act(() => {
      handler.fire(fakeSnapshot(true, {
        layout: [{ id: 'hero_card', type: 'hero', size: '2x1' }],
        removedDefaults: ['prompt_card'],
      }));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.layout.map((w) => w.id)).not.toContain('prompt_card');

    await act(async () => {
      await result.current.addWidget('prompt_card');
    });

    expect(firestoreMocks.setDoc).toHaveBeenCalledTimes(1);
    const [, payload] = firestoreMocks.setDoc.mock.calls[0];
    expect(payload.removedDefaults).toEqual([]);
    expect(payload.layout.map((w) => w.id)).toContain('prompt_card');
  });
});
