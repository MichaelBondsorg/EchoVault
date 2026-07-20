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

const { default: OpenLoopsWidget, formatDueSince } = await import('../OpenLoopsWidget');

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
  it('renders null when either flag is off', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
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
  it('answer opens the composer via onAnswerLoop with the loop text, and wires the saved entry id through answerLoop', () => {
    dueWith([loop({ id: 'l1', sourceSpan: { text: 'call the dentist' } })]);
    const onAnswerLoop = vi.fn();
    render(<OpenLoopsWidget onAnswerLoop={onAnswerLoop} />);

    fireEvent.click(screen.getByLabelText('Answer'));

    expect(onAnswerLoop).toHaveBeenCalledWith('call the dentist', expect.any(Function));

    // Simulate the composer saving successfully and reporting the new entry id.
    const onSaved = onAnswerLoop.mock.calls[0][1];
    onSaved('entry-123');

    expect(answerLoop).toHaveBeenCalledWith({ __db: true }, 'user-1', 'l1', 'entry-123');
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
