/**
 * Embeddings v2 migration, plan task M2: getSmartChatContext's semantic
 * matching routed through scoreEntryInBestSpace.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ai/gemini', () => ({ analyzeJournalEntryCloud: vi.fn() }));
vi.mock('../../../config/firebase', () => ({ askJournalAIFn: vi.fn() }));

const { getSmartChatContext } = await import('../index');

describe('getSmartChatContext — flag-off shape (legacy raw v1 vector)', () => {
  // getSmartChatContext also always merges in `scopedEntries.slice(0, 5)`
  // as a "recent entries" fallback (pre-existing, unrelated to this
  // task) — padding with >5 filler entries isolates the semantic-matching
  // seam under test from that fallback.
  const filler = Array.from({ length: 5 }, (_, i) => ({ id: `filler-${i}` }));

  it('byte-identical: scores against e.embedding only, same 0.3 threshold, same ordering', async () => {
    const entries = [
      { id: 'high', embedding: [1, 0] },       // cosine 1
      { id: 'low', embedding: [0.5, 0.87] },   // cosine ~0.5, above 0.3
      ...filler,
      { id: 'below', embedding: [0, 1] },      // cosine 0, below 0.3 -> excluded
      { id: 'none' },                          // no embedding -> excluded
    ];
    const result = await getSmartChatContext(entries, 'a question with no tag words', [1, 0]);
    const ids = result.map(e => e.id);
    // Semantic matches come first, sorted descending by similarity.
    expect(ids.slice(0, 2)).toEqual(['high', 'low']);
    expect(ids).not.toContain('below');
    expect(ids).not.toContain('none');
  });
});

describe('getSmartChatContext — dual-space mixed corpus', () => {
  it('v2-covered entry scores in v2, uncovered entry falls back to v1, both surfaced with sensible ordering', async () => {
    const entries = [
      { id: 'v2-covered', embedding: [0.01, 0.01], embeddingV2: [1, 0, 0] }, // perfect match in v2
      { id: 'v1-only', embedding: [1, 0] }, // perfect match in v1
    ];
    const result = await getSmartChatContext(
      entries,
      'a question with no tag words',
      { v1: [1, 0], v2: [1, 0, 0] }
    );
    const ids = result.map(e => e.id);
    expect(ids).toContain('v2-covered');
    expect(ids).toContain('v1-only');
    const byId = Object.fromEntries(result.map(e => [e.id, e]));
    expect(byId['v2-covered']._scoreSpace).toBe('v2');
    expect(byId['v1-only']._scoreSpace).toBe('v1');
  });

  it('never cross-scores: a v2-only entry is never semantically matched against a v1-only query, even with matching dims', async () => {
    // >5 filler entries ahead of the target so the always-on "recent
    // entries" fallback (scopedEntries.slice(0, 5), pre-existing and
    // unrelated to this task) cannot be what makes the target appear —
    // only real semantic matching could put it in the result.
    const filler = Array.from({ length: 5 }, (_, i) => ({ id: `filler-${i}` }));
    const entries = [...filler, { id: 'v2-only', embeddingV2: [1, 0, 0] }];
    const result = await getSmartChatContext(entries, 'a question', { v1: [1, 0, 0] });
    expect(result.map(e => e.id)).not.toContain('v2-only');
  });
});
