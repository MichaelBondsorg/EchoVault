import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the firebase re-export module: capture the query builder + reads/writes.
let autoIdCounter = 0;
let batchInstances = [];

function makeBatch() {
  const batch = {
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => {}),
  };
  batchInstances.push(batch);
  return batch;
}

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((...args) => {
    if (args.length === 1) {
      // Auto-id doc ref generated from a collection ref: doc(collectionRef)
      const col = args[0];
      autoIdCounter += 1;
      return { __doc: `${col.__col}/auto-${autoIdCounter}` };
    }
    const [, path, id] = args;
    return { __doc: `${path}/${id}` };
  }),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  limit: vi.fn((n) => ({ __limit: n })),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(async () => ({ id: 'space-1' })),
  updateDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ docs: [] })),
  setDoc: vi.fn(async () => {}),
  writeBatch: vi.fn(() => makeBatch()),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const {
  subscribeSpaces,
  createSpace,
  renameSpace,
  archiveSpace,
  seedStarterSpaces,
  reassignEntriesSpace,
  getLastCaptureSpaceId,
  setLastCaptureSpaceId,
} = await import('../spacesService.js');

const db = {};
const UID = 'user-1';
const SPACES_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/spaces';
const ENTRIES_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/entries';
const SETTINGS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/settings';

beforeEach(() => {
  vi.clearAllMocks();
  autoIdCounter = 0;
  batchInstances = [];
  mocks.onSnapshot.mockReturnValue(() => {});
  mocks.addDoc.mockResolvedValue({ id: 'space-1' });
  mocks.getDocs.mockResolvedValue({ docs: [] });
  mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
  mocks.writeBatch.mockImplementation(() => makeBatch());
});

describe('subscribeSpaces', () => {
  it('builds a state=active, orderBy name asc query', () => {
    subscribeSpaces(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, SPACES_PATH);
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.orderBy).toHaveBeenCalledWith('name', 'asc');
  });

  it('maps a snapshot to [{ id, ...data }] and returns the unsubscribe', () => {
    const unsub = () => {};
    mocks.onSnapshot.mockImplementation((_q, onNext) => {
      onNext({ forEach: (fn) => { fn({ id: 's1', data: () => ({ name: 'Work', state: 'active' }) }); } });
      return unsub;
    });
    const cb = vi.fn();
    const ret = subscribeSpaces(db, UID, cb);
    expect(cb).toHaveBeenCalledWith([{ id: 's1', name: 'Work', state: 'active' }]);
    expect(ret).toBe(unsub);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeSpaces(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('createSpace', () => {
  it('adds a doc with trimmed name, state active, createdAt/updatedAt strings', async () => {
    const result = await createSpace(db, UID, '  Work  ');
    expect(mocks.collection).toHaveBeenCalledWith(db, SPACES_PATH);
    const [, payload] = mocks.addDoc.mock.calls[0];
    expect(payload.name).toBe('Work');
    expect(payload.state).toBe('active');
    expect(typeof payload.createdAt).toBe('string');
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'name', 'state', 'updatedAt']);
    expect(result).toMatchObject({ id: 'space-1', name: 'Work', state: 'active' });
  });

  it('rejects an empty (or whitespace-only) name', async () => {
    await expect(createSpace(db, UID, '   ')).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects a name over 40 characters', async () => {
    const tooLong = 'x'.repeat(41);
    await expect(createSpace(db, UID, tooLong)).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('accepts a name exactly 40 characters', async () => {
    const exact = 'x'.repeat(40);
    await expect(createSpace(db, UID, exact)).resolves.toBeTruthy();
    expect(mocks.addDoc).toHaveBeenCalled();
  });
});

describe('renameSpace', () => {
  it('updates the doc with trimmed name + updatedAt only', async () => {
    await renameSpace(db, UID, 'space-1', '  Family  ');
    expect(mocks.doc).toHaveBeenCalledWith(db, SPACES_PATH, 'space-1');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.name).toBe('Family');
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).sort()).toEqual(['name', 'updatedAt']);
  });

  it('rejects an empty name', async () => {
    await expect(renameSpace(db, UID, 'space-1', '')).rejects.toThrow();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('rejects a name over 40 characters', async () => {
    await expect(renameSpace(db, UID, 'space-1', 'y'.repeat(41))).rejects.toThrow();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });
});

describe('archiveSpace', () => {
  it('sets state=archived + updatedAt only', async () => {
    await archiveSpace(db, UID, 'space-1');
    expect(mocks.doc).toHaveBeenCalledWith(db, SPACES_PATH, 'space-1');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('archived');
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).sort()).toEqual(['state', 'updatedAt']);
  });
});

describe('seedStarterSpaces', () => {
  it('creates Personal/Work/Family/Health via batch when the collection is empty', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [] });
    const count = await seedStarterSpaces(db, UID);
    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    expect(mocks.writeBatch).toHaveBeenCalledWith(db);
    expect(batchInstances).toHaveLength(1);
    const batch = batchInstances[0];
    expect(batch.set).toHaveBeenCalledTimes(4);
    const names = batch.set.mock.calls.map(([, data]) => data.name);
    expect(names).toEqual(['Personal', 'Work', 'Family', 'Health']);
    batch.set.mock.calls.forEach(([, data]) => {
      expect(data.state).toBe('active');
      expect(typeof data.createdAt).toBe('string');
      expect(typeof data.updatedAt).toBe('string');
      expect(Object.keys(data).sort()).toEqual(['createdAt', 'name', 'state', 'updatedAt']);
    });
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(count).toBe(4);
  });

  it('refuses to seed when at least one active space already exists', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [{ id: 'existing', data: () => ({ name: 'Work', state: 'active' }) }] });
    const count = await seedStarterSpaces(db, UID);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('refuses to seed when only an archived space exists', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [{ id: 'existing', data: () => ({ name: 'Old', state: 'archived' }) }] });
    const count = await seedStarterSpaces(db, UID);
    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });
});

