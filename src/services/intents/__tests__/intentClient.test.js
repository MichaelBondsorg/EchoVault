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
  it('writes snoozedUntil + updatedAt and appends a snoozed decision, leaving state untouched', async () => {
    await snoozeLoop(db, UID, 'loop-1', '2026-07-25T00:00:00.000Z');
    expect(mocks.doc).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents', 'loop-1');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update).toMatchObject({ snoozedUntil: '2026-07-25T00:00:00.000Z' });
    expect(update.state).toBeUndefined();
    expect(typeof update.updatedAt).toBe('string');
    expect(Object.keys(update).sort()).toEqual(['snoozedUntil', 'updatedAt']);
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-1', action: 'snoozed', reversible: true });
  });
});

describe('answerLoop', () => {
  it('writes state=completed_state + outcome.kind=answered + appends answered decision, never touching entries', async () => {
    await answerLoop(db, UID, 'loop-2', 'entry-99');
    expect(mocks.doc).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents', 'loop-2');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('completed_state');
    expect(update.outcome).toMatchObject({ kind: 'answered', answerEntryId: 'entry-99' });
    expect(typeof update.outcome.closedAt).toBe('string');
    expect(typeof update.updatedAt).toBe('string');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-2', action: 'answered', reversible: true });

    // Never touch the source entries collection.
    for (const [, path] of mocks.collection.mock.calls) {
      expect(path).not.toMatch(/entries/);
    }
    for (const [, path] of mocks.doc.mock.calls) {
      expect(path).not.toMatch(/entries/);
    }
  });

  it('defaults answerEntryId to null', async () => {
    await answerLoop(db, UID, 'loop-2');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.outcome.answerEntryId).toBeNull();
  });
});

describe('closeLoop', () => {
  it('writes state=completed_state + outcome.kind=closed + appends closed decision, never touching entries', async () => {
    await closeLoop(db, UID, 'loop-3');
    expect(mocks.doc).toHaveBeenCalledWith(db, 'artifacts/echo-vault-v5-fresh/users/user-1/intents', 'loop-3');
    const [, update] = mocks.updateDoc.mock.calls[0];
    expect(update.state).toBe('completed_state');
    expect(update.outcome).toMatchObject({ kind: 'closed' });
    expect(typeof update.outcome.closedAt).toBe('string');
    expect(typeof update.updatedAt).toBe('string');
    const [, decision] = mocks.addDoc.mock.calls[0];
    expect(decision).toMatchObject({ targetId: 'loop-3', action: 'closed', reversible: true });

    for (const [, path] of mocks.collection.mock.calls) {
      expect(path).not.toMatch(/entries/);
    }
    for (const [, path] of mocks.doc.mock.calls) {
      expect(path).not.toMatch(/entries/);
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
