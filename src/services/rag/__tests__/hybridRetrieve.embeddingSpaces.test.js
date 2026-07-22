/**
 * Embeddings v2 migration, plan task M2: hybridRetrieve's vector-similarity
 * signal routed through scoreEntryInBestSpace (space-aware, same-space-or-
 * nothing). See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi } from 'vitest';

// hybridRetrieve itself no longer imports '../../ai/embeddings' (it uses
// embeddingSpaces.js's local cosine copy), but importing from `../index`
// also re-exports companionContext.js, which transitively pulls in the real
// '../../config' -> firebase.js chain (triggers an unhandled Firebase
// Messaging rejection under jsdom). Stub the re-exported module out — this
// test only exercises hybridRetrieve — same isolation strategy as
// companionContext.scopeFilter.test.js uses for its own dependencies.
vi.mock('../companionContext', () => ({
  getCompanionContext: vi.fn(),
  formatContextForChat: vi.fn(),
  buildCompanionSystemPrompt: vi.fn(),
  estimateTokens: vi.fn(),
  truncateToTokens: vi.fn(),
}));

const { hybridRetrieve } = await import('../index');

describe('hybridRetrieve — vector signal, flag-off shape (legacy raw vector)', () => {
  it('byte-identical vector scoring: raw v1 array query vs entry.embedding', () => {
    const entries = [
      { id: 'a', category: 'x', embedding: [1, 0], createdAt: new Date(), tags: [] },
      { id: 'b', category: 'x', embedding: [0, 1], createdAt: new Date(), tags: [] },
    ];
    const result = hybridRetrieve({
      queryEmbedding: [1, 0],
      entries,
      category: 'x',
      weights: { vector: 1, recency: 0, entity: 0, mood: 0 },
      topK: 10,
    });
    const byId = Object.fromEntries(result.map(e => [e.id, e]));
    expect(byId.a._scores.vector).toBeCloseTo(1);
    expect(byId.a._vectorScoreSpace).toBe('v1');
    // 'b' scores 0 on the vector signal (orthogonal), and with all other
    // weights 0 its total score is 0, which is not > the 0.1 minimum
    // threshold — filtered out, matching legacy behavior byte-for-byte
    // (same as today's `queryEmbedding && entry.embedding ? cos : 0`).
    expect(byId.b).toBeUndefined();
  });

  it('entry with no embedding at all scores 0 on the vector signal (excluded from scoreable space, not an error)', () => {
    const entries = [{ id: 'a', category: 'x', createdAt: new Date(), tags: [] }];
    const result = hybridRetrieve({
      queryEmbedding: [1, 0],
      entries,
      category: 'x',
      weights: { vector: 1, recency: 0, entity: 0, mood: 0 },
      topK: 10,
    });
    // total score is 0 -> below the > 0.1 minimum threshold -> filtered out,
    // same as legacy behavior (queryEmbedding && entry.embedding ? cos : 0).
    expect(result.map(e => e.id)).toEqual([]);
  });
});

describe('hybridRetrieve — dual-space query vectors', () => {
  it('prefers v2 for a backfilled entry, falls back to v1 for an unbackfilled one, both surfaced', () => {
    const entries = [
      { id: 'v2', category: 'x', embedding: [0.1, 0.1], embeddingV2: [1, 0, 0], createdAt: new Date(), tags: [] },
      { id: 'v1', category: 'x', embedding: [1, 0], createdAt: new Date(), tags: [] },
    ];
    const result = hybridRetrieve({
      queryEmbedding: { v1: [1, 0], v2: [1, 0, 0] },
      entries,
      category: 'x',
      weights: { vector: 1, recency: 0, entity: 0, mood: 0 },
      topK: 10,
    });
    const byId = Object.fromEntries(result.map(e => [e.id, e]));
    expect(byId.v2._vectorScoreSpace).toBe('v2');
    expect(byId.v2._scores.vector).toBeCloseTo(1);
    expect(byId.v1._vectorScoreSpace).toBe('v1');
    expect(byId.v1._scores.vector).toBeCloseTo(1);
  });

  it('never cross-scores: a v2-only query against a v1-only entry contributes 0 to the vector signal', () => {
    const entries = [{ id: 'a', category: 'x', embedding: [1, 0, 0], createdAt: new Date(), tags: [] }];
    const result = hybridRetrieve({
      queryEmbedding: { v2: [1, 0, 0] }, // equal dims to entry.embedding, no v1 query vector
      entries,
      category: 'x',
      weights: { vector: 1, recency: 0, entity: 0, mood: 0 },
      topK: 10,
    });
    expect(result.map(e => e.id)).toEqual([]); // vector score 0 -> below threshold
  });
});
