/**
 * RevisitWidget tests (R2 Task 20).
 *
 * Exercises the REAL `revisitService` module (mirrors
 * `revisitService.test.js`'s mock harness) — only `config/firebase` and
 * `config/constants` are mocked, so every assertion below on
 * addDoc/updateDoc/getDoc payloads is proof the widget calls the service
 * with contract-correct arguments, not just that some jest.fn() was called.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let batchInstances = [];
function makeBatch() {
  const batch = { delete: vi.fn(), commit: vi.fn(async () => {}) };
  batchInstances.push(batch);
  return batch;
}

const mocks = {
  db: {},
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((...args) => {
    const [, path, id] = args;
    return { __doc: `${path}/${id}` };
  }),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(async () => ({ id: 'excl-1' })),
  deleteDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => true, data: () => ({ enabled: true }) })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(async () => {}),
  writeBatch: vi.fn(() => makeBatch()),
};
vi.mock('../../../../config/firebase', () => mocks);
vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const getFlag = vi.fn();
vi.mock('../../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

// GlassCard just renders its children in tests (OpenLoopsWidget precedent).
vi.mock('../../GlassCard', () => ({ default: ({ children }) => <div>{children}</div> }));

const subscribeSpaces = vi.fn(() => () => {});
vi.mock('../../../../services/spaces/spacesService', () => ({ subscribeSpaces: (...a) => subscribeSpaces(...a) }));

// RevisitControls gets its own dedicated test file — mocked here purely to
// isolate RevisitWidget's own "Manage" wiring (open/close/focus-restore),
// not the service layer (which stays real, see file header).
vi.mock('../../../revisit/RevisitControls', () => ({
  default: ({ onClose, onEnabledChange }) => (
    <div>
      <p>Manage Mock</p>
      <button type="button" onClick={onClose}>Close Manage Mock</button>
      <button type="button" onClick={() => onEnabledChange?.(false)}>Disable Mock</button>
    </div>
  ),
}));

const { default: RevisitWidget, deriveTopThemeOrEntity } = await import('../RevisitWidget');

const UID = 'user-1';
const QUEUE_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_queue';
const EXCLUSIONS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_exclusions';

function docsSnapshot(rows) {
  return { docs: rows.map((r) => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })) };
}

function queueItem(overrides = {}) {
  return {
    id: 'rq-1',
    entryId: 'entry-1',
    spaceId: null,
    status: 'queued',
    reason: 'A calm moment from March 2026',
    dueDate: '2026-07-21',
    ...overrides,
  };
}

/** Wires onSnapshot so subscribeTodayRevisit fires with `item` (or null → empty). */
function pushQueueItem(item) {
  mocks.onSnapshot.mockImplementation((_q, onNext) => {
    onNext(item ? docsSnapshot([item]) : { empty: true, docs: [] });
    return () => {};
  });
}

function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    text: 'It was a quiet afternoon by the lake, and everything felt still.',
    effectiveDate: '2026-03-14T00:00:00.000Z',
    analysis: { themes: ['calm'], entities: [{ name: 'Lake Tahoe' }] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batchInstances = [];
  getFlag.mockReturnValue(true); // gentleRevisit + contextSpaces both on by default
  subscribeSpaces.mockReturnValue(() => {});
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true }) });
  mocks.getDocs.mockResolvedValue(docsSnapshot([]));
  mocks.addDoc.mockResolvedValue({ id: 'excl-1' });
  mocks.onSnapshot.mockReturnValue(() => {});
});

/**
 * Drains several microtask turns — `getRevisitPrefs` is a real `async`
 * function chained through `.then()` inside the widget's effect, so a
 * single `act(async () => {})` tick isn't reliably enough to settle it.
 */
async function flushPromises() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential drain
      await Promise.resolve();
    }
  });
}

async function renderWidget(props = {}) {
  const utils = render(<RevisitWidget entries={[makeEntry()]} {...props} />);
  await flushPromises();
  return utils;
}

describe('RevisitWidget — null states', () => {
  it('renders null when gentleRevisit flag is off', async () => {
    getFlag.mockImplementation((f) => f !== 'gentleRevisit');
    pushQueueItem(queueItem());
    const { container } = await renderWidget();
    expect(container.firstChild).toBeNull();
  });

  it('renders null when prefs.enabled is false', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: false }) });
    pushQueueItem(queueItem());
    const { container } = await renderWidget();
    expect(container.firstChild).toBeNull();
    expect(mocks.getDoc).toHaveBeenCalled();
  });

  it('renders null when there is no queue doc for today', async () => {
    pushQueueItem(null);
    const { container } = await renderWidget();
    expect(container.firstChild).toBeNull();
  });

  it('renders null when the queued doc has status "dismissed"', async () => {
    pushQueueItem(queueItem({ status: 'dismissed' }));
    const { container } = await renderWidget();
    expect(container.firstChild).toBeNull();
  });
});

describe('RevisitWidget — preview (status "queued")', () => {
  it('shows the reason line and Space chip, but withholds entry text until Show', async () => {
    pushQueueItem(queueItem({ spaceId: 'space-1' }));
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    await renderWidget();

    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
    expect(screen.queryByText(/quiet afternoon by the lake/)).toBeNull();
    expect(screen.getByText('Show')).toBeTruthy();
  });

  it('omits the Space chip when contextSpaces is off, even with a spaceId', async () => {
    getFlag.mockImplementation((f) => f !== 'contextSpaces');
    pushQueueItem(queueItem({ spaceId: 'space-1' }));
    await renderWidget();
    expect(screen.queryByText('Work')).toBeNull();
  });

  it('omits the Space chip when there is no spaceId', async () => {
    pushQueueItem(queueItem({ spaceId: null }));
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    await renderWidget();
    expect(screen.queryByText('Work')).toBeNull();
  });

  it('falls back to a neutral reason line when the doc has none', async () => {
    pushQueueItem(queueItem({ reason: undefined }));
    await renderWidget();
    expect(screen.getByText('A memory from your journal')).toBeTruthy();
  });
});

