import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

// GlassCard just renders its children in tests.
vi.mock('../../GlassCard', () => ({ default: ({ children }) => <div>{children}</div> }));

const subscribeDueOpenLoops = vi.fn();
const subscribeUpcomingOpenLoops = vi.fn();
const snoozeLoop = vi.fn(async () => {});
const answerLoop = vi.fn(async () => {});
const closeLoop = vi.fn(async () => {});
const dismissIntent = vi.fn(async () => {});
vi.mock('../../../../services/intents/intentClient', () => ({
  subscribeDueOpenLoops: (...a) => subscribeDueOpenLoops(...a),
  subscribeUpcomingOpenLoops: (...a) => subscribeUpcomingOpenLoops(...a),
  snoozeLoop: (...a) => snoozeLoop(...a),
  answerLoop: (...a) => answerLoop(...a),
  closeLoop: (...a) => closeLoop(...a),
  dismissIntent: (...a) => dismissIntent(...a),
}));

const { default: OpenLoopsWidget, formatDueSince, snoozeUntilIso } = await import('../OpenLoopsWidget');

function loop(overrides = {}) {
  return {
    id: 'loop-1',
    userText: null,
    sourceSpan: { text: 'call the dentist' },
    targetAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    ...overrides,
  };
}

function dueWith(loops) {
  subscribeDueOpenLoops.mockImplementation((_db, _uid, cb) => {
    cb(loops);
    return () => {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockReturnValue(true);
  subscribeDueOpenLoops.mockReturnValue(() => {});
  subscribeUpcomingOpenLoops.mockReturnValue(() => {});
});

describe('OpenLoopsWidget - visibility gating', () => {
  it('renders null when openLoops is off (intentExtraction on)', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
    dueWith([loop()]);
    const { container } = render(<OpenLoopsWidget />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when intentExtraction is off (openLoops on) — reverse flag combination', () => {
    getFlag.mockImplementation((flag) => flag !== 'intentExtraction');
    dueWith([loop()]);
    const { container } = render(<OpenLoopsWidget />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when there are no due loops', () => {
    dueWith([]);
    const { container } = render(<OpenLoopsWidget />);
    expect(container.firstChild).toBeNull();
  });
});

describe('OpenLoopsWidget - due list (max 3)', () => {
  it('shows at most 3 due loops even when more are due', () => {
    dueWith([
      loop({ id: 'l1', sourceSpan: { text: 'loop one' } }),
      loop({ id: 'l2', sourceSpan: { text: 'loop two' } }),
      loop({ id: 'l3', sourceSpan: { text: 'loop three' } }),
      loop({ id: 'l4', sourceSpan: { text: 'loop four' } }),
    ]);
    render(<OpenLoopsWidget />);
    expect(screen.getByText('loop one')).toBeTruthy();
    expect(screen.getByText('loop two')).toBeTruthy();
    expect(screen.getByText('loop three')).toBeTruthy();
    expect(screen.queryByText('loop four')).toBeNull();
  });

  it('prefers userText over sourceSpan.text for display', () => {
    dueWith([loop({ userText: 'edited text', sourceSpan: { text: 'raw text' } })]);
    render(<OpenLoopsWidget />);
    expect(screen.getByText('edited text')).toBeTruthy();
    expect(screen.queryByText('raw text')).toBeNull();
  });
});

describe('OpenLoopsWidget - copy', () => {
  it('never renders guilt/shame/urgency language', () => {
    dueWith([loop()]);
    render(<OpenLoopsWidget />);
    const text = document.body.textContent;
    expect(text).not.toMatch(/overdue/i);
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/you (missed|forgot|failed)/i);
  });

  it('formatDueSince derives neutral, plain phrasing from targetAt', () => {
    const now = new Date(2024, 0, 15); // Monday, Jan 15 2024
    expect(formatDueSince(new Date(2024, 0, 15).toISOString(), now)).toBe('since today');
    expect(formatDueSince(new Date(2024, 0, 14).toISOString(), now)).toBe('since yesterday');
    expect(formatDueSince(new Date(2024, 0, 12).toISOString(), now)).toBe('since Friday');
    expect(formatDueSince(new Date(2024, 0, 1).toISOString(), now)).toBe('since Jan 1');
  });
});

describe('OpenLoopsWidget - snooze', () => {
  it('snoozing a loop calls snoozeLoop and hides the row', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(screen.getByText('call the dentist')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Snooze'));
    fireEvent.click(screen.getByText('Tomorrow'));

    expect(snoozeLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', expect.any(String), undefined);
    expect(screen.queryByText('call the dentist')).toBeNull();
  });

  it('"Tonight" after 20:00 local rolls over to tomorrow 20:00, not a past instant', () => {
    // Fake clock at 21:00 local on a fixed date.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 15, 21, 0, 0, 0)); // Jan 15 2024, 21:00
    try {
      dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
      render(<OpenLoopsWidget />);

      fireEvent.click(screen.getByLabelText('Snooze'));
      fireEvent.click(screen.getByText('Tonight'));

      expect(snoozeLoop).toHaveBeenCalledTimes(1);
      const untilIso = snoozeLoop.mock.calls[0][3];
      const until = new Date(untilIso);
      const now = new Date();
      expect(until.getTime()).toBeGreaterThan(now.getTime()); // never a past instant
      expect(until.getDate()).toBe(16); // rolled to tomorrow
      expect(until.getHours()).toBe(20);
      expect(until.getMinutes()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('snoozeUntilIso("tonight") stays today when called before 20:00', () => {
    const now = new Date(2024, 0, 15, 14, 0, 0, 0); // 14:00
    const until = new Date(snoozeUntilIso('tonight', now));
    expect(until.getDate()).toBe(15);
    expect(until.getHours()).toBe(20);
  });

  it('snoozeUntilIso("tonight") rolls to tomorrow when called after 20:00', () => {
    const now = new Date(2024, 0, 15, 21, 0, 0, 0); // 21:00
    const until = new Date(snoozeUntilIso('tonight', now));
    expect(until.getDate()).toBe(16);
    expect(until.getHours()).toBe(20);
  });
});

describe('OpenLoopsWidget - close & dismiss', () => {
  it('close calls closeLoop and hides the row', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(closeLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', undefined);
    expect(screen.queryByText('call the dentist')).toBeNull();
  });

  it('dismiss (X) calls dismissIntent with aria-label "Don\'t revisit" and hides the row', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    fireEvent.click(screen.getByLabelText("Don't revisit"));
    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null, undefined);
    expect(screen.queryByText('call the dentist')).toBeNull();
  });

  // INT-02 item 1: the widget already holds the subscribed intent doc, so it
  // passes that doc's `versions` field through to each action verbatim.
  it('passes the loop\'s versions snapshot through to snoozeLoop/closeLoop/dismissIntent', () => {
    const versions = { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 2 };
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' }, versions })]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getByLabelText('Close'));
    expect(closeLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', versions);
  });
});

describe('OpenLoopsWidget - answer wiring', () => {
  // AppLayout's onVoiceSave/onTextSave wrapper (see AppLayout.jsx) is what
  // actually calls the `onSaved` callback passed to `onAnswerLoop` here, and
  // it resolves to exactly one of: a real Firestore entry id string, the
  // sentinel 'deferred' (save genuinely completed but no id is available —
  // e.g. the documented crisis-deferred flow), or `false` (save failed or
  // threw). I1: only the first two may close the loop; `false` (and any
  // other unrecognized value) must NOT — the intent stays due.
  it('answer opens the composer via onAnswerLoop with the loop text', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);

    fireEvent.click(screen.getByLabelText('Answer'));

    expect(onAnswerLoop).toHaveBeenCalledWith('call the dentist', expect.any(Function));
  });

  it('wires a real entry id through to answerLoop and closes the loop', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('AbCdEf123456'); // a real Firestore auto-id shape, never a sentinel string

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', 'AbCdEf123456', undefined);
  });

  it('never writes the legacy "saved" sentinel into answerEntryId, but still closes the loop', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('saved'); // defensive: AppLayout no longer emits this, but guard it anyway

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null, undefined);
  });

  it('closes the loop with no linked id on the "deferred" sentinel (crisis flow)', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('deferred');

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null, undefined);
  });

  it('I1: does NOT call answerLoop when the save failed (false) — the loop stays due', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved(false);

    expect(answerLoop).not.toHaveBeenCalled();
    expect(screen.getByText('call the dentist')).toBeTruthy();
  });

  it('I1: does NOT call answerLoop on undefined (fail-safe default) — the loop stays due', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved(undefined);

    expect(answerLoop).not.toHaveBeenCalled();
    expect(screen.getByText('call the dentist')).toBeTruthy();
  });

  it('passes the loop\'s versions snapshot through to answerLoop', () => {
    const versions = { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 2 };
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' }, versions })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('AbCdEf123456');

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', 'AbCdEf123456', versions);
  });

  it('does nothing if onAnswerLoop is not provided', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(() => fireEvent.click(screen.getByLabelText('Answer'))).not.toThrow();
  });
});

