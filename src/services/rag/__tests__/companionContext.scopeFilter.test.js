/**
 * Adversarial scope-filter test for the companion RAG retrieval seam (R1
 * plan task 10): getCompanionContext must apply filterEntriesByScope AFTER
 * the existing category filter (both compose), so a Work-scoped call can
 * never surface a Personal-space or unscoped entry in any tier (recent,
 * similar, or entity-matched).
 */
import { describe, it, expect, vi } from 'vitest';

// Avoid pulling in the real '../../config' -> firebase.js chain (which triggers
// an unhandled Firebase Messaging rejection under jsdom). Re-implement the
// pure cosine-similarity math so the "similar" tier still behaves for real.
vi.mock('../../ai/embeddings', () => ({
  cosineSimilarity: (vecA, vecB) => {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
      magA += vecA[i] * vecA[i];
      magB += vecB[i] * vecB[i];
    }
    return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  },
}));

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

const NOW = new Date();
const SHARED_EMBEDDING = [1, 0, 0];

function mixedCorpus() {
  return [
    {
      id: 'work-1',
      spaceId: 'work',
      category: 'work',
      text: 'Sarah and I discussed the Q3 launch roadmap',
      tags: ['@person:sarah'],
      embedding: SHARED_EMBEDDING,
      createdAt: NOW,
    },
    {
      id: 'personal-1',
      spaceId: 'personal',
      category: 'work', // same category as work-1 so category filter alone can't separate these
      text: 'Sarah and I talked about the wedding plans',
      tags: ['@person:sarah'],
      embedding: SHARED_EMBEDDING,
      createdAt: NOW,
    },
    {
      id: 'unscoped-1',
      // no spaceId — legacy pre-Context-Spaces entry
      category: 'work',
      text: 'Sarah mentioned the launch again',
      tags: ['@person:sarah'],
      embedding: SHARED_EMBEDDING,
      createdAt: NOW,
    },
  ];
}

function allCandidateIds(result) {
  const { context } = result;
  return [
    ...context.recent.map((e) => e.id),
    ...context.similar.map((e) => e.id),
    ...context.entityMatched.map((e) => e.id),
  ];
}

describe('getCompanionContext - scope filter seam', () => {
  it('Work-scoped call never surfaces Personal-space or unscoped candidate ids in any tier', async () => {
    const entries = mixedCorpus();
    const result = await getCompanionContext({
      userId: 'u1',
      query: 'What did Sarah say about the launch?',
      queryEmbedding: SHARED_EMBEDDING,
      entries,
      category: 'work',
      scope: { spaceId: 'work' },
    });

    const ids = allCandidateIds(result);
    expect(ids).toContain('work-1');
    expect(ids).not.toContain('personal-1');
    expect(ids).not.toContain('unscoped-1');
    expect(result.stats.totalEntriesSearched).toBe(1);
  });

  it('null scope preserves legacy behavior: same candidates as an unscoped call (category filter alone)', async () => {
    const entries = mixedCorpus();
    const withNullScope = await getCompanionContext({
      userId: 'u1',
      query: 'What did Sarah say about the launch?',
      queryEmbedding: SHARED_EMBEDDING,
      entries,
      category: 'work',
      scope: null,
    });
    const withoutScopeArg = await getCompanionContext({
      userId: 'u1',
      query: 'What did Sarah say about the launch?',
      queryEmbedding: SHARED_EMBEDDING,
      entries,
      category: 'work',
    });

    expect(allCandidateIds(withNullScope).sort()).toEqual(allCandidateIds(withoutScopeArg).sort());
    // Sanity: legacy (unscoped) behavior surfaces all three same-category candidates.
    expect(allCandidateIds(withoutScopeArg).sort()).toEqual(['personal-1', 'unscoped-1', 'work-1']);
  });
});
