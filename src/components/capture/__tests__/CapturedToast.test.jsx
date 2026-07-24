import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

const subscribeRecentActiveIntents = vi.fn();
const dismissIntent = vi.fn(async () => {});
const setIntentUserText = vi.fn(async () => {});
vi.mock('../../../services/intents/intentClient', () => ({
  subscribeRecentActiveIntents: (...a) => subscribeRecentActiveIntents(...a),
  dismissIntent: (...a) => dismissIntent(...a),
  setIntentUserText: (...a) => setIntentUserText(...a),
}));

const { default: CapturedToast } = await import('../CapturedToast');

function intent(overrides = {}) {
  return {
    id: 'intent-1',
    userText: null,
    sourceSpan: { text: 'call the dentist' },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

let emit;
function withSubscribe() {
  subscribeRecentActiveIntents.mockImplementation((_db, _uid, cb) => {
    emit = cb;
    return () => {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockReturnValue(true);
  subscribeRecentActiveIntents.mockReturnValue(() => {});
  emit = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CapturedToast - flag gating', () => {
  it('renders null and never subscribes when intentExtraction is off', () => {
    getFlag.mockReturnValue(false);
    const { container } = render(<CapturedToast />);
    expect(container.firstChild).toBeNull();
    expect(subscribeRecentActiveIntents).not.toHaveBeenCalled();
  });
});

describe('CapturedToast - session-new filtering', () => {
  it('shows nothing for intents created before mount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    act(() => {
      emit([intent({ id: 'old-1', createdAt: new Date(2024, 0, 15, 9, 59, 0, 0).toISOString() })]);
    });

    expect(screen.queryByText(/Captured:/)).toBeNull();
  });

  it('shows an intent created strictly after mount', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();
  });

  it('prefers userText over sourceSpan.text for display', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([
        intent({
          id: 'new-1',
          userText: 'edited text',
          sourceSpan: { text: 'raw text' },
          createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString(),
        }),
      ]);
    });

    expect(screen.getByText('Captured: edited text')).toBeTruthy();
    expect(screen.queryByText(/raw text/)).toBeNull();
  });

  it('never re-shows an already-seen id on a snapshot refire', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    const fresh = intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() });
    act(() => {
      emit([fresh]);
    });
    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();

    // Undo it, then the same id refires in a later snapshot (still resolves to
    // 'dismissed' server-side, but simulate the refire before that lands).
    fireEvent.click(screen.getByText('Undo'));
    expect(screen.queryByText(/Captured:/)).toBeNull();

    act(() => {
      emit([fresh]);
    });
    expect(screen.queryByText(/Captured:/)).toBeNull();
  });
});

describe('CapturedToast - Undo', () => {
  it('Undo calls dismissIntent and hides the row immediately', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Undo'));

    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'new-1', null, undefined);
    expect(screen.queryByText(/Captured:/)).toBeNull();
  });

  it('passes the intent\'s versions snapshot through to dismissIntent (INT-02 item 1)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    const versions = { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 2 };
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', versions, createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Undo'));

    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'new-1', null, versions);
  });
});

