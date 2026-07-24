import { describe, it, expect, vi, beforeEach } from 'vitest';

// writeBatch mock helper, following src/services/revisit/revisitService.test.js
// precedent: each call returns a fresh recorder instance we can inspect.
let batchInstances = [];
function makeBatch() {
  const batch = {
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(async () => {}),
  };
  batchInstances.push(batch);
  return batch;
}

let autoIdCounter = 0;

// Mock the firebase re-export module: capture the query builder + writes.
// `doc` is overloaded like the real modular SDK: doc(db, path, id) for a
// known id, or doc(collectionRef) (one arg) to mint a new auto-id ref for a
// batch .set() — matching how commitIntentDecision() creates the decision ref.
const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((...args) => {
    if (args.length === 1) {
      autoIdCounter += 1;
      return { __doc: `${args[0].__col}/auto-${autoIdCounter}` };
    }
    const [, path, id] = args;
    return { __doc: `${path}/${id}` };
  }),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((f, op, v) => ({ __where: [f, op, v] })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  limit: vi.fn((n) => ({ __limit: n })),
  onSnapshot: vi.fn(() => () => {}),
  updateDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'decision-1' })),
  writeBatch: vi.fn(() => makeBatch()),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const {
  subscribeActiveTaskIntents,
  subscribeDueOpenLoops,
  subscribeUpcomingOpenLoops,
  subscribeSuggestedIntentsForEntry,
  subscribeRecentActiveIntents,
  keepIntent,
  dismissIntent,
  completeIntent,
  snoozeLoop,
  answerLoop,
  closeLoop,
  setIntentUserText,
} = await import('../intentClient.js');

const db = {};
const UID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
  batchInstances = [];
  autoIdCounter = 0;
  mocks.onSnapshot.mockReturnValue(() => {});
  mocks.addDoc.mockResolvedValue({ id: 'decision-1' });
  mocks.writeBatch.mockImplementation(() => makeBatch());
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

// The exact key set firestore.rules' user_decisions create rule allows via
// hasOnly(...). A future field added to decisionPayload() without a matching
// rules change should fail loudly here, not silently at write time in prod.
const DECISION_RULES_ALLOWED_KEYS = ['targetId', 'targetType', 'action', 'reasonCode', 'createdAt', 'reversible'];

// The exact key set firestore.rules' intents update rule allows via
// affectedKeys().hasOnly(...) (functions/src/intents/intentSchema.js
// CLIENT_MUTABLE_KEYS, minus the extraction-owned/never-client-touched ones).
const INTENT_RULES_ALLOWED_KEYS = ['state', 'updatedAt', 'authorization', 'snoozedUntil', 'outcome', 'userText'];

describe('keepIntent', () => {
  it('commits ONE writeBatch containing both the intent update and the decision append', async () => {
    await keepIntent(db, UID, 'i1');

    expect(mocks.writeBatch).toHaveBeenCalledTimes(1);
    expect(mocks.writeBatch).toHaveBeenCalledWith(db);
    expect(batchInstances).toHaveLength(1);
    const batch = batchInstances[0];
    expect(batch.update).toHaveBeenCalledTimes(1);
    expect(batch.set).toHaveBeenCalledTimes(1);
    expect(batch.commit).toHaveBeenCalledTimes(1);

    const [intentRef, update] = batch.update.mock.calls[0];
    expect(intentRef).toEqual({ __doc: 'artifacts/echo-vault-v5-fresh/users/user-1/intents/i1' });
    expect(update.state).toBe('active');
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).every((k) => INTENT_RULES_ALLOWED_KEYS.includes(k))).toBe(true);

    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i1', targetType: 'intent', action: 'kept', reasonCode: null, reversible: true });
    expect(Object.keys(decision).sort()).toEqual([...DECISION_RULES_ALLOWED_KEYS].sort());

    // Neither op happens as a standalone (unbatched) write.
    expect(mocks.updateDoc).not.toHaveBeenCalled();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects and leaves nothing to have been written when the batch commit fails', async () => {
    mocks.writeBatch.mockImplementationOnce(() => {
      const batch = makeBatch();
      batch.commit = vi.fn(async () => { throw new Error('offline'); });
      return batch;
    });
    await expect(keepIntent(db, UID, 'i1')).rejects.toThrow('offline');
  });

  it('is repeat-safe: a second call for the same id does not throw (from==to is a permitted rules transition)', async () => {
    await keepIntent(db, UID, 'i1');
    await expect(keepIntent(db, UID, 'i1')).resolves.toBeUndefined();
    expect(mocks.writeBatch).toHaveBeenCalledTimes(2);
  });
});

