/**
 * Embeddings v2 migration, plan task M2: client space-aware retrieval.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();

vi.mock('../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));

vi.mock('../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));

const {
  generateEmbedding,
  generateEmbeddingV2,
  generateQueryEmbeddings,
  findRelevantMemories,
  cosineSimilarity,
} = await import('../embeddings');

beforeEach(() => {
  mockGenerateEmbeddingFn.mockReset();
  mockGetFlag.mockReset();
  mockGetFlag.mockReturnValue(false); // default: flag OFF
});

describe('generateEmbeddingV2 — unconditional v2, no flag check (embeddings v2 migration plan M5, thread-vector repair)', () => {
  it('requests version:"v2" and never consults getFlag', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 2, 3], space: 'v2' } });

    const result = await generateEmbeddingV2('some thread name');

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'some thread name', version: 'v2' });
    expect(mockGetFlag).not.toHaveBeenCalled();
    expect(result).toEqual([1, 2, 3]);
  });

  it('rejects invalid/empty text without calling the callable', async () => {
    const result = await generateEmbeddingV2('');
    expect(result).toBeNull();
    expect(mockGenerateEmbeddingFn).not.toHaveBeenCalled();
  });

  it('returns null when the callable yields no embedding, after one retry (graceful degradation, never throws)', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: {} });
    const result = await generateEmbeddingV2('nothing here');
    expect(result).toBeNull();
  });

  it('retries once on exception then returns null on exhausted retry (never hard-fails the caller)', async () => {
    mockGenerateEmbeddingFn.mockRejectedValue(new Error('v2 down'));
    const result = await generateEmbeddingV2('flaky text');
    expect(result).toBeNull();
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2); // initial + 1 retry
  });
});

describe('generateQueryEmbeddings — flag OFF (byte-identical current behavior)', () => {
  it('calls the callable exactly once with no version field, returns {v1}', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 2, 3] } });

    const result = await generateQueryEmbeddings('hello');

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'hello' });
    expect(result).toEqual({ v1: [1, 2, 3] });
  });

  it('is a thin wrapper over the exact same call generateEmbedding makes (spy-provable equivalence)', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [9, 9] } });
    const direct = await generateEmbedding('same text');
    mockGenerateEmbeddingFn.mockClear();
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [9, 9] } });
    const viaQuery = await generateQueryEmbeddings('same text');

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'same text' });
    expect(viaQuery).toEqual({ v1: direct });
  });

  it('returns null (existing null semantics) when the callable yields no embedding, after the existing retry', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: {} });
    const result = await generateQueryEmbeddings('nothing here');
    expect(result).toBeNull();
    // existing generateEmbedding retries once on empty/exception path is a
    // *separate* concern (retryCount only applies inside the exception
    // branch) — here we just confirm the null passthrough.
  });

  it('rejects invalid/empty text without calling the callable', async () => {
    const result = await generateQueryEmbeddings('');
    expect(result).toBeNull();
    expect(mockGenerateEmbeddingFn).not.toHaveBeenCalled();
  });
});

describe('generateQueryEmbeddings — flag ON (dual-space)', () => {
  beforeEach(() => {
    mockGetFlag.mockImplementation((name) => name === 'model.embeddingV2Read');
  });

  it('requests BOTH v1 and v2 via two callable invocations with explicit versions', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1], space: 'v2' } });
      throw new Error('unexpected call shape: ' + JSON.stringify(arguments));
    });

    const result = await generateQueryEmbeddings('hello');

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'hello', version: 'v1' });
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'hello', version: 'v2' });
    expect(result).toEqual({ v1: [1, 0], v2: [0, 1] });
  });

  it('v2 call fails (throws, matching the server fail-loud contract) -> degrades gracefully to v1-only with a console.warn, never hard-fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0], space: 'v1' } });
      if (version === 'v2') return Promise.reject(new Error('v2 unavailable'));
    });

    const result = await generateQueryEmbeddings('hello');

    expect(result).toEqual({ v1: [1, 0] });
    expect(result.v2).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('v1 call fails (embeddings migration M4: v1 is retired upstream), v2 succeeds -> returns {v2} only, with a warn not an error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.reject(new Error('v1 down'));
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1], space: 'v2' } });
    });

    const result = await generateQueryEmbeddings('hello');

    expect(result).toEqual({ v2: [0, 1] });
    expect(result.v1).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled(); // v1 failure logged, but not screamed
    expect(errSpy).not.toHaveBeenCalled(); // M4 inversion: no longer console.error
    warnSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('both v1 AND v2 fail -> null (the only case that still nulls out, M4)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.reject(new Error('v1 down'));
      if (version === 'v2') return Promise.reject(new Error('v2 down'));
    });

    const result = await generateQueryEmbeddings('hello');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(2); // one for v1, one for v2
    warnSpy.mockRestore();
  });
});

describe('generateQueryEmbeddings — flag OFF, v1-retired-upstream reality (M4)', () => {
  it('flag OFF + v1 dead -> null (keyword-only retrieval) — pre-migration prod behavior, faithfully reproduced, not a new regression', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: {} }); // v1 call yields nothing, as it now always does
    const result = await generateQueryEmbeddings('hello');
    expect(result).toBeNull();
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'hello' }); // single call, no version field — unchanged
  });
});

describe('findRelevantMemories — routed through scoreEntryInBestSpace (space-aware seam)', () => {
  const category = 'personal';

  it('flag-off-shaped call (raw v1 vector) is byte-identical to legacy cosine-based scoring', () => {
    const target = [1, 0];
    const entries = [
      { id: 'a', category, embedding: [1, 0] }, // cosine 1
      { id: 'b', category, embedding: [0, 1] }, // cosine 0 -> below 0.35 threshold
      { id: 'c', category, embedding: null },   // no embedding -> excluded
      { id: 'd', category: 'other', embedding: [1, 0] }, // wrong category -> excluded
    ];

    const result = findRelevantMemories(target, entries, category, 5);

    expect(result.map(e => e.id)).toEqual(['a']);
    expect(result[0].score).toBeCloseTo(cosineSimilarity([1, 0], [1, 0]));
  });

  it('dual-space mixed corpus: v2-covered entry scores in v2, uncovered entry scores in v1, both surfaced with sensible ordering', () => {
    const queryVectors = { v1: [1, 0], v2: [1, 0, 0] };
    const entries = [
      // Backfilled: has both, v2 should be used (perfect match in v2 space).
      { id: 'v2-covered', category, embedding: [0.9, 0.1], embeddingV2: [1, 0, 0] },
      // Not backfilled yet: only v1, falls back to v1 (perfect match in v1 space).
      { id: 'v1-only', category, embedding: [1, 0] },
    ];

    const result = findRelevantMemories(queryVectors, entries, category, 5);
    const byId = Object.fromEntries(result.map(e => [e.id, e]));

    expect(byId['v2-covered']._scoreSpace).toBe('v2');
    expect(byId['v2-covered'].score).toBeCloseTo(1);
    expect(byId['v1-only']._scoreSpace).toBe('v1');
    expect(byId['v1-only'].score).toBeCloseTo(1);
    // Both entries are visible (no entry became invisible for lack of v2 coverage).
    expect(result.map(e => e.id).sort()).toEqual(['v1-only', 'v2-covered']);
  });

  it('returns [] when given no query vectors at all', () => {
    expect(findRelevantMemories(null, [{ id: 'a', category, embedding: [1, 0] }], category)).toEqual([]);
  });

  it('{v2}-only query vectors (M4: v1-failed shape from generateQueryEmbeddings) score v2-covered entries and correctly exclude v1-only entries as unscoreable', () => {
    const queryVectors = { v2: [1, 0, 0] }; // no v1 key at all, matching generateQueryEmbeddings' new {v2} return shape
    const entries = [
      { id: 'v2-covered', category, embeddingV2: [1, 0, 0] }, // no v1 vector even on the entry
      { id: 'v1-only', category, embedding: [1, 0] }, // has no v2 -> not scoreable against a v2-only query
    ];

    const result = findRelevantMemories(queryVectors, entries, category, 5);

    expect(result.map(e => e.id)).toEqual(['v2-covered']);
    expect(result[0]._scoreSpace).toBe('v2');
    expect(result[0].score).toBeCloseTo(1);
  });
});
