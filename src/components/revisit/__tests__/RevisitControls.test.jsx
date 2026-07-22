/**
 * RevisitControls tests (R2 Task 20; GR2 exclusions-before-first-enable
 * step added per Michael's review — see the component's own doc comment).
 *
 * Exercises the REAL `revisitService` module (mirrors
 * `revisitService.test.js`'s mock harness, plus the real
 * `ownerScopedStorage`/`ownerScope` modules for the onboarding-seen
 * marker) — only `config/firebase`, `config/constants`, and `config/flags`
 * are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

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
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(async () => {}),
  writeBatch: vi.fn(() => makeBatch()),
};
vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));

const { default: RevisitControls } = await import('../RevisitControls');

const UID = 'user-1';
const SETTINGS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/settings';
const EXCLUSIONS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_exclusions';
const QUEUE_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_queue';

const EXPLAINER_NAME = /before you turn on gentle revisit/i;
const EXCLUSIONS_STEP_NAME = /anything you.?d like to keep out/i;

function docsSnapshot(rows) {
  return { docs: rows.map((r) => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })) };
}

async function flushPromises() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential drain
      await Promise.resolve();
    }
  });
}

// The global test setup (src/test/setup.js) stubs `window.localStorage`
// with bare `vi.fn()` spies (no real backing store) — needed here since
// the onboarding-seen marker (`ownerStorageKey`-scoped) round-trips through
// real `localStorage.getItem`/`setItem`. Give those same spies an in-memory
// Map-backed implementation for this file only (never touches setup.js).
const localStorageStore = new Map();

beforeEach(() => {
  vi.clearAllMocks();
  batchInstances = [];
  localStorageStore.clear();
  window.localStorage.getItem.mockImplementation((key) => (localStorageStore.has(key) ? localStorageStore.get(key) : null));
  window.localStorage.setItem.mockImplementation((key, value) => { localStorageStore.set(key, String(value)); });
  window.localStorage.removeItem.mockImplementation((key) => { localStorageStore.delete(key); });
  window.localStorage.clear.mockImplementation(() => { localStorageStore.clear(); });
  getFlag.mockReturnValue(true);
  mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  mocks.getDocs.mockResolvedValue(docsSnapshot([]));
  mocks.addDoc.mockResolvedValue({ id: 'excl-1' });
  mocks.writeBatch.mockImplementation(() => makeBatch());
});

async function renderControls(props = {}) {
  const onClose = vi.fn();
  const onEnabledChange = vi.fn();
  const utils = render(<RevisitControls uid={UID} onClose={onClose} onEnabledChange={onEnabledChange} {...props} />);
  await flushPromises();
  return { ...utils, onClose, onEnabledChange };
}

describe('RevisitControls — load', () => {
  it('renders the current enabled state and exclusion list from the real service', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true }) });
    mocks.getDocs.mockResolvedValue(docsSnapshot([
      { id: 'ex-1', dimension: 'entry', value: 'entry-9', reason: 'never_show', permanent: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]));

    await renderControls();

    expect(mocks.doc).toHaveBeenCalledWith(mocks.db, SETTINGS_PATH, 'revisitPrefs');
    const toggle = screen.getByRole('switch', { name: /gentle revisit/i });
    expect(toggle.getAttribute('data-state')).toBe('checked');
    expect(screen.getByText('entry-9')).toBeTruthy();
  });
});

describe('RevisitControls — onboarding: explainer step', () => {
  it('shows the explainer sheet before enabling, and does NOT call setRevisitEnabled yet', async () => {
    const { onEnabledChange } = await renderControls();

    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));

    const dialog = await screen.findByRole('dialog', { name: EXPLAINER_NAME });
    // Exact-string matches (not regex substrings) — a regex would also match
    // the paragraphs' shared ancestor `<div>` (whose concatenated text
    // contains every paragraph), throwing a multiple-elements error.
    expect(within(dialog).getByText(
      'What it does — occasionally shows a single calm entry from your journal, and you choose whether to open it.',
    )).toBeTruthy();
    expect(within(dialog).getByText(
      "What's excluded — entries flagged for safety or with warning indicators are never eligible, and anything you hide or exclude here stays hidden.",
    )).toBeTruthy();
    expect(within(dialog).getByText(
      'How to stop — turn the toggle back off anytime; anything waiting is cleared immediately.',
    )).toBeTruthy();
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(onEnabledChange).not.toHaveBeenCalled();
  });

  it('"Not now" closes the sheet without enabling', async () => {
    await renderControls();
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));
    await screen.findByRole('dialog', { name: EXPLAINER_NAME });

    fireEvent.click(screen.getByText('Not now'));

    // The RevisitControls root itself is also `role="dialog"` (PrivacyCenter
    // template) — scope by accessible name to the nested onboarding sheet.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: EXPLAINER_NAME })).toBeNull());
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: /gentle revisit/i }).getAttribute('data-state')).toBe('unchecked');
  });

  it('never shows the explainer again once marked seen, even across a disable/re-enable', async () => {
    await renderControls();
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));
    await screen.findByRole('dialog', { name: EXPLAINER_NAME });
    fireEvent.click(screen.getByText('Continue'));
    const exclusionsDialog = await screen.findByRole('dialog', { name: EXCLUSIONS_STEP_NAME });
    fireEvent.click(within(exclusionsDialog).getByText('Skip for now'));
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));

    // Disable, then re-enable — explainer must not reappear.
    mocks.setDoc.mockClear();
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i })); // off
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i })); // on again
    await screen.findByRole('dialog', { name: EXCLUSIONS_STEP_NAME });
    expect(screen.queryByRole('dialog', { name: EXPLAINER_NAME })).toBeNull();
  });
});

describe('RevisitControls — onboarding: exclusions step (GR2)', () => {
  async function openExclusionsStepFirstTime() {
    const utils = await renderControls();
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));
    await screen.findByRole('dialog', { name: EXPLAINER_NAME });
    fireEvent.click(screen.getByText('Continue'));
    const dialog = await screen.findByRole('dialog', { name: EXCLUSIONS_STEP_NAME });
    return { ...utils, dialog };
  }

  it('is shown after the explainer, before any enable call, and "Skip for now" then enables', async () => {
    const { onEnabledChange, dialog } = await openExclusionsStepFirstTime();
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(onEnabledChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText('Skip for now'));

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));
    const [, payload, opts] = mocks.setDoc.mock.calls[0];
    expect(payload.enabled).toBe(true);
    expect(opts).toEqual({ merge: true });
    expect(onEnabledChange).toHaveBeenCalledWith(true);
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: EXCLUSIONS_STEP_NAME })).toBeNull();
  });

  it('adding a Space and a Date exclusion writes exact hidden_dim payloads, then "Done" enables', async () => {
    mocks.addDoc.mockResolvedValueOnce({ id: 'excl-space' }).mockResolvedValueOnce({ id: 'excl-date' });
    const { onEnabledChange, dialog } = await openExclusionsStepFirstTime();

    fireEvent.change(within(dialog).getByLabelText('Dimension to hide'), { target: { value: 'space' } });
    fireEvent.change(within(dialog).getByLabelText(/value to hide/i), { target: { value: 'Family' } });
    fireEvent.click(within(dialog).getByText('Hide'));
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));

    fireEvent.change(within(dialog).getByLabelText('Dimension to hide'), { target: { value: 'date' } });
    fireEvent.change(within(dialog).getByLabelText(/value to hide/i), { target: { value: '2026-01-01' } });
    fireEvent.click(within(dialog).getByText('Hide'));
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(2));

    const [, spacePayload] = mocks.addDoc.mock.calls[0];
    expect(spacePayload).toMatchObject({ dimension: 'space', value: 'Family', reason: 'hidden_dim', permanent: true });
    const [, datePayload] = mocks.addDoc.mock.calls[1];
    expect(datePayload).toMatchObject({ dimension: 'date', value: '2026-01-01', reason: 'hidden_dim', permanent: true });

    expect(mocks.setDoc).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText('Done — turn on Gentle Revisit'));

    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));
    expect(mocks.setDoc.mock.calls[0][1].enabled).toBe(true);
    expect(onEnabledChange).toHaveBeenCalledWith(true);
  });

  it('abandoning (closing the sheet) after adding an exclusion does NOT enable, but the exclusion is written', async () => {
    const { onEnabledChange, dialog } = await openExclusionsStepFirstTime();

    fireEvent.change(within(dialog).getByLabelText('Dimension to hide'), { target: { value: 'tag' } });
    fireEvent.change(within(dialog).getByLabelText(/value to hide/i), { target: { value: 'grief' } });
    fireEvent.click(within(dialog).getByText('Hide'));
    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: EXCLUSIONS_STEP_NAME })).toBeNull());
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(onEnabledChange).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: /gentle revisit/i }).getAttribute('data-state')).toBe('unchecked');
    // The exclusion itself is NOT rolled back — it's a suppression-only
    // write, safe to keep even though the user never finished opting in.
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
  });

  it('is re-offered on every subsequent enable, even after the explainer has been seen', async () => {
    const { dialog: firstDialog } = await openExclusionsStepFirstTime();
    fireEvent.click(within(firstDialog).getByText('Skip for now'));
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));

    mocks.setDoc.mockClear();
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i })); // off
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));
    mocks.setDoc.mockClear();

    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i })); // on again
    // No explainer this time — straight to the exclusions step.
    expect(screen.queryByRole('dialog', { name: EXPLAINER_NAME })).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: EXCLUSIONS_STEP_NAME });
    expect(mocks.setDoc).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText('Done — turn on Gentle Revisit'));
    await waitFor(() => expect(mocks.setDoc).toHaveBeenCalledTimes(1));
    expect(mocks.setDoc.mock.calls[0][1].enabled).toBe(true);
  });
});

describe('RevisitControls — toggle off (disable clears the queue)', () => {
  it('calls setRevisitEnabled(false), which deletes every queued doc via the real service', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true }) });
    // setRevisitEnabled(false) internally re-queries queued docs — this
    // mock covers both the initial load's listRevisitExclusions AND that
    // later query, since both use getDocs; the shape here matches what
    // setRevisitEnabled expects (a queued-docs snapshot).
    mocks.getDocs.mockResolvedValue(docsSnapshot([{ id: 'rq-1' }, { id: 'rq-2' }]));

    const { onEnabledChange } = await renderControls();
    expect(screen.getByRole('switch', { name: /gentle revisit/i }).getAttribute('data-state')).toBe('checked');

    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));

    await waitFor(() => expect(mocks.writeBatch).toHaveBeenCalledTimes(1));
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, QUEUE_PATH);
    const batch = batchInstances[0];
    expect(batch.delete).toHaveBeenCalledTimes(2);
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(onEnabledChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('switch', { name: /gentle revisit/i }).getAttribute('data-state')).toBe('unchecked');
  });
});

describe('RevisitControls — hidden dimensions', () => {
  it('adds a hide-by-tag row as {dimension, value, reason:"hidden_dim", permanent:true}', async () => {
    await renderControls();

    fireEvent.change(screen.getByLabelText('Dimension to hide'), { target: { value: 'tag' } });
    fireEvent.change(screen.getByLabelText(/value to hide/i), { target: { value: 'grief' } });
    fireEvent.click(screen.getByText('Hide'));

    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));
    expect(mocks.collection).toHaveBeenCalledWith(mocks.db, EXCLUSIONS_PATH);
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'dimension', 'permanent', 'reason', 'value']);
    expect(payload).toMatchObject({ dimension: 'tag', value: 'grief', reason: 'hidden_dim', permanent: true });

    expect(await screen.findByText('grief')).toBeTruthy();
  });

  it('does not submit an empty value', async () => {
    await renderControls();
    fireEvent.click(screen.getByText('Hide'));
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a value to hide.')).toBeTruthy();
  });

  it('offers "Space" as a dimension only when contextSpaces is on', async () => {
    getFlag.mockImplementation((f) => f !== 'contextSpaces');
    await renderControls();
    const select = screen.getByLabelText('Dimension to hide');
    expect(within(select).queryByText('Space')).toBeNull();
  });

  it('includes "Space" as a dimension when contextSpaces is on', async () => {
    await renderControls();
    const select = screen.getByLabelText('Dimension to hide');
    expect(within(select).getByText('Space')).toBeTruthy();
  });
});

describe('RevisitControls — exclusion list remove/restore', () => {
  it('removes an exclusion (delete-to-restore, no update path) and rolls back on failure', async () => {
    mocks.getDocs.mockResolvedValue(docsSnapshot([
      { id: 'ex-1', dimension: 'tag', value: 'grief', reason: 'hidden_dim', permanent: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]));
    await renderControls();
    expect(screen.getByText('grief')).toBeTruthy();

    mocks.deleteDoc.mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(mocks.deleteDoc).toHaveBeenCalledWith({ __doc: `${EXCLUSIONS_PATH}/ex-1` }));
    await screen.findByText('Could not remove that exclusion. Please try again.');
    expect(screen.getByText('grief')).toBeTruthy(); // rolled back

    mocks.deleteDoc.mockResolvedValueOnce();
    fireEvent.click(screen.getByText('Remove'));
    await waitFor(() => expect(screen.queryByText('grief')).toBeNull());
  });
});

describe('RevisitControls — copy', () => {
  it('never renders guilt/streak/anniversary language, including inside both onboarding steps', async () => {
    mocks.getDocs.mockResolvedValue(docsSnapshot([
      { id: 'ex-1', dimension: 'tag', value: 'grief', reason: 'hidden_dim', permanent: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]));
    await renderControls();
    // Walk through both onboarding steps so their copy is included in the sweep.
    fireEvent.click(screen.getByRole('switch', { name: /gentle revisit/i }));
    await screen.findByRole('dialog', { name: EXPLAINER_NAME });
    fireEvent.click(screen.getByText('Continue'));
    await screen.findByRole('dialog', { name: EXCLUSIONS_STEP_NAME });

    const text = document.body.textContent;
    expect(text).not.toMatch(/streak/i);
    expect(text).not.toMatch(/anniversary/i);
    expect(text).not.toMatch(/you (missed|forgot|failed|didn'?t)/i);
    expect(text).not.toMatch(/don'?t break/i);
    expect(text).not.toMatch(/\bday[s]? in a row\b/i);
  });
});
