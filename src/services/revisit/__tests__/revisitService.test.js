/**
 * Gentle Revisit client service tests (R2 Task 19).
 *
 * settings/revisitPrefs {enabled, optInAt, updatedAt}; revisit_exclusions
 * {dimension, value, reason, permanent, createdAt, expiresAt} (owner
 * create/read/delete only — no update); revisit_queue (server-written; owner
 * read/delete + status-only update to 'shown'|'dismissed').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let batchInstances = [];
function makeBatch() {
  const batch = {
    delete: vi.fn(),
    commit: vi.fn(async () => {}),
  };
  batchInstances.push(batch);
  return batch;
}

const mocks = {
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

const {
  setRevisitEnabled,
  getRevisitPrefs,
  subscribeTodayRevisit,
  markShown,
  dismissRevisit,
  addRevisitExclusion,
  listRevisitExclusions,
  removeRevisitExclusion,
} = await import('../revisitService.js');

const db = {};
const UID = 'user-1';
const SETTINGS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/settings';
const EXCLUSIONS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_exclusions';
const QUEUE_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/revisit_queue';

function docsSnapshot(rows) {
  return {
    docs: rows.map((r) => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batchInstances = [];
  mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  mocks.getDocs.mockResolvedValue(docsSnapshot([]));
  mocks.addDoc.mockResolvedValue({ id: 'excl-1' });
  mocks.writeBatch.mockImplementation(() => makeBatch());
});

describe('setRevisitEnabled — enabling', () => {
  it('writes {enabled:true, optInAt, updatedAt} on first opt-in (no prior prefs doc)', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await setRevisitEnabled(db, UID, true);

    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'revisitPrefs');
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [, payload, opts] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['enabled', 'optInAt', 'updatedAt']);
    expect(payload.enabled).toBe(true);
    expect(typeof payload.optInAt).toBe('string');
    expect(opts).toEqual({ merge: true });
  });

  it('preserves the existing optInAt (does not overwrite it) on a repeat enable call', async () => {
    mocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ enabled: false, optInAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }),
    });
    await setRevisitEnabled(db, UID, true);

    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['enabled', 'updatedAt']);
    expect(payload.optInAt).toBeUndefined();
  });

  it('throws for a non-boolean enabled value (never reaches Firestore)', async () => {
    await expect(setRevisitEnabled(db, UID, 'yes')).rejects.toThrow();
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });
});

describe('setRevisitEnabled — disabling', () => {
  it('writes {enabled:false, updatedAt} with no optInAt key', async () => {
    await setRevisitEnabled(db, UID, false);
    const [, payload, opts] = mocks.setDoc.mock.calls[0];
    expect(payload).toEqual({ enabled: false, updatedAt: expect.any(String) });
    expect(opts).toEqual({ merge: true });
  });

  it('deletes every status=="queued" revisit_queue doc (immediate cancel)', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'rq-1', status: 'queued' },
      { id: 'rq-2', status: 'queued' },
    ]));

    await setRevisitEnabled(db, UID, false);

    expect(mocks.collection).toHaveBeenCalledWith(db, QUEUE_PATH);
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'queued');
    expect(mocks.writeBatch).toHaveBeenCalledWith(db);
    const batch = batchInstances[0];
    expect(batch.delete).toHaveBeenCalledTimes(2);
    expect(batch.delete).toHaveBeenCalledWith({ __doc: `${QUEUE_PATH}/rq-1` });
    expect(batch.delete).toHaveBeenCalledWith({ __doc: `${QUEUE_PATH}/rq-2` });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('does not touch writeBatch when there is nothing queued', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([]));
    await setRevisitEnabled(db, UID, false);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('only deletes queued docs, never shown/dismissed ones (query already filters, but confirm the query shape)', async () => {
    await setRevisitEnabled(db, UID, false);
    expect(mocks.where).toHaveBeenCalledWith('status', '==', 'queued');
  });
});

describe('setRevisitEnabled — payload-exactness regression guard', () => {
  // Mirrors firestore.rules:161-164 exactly: settings/revisitPrefs writes
  // must hasOnly(['enabled','optInAt','updatedAt']). This is a dedicated,
  // explicit-allow-list assertion (not just an incidental Object.keys
  // equality elsewhere) so a future change that adds any other key to this
  // doc's payload — e.g. a job marker — fails loudly here instead of
  // silently getting rejected by rules in production.
  const RULES_ALLOWED_KEYS = ['enabled', 'optInAt', 'updatedAt'];

  it('every key in the first-opt-in payload is in the rules allow-list', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    await setRevisitEnabled(db, UID, true);
    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(payload).every((k) => RULES_ALLOWED_KEYS.includes(k))).toBe(true);
  });

  it('every key in the repeat-enable payload is in the rules allow-list', async () => {
    mocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ enabled: false, optInAt: '2026-01-01T00:00:00.000Z' }),
    });
    await setRevisitEnabled(db, UID, true);
    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(payload).every((k) => RULES_ALLOWED_KEYS.includes(k))).toBe(true);
  });

  it('every key in the disable payload is in the rules allow-list', async () => {
    await setRevisitEnabled(db, UID, false);
    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(Object.keys(payload).every((k) => RULES_ALLOWED_KEYS.includes(k))).toBe(true);
  });
});

describe('getRevisitPrefs', () => {
  it('returns {enabled:false, optInAt:null} when the doc does not exist', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    expect(await getRevisitPrefs(db, UID)).toEqual({ enabled: false, optInAt: null });
  });

  it('returns the persisted enabled/optInAt when the doc exists', async () => {
    mocks.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ enabled: true, optInAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }),
    });
    expect(await getRevisitPrefs(db, UID)).toEqual({ enabled: true, optInAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('subscribeTodayRevisit', () => {
  it('queries revisit_queue where dueDate == today', () => {
    subscribeTodayRevisit(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, QUEUE_PATH);
    const [, whereClause] = mocks.query.mock.calls[0];
    expect(whereClause).toEqual({ __where: ['dueDate', '==', expect.any(String)] });
  });

  it('calls back with null when the snapshot is empty', () => {
    const cb = vi.fn();
    mocks.onSnapshot.mockImplementationOnce((_q, onNext) => {
      onNext({ empty: true, docs: [] });
      return () => {};
    });
    subscribeTodayRevisit(db, UID, cb);
    expect(cb).toHaveBeenCalledWith(null);
  });

  it('calls back with {id, ...data} for the day\'s doc', () => {
    const cb = vi.fn();
    mocks.onSnapshot.mockImplementationOnce((_q, onNext) => {
      onNext({ empty: false, docs: [{ id: 'rq-1', data: () => ({ entryId: 'e1', status: 'queued' }) }] });
      return () => {};
    });
    subscribeTodayRevisit(db, UID, cb);
    expect(cb).toHaveBeenCalledWith({ id: 'rq-1', entryId: 'e1', status: 'queued' });
  });

  it('forwards subscription errors to onError', () => {
    const onError = vi.fn();
    const err = new Error('boom');
    mocks.onSnapshot.mockImplementationOnce((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    subscribeTodayRevisit(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('markShown / dismissRevisit', () => {
  it('markShown updates only status/updatedAt to "shown"', async () => {
    await markShown(db, UID, 'rq-1');
    expect(mocks.doc).toHaveBeenCalledWith(db, QUEUE_PATH, 'rq-1');
    const [, payload] = mocks.updateDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('shown');
  });

  it('dismissRevisit updates only status/updatedAt to "dismissed"', async () => {
    await dismissRevisit(db, UID, 'rq-1');
    const [, payload] = mocks.updateDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('dismissed');
  });
});

describe('addRevisitExclusion', () => {
  it('creates a doc with exactly {dimension, value, reason, permanent, createdAt} when expiresAt is omitted', async () => {
    await addRevisitExclusion(db, UID, { dimension: 'entry', value: 'entry-1', reason: 'never_show', permanent: true });

    expect(mocks.collection).toHaveBeenCalledWith(db, EXCLUSIONS_PATH);
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'dimension', 'permanent', 'reason', 'value']);
    expect(payload).toMatchObject({ dimension: 'entry', value: 'entry-1', reason: 'never_show', permanent: true });
  });

  it('includes expiresAt when explicitly provided', async () => {
    await addRevisitExclusion(db, UID, {
      dimension: 'family', value: 'topic-x', reason: 'less_like_this', permanent: false, expiresAt: '2026-10-01T00:00:00.000Z',
    });
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(payload.expiresAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('defaults permanent to false when not provided', async () => {
    await addRevisitExclusion(db, UID, { dimension: 'tag', value: 'grief', reason: 'hidden_dim' });
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(payload.permanent).toBe(false);
  });

  it('rejects an unknown dimension (mirrors firestore.rules allow-list)', async () => {
    await expect(addRevisitExclusion(db, UID, { dimension: 'mood', value: 'x', reason: 'never_show' })).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects an unknown reason', async () => {
    await expect(addRevisitExclusion(db, UID, { dimension: 'entry', value: 'x', reason: 'because' })).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects a missing/non-string value', async () => {
    await expect(addRevisitExclusion(db, UID, { dimension: 'entry', reason: 'never_show' })).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('listRevisitExclusions', () => {
  it('returns all exclusion docs as {id, ...data}', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'ex-1', dimension: 'entry', value: 'e1', reason: 'never_show', permanent: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]));
    const result = await listRevisitExclusions(db, UID);
    expect(result).toEqual([
      { id: 'ex-1', dimension: 'entry', value: 'e1', reason: 'never_show', permanent: true, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

describe('removeRevisitExclusion', () => {
  it('deletes the exclusion doc by id', async () => {
    await removeRevisitExclusion(db, UID, 'ex-1');
    expect(mocks.doc).toHaveBeenCalledWith(db, EXCLUSIONS_PATH, 'ex-1');
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
  });
});
