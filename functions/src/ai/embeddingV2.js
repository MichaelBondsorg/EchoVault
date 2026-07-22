/**
 * gemini-embedding-2 (v2) embedding generation + the same-space retrieval guard
 * (plan task M3).
 *
 * Vectors from different embedding models live in incompatible geometric
 * spaces: cosine similarity between a v1 (text-embedding-004) vector and a v2
 * (gemini-embedding-2) vector is meaningless and silently corrupts retrieval.
 * scoreSameSpace() makes that mistake structurally impossible — it refuses to
 * compare vectors whose declared `space` differs.
 */

// Embedding spaces. A vector is only ever compared to another vector of the
// same space.
export const EMBEDDING_SPACES = Object.freeze({ v1: 'v1', v2: 'v2' });

// gemini-embedding-2 is a retrieval model; documents and stored entry vectors
// are embedded with the RETRIEVAL_DOCUMENT task type.
export const EMBEDDING_V2_TASK_TYPE = 'RETRIEVAL_DOCUMENT';

// gemini-embedding-2 is an ASYMMETRIC retrieval model: the query side of a
// retrieval pair must be embedded with RETRIEVAL_QUERY, not
// RETRIEVAL_DOCUMENT. The two task types produce vectors tuned for their side
// of the pairing (query <-> document) — embedding a search query with the
// document task type (or vice versa) still produces a same-shape vector but
// silently degrades retrieval quality, with no error to signal the mistake.
// Server query embeddings (plan task M1) MUST use this constant; document/
// entry embeddings (dual-write, above) MUST keep using EMBEDDING_V2_TASK_TYPE.
export const EMBEDDING_V2_QUERY_TASK_TYPE = 'RETRIEVAL_QUERY';

const V2_TIMEOUT_MS = 15000;

/** Build the embeddingMeta provenance stamp written alongside a v2 vector. */
export function buildEmbeddingMeta({ model, dim, taskType, createdAt }) {
  return {
    model,
    dim,
    taskType,
    createdAt: createdAt || new Date().toISOString(),
  };
}

/**
 * Generate a v2 embedding via gemini-embedding-2. Fail-open: returns null on any
 * error (HTTP, network, unparseable) so the caller can still persist the legacy
 * v1 vector.
 *
 * @returns {Promise<{embedding:number[], dim:number}|null>}
 */
export async function generateEmbeddingV2(text, apiKey, {
  model,
  taskType = EMBEDDING_V2_TASK_TYPE,
  timeoutMs = V2_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  if (!text || typeof text !== 'string' || !text.trim()) return null;
  if (!apiKey || !model) return null;
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('[embeddingV2] API error', { model, status: res.status, err: errorData?.error?.message });
      return null;
    }
    const data = await res.json();
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) return null;
    return { embedding: values, dim: values.length };
  } catch (e) {
    console.error('[embeddingV2] exception', { model, err: e?.message });
    return null;
  }
}

/** Raw cosine similarity of two equal-length numeric vectors. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Same-space cosine similarity. Both operands are `{ vector, space }`. Throws if
 * the spaces differ — a v2 query vector can NEVER be scored against a v1 doc
 * vector (or vice versa). This is the structural enforcement the plan requires.
 *
 * @param {{vector:number[], space:string}} query
 * @param {{vector:number[], space:string}} doc
 * @returns {number} cosine similarity within the shared space
 */
export function scoreSameSpace(query, doc) {
  if (!query || !doc || !query.space || !doc.space) {
    throw new Error('scoreSameSpace requires {vector, space} for query and doc');
  }
  if (query.space !== doc.space) {
    throw new Error(
      `Cross-space embedding comparison refused: query=${query.space} doc=${doc.space}`
    );
  }
  return cosineSimilarity(query.vector, doc.vector);
}

export default {
  EMBEDDING_SPACES,
  EMBEDDING_V2_TASK_TYPE,
  EMBEDDING_V2_QUERY_TASK_TYPE,
  buildEmbeddingMeta,
  generateEmbeddingV2,
  cosineSimilarity,
  scoreSameSpace,
};
