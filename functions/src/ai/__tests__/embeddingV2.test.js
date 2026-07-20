/**
 * gemini-embedding-2 v2 embedding: generation, provenance, and the same-space
 * retrieval guard (plan task M3).
 */
import { describe, it, expect, vi } from 'vitest';

// The embedding cache stamps createdAt via FieldValue.serverTimestamp().
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => '__ts__' },
}));

import {
  EMBEDDING_SPACES,
  EMBEDDING_V2_TASK_TYPE,
  buildEmbeddingMeta,
  generateEmbeddingV2,
  cosineSimilarity,
  scoreSameSpace,
} from '../embeddingV2.js';
import {
  embeddingCacheKey,
  embeddingV2CacheKey,
  getCachedEmbeddingV2,
  setCachedEmbeddingV2,
} from '../embeddingCache.js';

function okResponse(values) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { embedding: { values } };
    },
  };
}

describe('scoreSameSpace — cross-space guard', () => {
  it('scores two vectors in the SAME space', () => {
    const q = { vector: [1, 0, 0], space: EMBEDDING_SPACES.v2 };
    const d = { vector: [1, 0, 0], space: EMBEDDING_SPACES.v2 };
    expect(scoreSameSpace(q, d)).toBeCloseTo(1, 6);
  });

  it('REFUSES to compare a v2 query against a v1 doc vector', () => {
    const q = { vector: [1, 2, 3], space: EMBEDDING_SPACES.v2 };
    const d = { vector: [1, 2, 3], space: EMBEDDING_SPACES.v1 };
    expect(() => scoreSameSpace(q, d)).toThrow(/Cross-space embedding comparison refused/);
  });

  it('REFUSES to compare a v1 query against a v2 doc vector', () => {
    const q = { vector: [1, 2, 3], space: EMBEDDING_SPACES.v1 };
    const d = { vector: [1, 2, 3], space: EMBEDDING_SPACES.v2 };
    expect(() => scoreSameSpace(q, d)).toThrow(/Cross-space/);
  });

  it('throws when space metadata is missing (cannot prove same-space)', () => {
    expect(() => scoreSameSpace({ vector: [1] }, { vector: [1], space: 'v1' })).toThrow();
    expect(() => scoreSameSpace({ vector: [1], space: 'v1' }, { vector: [1] })).toThrow();
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical, 0 for orthogonal', () => {
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('returns 0 for mismatched length or empty', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });
});

describe('generateEmbeddingV2', () => {
  it('sends the RETRIEVAL_DOCUMENT task type and returns {embedding, dim}', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse([0.1, 0.2, 0.3, 0.4]));
    const out = await generateEmbeddingV2('hello', 'key', { model: 'gemini-embedding-2', fetchImpl });
    expect(out).toEqual({ embedding: [0.1, 0.2, 0.3, 0.4], dim: 4 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('gemini-embedding-2:embedContent');
    const body = JSON.parse(init.body);
    expect(body.taskType).toBe(EMBEDDING_V2_TASK_TYPE);
    expect(body.model).toBe('models/gemini-embedding-2');
  });

  it('fail-open returns null on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, async json() { return {}; } });
    expect(await generateEmbeddingV2('hi', 'key', { model: 'gemini-embedding-2', fetchImpl })).toBeNull();
  });

  it('fail-open returns null on a thrown fetch', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    expect(await generateEmbeddingV2('hi', 'key', { model: 'gemini-embedding-2', fetchImpl })).toBeNull();
  });

  it('returns null without a model or apiKey (no call made)', async () => {
    const fetchImpl = vi.fn();
    expect(await generateEmbeddingV2('hi', '', { model: 'gemini-embedding-2', fetchImpl })).toBeNull();
    expect(await generateEmbeddingV2('hi', 'key', { model: '', fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('buildEmbeddingMeta', () => {
  it('captures model, dim, taskType, and a createdAt', () => {
    const meta = buildEmbeddingMeta({ model: 'gemini-embedding-2', dim: 768, taskType: 'RETRIEVAL_DOCUMENT' });
    expect(meta.model).toBe('gemini-embedding-2');
    expect(meta.dim).toBe(768);
    expect(meta.taskType).toBe('RETRIEVAL_DOCUMENT');
    expect(typeof meta.createdAt).toBe('string');
  });
});

describe('v2 cache-key separation', () => {
  it('v1 and v2 keys for the same (uid,text) differ', () => {
    expect(embeddingV2CacheKey('u1', 'hello')).not.toBe(embeddingCacheKey('u1', 'hello'));
  });
  it('v2 keys are owner-scoped and text-sensitive', () => {
    expect(embeddingV2CacheKey('u1', 'hello')).not.toBe(embeddingV2CacheKey('u2', 'hello'));
    expect(embeddingV2CacheKey('u1', 'hello')).not.toBe(embeddingV2CacheKey('u1', 'world'));
  });
  it('v2 keys are stable and 24 hex chars', () => {
    const k = embeddingV2CacheKey('u1', 'hello');
    expect(k).toBe(embeddingV2CacheKey('u1', 'hello'));
    expect(k).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('v2 cache read/write round-trip', () => {
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

  it('writes vector + embeddingMeta and reads them back same-space', async () => {
    const db = makeCacheDb();
    const meta = buildEmbeddingMeta({ model: 'gemini-embedding-2', dim: 3, taskType: 'RETRIEVAL_DOCUMENT' });
    await setCachedEmbeddingV2(db, 'u1', 'hello', [0.1, 0.2, 0.3], meta);
    const got = await getCachedEmbeddingV2(db, 'u1', 'hello');
    expect(got.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(got.embeddingMeta.model).toBe('gemini-embedding-2');
    // stored under the v2 key, never the v1 key
    expect(db.store.has(embeddingV2CacheKey('u1', 'hello'))).toBe(true);
    expect(db.store.has(embeddingCacheKey('u1', 'hello'))).toBe(false);
  });

  it('returns null on a v2 cache miss', async () => {
    const db = makeCacheDb();
    expect(await getCachedEmbeddingV2(db, 'u1', 'nope')).toBeNull();
  });
});
