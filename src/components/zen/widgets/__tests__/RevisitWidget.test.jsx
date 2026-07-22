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

const { default: RevisitWidget, deriveTopThemeOrEntity, currentStateGateTripped } = await import('../RevisitWidget');

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

// Production entry shape (R2 review fix): `orchestrator.js`'s
// `buildSuccessPayload` writes top-level `tags` and an `analysis` object
// with ONLY {mood_score, framework, cbt_breakdown, act_analysis,
// vent_support, celebration, task_acknowledgment} — never
// `analysis.themes`/`analysis.entities`. Fixtures below mirror that exactly
// so `deriveTopThemeOrEntity`'s tests don't encode the same wrong schema the
// bug did.
function makeEntry(overrides = {}) {
  return {
    id: 'entry-1',
    text: 'It was a quiet afternoon by the lake, and everything felt still.',
    effectiveDate: '2026-03-14T00:00:00.000Z',
    analysis: { mood_score: 0.6, framework: 'general' },
    tags: ['calm'],
    ...overrides,
  };
}

/**
 * Replicates `matchesExclusion`'s `family` predicate
 * (`functions/src/revisit/selectRevisits.js`) so this frontend test can
 * prove a written exclusion value would actually match server-side, WITHOUT
 * cross-importing a Cloud Functions module (which pulls in
 * firebase-admin/firebase-functions at module scope — not something a
 * frontend widget test should depend on). Kept in exact lockstep with the
 * real function's logic; `selectRevisits.test.js` owns the authoritative
 * tests for the real predicate itself.
 */
