import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the firebase re-export module: capture the query builder + writes.
const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  limit: vi.fn((n) => ({ __limit: n })),
  onSnapshot: vi.fn(() => () => {}),
  updateDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'decision-1' })),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const {
  subscribeActiveTaskIntents,
  keepIntent,
  dismissIntent,
  completeIntent,
} = await import('../intentClient.js');

const db = {};
const UID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onSnapshot.mockReturnValue(() => {});
  mocks.addDoc.mockResolvedValue({ id: 'decision-1' });
});

describe('subscribeActiveTaskIntents', () => {
  it('builds a kind=task, state=active, createdAt desc, limit 20 query', () => {
    subscribeActiveTaskIntents(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents');
    expect(mocks.where).toHaveBeenCalledWith('kind', '==', 'task');
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(20);
  });

  it('maps a snapshot to [{ id, ...data }] and returns the unsubscribe', () => {
    const unsub = () => {};
    mocks.onSnapshot.mockImplementation((_q, onNext) => {
      onNext({ forEach: (fn) => { fn({ id: 'i1', data: () => ({ kind: 'task', state: 'active' }) }); } });
      return unsub;
    });
    const cb = vi.fn();
    const ret = subscribeActiveTaskIntents(db, UID, cb);
    expect(cb).toHaveBeenCalledWith([{ id: 'i1', kind: 'task', state: 'active' }]);
    expect(ret).toBe(unsub);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeActiveTaskIntents(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('keepIntent', () => {
  it('transitions suggested -> active and appends a kept decision', async () => {
    await keepIntent(db, UID, 'i1');
    expect(mocks.doc).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents', 'i1');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('active');
    expect(typeof update.updatedAt).toBe('string');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i1', targetType: 'intent', action: 'kept', reasonCode: null, reversible: true });
  });
});

describe('dismissIntent', () => {
  it('transitions to dismissed and appends a not_a_task decision with reasonCode', async () => {
    await dismissIntent(db, UID, 'i2', 'misheard');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('dismissed');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i2', action: 'not_a_task', reasonCode: 'misheard', reversible: true });
  });

  it('defaults reasonCode to null', async () => {
    await dismissIntent(db, UID, 'i2');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision.reasonCode).toBeNull();
  });
});

describe('completeIntent', () => {
  it('transitions active -> completed_state and appends a completed decision', async () => {
    await completeIntent(db, UID, 'i3');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('completed_state');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i3', action: 'completed', reversible: true });
  });
});
