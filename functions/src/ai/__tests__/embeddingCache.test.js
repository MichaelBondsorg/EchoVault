/**
 * Owner-scoped embedding cache: three-way keyspace separation between the v1
 * cache, the v2 DOCUMENT cache (RETRIEVAL_DOCUMENT), and the v2 QUERY cache
 * (RETRIEVAL_QUERY, plan task M1) — plus round-trip behavior for the new
 * query keyspace.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import {
  embeddingCacheKey,
  embeddingV2CacheKey,
  embeddingV2QueryCacheKey,
  getCachedEmbeddingV2Query,
  setCachedEmbeddingV2Query,
} from '../embeddingCache.js';
import { buildEmbeddingMeta, EMBEDDING_V2_QUERY_TASK_TYPE } from '../embeddingV2.js';

function makeCacheDb() {
  const store = new Map();
  return {
    store,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              return { exists: store.has(id), data: () => store.get(id) };
            },
            async set(val) {
              store.set(id, val);
            },
          };
        },
      };
    },
  };
}

describe('embeddingV2QueryCacheKey — three-way keyspace separation', () => {
  it('differs from BOTH the v1 key and the v2 document key for the same (uid,text)', () => {
    const v1 = embeddingCacheKey('u1', 'hello');
    const v2doc = embeddingV2CacheKey('u1', 'hello');
    const v2q = embeddingV2QueryCacheKey('u1', 'hello');
    expect(new Set([v1, v2doc, v2q]).size).toBe(3);
  });

  it('is owner-scoped and text-sensitive', () => {
    expect(embeddingV2QueryCacheKey('u1', 'hello')).not.toBe(embeddingV2QueryCacheKey('u2', 'hello'));
    expect(embeddingV2QueryCacheKey('u1', 'hello')).not.toBe(embeddingV2QueryCacheKey('u1', 'world'));
  });

  it('is stable and 24 hex chars', () => {
    const k = embeddingV2QueryCacheKey('u1', 'hello');
    expect(k).toBe(embeddingV2QueryCacheKey('u1', 'hello'));
    expect(k).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('v2 QUERY cache read/write round-trip', () => {
  it('writes vector + embeddingMeta and reads them back, keyed distinctly from v1 and v2-document', async () => {
    const db = makeCacheDb();
    const meta = buildEmbeddingMeta({ model: 'gemini-embedding-2', dim: 3, taskType: EMBEDDING_V2_QUERY_TASK_TYPE });
    await setCachedEmbeddingV2Query(db, 'u1', 'what did I say about work?', [0.1, 0.2, 0.3], meta);

    const got = await getCachedEmbeddingV2Query(db, 'u1', 'what did I say about work?');
    expect(got.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got.embeddingMeta.taskType).toBe('RETRIEVAL_QUERY');

    // stored under the query key, never the v1 or v2-document key
    expect(db.store.has(embeddingV2QueryCacheKey('u1', 'what did I say about work?'))).toBe(true);
    expect(db.store.has(embeddingCacheKey('u1', 'what did I say about work?'))).toBe(false);
    expect(db.store.has(embeddingV2CacheKey('u1', 'what did I say about work?'))).toBe(false);
  });

  it('returns null on a v2 query cache miss', async () => {
    const db = makeCacheDb();
    expect(await getCachedEmbeddingV2Query(db, 'u1', 'nope')).toBeNull();
  });

  it('a v2 DOCUMENT-space write is not visible via the QUERY read (no cross-keyspace bleed)', async () => {
    const db = makeCacheDb();
    // Simulate a document-space write directly under the doc key.
    await db.collection('embedding_cache').doc(embeddingV2CacheKey('u1', 'same text')).set({
      embedding: [9, 9, 9],
      embeddingMeta: buildEmbeddingMeta({ model: 'gemini-embedding-2', dim: 3, taskType: 'RETRIEVAL_DOCUMENT' }),
    });
    expect(await getCachedEmbeddingV2Query(db, 'u1', 'same text')).toBeNull();
  });
});
