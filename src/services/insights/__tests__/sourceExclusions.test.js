/**
 * Source Exclusions service tests (R2 Task 10).
 *
 * `source_exclusions/{id}` docs: {entryId, appliesTo:'all'|patternType,
 * reason:'wrong_source'|'excluded_by_user', permanent:true, createdAt}.
 * Owner create/read/delete only — NO update (firestore.rules): deleting the
 * doc IS the "restore" action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  addDoc: vi.fn(async () => ({ id: 'excl-1' })),
  deleteDoc: vi.fn(async () => {}),
  getDocs: vi.fn(async () => ({ docs: [], forEach: () => {} })),
  query: vi.fn((col, ...clauses) => ({ __col: col, __clauses: clauses })),
  where: vi.fn((field, op, value) => ({ __where: [field, op, value] })),
  limit: vi.fn((n) => ({ __limit: n })),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const onSourcesChanged = vi.fn(async () => {});
vi.mock('../recompute', () => ({ onSourcesChanged: (...a) => onSourcesChanged(...a) }));

const {
  excludeSource,
  restoreSource,
  listSourceExclusions,
  getExcludedEntryIds,
} = await import('../sourceExclusions.js');

const db = {};
const UID = 'user-1';
const EXCLUSIONS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/source_exclusions';

function docsSnapshot(rows) {
  // rows: [{id, ...data}]
  return {
    docs: rows.map((r) => ({ id: r.id, data: () => { const { id, ...rest } = r; return rest; } })),
    forEach(cb) {
      this.docs.forEach((d) => cb(d));
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.addDoc.mockResolvedValue({ id: 'excl-1' });
  mocks.getDocs.mockResolvedValue(docsSnapshot([]));
});

describe('excludeSource', () => {
  it('creates a doc with {entryId, appliesTo, reason, permanent:true, createdAt} and fans out staleness', async () => {
    await excludeSource(db, UID, { entryId: 'entry-1', reason: 'excluded_by_user' });

    expect(mocks.collection).toHaveBeenCalledWith(db, EXCLUSIONS_PATH);
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload).toEqual({
      entryId: 'entry-1',
      appliesTo: 'all',
      reason: 'excluded_by_user',
      permanent: true,
      createdAt: expect.any(String),
    });
    expect(onSourcesChanged).toHaveBeenCalledWith(db, UID);
  });

  it('defaults appliesTo to "all" but accepts an explicit patternType', async () => {
    await excludeSource(db, UID, { entryId: 'entry-2', appliesTo: 'career_anticipation', reason: 'wrong_source' });
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.appliesTo).toBe('career_anticipation');
  });

  it('throws without an entryId (never reaches Firestore)', async () => {
    await expect(excludeSource(db, UID, { reason: 'wrong_source' })).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('throws with an invalid reason (mirrors firestore.rules allow-list)', async () => {
    await expect(excludeSource(db, UID, { entryId: 'entry-1', reason: 'because' })).rejects.toThrow();
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('staleness fan-out is awaited before excludeSource resolves (PRD: stale within 10s)', async () => {
    let resolved = false;
    onSourcesChanged.mockImplementationOnce(async () => { resolved = true; });
    await excludeSource(db, UID, { entryId: 'entry-1', reason: 'wrong_source' });
    expect(resolved).toBe(true);
  });

  it('is idempotent per (entryId, appliesTo): excluding the same entry twice creates exactly one doc and returns the existing id on the second call', async () => {
    // First call: no existing exclusion -> addDoc creates 'excl-1'.
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([]));
    const first = await excludeSource(db, UID, { entryId: 'entry-1', reason: 'wrong_source' });
    expect(first.id).toBe('excl-1');

    // Second call: the duplicate-check query now finds the doc created above.
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'excl-1', entryId: 'entry-1', appliesTo: 'all', reason: 'wrong_source', permanent: true, createdAt: '2026-07-20T00:00:00.000Z' },
    ]));
    const second = await excludeSource(db, UID, { entryId: 'entry-1', reason: 'wrong_source' });

    expect(second.id).toBe('excl-1');
    expect(mocks.addDoc).toHaveBeenCalledTimes(1); // NOT called again on the second, duplicate call
    expect(onSourcesChanged).toHaveBeenCalledTimes(1); // nothing changed on the second call, so no fan-out
  });
});

describe('restoreSource', () => {
  it('deletes the exclusion doc and fans out staleness', async () => {
    await restoreSource(db, UID, 'excl-1');
    expect(mocks.doc).toHaveBeenCalledWith(db, EXCLUSIONS_PATH, 'excl-1');
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
    expect(onSourcesChanged).toHaveBeenCalledWith(db, UID);
  });

  it('resolves without throwing for a nonexistent exclusionId (deleteDoc is a Firestore no-op) and still fans out staleness', async () => {
    // Firestore's deleteDoc resolves successfully even when the target doc
    // does not exist (or was already deleted) — it does not reject/throw.
    mocks.deleteDoc.mockResolvedValueOnce(undefined);
    await expect(restoreSource(db, UID, 'does-not-exist')).resolves.toBeUndefined();
    expect(mocks.doc).toHaveBeenCalledWith(db, EXCLUSIONS_PATH, 'does-not-exist');
    // Current behavior: restoreSource always fans out staleness after the
    // delete call, regardless of whether a doc actually existed — a no-op
    // delete still triggers a harmless recompute/invalidation.
    expect(onSourcesChanged).toHaveBeenCalledWith(db, UID);
    expect(onSourcesChanged).toHaveBeenCalledTimes(1);
  });
});

describe('listSourceExclusions', () => {
  it('returns all exclusion docs as {id, ...data}', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'excl-1', entryId: 'entry-1', appliesTo: 'all', reason: 'wrong_source', permanent: true, createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 'excl-2', entryId: 'entry-2', appliesTo: 'all', reason: 'excluded_by_user', permanent: true, createdAt: '2026-07-21T00:00:00.000Z' },
    ]));

    const result = await listSourceExclusions(db, UID);
    expect(result).toEqual([
      { id: 'excl-1', entryId: 'entry-1', appliesTo: 'all', reason: 'wrong_source', permanent: true, createdAt: '2026-07-20T00:00:00.000Z' },
      { id: 'excl-2', entryId: 'entry-2', appliesTo: 'all', reason: 'excluded_by_user', permanent: true, createdAt: '2026-07-21T00:00:00.000Z' },
    ]);
  });
});

describe('getExcludedEntryIds', () => {
  it('returns a Set of entryIds for appliesTo=="all" exclusions', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'excl-1', entryId: 'entry-1', appliesTo: 'all', reason: 'wrong_source' },
      { id: 'excl-2', entryId: 'entry-2', appliesTo: 'all', reason: 'excluded_by_user' },
    ]));

    const ids = await getExcludedEntryIds(db, UID);
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(['entry-1', 'entry-2']);
  });

  it('excludes pattern-scoped (non-"all") exclusions from the Set — they do not remove an entry from the general pool', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([
      { id: 'excl-1', entryId: 'entry-1', appliesTo: 'all', reason: 'wrong_source' },
      { id: 'excl-2', entryId: 'entry-2', appliesTo: 'career_anticipation', reason: 'excluded_by_user' },
    ]));

    const ids = await getExcludedEntryIds(db, UID);
    expect([...ids]).toEqual(['entry-1']);
  });

  it('returns an empty Set when there are no exclusions', async () => {
    mocks.getDocs.mockResolvedValueOnce(docsSnapshot([]));
    const ids = await getExcludedEntryIds(db, UID);
    expect(ids.size).toBe(0);
  });
});