describe('OpenLoopsWidget - I2: due-loop foreground/visibility resubscribe', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-invokes subscribeDueOpenLoops on visibilitychange when the tab becomes visible', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(2);
  });

  it('does not re-subscribe on visibilitychange when the tab becomes hidden', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);
  });

  it('re-invokes subscribeDueOpenLoops every 5 minutes while visible (fake timers)', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(2);

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(3);
  });

  it('cleans up the visibilitychange listener and interval on unmount', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const { unmount } = render(<OpenLoopsWidget />);
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);

    unmount();
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    document.dispatchEvent(new Event('visibilitychange'));

    // No further (re-)subscriptions after unmount.
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);
  });
});

describe('OpenLoopsWidget - I2 follow-up: upcoming-list freshness (shares the due-list refreshNonce)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-invokes subscribeUpcomingOpenLoops on visibilitychange when the tab becomes visible (a loop crossing targetAt migrates upcoming->due without remount)', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(2);
  });

  it('re-invokes subscribeUpcomingOpenLoops every 5 minutes while visible (fake timers)', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(2);
  });

  it('due and upcoming resubscribe together off the SAME nonce (one visibilitychange bumps both)', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(1);
    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(subscribeDueOpenLoops).toHaveBeenCalledTimes(2);
    expect(subscribeUpcomingOpenLoops).toHaveBeenCalledTimes(2);
  });
});