describe('reassignEntriesSpace', () => {
  it('queries entries by spaceId with the batch limit and updates ONLY {spaceId, updatedAt}', async () => {
    mocks.getDocs.mockResolvedValueOnce({
      docs: [
        { id: 'e1', data: () => ({ spaceId: 'from-1', createdAt: 'X', effectiveDate: 'Y', transcription: 'hi' }) },
      ],
    });
    const total = await reassignEntriesSpace(db, UID, 'from-1', 'to-1', { batchSize: 5 });
    expect(mocks.collection).toHaveBeenCalledWith(db, ENTRIES_PATH);
    expect(mocks.where).toHaveBeenCalledWith('spaceId', '==', 'from-1');
    expect(mocks.limit).toHaveBeenCalledWith(5);
    expect(mocks.doc).toHaveBeenCalledWith(db, ENTRIES_PATH, 'e1');
    const batch = batchInstances[0];
    expect(batch.update).toHaveBeenCalledTimes(1);
    const [, payload] = batch.update.mock.calls[0];
    expect(payload.spaceId).toBe('to-1');
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
    expect(batch.commit).toHaveBeenCalledTimes(1);
    expect(total).toBe(1);
  });

  it('accepts null as toSpaceId (Keep unscoped)', async () => {
    mocks.getDocs.mockResolvedValueOnce({
      docs: [{ id: 'e1', data: () => ({ spaceId: 'from-1' }) }],
    });
    await reassignEntriesSpace(db, UID, 'from-1', null, { batchSize: 5 });
    const batch = batchInstances[0];
    const [, payload] = batch.update.mock.calls[0];
    expect(payload.spaceId).toBeNull();
  });

  it('defaults batchSize to 200 when options are omitted', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [] });
    await reassignEntriesSpace(db, UID, 'from-1', 'to-1');
    expect(mocks.limit).toHaveBeenCalledWith(200);
  });

  it('loops across batches: full batchSize docs, then fewer, summing the total', async () => {
    const batchSize = 2;
    mocks.getDocs
      .mockResolvedValueOnce({
        docs: [
          { id: 'e1', data: () => ({ spaceId: 'from-1' }) },
          { id: 'e2', data: () => ({ spaceId: 'from-1' }) },
        ],
      })
      .mockResolvedValueOnce({
        docs: [{ id: 'e3', data: () => ({ spaceId: 'from-1' }) }],
      });

    const total = await reassignEntriesSpace(db, UID, 'from-1', 'to-1', { batchSize });

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(batchInstances).toHaveLength(2);
    expect(batchInstances[0].update).toHaveBeenCalledTimes(2);
    expect(batchInstances[1].update).toHaveBeenCalledTimes(1);
    expect(total).toBe(3);
  });

  it('stops immediately (no batch/commit) when the query returns zero docs', async () => {
    mocks.getDocs.mockResolvedValueOnce({ docs: [] });
    const total = await reassignEntriesSpace(db, UID, 'from-1', 'to-1', { batchSize: 5 });
    expect(mocks.writeBatch).not.toHaveBeenCalled();
    expect(total).toBe(0);
  });

  it('short-circuits with zero queries/writes when fromSpaceId === toSpaceIdOrNull (self-reassign no-op guard)', async () => {
    const total = await reassignEntriesSpace(db, UID, 'space-1', 'space-1', { batchSize: 5 });
    expect(total).toBe(0);
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.collection).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.where).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });

  it('short-circuits when both fromSpaceId and toSpaceIdOrNull are null (null-safe strict equality)', async () => {
    const total = await reassignEntriesSpace(db, UID, null, null, { batchSize: 5 });
    expect(total).toBe(0);
    expect(mocks.getDocs).not.toHaveBeenCalled();
    expect(mocks.writeBatch).not.toHaveBeenCalled();
  });
});

describe('getLastCaptureSpaceId', () => {
  it('returns null when the prefs doc does not exist', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
    const result = await getLastCaptureSpaceId(db, UID);
    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'spacePrefs');
    expect(result).toBeNull();
  });

  it('returns lastCaptureSpaceId when the prefs doc exists', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ lastCaptureSpaceId: 'space-9', updatedAt: 'now' }) });
    const result = await getLastCaptureSpaceId(db, UID);
    expect(result).toBe('space-9');
  });

  it('returns null when the doc exists but the field is missing', async () => {
    mocks.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ updatedAt: 'now' }) });
    const result = await getLastCaptureSpaceId(db, UID);
    expect(result).toBeNull();
  });
});

describe('setLastCaptureSpaceId', () => {
  it('merges lastCaptureSpaceId + updatedAt onto the prefs doc', async () => {
    await setLastCaptureSpaceId(db, UID, 'space-9');
    expect(mocks.doc).toHaveBeenCalledWith(db, SETTINGS_PATH, 'spacePrefs');
    const [, payload, options] = mocks.setDoc.mock.calls[0];
    expect(payload.lastCaptureSpaceId).toBe('space-9');
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['lastCaptureSpaceId', 'updatedAt']);
    expect(options).toMatchObject({ merge: true });
  });

  it('accepts null to clear the last capture space', async () => {
    await setLastCaptureSpaceId(db, UID, null);
    const [, payload] = mocks.setDoc.mock.calls[0];
    expect(payload.lastCaptureSpaceId).toBeNull();
  });
});