describe('CapturedToast - INT-02 item 2: failure handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Undo failure restores the row and shows a quiet, non-alarming failure message', async () => {
    dismissIntent.mockRejectedValueOnce(new Error('offline'));
    withSubscribe();
    render(<CapturedToast />);

    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(Date.now() + 1).toISOString() })]);
    });
    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();

    fireEvent.click(screen.getByText('Undo'));
    // Optimistic advance happens synchronously.
    expect(screen.queryByText(/Captured:/)).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('Captured: call the dentist')).toBeTruthy();
    });
    const message = screen.getByText(/couldn.t save/i);
    expect(message).toBeTruthy();
    expect(message.textContent).not.toMatch(/error|fail|alert/i);
  });

  it('Edit-confirm failure restores the row with the just-typed text (not lost)', async () => {
    setIntentUserText.mockRejectedValueOnce(new Error('offline'));
    withSubscribe();
    render(<CapturedToast />);

    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(Date.now() + 1).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText('Edit captured text');
    fireEvent.change(input, { target: { value: 'call the dentist tomorrow' } });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(screen.getByText('Captured: call the dentist tomorrow')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('a successful Undo leaves no failure message behind', async () => {
    withSubscribe();
    render(<CapturedToast />);

    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(Date.now() + 1).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Undo'));
    await vi.waitFor(() => expect(dismissIntent).toHaveBeenCalled());
    expect(screen.queryByText(/couldn.t save/i)).toBeNull();
  });

  it('a retry after a restored failure fires exactly one more dismissIntent call (no leftover in-flight state blocks it)', async () => {
    dismissIntent.mockRejectedValueOnce(new Error('offline'));
    withSubscribe();
    render(<CapturedToast />);

    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(Date.now() + 1).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Undo'));
    await vi.waitFor(() => expect(screen.getByText(/couldn.t save/i)).toBeTruthy());
    expect(dismissIntent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Undo'));
    await vi.waitFor(() => expect(dismissIntent).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Captured:/)).toBeNull();
  });
});

describe('CapturedToast - Edit', () => {
  it('Edit shows an inline input; confirm calls setIntentUserText and hides the row', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText('Edit captured text');
    fireEvent.change(input, { target: { value: 'call the dentist tomorrow' } });
    fireEvent.click(screen.getByText('Save'));

    expect(setIntentUserText).toHaveBeenCalledWith({ __db: true }, 'user-1', 'new-1', 'call the dentist tomorrow');
    expect(screen.queryByText(/Captured:/)).toBeNull();
  });

  it('edit then Cancel reverts to the confirm view and re-arms a fresh 6s auto-dismiss', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByLabelText('Edit captured text')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByLabelText('Edit captured text')).toBeNull();
    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();
    expect(setIntentUserText).not.toHaveBeenCalled();

    // The auto-dismiss timer was re-armed fresh from the cancel point, not
    // left over from before Edit was tapped: not yet dismissed just under 6s.
    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(/Captured:/)).toBeNull();
    expect(dismissIntent).not.toHaveBeenCalled();
  });

  it('an edit abandoned for 30s reverts without saving, then the normal 6s flow resumes and advances the queue', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([
        intent({ id: 'first', sourceSpan: { text: 'first capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() }),
        intent({ id: 'second', sourceSpan: { text: 'second capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 2, 0).toISOString() }),
      ]);
    });

    expect(screen.getByText('Captured: first capture')).toBeTruthy();

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText('Edit captured text');
    fireEvent.change(input, { target: { value: 'partial edit, never saved' } });

    // Walk away: the 30s abandonment safety net fires.
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    // Reverted to the confirm view for the same (still-first) item; partial
    // text was never saved.
    expect(screen.queryByLabelText('Edit captured text')).toBeNull();
    expect(screen.getByText('Captured: first capture')).toBeTruthy();
    expect(setIntentUserText).not.toHaveBeenCalled();

    // Normal 6s auto-dismiss flow resumes from the revert point and advances
    // the queue to the next session-new intent.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByText('Captured: first capture')).toBeNull();
    expect(screen.getByText('Captured: second capture')).toBeTruthy();
  });
});

describe('CapturedToast - auto-dismiss', () => {
  it('auto-dismisses after 6s without calling dismissIntent or setIntentUserText', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });
    expect(screen.getByText('Captured: call the dentist')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText(/Captured:/)).toBeNull();
    expect(dismissIntent).not.toHaveBeenCalled();
    expect(setIntentUserText).not.toHaveBeenCalled();
  });

  it('clears the auto-dismiss timer on interaction (Undo before 6s, then no late hide crash)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([intent({ id: 'new-1', createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() })]);
    });

    fireEvent.click(screen.getByText('Undo'));
    expect(dismissIntent).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // No second dismiss/advance triggered by the stale timer.
    expect(dismissIntent).toHaveBeenCalledTimes(1);
  });

  it('queue of 2: the first auto-dismisses via the 6s timer, then the second appears', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([
        intent({ id: 'first', sourceSpan: { text: 'first capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() }),
        intent({ id: 'second', sourceSpan: { text: 'second capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 2, 0).toISOString() }),
      ]);
    });

    expect(screen.getByText('Captured: first capture')).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.queryByText('Captured: first capture')).toBeNull();
    expect(screen.getByText('Captured: second capture')).toBeTruthy();
    expect(dismissIntent).not.toHaveBeenCalled();
    expect(setIntentUserText).not.toHaveBeenCalled();
  });
});

describe('CapturedToast - FIFO queueing', () => {
  it('shows one at a time; additional session-new intents queue and show after the current resolves', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 0, 0));
    withSubscribe();
    render(<CapturedToast />);

    vi.setSystemTime(new Date(2024, 0, 15, 10, 0, 1, 0));
    act(() => {
      emit([
        intent({ id: 'second', sourceSpan: { text: 'second capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 2, 0).toISOString() }),
        intent({ id: 'first', sourceSpan: { text: 'first capture' }, createdAt: new Date(2024, 0, 15, 10, 0, 1, 0).toISOString() }),
      ]);
    });

    // Only one row shown, and it's the oldest (first-captured) of the two.
    expect(screen.getByText('Captured: first capture')).toBeTruthy();
    expect(screen.queryByText('Captured: second capture')).toBeNull();

    fireEvent.click(screen.getByText('Undo'));

    expect(screen.getByText('Captured: second capture')).toBeTruthy();
  });
});