describe('dismissIntent', () => {
  it('commits one batch: dismissed state + a not_a_task decision with reasonCode', async () => {
    await dismissIntent(db, UID, 'i2', 'misheard');
    const batch = batchInstances[0];
    const [, update] = batch.update.mock.calls[0];
    expect(update.state).toBe('dismissed');
    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i2', action: 'not_a_task', reasonCode: 'misheard', reversible: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it('defaults reasonCode to null', async () => {
    await dismissIntent(db, UID, 'i2');
    const [, decision] = batchInstances[0].set.mock.calls[0];
    expect(decision.reasonCode).toBeNull();
  });

  it('is repeat-safe: dismissing an already-dismissed intent does not throw', async () => {
    await dismissIntent(db, UID, 'i2');
    await expect(dismissIntent(db, UID, 'i2')).resolves.toBeUndefined();
  });

  it('propagates a commit failure (caller decides how to restore/report)', async () => {
    mocks.writeBatch.mockImplementationOnce(() => {
      const batch = makeBatch();
      batch.commit = vi.fn(async () => { throw new Error('permission-denied'); });
      return batch;
    });
    await expect(dismissIntent(db, UID, 'i2')).rejects.toThrow('permission-denied');
  });
});

describe('completeIntent', () => {
  it('commits one batch: completed_state + a completed decision', async () => {
    await completeIntent(db, UID, 'i3');
    const batch = batchInstances[0];
    const [, update] = batch.update.mock.calls[0];
    expect(update.state).toBe('completed_state');
    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'i3', action: 'completed', reversible: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeDueOpenLoops', () => {
  it('builds kind=open_loop, state=active, targetAt<=now, orderBy targetAt asc, limit 20', () => {
    subscribeDueOpenLoops(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents');
    expect(mocks.where).toHaveBeenCalledWith('kind', '==', 'open_loop');
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.where).toHaveBeenCalledWith('targetAt', '<=', expect.any(String));
    expect(mocks.orderBy).toHaveBeenCalledWith('targetAt', 'asc');
    expect(mocks.limit).toHaveBeenCalledWith(20);
  });

  it('maps snapshot to [{ id, ...data }], dropping docs whose snoozedUntil is in the future', () => {
    mocks.onSnapshot.mockImplementation((_q, onNext) => {
      onNext({
        forEach: (fn) => {
          fn({ id: 'due-1', data: () => ({ kind: 'open_loop', state: 'active', targetAt: '2026-07-19T00:00:00.000Z', snoozedUntil: null }) });
          fn({ id: 'due-2-snoozed', data: () => ({ kind: 'open_loop', state: 'active', targetAt: '2026-07-19T00:00:00.000Z', snoozedUntil: '2099-01-01T00:00:00.000Z' }) });
        },
      });
      return () => {};
    });
    const cb = vi.fn();
    subscribeDueOpenLoops(db, UID, cb);
    expect(cb).toHaveBeenCalledWith([{ id: 'due-1', kind: 'open_loop', state: 'active', targetAt: '2026-07-19T00:00:00.000Z', snoozedUntil: null }]);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeDueOpenLoops(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('subscribeUpcomingOpenLoops', () => {
  it('builds kind=open_loop, state=active, targetAt>now, orderBy targetAt asc, limit 20', () => {
    subscribeUpcomingOpenLoops(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents');
    expect(mocks.where).toHaveBeenCalledWith('kind', '==', 'open_loop');
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.where).toHaveBeenCalledWith('targetAt', '>', expect.any(String));
    expect(mocks.orderBy).toHaveBeenCalledWith('targetAt', 'asc');
    expect(mocks.limit).toHaveBeenCalledWith(20);
  });

  it('maps snapshot to [{ id, ...data }] without dropping snoozed docs', () => {
    mocks.onSnapshot.mockImplementation((_q, onNext) => {
      onNext({
        forEach: (fn) => {
          fn({ id: 'up-1', data: () => ({ kind: 'open_loop', state: 'active', targetAt: '2099-01-01T00:00:00.000Z', snoozedUntil: '2099-06-01T00:00:00.000Z' }) });
        },
      });
      return () => {};
    });
    const cb = vi.fn();
    subscribeUpcomingOpenLoops(db, UID, cb);
    expect(cb).toHaveBeenCalledWith([{ id: 'up-1', kind: 'open_loop', state: 'active', targetAt: '2099-01-01T00:00:00.000Z', snoozedUntil: '2099-06-01T00:00:00.000Z' }]);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeUpcomingOpenLoops(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('subscribeSuggestedIntentsForEntry', () => {
  it('builds entryId==X, state=suggested query with no orderBy/limit', () => {
    subscribeSuggestedIntentsForEntry(db, UID, 'entry-1', () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents');
    expect(mocks.where).toHaveBeenCalledWith('entryId', '==', 'entry-1');
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'suggested');
    expect(mocks.orderBy).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('maps a snapshot to [{ id, ...data }] and returns the unsubscribe', () => {
    const unsub = () => {};
    mocks.onSnapshot.mockImplementation((_q, onNext) => {
      onNext({ forEach: (fn) => { fn({ id: 's1', data: () => ({ kind: 'task', state: 'suggested', entryId: 'entry-1' }) }); } });
      return unsub;
    });
    const cb = vi.fn();
    const ret = subscribeSuggestedIntentsForEntry(db, UID, 'entry-1', cb);
    expect(cb).toHaveBeenCalledWith([{ id: 's1', kind: 'task', state: 'suggested', entryId: 'entry-1' }]);
    expect(ret).toBe(unsub);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeSuggestedIntentsForEntry(db, UID, 'entry-1', () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('subscribeRecentActiveIntents', () => {
  it('builds state=active, orderBy createdAt desc, limit 5 query', () => {
    subscribeRecentActiveIntents(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents');
    expect(mocks.where).toHaveBeenCalledWith('state', '==', 'active');
    expect(mocks.where).not.toHaveBeenCalledWith('kind', expect.anything(), expect.anything());
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(mocks.limit).toHaveBeenCalledWith(5);
  });

  it('routes snapshot errors to onError', () => {
    const err = new Error('perm');
    mocks.onSnapshot.mockImplementation((_q, _onNext, onErr) => { onErr(err); return () => {}; });
    const onError = vi.fn();
    subscribeRecentActiveIntents(db, UID, () => {}, onError);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('snoozeLoop', () => {
  it('commits one batch: snoozedUntil + updatedAt (state untouched) + a snoozed decision', async () => {
    await snoozeLoop(db, UID, 'loop-1', '2026-07-25T00:00:00.000Z');
    const batch = batchInstances[0];
    expect(batch.update).toHaveBeenCalledWith(
      { __doc: 'artifacts/echo-vault-v5-fresh/users/user-1/intents/loop-1' },
      expect.any(Object),
    );
    const [, update] = batch.update.mock.calls[0];
    expect(update).toMatchObject({ snoozedUntil: '2026-07-25T00:00:00.000Z' });
    expect(update.state).toBeUndefined();
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).sort()).toEqual(['snoozedUntil', 'updatedAt']);
    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-1', action: 'snoozed', reversible: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });
});

describe('answerLoop', () => {
  it('commits one batch: state=completed_state + outcome.kind=answered + answered decision, never touching entries', async () => {
    await answerLoop(db, UID, 'loop-2', 'entry-99');
    const batch = batchInstances[0];
    expect(batch.update).toHaveBeenCalledWith(
      { __doc: 'artifacts/echo-vault-v5-fresh/users/user-1/intents/loop-2' },
      expect.any(Object),
    );
    const [, update] = batch.update.mock.calls[0];
    expect(update.state).toBe('completed_state');
    expect(update.outcome).toMatchObject({ kind: 'answered', answerEntryId: 'entry-99' });
    expect(typeof update.outcome.closedAt).toBe('string');
    expect(typeof update.updatedAt).toBe('string');
    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-2', action: 'answered', reversible: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);

    // Never touch the source entries collection.
    for (const [, path] of mocks.collection.mock.calls) {
      expect(path).not.toMatch(/entries/);
    }
    for (const args of mocks.doc.mock.calls) {
      if (args.length > 1) expect(args[1]).not.toMatch(/entries/);
    }
  });

  it('defaults answerEntryId to null', async () => {
    await answerLoop(db, UID, 'loop-2');
    const [, update] = batchInstances[0].update.mock.calls[0];
    expect(update.outcome.answerEntryId).toBeNull();
  });
});

describe('closeLoop', () => {
  it('commits one batch: state=completed_state + outcome.kind=closed + closed decision, never touching entries', async () => {
    await closeLoop(db, UID, 'loop-3');
    const batch = batchInstances[0];
    expect(batch.update).toHaveBeenCalledWith(
      { __doc: 'artifacts/echo-vault-v5-fresh/users/user-1/intents/loop-3' },
      expect.any(Object),
    );
    const [, update] = batch.update.mock.calls[0];
    expect(update.state).toBe('completed_state');
    expect(update.outcome).toMatchObject({ kind: 'closed' });
    expect(typeof update.outcome.closedAt).toBe('string');
    expect(typeof update.updatedAt).toBe('string');
    const [, decision] = batch.set.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-3', action: 'closed', reversible: true });
    expect(batch.commit).toHaveBeenCalledTimes(1);

    for (const [, path] of mocks.collection.mock.calls) {
      expect(path).not.toMatch(/entries/);
    }
    for (const args of mocks.doc.mock.calls) {
      if (args.length > 1) expect(args[1]).not.toMatch(/entries/);
    }
  });
});

describe('setIntentUserText', () => {
  it('writes userText + updatedAt only, with no decision appended', async () => {
    await setIntentUserText(db, UID, 'loop-4', 'left a voicemail');
    expect(mocks.doc).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents', 'loop-4');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update).toMatchObject({ userText: 'left a voicemail' });
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).sort()).toEqual(['updatedAt', 'userText']);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('allows clearing userText back to null', async () => {
    await setIntentUserText(db, UID, 'loop-4', null);
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.userText).toBeNull();
  });
});

describe('restoreIntent (not implemented in v1)', () => {
  it('is not exported: dismissal is final, dismissed->active is not an allowed transition', async () => {
    const mod = await import('../intentClient.js');
    expect(mod.restoreIntent).toBeUndefined();
    expect(mod.default.restoreIntent).toBeUndefined();
  });
});