describe('RevisitWidget — status "shown" (remount after Show)', () => {
  it('renders revealed directly, with no Show button', async () => {
    pushQueueItem(queueItem({ status: 'shown' }));
    await renderWidget();
    expect(screen.getByText(/quiet afternoon by the lake/)).toBeTruthy();
    expect(screen.queryByText('Show')).toBeNull();
  });
});

describe('RevisitWidget — Show', () => {
  it('reveals the entry text inline and calls markShown with {status:"shown"}', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    expect(screen.queryByText(/quiet afternoon by the lake/)).toBeNull();
    fireEvent.click(screen.getByText('Show'));

    expect(screen.getByText(/quiet afternoon by the lake/)).toBeTruthy();
    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, QUEUE_PATH, 'rq-1');
    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.updateDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('shown');
  });
});

describe('RevisitWidget — Not now', () => {
  it('calls dismissRevisit with {status:"dismissed"} and writes NO exclusion', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    fireEvent.click(screen.getByText('Not now'));

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.updateDoc.mock.calls[0];
    expect(payload.status).toBe('dismissed');
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('RevisitWidget — Never show this entry', () => {
  it('opens a confirm dialog; confirming writes the exact exclusion payload then dismisses', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    fireEvent.click(screen.getByText('Never show this entry'));
    const dialog = await screen.findByRole('dialog', { name: /never show this entry again/i });
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByText('Never show'));

    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, EXCLUSIONS_PATH);
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'dimension', 'permanent', 'reason', 'value']);
    expect(payload).toMatchObject({
      dimension: 'entry',
      value: 'entry-1',
      reason: 'never_show',
      permanent: true,
    });

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1));
    expect(mocks.updateDoc.mock.calls[0][1].status).toBe('dismissed');
  });

  it('Cancel closes the dialog and writes nothing', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    fireEvent.click(screen.getByText('Never show this entry'));
    await screen.findByRole('dialog', { name: /never show this entry again/i });
    fireEvent.click(screen.getByText('Cancel'));

    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('RevisitWidget — Less like this', () => {
  it('writes {dimension:"family", value: topThemeOrEntity, reason:"less_like_this", permanent:false, expiresAt} then dismisses, with no explanation prompt', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    fireEvent.click(screen.getByText('Less like this'));

    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'dimension', 'expiresAt', 'permanent', 'reason', 'value']);
    expect(payload).toMatchObject({
      dimension: 'family',
      value: 'calm', // entries fixture's analysis.themes[0]
      reason: 'less_like_this',
      permanent: false,
    });
    expect(typeof payload.expiresAt).toBe('string');
    // 90 days out, not permanent/never.
    const days = (new Date(payload.expiresAt) - new Date(payload.createdAt)) / 86400000;
    expect(days).toBeCloseTo(90, 0);

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalledTimes(1));
    expect(mocks.updateDoc.mock.calls[0][1].status).toBe('dismissed');

    // No explanation prompt — no dialog/textarea appears anywhere.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the action entirely when the entry has neither theme nor entity', async () => {
    pushQueueItem(queueItem({ entryId: 'entry-2' }));
    await renderWidget({ entries: [makeEntry({ id: 'entry-2', analysis: {} })] });
    expect(screen.queryByText('Less like this')).toBeNull();
  });

  it('deriveTopThemeOrEntity prefers theme over entity, then falls back to entity, then null', () => {
    expect(deriveTopThemeOrEntity({ analysis: { themes: ['grief'], entities: [{ name: 'Sam' }] } })).toBe('grief');
    expect(deriveTopThemeOrEntity({ analysis: { entities: [{ name: 'Sam' }] } })).toBe('Sam');
    expect(deriveTopThemeOrEntity({ analysis: {} })).toBeNull();
    expect(deriveTopThemeOrEntity(undefined)).toBeNull();
  });
});

describe('RevisitWidget — Manage', () => {
  it('opens RevisitControls and restores focus to the Manage trigger on close', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    const manageButton = screen.getByText('Manage');
    fireEvent.click(manageButton);
    expect(screen.getByText('Manage Mock')).toBeTruthy();

    fireEvent.click(screen.getByText('Close Manage Mock'));
    expect(screen.queryByText('Manage Mock')).toBeNull();
    expect(document.activeElement).toBe(manageButton);
  });

  it('keeps the Manage overlay mounted even if it disables Gentle Revisit mid-session', async () => {
    pushQueueItem(queueItem());
    await renderWidget();

    fireEvent.click(screen.getByText('Manage'));
    fireEvent.click(screen.getByText('Disable Mock'));

    // The card itself disappears (prefsEnabled flipped false)...
    expect(screen.queryByText('A calm moment from March 2026')).toBeNull();
    // ...but the still-open Manage overlay is not yanked out from under the user.
    expect(screen.getByText('Manage Mock')).toBeTruthy();
  });
});

describe('RevisitWidget — copy', () => {
  it('never renders guilt/streak/anniversary language', async () => {
    pushQueueItem(queueItem({ status: 'shown' }));
    await renderWidget();

    const text = document.body.textContent;
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/anniversary/i);
    expect(text).not.toMatch(/you (missed|forgot|failed|didn'?t)/i);
    expect(text).not.toMatch(/don'?t break/i);
    expect(text).not.toMatch(/\bday[s]? in a row\b/i);
  });
});
