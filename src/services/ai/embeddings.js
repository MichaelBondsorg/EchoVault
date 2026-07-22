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
  // Threshold (0.35) applied to whichever space scored — unchanged per
  // space, a documented M2 assumption (different embedding models can have
  // different similarity distributions; revisit with real data, see M3
  // runbook note).
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
 * Generate a v2 (gemini-embedding-2) embedding vector for text,
 * UNCONDITIONALLY — no flag check (embeddings v2 migration plan task M5,
 * thread-vector repair; see
 * docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md and
 * threadManager.js's file-level doc comment).
 *
 * Reuses the exact same M1 callable contract as `generateQueryEmbeddings`'s
 * flag-ON path (`generateEmbeddingFn({text, version:'v2'})`) but bypasses
 * the `model.embeddingV2Read` flag check entirely. That flag governs a
 * ROLLOUT decision for seams that have a working v1 fallback to roll back
 * to (retrieval query scoring). Thread vectors have no such fallback: v1
 * (text-embedding-004) is permanently retired upstream, so gating this call
 * behind the flag would only mean "thread dedup is broken for flag-OFF
 * users" instead of "thread dedup always worked" — there is no rollback
 * target, so there is nothing for a flag to gate. This is a repair of a
 * dead code path, not a feature rollout.
 *
 * Retry/error shape mirrors `generateEmbedding` above (retry once on
 * exception, null on exhausted retry or empty result) so callers get the
 * same graceful-degradation contract they already rely on — the only
 * difference is the requested version and that failures log at `warn`
 * (matching this file's established v2-failure convention — v2 issues are
 * expected/transient-network class, not screaming-`error` incidents).
 *
 * @param {string} text
 * @param {number} retryCount - internal retry counter
 * @returns {Promise<number[]|null>} The v2 embedding vector or null on failure
 */
export const generateEmbeddingV2 = async (text, retryCount = 0) => {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      console.error('generateEmbeddingV2: Invalid or empty text provided');
      return null;
    }

    const result = await generateEmbeddingFn({ text, version: 'v2' });
    const embedding = result.data?.embedding || null;

    if (!embedding) {
      console.warn('generateEmbeddingV2: callable returned no embedding values');
    }

    return embedding;
  } catch (e) {
    console.warn('generateEmbeddingV2 exception:', e);

    // Retry once on failure, same policy as generateEmbedding.
    if (retryCount < 1) {
      console.log('Retrying v2 embedding generation after exception...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return generateEmbeddingV2(text, retryCount + 1);
    }

    return null;
  }
};

/**
 * Generate QUERY-side embedding vector(s) for retrieval (embeddings v2
 * migration plan task M2). This is the space-aware sibling of
 * `generateEmbedding` above — use this for retrieval query text (chat
 * questions, semantic search). threadManager.js's thread-name vectors do
 * NOT route through this flag-aware helper either — since plan task M5
 * they use the unconditional `generateEmbeddingV2` below (v2-pinned;
 * v1 is retired upstream and can never serve them again) — see
 * threadManager.js's doc comment.
 *
 * Flag `model.embeddingV2Read` gates the behavior:
 *  - OFF (default): returns `{v1}` via the EXACT SAME single callable
 *    invocation `generateEmbedding(text)` already makes today
 *    (`generateEmbeddingFn({text})`, no `version` field) — byte-identical
 *    current behavior, including its retry-once-on-exception semantics.
 *    `generateEmbedding` itself is untouched and still used unmodified by
 *    its other callers. (threadManager.js's thread vectors moved OFF this
 *    function's OFF-path entirely in plan task M5 — they use the
 *    unconditional `generateEmbeddingV2` below instead, since v1 is a dead
 *    fallback for them; see that function's doc comment.)
 *  - ON: dual-space robustness policy (no mid-migration cliff) — requests
 *    BOTH v1 and v2 query vectors via TWO separate invocations of the M1
 *    callable contract `generateEmbeddingFn({text, version})`, so entries
 *    are scoreable regardless of backfill coverage (`scoreEntryInBestSpace`
 *    then picks v2 when the entry has it, else falls back to v1 — see
 *    embeddingSpaces.js). No retry is layered on top of either ON-path
 *    call; failure handling is explicit below instead.
 *
 * Failure semantics (updated, embeddings migration M4 — v1-retirement
 * resilience, 2026-07-22: Google retired text-embedding-004 upstream, so
 * the v1 call below is now EXPECTED to fail on every invocation):
 *  - Either space can fail independently; the result carries whichever
 *    space(s) actually succeeded — `{v1, v2}`, `{v2}`, or `{v1}`.
 *  - `null` is returned ONLY when BOTH spaces fail. This is the inversion
 *    from pre-M4 behavior (which nulled out the whole result on a v1
 *    failure alone) — v2 must be able to carry retrieval alone now that v1
 *    is permanently dead.
 *  - A v1 failure is logged at `console.warn` (not `console.error`): v1 is
 *    known-dead upstream, so its failure is an expected, permanent
 *    condition, not an incident — screaming at `error` level on every
 *    single query would be pure alarm-fatigue noise. v2 failure was already
 *    a `console.warn` and stays one.
 *
 * IMPORTANT flag-OFF nuance: when `model.embeddingV2Read` is OFF, this
 * function still requests v1 ONLY (single call, byte-identical shape to
 * pre-migration). Since v1 is now permanently dead, a flag-OFF user gets
 * `null` back from every query -> keyword-only retrieval. This is NOT a
 * regression introduced by M4 — it is exactly today's pre-migration prod
 * behavior, faithfully reproduced. What M4 changes is the framing: flipping
 * `model.embeddingV2Read` ON is no longer an optional enhancement layered on
 * a working v1 baseline — it is now REQUIRED to get any semantic (non-
 * keyword) retrieval at all. See the runbook's v1-retirement note.
 *
 * @param {string} text
 * @returns {Promise<{v1?: number[], v2?: number[]}|null>}
 */
export const generateQueryEmbeddings = async (text) => {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    console.error('generateQueryEmbeddings: Invalid or empty text provided');
    return null;
  }

  if (!getFlag('model.embeddingV2Read')) {
    // OFF: byte-identical to today — the exact same tested single-call path
    // (including its retry-once behavior), just repackaged as {v1}. Note
    // (M4): v1 is retired upstream, so this path now resolves to `null` on
    // every call in practice — the flag being ON is the fix, see doc
    // comment above.
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
    // v1 is retired upstream (text-embedding-004 404s permanently) — an
    // expected, permanent condition, not an incident. One warn per query,
    // never console.error (M4 — was error pre-M4, see doc comment above).
    console.warn(
      'generateQueryEmbeddings: v1 embedding unavailable (v1 is retired upstream)',
      v1Result.status === 'rejected' ? v1Result.reason : 'empty embedding'
    );
  }

  if (!v1 && !v2) {
    return null; // both spaces failed — nothing to score against (M4: was v1-only-gates-null before)
  }

  const result = {};
  if (v1) result.v1 = v1;
  if (v2) result.v2 = v2;
  return result;
};
