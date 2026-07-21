import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

    expect(snoozeLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', expect.any(String));
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
    expect(closeLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1');
    expect(screen.queryByText('call the dentist')).toBeNull();
  });

  it('dismiss (X) calls dismissIntent with aria-label "Don\'t revisit" and hides the row', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    fireEvent.click(screen.getByLabelText("Don't revisit"));
    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1');
    expect(screen.queryByText('call the dentist')).toBeNull();
  });
});

describe('OpenLoopsWidget - answer wiring', () => {
  // The composer's save chain (App.jsx saveEntry/doSaveEntry/handleAudioWrapper)
  // never resolves to a bare entry id — its long-standing return contract is
  // the sentinel strings 'saved'/'deferred' (or undefined on some early-return
  // paths). The REAL id (when the online save path fires) arrives via a
  // separate onEntryRef side-channel threaded through AppLayout, which is
  // what actually reaches the `onSaved` callback here. These tests simulate
  // each production-shaped value the callback can actually receive.
  it('answer opens the composer via onAnswerLoop with the loop text', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);

    fireEvent.click(screen.getByLabelText('Answer'));

    expect(onAnswerLoop).toHaveBeenCalledWith('call the dentist', expect.any(Function));
  });

  it('wires a real entry id (from the onEntryRef side-channel) through to answerLoop', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('AbCdEf123456'); // a real Firestore auto-id shape, never a sentinel string

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', 'AbCdEf123456');
  });

  it('never writes the "saved" sentinel into answerEntryId', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('saved'); // saveEntry/doSaveEntry's own return contract, not an id

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null);
  });

  it('never writes the "deferred" sentinel (crisis flow) into answerEntryId', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('deferred');

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null);
  });

  it('treats undefined (early-return save paths) as null, not a sentinel', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);
    fireEvent.click(screen.getByLabelText('Answer'));

    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved(undefined);

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', null);
  });

  it('does nothing if onAnswerLoop is not provided', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    render(<OpenLoopsWidget />);
    expect(() => fireEvent.click(screen.getByLabelText('Answer'))).not.toThrow();
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
    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'u1');
  });
});
