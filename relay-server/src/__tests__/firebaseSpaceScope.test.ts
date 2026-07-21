/**
 * R2 plan task 5: voice relay spaceId scope threading.
 *
 * `getRecentEntries` (used to build ConversationContext.recentEntries for
 * promptBuilder) and `searchEntries` (used by the get_memory tool in both
 * realtimeProxy.ts and standardPipeline.ts) must gain a
 * `.where('spaceId', '==', spaceId)` clause ONLY when a spaceId is supplied
 * — omitted/null must produce the byte-identical query shape as before this
 * parameter existed (same method calls, same order, no extra `where`).
 *
 * Firestore itself is fully mocked: every query stage (`collection`, `doc`,
 * `where`, `orderBy`, `limit`) returns the SAME self-chaining mock object, so
 * assertions just inspect that object's `where`/`orderBy`/`limit` call logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryable, resetQueryable } = vi.hoisted(() => {
  const state: { docs: any[] } = { docs: [] };
  const queryable: any = {};
  queryable.collection = vi.fn(() => queryable);
  queryable.doc = vi.fn(() => queryable);
  queryable.where = vi.fn(() => queryable);
  queryable.orderBy = vi.fn(() => queryable);
  queryable.limit = vi.fn(() => queryable);
  queryable.get = vi.fn(async () => ({ docs: state.docs }));
  const resetQueryable = (docs: any[] = []) => {
    state.docs = docs;
    queryable.collection.mockClear();
    queryable.doc.mockClear();
    queryable.where.mockClear();
    queryable.orderBy.mockClear();
    queryable.limit.mockClear();
    queryable.get.mockClear();
  };
  return { queryable, resetQueryable };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  applicationDefault: vi.fn(() => ({})),
  cert: vi.fn(() => ({})),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => queryable),
  FieldValue: {},
  Timestamp: { now: vi.fn(() => ({})) },
}));

const { getRecentEntries, searchEntries } = await import('../auth/firebase.js');

beforeEach(() => {
  resetQueryable();
});

describe('getRecentEntries — spaceId scope threading', () => {
  it('adds a where(spaceId) clause when spaceId is provided', async () => {
    await getRecentEntries('user-1', 5, 'work');
    expect(queryable.where.mock.calls).toContainEqual(['spaceId', '==', 'work']);
    expect(queryable.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(queryable.limit).toHaveBeenCalledWith(5);
  });

  it('adds no where clause (byte-identical legacy query) when spaceId is omitted', async () => {
    await getRecentEntries('user-1', 5);
    expect(queryable.where).not.toHaveBeenCalled();
    expect(queryable.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(queryable.limit).toHaveBeenCalledWith(5);
  });

  it('adds no where clause when spaceId is explicitly null', async () => {
    await getRecentEntries('user-1', 5, null);
    expect(queryable.where).not.toHaveBeenCalled();
  });

  it('adds no where clause when spaceId is an empty string (falsy, not a real scope)', async () => {
    await getRecentEntries('user-1', 5, '');
    expect(queryable.where).not.toHaveBeenCalled();
  });
});

describe('searchEntries — spaceId scope threading', () => {
  it('adds a where(spaceId) clause when options.spaceId is set', async () => {
    await searchEntries('user-1', 'query text', { spaceId: 'personal' });
    expect(queryable.where.mock.calls).toContainEqual(['spaceId', '==', 'personal']);
    expect(queryable.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('adds no where clause when spaceId is not set (byte-identical legacy query)', async () => {
    await searchEntries('user-1', 'query text', {});
    expect(queryable.where).not.toHaveBeenCalled();
  });

  it('adds no where clause when options is entirely omitted', async () => {
    await searchEntries('user-1', 'query text');
    expect(queryable.where).not.toHaveBeenCalled();
  });

  it('adds no where clause when spaceId is explicitly null', async () => {
    await searchEntries('user-1', 'query text', { spaceId: null });
    expect(queryable.where).not.toHaveBeenCalled();
  });

  it('combines spaceId scoping with an existing dateHint where-clause chain', async () => {
    await searchEntries('user-1', 'query text', {
      spaceId: 'work',
      dateHint: 'not-a-parseable-hint-so-falls-back',
    });
    // dateHint that fails to parse falls back to the plain orderBy path —
    // spaceId scoping must still be present either way.
    expect(queryable.where.mock.calls).toContainEqual(['spaceId', '==', 'work']);
  });
});
