/**
 * Client-side space-aware retrieval scorer (embeddings v2 migration, plan
 * task M2 — docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md).
 *
 * Vectors from different embedding models live in incompatible geometric
 * spaces: cosine similarity between a v1 (text-embedding-004) vector and a
 * v2 (gemini-embedding-2) vector is meaningless and silently corrupts
 * retrieval (cosineSimilarity even returns a numeric-looking 0 on a length
 * mismatch instead of erroring — dangerous if dims ever coincide). This
 * module ports the SAME-SPACE-OR-NOTHING semantics of the server's
 * `scoreSameSpace` (functions/src/ai/embeddingV2.js) to the client, without
 * importing server code into the client bundle (that file lives under
 * functions/ and is never bundled for the browser).
 *
 * Import-cycle note: `cosineSimilarity` is duplicated here (a tiny, pure,
 * ~10-line function) rather than imported from `./embeddings.js`. Reason:
 * `embeddings.js` must import `scoreEntryInBestSpace` from this module to
 * route `findRelevantMemories` (plan M2 seam) through space-aware scoring,
 * so the reverse import (`embeddingSpaces.js` -> `embeddings.js`) would
 * create a circular ES module dependency. Duplicating the pure math here
 * keeps both modules acyclic and independently testable; if the two ever
 * drift, the adversarial tests in this module's test file exercise this
 * copy directly.
 */

/** Raw cosine similarity of two equal-length numeric vectors. */
export const cosineSimilarity = (vecA, vecB) => {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
};

/**
 * Score an entry against a set of query vectors, preferring v2 when both
 * sides have it, structurally never comparing across spaces.
 *
 * The "never cross-space" guarantee is structural, not a runtime check: the
 * v2 branch ONLY ever reads `queryVectors.v2` and `entry.embeddingV2`, and
 * the v1 branch ONLY ever reads `queryVectors.v1` and `entry.embedding` —
 * there is no code path that can pair `queryVectors.v2` with
 * `entry.embedding` (or vice versa), even if both happen to have the same
 * dimensionality. See embeddingSpaces.test.js's adversarial equal-dims
 * fixture.
 *
 * @param {{v1?: number[], v2?: number[]}} queryVectors
 * @param {{embedding?: number[], embeddingV2?: number[]}} entry
 * @returns {{score: number, space: 'v1'|'v2'} | null} null when neither
 *   space has BOTH a query vector and an entry vector (no scoreable space —
 *   same as today's "entry has no embedding" exclusion).
 */
export function scoreEntryInBestSpace(queryVectors, entry) {
  if (!queryVectors || !entry) return null;

  if (queryVectors.v2 && entry.embeddingV2) {
    return { score: cosineSimilarity(queryVectors.v2, entry.embeddingV2), space: 'v2' };
  }

  if (queryVectors.v1 && entry.embedding) {
    return { score: cosineSimilarity(queryVectors.v1, entry.embedding), space: 'v1' };
  }

  return null;
}

/**
 * Backward-compat normalizer: several retrieval seams (getSmartChatContext,
 * hybridRetrieve, getCompanionContext, findRelevantMemories) have existing
 * callers outside this task's file boundary (e.g. runRecipe.js,
 * UnifiedConversation.jsx) that pass a single legacy v1 vector (a plain
 * `number[]`, from the untouched `generateEmbedding(text)`), not the new
 * `{v1, v2}` shape. Normalizing here means every seam can call
 * `scoreEntryInBestSpace` uniformly without duplicating this shape-sniffing
 * logic, and legacy callers get byte-identical v1-only scoring.
 *
 * @param {number[]|{v1?: number[], v2?: number[]}|null|undefined} input
 * @returns {{v1?: number[], v2?: number[]}|null}
 */
export function toQueryVectors(input) {
  if (!input) return null;
  if (Array.isArray(input)) return { v1: input };
  if (typeof input === 'object' && (input.v1 || input.v2)) return input;
  return null;
}

export default { cosineSimilarity, scoreEntryInBestSpace, toQueryVectors };
