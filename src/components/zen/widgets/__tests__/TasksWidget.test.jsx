import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

// GlassCard just renders its children in tests.
vi.mock('../../GlassCard', () => ({ default: ({ children }) => <div>{children}</div> }));

const subscribeActiveTaskIntents = vi.fn();
const completeIntent = vi.fn(async () => {});
const dismissIntent = vi.fn(async () => {});
vi.mock('../../../../services/intents/intentClient', () => ({
  subscribeActiveTaskIntents: (...a) => subscribeActiveTaskIntents(...a),
  completeIntent: (...a) => completeIntent(...a),
  dismissIntent: (...a) => dismissIntent(...a),
}));

const TasksWidget = (await import('../TasksWidget')).default;

beforeEach(() => {
  vi.clearAllMocks();
  subscribeActiveTaskIntents.mockReturnValue(() => {});
});

describe('TasksWidget - legacy path (flag OFF)', () => {
  beforeEach(() => getFlag.mockReturnValue(false));

  const entries = [
    { id: 'e1', extracted_tasks: [{ text: 'Buy milk', completed: false }, { text: 'Done thing', completed: true }] },
  ];

  it('renders pending extracted_tasks and never subscribes to intents', () => {
    render(<TasksWidget entries={entries} onToggleTask={() => {}} />);
    expect(screen.getByText('Buy milk')).toBeTruthy();
    expect(screen.queryByText('Done thing')).toBeNull();
    expect(subscribeActiveTaskIntents).not.toHaveBeenCalled();
  });

  it('toggling a task calls onToggleTask with the legacy signature', () => {
    const onToggleTask = vi.fn();
    render(<TasksWidget entries={entries} onToggleTask={onToggleTask} />);
    fireEvent.click(screen.getByText('Buy milk').closest('li').querySelector('button'));
    expect(onToggleTask).toHaveBeenCalledWith('Buy milk', 'e1', 0);
    expect(completeIntent).not.toHaveBeenCalled();
  });

  it('renders no "Not a task" affordance under the legacy path', () => {
    render(<TasksWidget entries={entries} onToggleTask={() => {}} />);
    expect(screen.queryByLabelText('Not a task')).toBeNull();
  });
});

describe('TasksWidget - intent path (flag ON)', () => {
  beforeEach(() => getFlag.mockReturnValue(true));

  function subscribeWith(intents) {
    subscribeActiveTaskIntents.mockImplementation((_db, _uid, cb) => {
      cb(intents);
      return () => {};
    });
  }

  it('renders policy-qualified active task intents from the subscription', () => {
    subscribeWith([{ id: 'i1', sourceSpan: { text: 'call the dentist' } }]);
    render(<TasksWidget entries={[]} onToggleTask={() => {}} />);
    expect(subscribeActiveTaskIntents).toHaveBeenCalledWith(
      { __db: true }, 'user-1', expect.any(Function), expect.any(Function),
    );
    expect(screen.getByText('call the dentist')).toBeTruthy();
  });

  it('toggling completes the intent (not the legacy callback)', () => {
    const onToggleTask = vi.fn();
    subscribeWith([{ id: 'i1', sourceSpan: { text: 'call the dentist' } }]);
    render(<TasksWidget entries={[]} onToggleTask={onToggleTask} />);
    fireEvent.click(screen.getByText('call the dentist').closest('li').querySelector('button'));
    expect(completeIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'i1');
    expect(onToggleTask).not.toHaveBeenCalled();
  });

  it('the "Not a task" affordance dismisses the intent', () => {
    subscribeWith([{ id: 'i1', sourceSpan: { text: 'call the dentist' } }]);
    render(<TasksWidget entries={[]} onToggleTask={() => {}} />);
    fireEvent.click(screen.getByLabelText('Not a task'));
    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'i1');
  });
});
