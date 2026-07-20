/**
 * Idempotency + owner-scoped embedding cache tests (plan task A5).
 *
 * Covers the reusable primitives behind the memory-extraction / burnout markers,
 * the watchdog per-entry lease, and the owner-scoped embedding cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    delete: () => '__delete__',
  },
}));

const { claimProcessingMarker, acquireEntryLease } = await import('../triggers/idempotency.js');
const { embeddingCacheKey, setCachedEmbedding } = await import('../ai/embeddingCache.js');

/** Fake transactional db: `docData` is the current stored doc (null = missing). */
function makeTxDb(docData) {
  const sets = [];
  const updates = [];
  const tx = {
    get: async () => ({
      exists: docData !== null && docData !== undefined,
      data: () => docData,
    }),
    set: (ref, data, opts) => sets.push({ ref, data, opts }),
    update: (ref, data) => updates.push({ ref, data }),
  };
  const db = { runTransaction: async (fn) => fn(tx) };
  return { db, sets, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('claimProcessingMarker (memory extraction / burnout dedup)', () => {
  it('claims the marker on first delivery', async () => {
    const { db, sets } = makeTxDb({ text: 'hi' });
    const claimed = await claimProcessingMarker(db, {}, 'processing.memoryExtractedAt');
    expect(claimed).toBe(true);
    expect(sets).toHaveLength(1);
    expect(sets[0].data).toEqual({ processing: { memoryExtractedAt: '__ts__' } });
    expect(sets[0].opts).toEqual({ merge: true });
  });

  it('is a no-op on a second delivery of the same event', async () => {
    const { db, sets } = makeTxDb({ processing: { memoryExtractedAt: '__ts__' } });
    const claimed = await claimProcessingMarker(db, {}, 'processing.memoryExtractedAt');
    expect(claimed).toBe(false);
    expect(sets).toHaveLength(0);
  });

  it('independent markers do not collide (burnout after memory)', async () => {
    const { db, sets } = makeTxDb({ processing: { memoryExtractedAt: '__ts__' } });
    const claimed = await claimProcessingMarker(db, {}, 'processing.burnoutCheckedAt');
    expect(claimed).toBe(true);
    expect(sets[0].data).toEqual({ processing: { burnoutCheckedAt: '__ts__' } });
  });
});

describe('acquireEntryLease (watchdog)', () => {
  it('wins when no lease exists', async () => {
    const { db, updates } = makeTxDb({ analysisStatus: 'pending' });
    const won = await acquireEntryLease(db, {}, 'run-1', { requireStatus: 'pending' });
    expect(won).toBe(true);
    expect(updates[0].data.analysisLease.by).toBe('run-1');
  });

  it('refuses when a fresh lease is held', async () => {
    const fresh = Date.now() - 60 * 1000; // 1 min ago
    const { db, updates } = makeTxDb({
      analysisStatus: 'pending',
      analysisLease: { at: { toMillis: () => fresh }, by: 'run-0' },
    });
    const won = await acquireEntryLease(db, {}, 'run-1', { requireStatus: 'pending' });
    expect(won).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('takes over an expired lease (older than 5 min)', async () => {
    const stale = Date.now() - 6 * 60 * 1000; // 6 min ago
    const { db, updates } = makeTxDb({
      analysisStatus: 'pending',
      analysisLease: { at: { toMillis: () => stale }, by: 'run-0' },
    });
    const won = await acquireEntryLease(db, {}, 'run-2', { requireStatus: 'pending' });
    expect(won).toBe(true);
    expect(updates[0].data.analysisLease.by).toBe('run-2');
  });

  it('refuses when the entry is no longer pending', async () => {
    const { db } = makeTxDb({ analysisStatus: 'complete' });
    const won = await acquireEntryLease(db, {}, 'run-1', { requireStatus: 'pending' });
    expect(won).toBe(false);
  });
});

describe('owner-scoped embedding cache', () => {
  it('derives different keys per uid for the same text', () => {
    expect(embeddingCacheKey('userA', 'same text')).not.toBe(
      embeddingCacheKey('userB', 'same text')
    );
  });

  it('key is stable and 24 chars', () => {
    const k = embeddingCacheKey('userA', 'hello');
    expect(k).toBe(embeddingCacheKey('userA', 'hello'));
    expect(k).toHaveLength(24);
  });

  it('writes ownerUid/embeddingModel/createdAt and NO preview', async () => {
    let written;
    const db = {
      collection: () => ({
        doc: () => ({ set: async (data) => { written = data; } }),
      }),
    };
    await setCachedEmbedding(db, 'userA', 'hello', [0.1, 0.2], 'text-embedding-004');
    expect(written.ownerUid).toBe('userA');
    expect(written.embeddingModel).toBe('text-embedding-004');
    expect(written.createdAt).toBe('__ts__');
    expect(written).not.toHaveProperty('preview');
  });
});
