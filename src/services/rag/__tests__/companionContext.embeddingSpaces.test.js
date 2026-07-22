/**
 * Embeddings v2 migration, plan task M2: companionContext Tier 4
 * (semantically similar entries) routed through scoreEntryInBestSpace.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../memory', () => ({
  getMemoryGraph: vi.fn(async () => null),
  formatMemoryForContext: vi.fn(() => null),
}));
vi.mock('../../memory/sessionBuffer', () => ({
  getSessionBuffer: vi.fn(() => null),
  formatBufferForContext: vi.fn(() => null),
  isExpired: vi.fn(() => true),
}));

const { getCompanionContext } = await import('../companionContext');

const baseArgs = {
  userId: 'u1',
  query: 'anything with no entity keywords',
  entries: [],
};

// Older than Tier 3's 7-day recency window, so these entries fall through to
// Tier 4 (semantic) instead of being claimed by Tier 3 (recent) first —
// Tier 3 dedup would otherwise hide them from Tier 4 regardless of scoring.
const OLD_DATE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('getCompanionContext — Tier 4 space-aware scoring (plan M2)', () => {
  it('flag-off shape: legacy raw v1 vector scores byte-identically against entry.embedding', async () => {
    const entries = [
      { id: 'a', embedding: [1, 0, 0], createdAt: OLD_DATE, text: 'match', tags: [] },
      { id: 'b', embedding: [0, 1, 0], createdAt: OLD_DATE, text: 'no match', tags: [] }, // orthogonal -> below 0.25
    ];
    const result = await getCompanionContext({
      ...baseArgs,
      queryEmbedding: [1, 0, 0], // legacy raw array
      entries,
    });
    const ids = result.context.similar.map(e => e.id);
    expect(ids).toEqual(['a']);
  });

  it('dual-space mixed corpus: v2-covered entry scores in v2 space, uncovered entry falls back to v1, both surfaced', async () => {
    const entries = [
      { id: 'v2-covered', embedding: [0.1, 0.1, 0.1], embeddingV2: [1, 0, 0], createdAt: OLD_DATE, text: 'v2', tags: [] },
      { id: 'v1-only', embedding: [1, 0, 0], createdAt: OLD_DATE, text: 'v1', tags: [] },
    ];
    const result = await getCompanionContext({
      ...baseArgs,
      queryEmbedding: { v1: [1, 0, 0], v2: [1, 0, 0] },
      entries,
    });
    const byId = Object.fromEntries(result.context.similar.map(e => [e.id, e]));
    expect(byId['v2-covered']).toBeTruthy();
    expect(byId['v1-only']).toBeTruthy();
  });

  it('never cross-scores: entry with only a v2 vector is invisible to a v1-only query even with matching dims', async () => {
    const entries = [
      { id: 'v2-only', embeddingV2: [1, 0, 0], createdAt: OLD_DATE, text: 'x', tags: [] },
    ];
    const result = await getCompanionContext({
      ...baseArgs,
      queryEmbedding: { v1: [1, 0, 0] }, // no v2 query vector
      entries,
    });
    expect(result.context.similar.map(e => e.id)).toEqual([]);
  });

  it('no queryEmbedding at all: Tier 4 stays empty (legacy behavior)', async () => {
    const entries = [{ id: 'a', embedding: [1, 0, 0], createdAt: new Date(), text: 'x', tags: [] }];
    const result = await getCompanionContext({
      ...baseArgs,
      queryEmbedding: null,
      entries,
    });
    expect(result.context.similar).toEqual([]);
  });
});
