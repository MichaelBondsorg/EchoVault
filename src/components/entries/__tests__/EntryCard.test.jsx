import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

const subscribeSpaces = vi.fn();
vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: (...a) => subscribeSpaces(...a),
}));

// IntentSuggestionTray is rendered by EntryCard — stub its service so the
// real module (which imports config/firebase) is never loaded.
vi.mock('../../../services/intents/intentClient', () => ({
  subscribeSuggestedIntentsForEntry: vi.fn(() => () => {}),
  keepIntent: vi.fn(),
  dismissIntent: vi.fn(),
  setIntentUserText: vi.fn(),
}));

const { default: EntryCard } = await import('../EntryCard');

function baseEntry(overrides = {}) {
  return {
    id: 'entry-1',
    text: 'Some entry text',
    title: 'Entry title',
    category: 'personal',
    createdAt: new Date('2026-07-20T10:00:00Z'),
    effectiveDate: new Date('2026-07-20T10:00:00Z'),
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // contextSpaces on, everything else (intentExtraction/openLoops) off —
  // keeps IntentSuggestionTray a no-op so these tests stay focused.
  getFlag.mockImplementation((flag) => flag === 'contextSpaces');
  subscribeSpaces.mockReturnValue(() => {});
});

describe('EntryCard — Space chip gating (flag: contextSpaces)', () => {
  it('renders no Space chip and does not subscribe when the flag is off', () => {
    getFlag.mockImplementation(() => false);
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.queryByLabelText('Assign a space')).toBeNull();
    expect(subscribeSpaces).not.toHaveBeenCalled();
  });

  it('subscribes to active spaces (db, uid, cb) when the flag is on', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(subscribeSpaces).toHaveBeenCalledWith({ __db: true }, 'user-1', expect.any(Function));
  });
});

describe('EntryCard — Space chip display + re-scoping', () => {
  it('shows nothing but the icon when the entry is unscoped', () => {
    render(<EntryCard entry={baseEntry({ spaceId: undefined })} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText('Assign a space')).toBeTruthy();
  });

  it("resolves the entry's Space name from the subscribed spaces list", () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
      return () => {};
    });
    render(<EntryCard entry={baseEntry({ spaceId: 'space-2' })} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText('Space: Personal')).toBeTruthy();
  });

  it('tapping the chip opens a popover listing active spaces + "No space"', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
  });

  it('selecting a space calls onUpdate with EXACTLY {spaceId, updatedAt}', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [entryId, payload] = onUpdate.mock.calls[0];
    expect(entryId).toBe('entry-1');
    expect(payload.spaceId).toBe('space-1');
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
  });

  it('selecting "No space" clears spaceId to null via the same exact payload shape', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry({ spaceId: 'space-1' })} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Space: Work'));
    fireEvent.click(screen.getByText('No space'));

    const [, payload] = onUpdate.mock.calls[0];
    expect(payload.spaceId).toBeNull();
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
  });

  it('never includes createdAt/effectiveDate/transcription in the re-scope payload', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(
      <EntryCard
        entry={baseEntry({ transcription: { rawTranscript: 'raw' } })}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />
    );
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    const [, payload] = onUpdate.mock.calls[0];
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('effectiveDate');
    expect(payload).not.toHaveProperty('transcription');
  });
});

describe('EntryCard — Space chip popover dismissal (review fix)', () => {
  beforeEach(() => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
  });

  it('an outside pointerdown closes the open popover', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('Escape closes the open popover', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('a click inside the popover does not get treated as outside (selection still applies)', () => {
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.pointerDown(screen.getByText('Work'));
    fireEvent.click(screen.getByText('Work'));

    expect(onUpdate).toHaveBeenCalledWith('entry-1', expect.objectContaining({ spaceId: 'space-1' }));
  });
});
