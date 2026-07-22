import { generateEmbeddingFn } from '../../config';
import { getFlag } from '../../config/flags';
import { scoreEntryInBestSpace, toQueryVectors } from './embeddingSpaces';

/**
 * Calculate cosine similarity between two vectors
 */
export const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
};

/**
 * Find semantically relevant entries using vector similarity
 * (embeddings v2 migration plan task M2 seam: routed through
 * `scoreEntryInBestSpace` so a v2 query vector is only ever compared to a
 * v2 entry vector, never cross-space.)
 *
 * @param {number[]|{v1?: number[], v2?: number[]}} targetVector - a legacy
 *   raw v1 vector OR a `{v1, v2}` query-vectors object (see
 *   `generateQueryEmbeddings` below). `toQueryVectors` normalizes either
 *   shape, so a legacy raw-vector caller gets byte-identical v1-only
 *   scoring against `entry.embedding` (same threshold, same ordering).
 */
export const findRelevantMemories = (targetVector, allEntries, category, topK = 5) => {
  const queryVectors = toQueryVectors(targetVector);
  if (!queryVectors) return [];
  const contextEntries = allEntries.filter(e => e.category === category);
  const scored = contextEntries.map(e => {
    const result = scoreEntryInBestSpace(queryVectors, e);
    return { ...e, score: result ? result.score : -1, _scoreSpace: result?.space };
  });
  return scored.filter(e => e.score > 0.35).sort((a, b) => b.score - a.score).slice(0, topK);
};

/**
 * Generate an embedding vector for text using Cloud Function
 * @param {string} text - The text to generate an embedding for
 * @param {number} retryCount - Internal retry counter
 * @returns {Promise<number[]|null>} The embedding vector or null on failure
 */
export const generateEmbedding = async (text, retryCount = 0) => {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('generateEmbedding: Invalid or empty text provided');
      return null;
    }

    const result = await generateEmbeddingFn({ text });
    const embedding = result.data?.embedding || null;

    if (!embedding) {
      console.error('Embedding Cloud Function returned no embedding values');
    }

    return embedding;
  } catch (e) {
    console.error('generateEmbedding exception:', e);

    // Retry once on failure
    if (retryCount < 1) {
      console.log('Retrying embedding generation after exception...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return generateEmbedding(text, retryCount + 1);
    }

    return null;
  }
};

/**
 * Generate QUERY-side embedding vector(s) for retrieval (embeddings v2
 * migration plan task M2). This is the space-aware sibling of
 * `generateEmbedding` above — use this for retrieval query text (chat
 * questions, semantic search); use plain `generateEmbedding` for anything
 * that isn't a retrieval query (e.g. threadManager.js's thread-name
 * vectors, which are explicitly PINNED to v1 and must NOT route through
 * this flag-aware helper — see threadManager.js's doc comment).
 *
 * Flag `model.embeddingV2Read` gates the behavior:
 *  - OFF (default): returns `{v1}` via the EXACT SAME single callable
 *    invocation `generateEmbedding(text)` already makes today
 *    (`generateEmbeddingFn({text})`, no `version` field) — byte-identical
 *    current behavior, including its retry-once-on-exception semantics.
 *    `generateEmbedding` itself is untouched and still used unmodified by
 *    every one of its other callers (threadManager.js, etc).
 *  - ON: dual-space robustness policy (no mid-migration cliff) — requests
 *    BOTH v1 and v2 query vectors via TWO separate invocations of the M1
 *    callable contract `generateEmbeddingFn({text, version})`, so entries
 *    are scoreable regardless of backfill coverage (`scoreEntryInBestSpace`
 *    then picks v2 when the entry has it, else falls back to v1 — see
 *    embeddingSpaces.js). No retry is layered on top of either ON-path
 *    call; failure handling is explicit below instead.
 *
 * Failure semantics (documented, plan-binding):
 *  - v2 call fails/throws (the server's v2 path fails LOUD by design, see
 *    functions/index.js's `generateEmbedding` callable doc comment) ->
 *    degrade gracefully to v1-only with a `console.warn`. Retrieval must
 *    never hard-fail chat just because the newer space is unavailable.
 *  - v1 call fails -> existing null semantics: the whole function resolves
 *    to `null`, exactly like `generateEmbedding` returning `null` today, so
 *    every seam's existing `if (queryVectors) { ... }` guard still no-ops
 *    correctly.
 *
 * @param {string} text
 * @returns {Promise<{v1: number[], v2?: number[]}|null>}
 */
export const generateQueryEmbeddings = async (text) => {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.error('generateQueryEmbeddings: Invalid or empty text provided');
    return null;
  }

  if (!getFlag('model.embeddingV2Read')) {
    // OFF: byte-identical to today — the exact same tested single-call path
    // (including its retry-once behavior), just repackaged as {v1}.
    const v1 = await generateEmbedding(text);
    return v1 ? { v1 } : null;
  }

  // ON: two independent callable invocations, explicit versions.
  const [v1Result, v2Result] = await Promise.allSettled([
    generateEmbeddingFn({ text, version: 'v1' }),
    generateEmbeddingFn({ text, version: 'v2' }),
  ]);

  const v1 = v1Result.status === 'fulfilled' ? (v1Result.value?.data?.embedding || null) : null;
  const v2 = v2Result.status === 'fulfilled' ? (v2Result.value?.data?.embedding || null) : null;

  if (v2Result.status === 'rejected' || !v2) {
    console.warn(
      'generateQueryEmbeddings: v2 embedding unavailable, degrading to v1-only',
      v2Result.status === 'rejected' ? v2Result.reason : 'empty embedding'
    );
  }

  if (v1Result.status === 'rejected' || !v1) {
    console.error(
      'generateQueryEmbeddings: v1 embedding failed',
      v1Result.status === 'rejected' ? v1Result.reason : 'empty embedding'
    );
    return null; // existing null semantics preserved
  }

  return v2 ? { v1, v2 } : { v1 };
};