describe('OpenLoopsWidget - upcoming footer', () => {
  it('shows a "+N upcoming" footer that expands to a read-only list with dismiss', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    subscribeUpcomingOpenLoops.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'u1', sourceSpan: { text: 'renew passport' }, targetAt: new Date().toISOString() }]);
      return () => {};
    });
    render(<OpenLoopsWidget />);

    expect(screen.getByText('+1 upcoming')).toBeTruthy();
    expect(screen.queryByText('renew passport')).toBeNull();

    fireEvent.click(screen.getByText('+1 upcoming'));
    expect(screen.getByText('renew passport')).toBeTruthy();

    // Two "Don't revisit" buttons now exist (due row + upcoming row); the
    // upcoming one is rendered last.
    const dismissButtons = screen.getAllByLabelText("Don't revisit");
    fireEvent.click(dismissButtons[dismissButtons.length - 1]);
    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'u1', null, undefined);
  });

  it('A11Y-02: the "+N upcoming" toggle exposes aria-expanded/aria-controls, and the panel id matches', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    subscribeUpcomingOpenLoops.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'u1', sourceSpan: { text: 'renew passport' }, targetAt: new Date().toISOString() }]);
      return () => {};
    });
    render(<OpenLoopsWidget />);

    const toggle = screen.getByText('+1 upcoming').closest('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Collapsed: the <ul> is unmounted, so aria-controls must be absent
    // (it may only reference an id present in the DOM).
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId)).toBeTruthy();
    expect(document.getElementById(controlsId).textContent).toMatch(/renew passport/);
  });
});

