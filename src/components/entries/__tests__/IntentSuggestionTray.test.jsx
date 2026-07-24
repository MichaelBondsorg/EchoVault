import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

const subscribeSuggestedIntentsForEntry = vi.fn();
const keepIntent = vi.fn(async () => {});
const dismissIntent = vi.fn(async () => {});
const setIntentUserText = vi.fn(async () => {});
vi.mock('../../../services/intents/intentClient', () => ({
  subscribeSuggestedIntentsForEntry: (...a) => subscribeSuggestedIntentsForEntry(...a),
  keepIntent: (...a) => keepIntent(...a),
  dismissIntent: (...a) => dismissIntent(...a),
  setIntentUserText: (...a) => setIntentUserText(...a),
}));

const { default: IntentSuggestionTray } = await import('../IntentSuggestionTray');

function intent(overrides = {}) {
  return {
    id: 'intent-1',
    kind: 'task',
    userText: null,
    sourceSpan: { text: 'call the vet' },
    ...overrides,
  };
}

function suggestedWith(intents) {
  subscribeSuggestedIntentsForEntry.mockImplementation((_db, _uid, _entryId, cb) => {
    cb(intents);
    return () => {};
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockImplementation(() => true); // intentExtraction + openLoops both on by default
  subscribeSuggestedIntentsForEntry.mockReturnValue(() => {});
});

describe('IntentSuggestionTray - gating', () => {
  it('renders null when intentExtraction is off, even with suggestions', () => {
    getFlag.mockImplementation((flag) => flag !== 'intentExtraction');
    suggestedWith([intent()]);
    const { container } = render(<IntentSuggestionTray entryId="e1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when there are no suggestions', () => {
    suggestedWith([]);
    const { container } = render(<IntentSuggestionTray entryId="e1" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows task suggestions even when openLoops is off', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
    suggestedWith([intent({ kind: 'task' })]);
    render(<IntentSuggestionTray entryId="e1" />);
    expect(screen.getByText('Possible task')).toBeTruthy();
  });

  it('hides open_loop suggestions when openLoops is off (intentExtraction still on)', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
    suggestedWith([intent({ id: 'loop-1', kind: 'open_loop' })]);
    const { container } = render(<IntentSuggestionTray entryId="e1" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows open_loop suggestions when openLoops is on', () => {
    suggestedWith([intent({ id: 'loop-1', kind: 'open_loop' })]);
    render(<IntentSuggestionTray entryId="e1" />);
    expect(screen.getByText('Revisit this?')).toBeTruthy();
  });

  it('renders null when only open_loop suggestions exist and openLoops is off', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
    suggestedWith([
      intent({ id: 'loop-1', kind: 'open_loop' }),
      intent({ id: 'loop-2', kind: 'open_loop' }),
    ]);
    const { container } = render(<IntentSuggestionTray entryId="e1" />);
    expect(container.firstChild).toBeNull();
  });

  it('mixed suggestions: shows task row, hides open_loop row, when openLoops is off', () => {
    getFlag.mockImplementation((flag) => flag !== 'openLoops');
    suggestedWith([
      intent({ id: 'task-1', kind: 'task', sourceSpan: { text: 'buy milk' } }),
      intent({ id: 'loop-1', kind: 'open_loop', sourceSpan: { text: 'follow up with dentist' } }),
    ]);
    render(<IntentSuggestionTray entryId="e1" />);
    expect(screen.getByText('buy milk')).toBeTruthy();
    expect(screen.queryByText('follow up with dentist')).toBeNull();
  });
});

describe('IntentSuggestionTray - display text', () => {
  it('prefers userText over sourceSpan.text', () => {
    suggestedWith([intent({ userText: 'edited text', sourceSpan: { text: 'raw text' } })]);
    render(<IntentSuggestionTray entryId="e1" />);
    expect(screen.getByText('edited text')).toBeTruthy();
    expect(screen.queryByText('raw text')).toBeNull();
  });

  it('falls back to sourceSpan.text when userText is absent', () => {
    suggestedWith([intent({ userText: null, sourceSpan: { text: 'raw text' } })]);
    render(<IntentSuggestionTray entryId="e1" />);
    expect(screen.getByText('raw text')).toBeTruthy();
  });
});

describe('IntentSuggestionTray - actions', () => {
  it('Keep calls keepIntent with (db, uid, id, versions) and hides the row', () => {
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Keep'));

    expect(keepIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', undefined);
    expect(setIntentUserText).not.toHaveBeenCalled();
    expect(screen.queryByText('call the vet')).toBeNull();
  });

  it('No thanks calls dismissIntent with (db, uid, id, null, versions) and hides the row', () => {
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('No thanks'));

    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', null, undefined);
    expect(keepIntent).not.toHaveBeenCalled();
    expect(screen.queryByText('call the vet')).toBeNull();
  });

  // INT-02 part 2 item 1: the tray already holds the subscribed intent doc,
  // so it passes that doc's `versions` field through to keepIntent/
  // dismissIntent verbatim (intentClient copies it onto the paired decision).
  it('passes the suggestion\'s versions snapshot through to keepIntent', () => {
    const versions = { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 2 };
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' }, versions })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Keep'));

    expect(keepIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', versions);
  });

  it('passes the suggestion\'s versions snapshot through to dismissIntent', () => {
    const versions = { extraction: 1, model: 'gemini-3.5-flash', prompt: 1, schema: 2 };
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' }, versions })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('No thanks'));

    expect(dismissIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', null, versions);
  });

  it('Edit shows an inline input prefilled with the display text', () => {
    suggestedWith([intent({ id: 'intent-1', userText: null, sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Edit'));

    expect(screen.getByDisplayValue('call the vet')).toBeTruthy();
  });

  it('A11Y-02: the edit input has a programmatic label and is text-base (16px, avoids iOS auto-zoom)', () => {
    suggestedWith([intent({ id: 'intent-1', userText: null, sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText('Edit suggestion text');
    expect(input).toBe(screen.getByDisplayValue('call the vet'));
    expect(input.className).toMatch(/\btext-base\b/);
  });

  it('Edit confirm calls setIntentUserText then keepIntent with the edited text, and hides the row', async () => {
    suggestedWith([intent({ id: 'intent-1', userText: null, sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByDisplayValue('call the vet');
    fireEvent.change(input, { target: { value: 'call the vet tomorrow' } });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(keepIntent).toHaveBeenCalled();
    });

    expect(setIntentUserText).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', 'call the vet tomorrow');
    expect(keepIntent).toHaveBeenCalledWith({ __db: true }, 'user-1', 'intent-1', undefined);
    // setIntentUserText must be called before keepIntent (userText persisted before activation).
    expect(setIntentUserText.mock.invocationCallOrder[0]).toBeLessThan(keepIntent.mock.invocationCallOrder[0]);
    expect(screen.queryByText('call the vet tomorrow')).toBeNull();
  });

  it('Edit cancel discards the edit without calling any intent helpers', () => {
    suggestedWith([intent({ id: 'intent-1', userText: null, sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByDisplayValue('call the vet');
    fireEvent.change(input, { target: { value: 'something else' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(keepIntent).not.toHaveBeenCalled();
    expect(setIntentUserText).not.toHaveBeenCalled();
    expect(dismissIntent).not.toHaveBeenCalled();
    expect(screen.getByText('call the vet')).toBeTruthy();
  });
});

describe('IntentSuggestionTray - INT-02 failure handling', () => {
  it('Keep failure restores the row and shows a quiet, non-alarming failure message', async () => {
    keepIntent.mockRejectedValueOnce(new Error('offline'));
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Keep'));
    // Optimistic removal happens synchronously.
    expect(screen.queryByText('call the vet')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('call the vet')).toBeTruthy();
    });
    const message = screen.getByText(/couldn.t save/i);
    expect(message).toBeTruthy();
    expect(message.textContent).not.toMatch(/error|fail|alert/i);
  });

  it('Dismiss failure restores the row and shows the failure message', async () => {
    dismissIntent.mockRejectedValueOnce(new Error('permission-denied'));
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('No thanks'));
    expect(screen.queryByText('call the vet')).toBeNull();

    await vi.waitFor(() => {
      expect(screen.getByText('call the vet')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('Edit-confirm failure restores the row with the just-typed text (not lost)', async () => {
    keepIntent.mockRejectedValueOnce(new Error('offline'));
    suggestedWith([intent({ id: 'intent-1', userText: null, sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByDisplayValue('call the vet');
    fireEvent.change(input, { target: { value: 'call the vet tomorrow' } });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => {
      expect(screen.getByText('call the vet tomorrow')).toBeTruthy();
      expect(screen.getByText(/couldn.t save/i)).toBeTruthy();
    });
  });

  it('a successful action leaves no failure message behind', async () => {
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Keep'));
    await vi.waitFor(() => expect(keepIntent).toHaveBeenCalled());
    expect(screen.queryByText(/couldn.t save/i)).toBeNull();
  });

  it('guards against a re-entrant call for the same row while its action is still in flight (e.g. a subscription refire mid-commit)', async () => {
    let resolveKeep;
    keepIntent.mockImplementationOnce(() => new Promise((resolve) => { resolveKeep = resolve; }));
    let deliver;
    subscribeSuggestedIntentsForEntry.mockImplementation((_db, _uid, _entryId, cb) => {
      deliver = cb;
      cb([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
      return () => {};
    });
    render(<IntentSuggestionTray entryId="e1" />);

    fireEvent.click(screen.getByText('Keep'));
    expect(keepIntent).toHaveBeenCalledTimes(1);

    // The live subscription refires mid-flight and re-delivers the doc
    // (its state hasn't changed yet — the batch commit is still pending) —
    // the row genuinely reappears in the DOM.
    act(() => {
      deliver([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    });
    expect(screen.getByText('call the vet')).toBeTruthy();

    // A second tap on it while busy must NOT fire a second keepIntent.
    fireEvent.click(screen.getByText('Keep'));
    expect(keepIntent).toHaveBeenCalledTimes(1);

    resolveKeep();
    await vi.waitFor(() => {}); // let the in-flight promise settle
  });
});

describe('IntentSuggestionTray - copy', () => {
  it('uses quiet, non-guilt labels', () => {
    suggestedWith([intent({ kind: 'task' })]);
    render(<IntentSuggestionTray entryId="e1" />);
    const text = document.body.textContent;
    expect(text).not.toMatch(/overdue/i);
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/you (missed|forgot|failed)/i);
  });
});

describe('IntentSuggestionTray - A11Y-02: touch targets', () => {
  it('Keep/Edit/No thanks all meet the 44px minimum height', () => {
    suggestedWith([intent({ id: 'intent-1', sourceSpan: { text: 'call the vet' } })]);
    render(<IntentSuggestionTray entryId="e1" />);
    for (const label of ['Keep', 'Edit', 'No thanks']) {
      expect(screen.getByText(label).className).toMatch(/\bmin-h-11\b/);
    }
  });
});