function familyExclusionWouldMatch(entry, value) {
  const entityValues = (entry.entities || []).map((e) => e?.id || e?.name).filter(Boolean);
  return entityValues.includes(value) || (Array.isArray(entry.tags) && entry.tags.includes(value));
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

describe('RevisitWidget — status "shown" (remount after Show, Round 2 per-session reveal)', () => {
  it('renders the PREVIEW (entry text withheld) on a fresh mount, with the Show action present again', async () => {
    pushQueueItem(queueItem({ status: 'shown' }));
    await renderWidget();
    expect(screen.queryByText(/quiet afternoon by the lake/)).toBeNull();
    expect(screen.getByText('Show')).toBeTruthy();
    // The card itself is still rendered (live selection, other actions apply).
    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy();
  });

  it('tapping Show on a remounted "shown" doc reveals locally WITHOUT re-calling markShown (no duplicate write)', async () => {
    pushQueueItem(queueItem({ status: 'shown' }));
    await renderWidget();

    fireEvent.click(screen.getByText('Show'));

    expect(screen.getByText(/quiet afternoon by the lake/)).toBeTruthy();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
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

  it('failure: markShown rejecting rolls back the reveal and shows an inline error', async () => {
    pushQueueItem(queueItem());
    mocks.updateDoc.mockRejectedValueOnce(new Error('boom'));
    await renderWidget();

    fireEvent.click(screen.getByText('Show'));
    // Optimistic reveal happens immediately, before the rejection settles —
    // the Show button itself unmounts at that point (only rendered while
    // `!revealed`), which is itself the double-submit guard for this action.
    expect(screen.getByText(/quiet afternoon by the lake/)).toBeTruthy();
    expect(screen.queryByText('Show')).toBeNull();

    await screen.findByText("Couldn't save that you viewed this. Please try again.");
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    // Rolled back: entry text hidden again, Show button back.
    expect(screen.queryByText(/quiet afternoon by the lake/)).toBeNull();
    expect(screen.getByText('Show')).toBeTruthy();
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

  it('failure: dismissRevisit rejecting shows an inline error, keeps the card, and guards against double-submit', async () => {
    pushQueueItem(queueItem());
    mocks.updateDoc.mockRejectedValueOnce(new Error('boom'));
    await renderWidget();

    fireEvent.click(screen.getByText('Not now'));
    fireEvent.click(screen.getByText('Dismissing…')); // double-click while in flight — guarded, no-op

    await screen.findByText("Couldn't dismiss this. Please try again.");
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1); // not called twice
    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy(); // card intact
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

  it('failure: addRevisitExclusion rejecting shows an inline error inside the dialog, keeps it open, and guards against double-submit', async () => {
    pushQueueItem(queueItem());
    mocks.addDoc.mockRejectedValueOnce(new Error('boom'));
    await renderWidget();

    fireEvent.click(screen.getByText('Never show this entry'));
    const dialog = await screen.findByRole('dialog', { name: /never show this entry again/i });

    fireEvent.click(screen.getByText('Never show'));
    fireEvent.click(screen.getByText('Excluding…')); // double-click while in flight — guarded, no-op

    await within(dialog).findByText("Couldn't exclude this entry. Please try again.");
    expect(mocks.addDoc).toHaveBeenCalledTimes(1); // not called twice
    expect(mocks.updateDoc).not.toHaveBeenCalled(); // never dismissed on failure
    expect(screen.getByRole('dialog', { name: /never show this entry again/i })).toBeTruthy(); // stays open
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
      value: 'calm', // entries fixture's top-level tags[0] (production shape)
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

  it('R2 review regression: an entry shaped exactly like buildSuccessPayload\'s real output renders the button, and the written value would match the real selector\'s family predicate', async () => {
    // No analysis.themes/analysis.entities anywhere — exactly what
    // production analysis writes actually produce.
    const productionEntry = {
      id: 'entry-prod',
      text: 'A quiet Sunday.',
      effectiveDate: '2026-02-01T00:00:00.000Z',
      tags: ['gratitude', 'family-time'],
      analysis: { mood_score: 0.7, framework: 'general' },
    };
    pushQueueItem(queueItem({ entryId: 'entry-prod' }));
    await renderWidget({ entries: [productionEntry] });

    expect(screen.getByText('Less like this')).toBeTruthy();
    fireEvent.click(screen.getByText('Less like this'));

    await waitFor(() => expect(mocks.addDoc).toHaveBeenCalledTimes(1));
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(payload.dimension).toBe('family');
    expect(payload.value).toBe('gratitude'); // tags[0] — the only populated source
    // The value written would actually suppress this entry server-side —
    // verified against a faithful replica of the real selector's predicate
    // (see `familyExclusionWouldMatch`'s doc comment for why it's a replica,
    // not a cross-package import).
    expect(familyExclusionWouldMatch(productionEntry, payload.value)).toBe(true);
  });

  it('does NOT derive from entry.analysis.themes/entry.analysis.entities (old wrong-schema fields, never populated in production) — hides the action', async () => {
    const oldSchemaShapedEntry = {
      id: 'entry-2',
      text: 'Some text.',
      // No top-level tags/entities — only the (never-real) analysis fields.
      analysis: { mood_score: 0.6, themes: ['calm'], entities: [{ name: 'Lake Tahoe' }] },
    };
    pushQueueItem(queueItem({ entryId: 'entry-2' }));
    await renderWidget({ entries: [oldSchemaShapedEntry] });
    expect(screen.queryByText('Less like this')).toBeNull();
  });

  it('hides the action entirely when the entry has neither tags nor entities', async () => {
    pushQueueItem(queueItem({ entryId: 'entry-2' }));
    await renderWidget({ entries: [makeEntry({ id: 'entry-2', tags: [], analysis: { mood_score: 0.6 } })] });
    expect(screen.queryByText('Less like this')).toBeNull();
  });

  it('deriveTopThemeOrEntity prefers top-level entity id, then entity name, then top-level tag, then null', () => {
    expect(deriveTopThemeOrEntity({ entities: [{ id: 'e1', name: 'grief' }], tags: ['other'] })).toBe('e1');
    expect(deriveTopThemeOrEntity({ entities: [{ name: 'Sam' }], tags: ['other'] })).toBe('Sam');
    expect(deriveTopThemeOrEntity({ tags: ['grief'] })).toBe('grief');
    expect(deriveTopThemeOrEntity({ tags: [], entities: [] })).toBeNull();
    expect(deriveTopThemeOrEntity({ analysis: { themes: ['grief'] } })).toBeNull(); // wrong-schema field, never read
    expect(deriveTopThemeOrEntity(undefined)).toBeNull();
  });

  it('failure: addRevisitExclusion rejecting shows an inline error, keeps the card, and guards against double-submit', async () => {
    pushQueueItem(queueItem());
    mocks.addDoc.mockRejectedValueOnce(new Error('boom'));
    await renderWidget();

    fireEvent.click(screen.getByText('Less like this'));
    fireEvent.click(screen.getByText('Saving…')); // double-click while in flight — guarded, no-op

    await screen.findByText("Couldn't save that preference. Please try again.");
    expect(mocks.addDoc).toHaveBeenCalledTimes(1); // not called twice
    expect(mocks.updateDoc).not.toHaveBeenCalled(); // never dismissed on failure
    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy(); // card intact
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

// ---------------------------------------------------------------------------
// GR1 (Michael's direct safety review) current-state gate — client mirror of
// `functions/src/revisit/selectRevisits.js`'s `currentStateGateTripped`/
// `sustainedLowMoodTripped`. Covered both as a direct pure-function fixture
// set (mirroring the server test file's structure) and end-to-end through
// the widget's render gate.
// ---------------------------------------------------------------------------

function recentEntry(id, { daysAgo = 1, mood, safety_flagged, has_warning_indicators } = {}) {
  return {
    id,
    text: 'text',
    effectiveDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    analysis: mood != null ? { mood_score: mood } : {},
    ...(safety_flagged !== undefined ? { safety_flagged } : {}),
    ...(has_warning_indicators !== undefined ? { has_warning_indicators } : {}),
  };
}

describe('currentStateGateTripped (client mirror, direct fixtures)', () => {
  it('trips when a recent entry has safety_flagged true', () => {
    expect(currentStateGateTripped([recentEntry('a', { safety_flagged: true })])).toBe(true);
  });

  it('trips when a recent entry has has_warning_indicators true', () => {
    expect(currentStateGateTripped([recentEntry('a', { has_warning_indicators: true })])).toBe(true);
  });

  it('does not trip on clean, unremarkable recent entries', () => {
    expect(currentStateGateTripped([recentEntry('a', { mood: 0.6 })])).toBe(false);
  });

  it('trips on sustained low mood: >=3 of the last 7 mood-scored recent entries below 0.4', () => {
    const entries = [
      recentEntry('a', { daysAgo: 1, mood: 0.1 }),
      recentEntry('b', { daysAgo: 2, mood: 0.1 }),
      recentEntry('c', { daysAgo: 3, mood: 0.1 }),
    ];
    expect(currentStateGateTripped(entries)).toBe(true);
  });

  it('fails open with fewer than 3 mood-scored recent entries, even if all are low', () => {
    const entries = [recentEntry('a', { daysAgo: 1, mood: 0.05 }), recentEntry('b', { daysAgo: 2, mood: 0.05 })];
    expect(currentStateGateTripped(entries)).toBe(false);
  });

  it('ignores low-mood entries older than the 14-day recent window', () => {
    const entries = [
      recentEntry('a', { daysAgo: 20, mood: 0.05 }),
      recentEntry('b', { daysAgo: 21, mood: 0.05 }),
      recentEntry('c', { daysAgo: 22, mood: 0.05 }),
    ];
    expect(currentStateGateTripped(entries)).toBe(false);
  });

  it('handles an empty/undefined entries list without throwing', () => {
    expect(currentStateGateTripped([])).toBe(false);
    expect(currentStateGateTripped(undefined)).toBe(false);
  });
});

describe('RevisitWidget — current-state gate (GR1 rule 7, client mirror, end-to-end)', () => {
  it('suppresses the card when a recent entry has safety_flagged true, even with a queued doc present', async () => {
    pushQueueItem(queueItem());
    const { container } = await renderWidget({ entries: [makeEntry(), recentEntry('recent-1', { safety_flagged: true })] });
    expect(container.firstChild).toBeNull();
  });

  it('suppresses the card when a recent entry has has_warning_indicators true, even with a queued doc present', async () => {
    pushQueueItem(queueItem());
    const { container } = await renderWidget({ entries: [makeEntry(), recentEntry('recent-1', { has_warning_indicators: true })] });
    expect(container.firstChild).toBeNull();
  });

  it('suppresses the card on sustained low mood among recent entries, even with a queued doc present', async () => {
    pushQueueItem(queueItem());
    const lowMoodRecent = [
      recentEntry('r1', { daysAgo: 1, mood: 0.1 }),
      recentEntry('r2', { daysAgo: 2, mood: 0.1 }),
      recentEntry('r3', { daysAgo: 3, mood: 0.1 }),
    ];
    const { container } = await renderWidget({ entries: [makeEntry(), ...lowMoodRecent] });
    expect(container.firstChild).toBeNull();
  });

  it('does NOT suppress the card when there are fewer than 3 recent mood-scored entries (fail-open)', async () => {
    pushQueueItem(queueItem());
    const lowMoodRecent = [recentEntry('r1', { daysAgo: 1, mood: 0.1 }), recentEntry('r2', { daysAgo: 2, mood: 0.1 })];
    await renderWidget({ entries: [makeEntry(), ...lowMoodRecent] });
    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy();
  });

  it('does NOT suppress the card when the flagged entry is well outside the 14-day recent window', async () => {
    pushQueueItem(queueItem());
    const oldFlagged = recentEntry('old-flagged', { daysAgo: 100, safety_flagged: true });
    await renderWidget({ entries: [makeEntry(), oldFlagged] });
    expect(screen.getByText('A calm moment from March 2026')).toBeTruthy();
  });
});