describe('OpenLoopsWidget - A11Y-02: touch targets', () => {
  it('the four due-row action buttons pad their 24px visual box to a 44px hit area', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    for (const label of ['Answer', 'Snooze', 'Close', "Don't revisit"]) {
      const btn = screen.getByLabelText(label);
      expect(btn.className).toMatch(/relative/);
      expect(btn.className).toMatch(/before:-inset-2\.5/);
    }
  });

  it('the upcoming-row dismiss button pads its 20px visual box to a 44px hit area', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    subscribeUpcomingOpenLoops.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'u1', sourceSpan: { text: 'renew passport' }, targetAt: new Date().toISOString() }]);
      return () => {};
    });
    render(<OpenLoopsWidget />);
    fireEvent.click(screen.getByText('+1 upcoming'));
    const dismissButtons = screen.getAllByLabelText("Don't revisit");
    const upcomingDismiss = dismissButtons[dismissButtons.length - 1];
    expect(upcomingDismiss.className).toMatch(/before:-inset-3\b/);
  });
});

describe('OpenLoopsWidget - INT-02 item 3: failure handling', () => {
  it('Close failure restores the row and shows a quiet, non-alarming failure message', async () => {
    closeLoop.mockRejectedValueOnce(new Error('offline'));
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getByLabelText('Close'));
    // Optimistic removal happens synchronously.
    expect(screen.queryByText('call the dentist')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('call the dentist')).toBeTruthy();
    });
    const message = screen.getByText(/couldn.t save/i);
    expect(message).toBeTruthy();
    expect(message.textContent).not.toMatch(/error|fail|alert/i);
  });

  it('Snooze failure restores the row and shows the failure message', async () => {
    snoozeLoop.mockRejectedValueOnce(new Error('offline'));
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getByLabelText('Snooze'));
    fireEvent.click(screen.getByText('Tomorrow'));
    expect(screen.queryByText('call the dentist')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('call the dentist')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('Dismiss (due) failure restores the row and shows the failure message', async () => {
    dismissIntent.mockRejectedValueOnce(new Error('permission-denied'));
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getByLabelText("Don't revisit"));
    expect(screen.queryByText('call the dentist')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('call the dentist')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('Dismiss (upcoming) failure restores the row and shows the failure message', async () => {
    dismissIntent.mockRejectedValueOnce(new Error('permission-denied'));
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    subscribeUpcomingOpenLoops.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'u1', sourceSpan: { text: 'renew passport' }, targetAt: new Date().toISOString() }]);
      return () => {};
    });
    render(<OpenLoopsWidget />);
    fireEvent.click(screen.getByText('+1 upcoming'));

    const dismissButtons = screen.getAllByLabelText("Don't revisit");
    fireEvent.click(dismissButtons[dismissButtons.length - 1]);
    expect(screen.queryByText('renew passport')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('renew passport')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('Answer failure leaves the (never-removed) row visible with a quiet failure message', async () => {
    answerLoop.mockRejectedValueOnce(new Error('offline'));
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('entry-1');

    expect(screen.getByText('call the dentist')).toBeTruthy();
    await vi.waitFor(() => {
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('a successful action leaves no failure message behind', async () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getByLabelText('Close'));
    await vi.waitFor(() => expect(closeLoop).toHaveBeenCalled());
    expect(screen.queryByText(/couldn.t save/i)).toBeNull();
  });

  it('one row\'s failure does not disable or flag an unrelated row (per-id busy/error state)', async () => {
    closeLoop.mockRejectedValueOnce(new Error('offline'));
    dueWith([
      loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } }),
      loop({ id: 'l2', sourceSpan: { text: 'water the plants' } }),
    ]);
    render(<OpenLoopsWidget />);

    fireEvent.click(screen.getAllByLabelText('Close')[0]);
    expect(screen.queryByText('call the dentist')).toBeNull();
    // l2's row is untouched and its Close button stays enabled.
    expect(screen.getByLabelText('Close')).not.toBeDisabled();

    await vi.waitFor(() => {
      expect(screen.getByText('call the dentist')).toBeTruthy();
    });
    // Only l1's row shows the failure message.
    expect(screen.getAllByText(/couldn.t save/i)).toHaveLength(1);
  });
});
