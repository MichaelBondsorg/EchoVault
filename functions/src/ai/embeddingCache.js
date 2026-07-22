/**
 * Owner-scoped embedding cache.
 *
 * Historically `embedding_cache` was a TOP-LEVEL global collection keyed on
 * sha256(text)[:16] and it stored a 100-char plaintext `preview` of the user's
 * entry — a cross-user leak (any user's text preview readable by admin/debug
 * tooling, and cache hits shared across users). The key is now derived from
 * `sha256(uid + ':' + text)` so entries are namespaced per user, and NO
 * plaintext preview is ever written.
 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

const CACHE_COLLECTION = 'embedding_cache';

/** Owner-scoped cache key: sha256(uid + ':' + text)[:24]. */
export function embeddingCacheKey(uid, text) {
  return createHash('sha256')
    .update(`${uid}:${(text || '').trim()}`)
    .digest('hex')
    .substring(0, 24);
}

/**
 * Owner-scoped v2 cache key: sha256(uid + ':' + 'v2:' + text)[:24]. The 'v2:'
 * infix keeps gemini-embedding-2 vectors in a distinct keyspace so a v2 vector
 * can never be served for a v1 lookup (or vice versa) — same-space by
 * construction.
 */
export function embeddingV2CacheKey(uid, text) {
  return createHash('sha256')
    .update(`${uid}:v2:${(text || '').trim()}`)
    .digest('hex')
    .substring(0, 24);
}

/**
 * Owner-scoped v2 QUERY cache key: sha256(uid + ':' + 'v2q:' + text)[:24]. The
 * 'v2q:' infix keeps query-task-type vectors (RETRIEVAL_QUERY) in a keyspace
 * distinct from BOTH the v1 cache AND the v2 DOCUMENT cache (RETRIEVAL_
 * DOCUMENT, 'v2:' infix) — a query vector can never be served for a document
 * lookup (or vice versa), same-space by construction. See embeddingV2.js's
 * EMBEDDING_V2_QUERY_TASK_TYPE for why query and document vectors must not be
 * conflated even though they share a model and dimensionality.
 */
export function embeddingV2QueryCacheKey(uid, text) {
  return createHash('sha256')
    .update(`${uid}:v2q:${(text || '').trim()}`)
    .digest('hex')
    .substring(0, 24);
}

/** Read a cached embedding for this user's text, or null on miss/error. */
export async function getCachedEmbedding(db, uid, text) {
  try {
    const key = embeddingCacheKey(uid, text);
    const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
    return snap.exists ? snap.data().embedding : null;
  } catch (e) {
    console.warn('Cache read failed:', e?.message);
    return null;
  }
}

/**
 * Write a cached embedding for this user's text. Stores only the embedding plus
 * ownership/model metadata — never a plaintext preview.
 */
export async function setCachedEmbedding(db, uid, text, embedding, embeddingModel) {
  try {
    const key = embeddingCacheKey(uid, text);
    await db.collection(CACHE_COLLECTION).doc(key).set({
      embedding,
      ownerUid: uid,
      embeddingModel,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('Cache write failed:', e?.message);
  }
}

/**
 * Read a cached v2 embedding for this user's text, or null on miss/error.
 * Returns `{ embedding, embeddingMeta }` so the same-space metadata travels
 * with the vector.
 */
export async function getCachedEmbeddingV2(db, uid, text) {
  try {
    const key = embeddingV2CacheKey(uid, text);
    const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!Array.isArray(data.embedding)) return null;
    return { embedding: data.embedding, embeddingMeta: data.embeddingMeta || null };
  } catch (e) {
    console.warn('V2 cache read failed:', e?.message);
    return null;
  }
}

/**
 * Write a cached v2 embedding for this user's text. Stores the vector plus its
 * embeddingMeta (model, dim, taskType, createdAt) — never a plaintext preview.
 */
export async function setCachedEmbeddingV2(db, uid, text, embedding, embeddingMeta) {
  try {
    const key = embeddingV2CacheKey(uid, text);
    await db.collection(CACHE_COLLECTION).doc(key).set({
      embedding,
      ownerUid: uid,
      embeddingMeta: embeddingMeta || null,
      embeddingModel: embeddingMeta?.model || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('V2 cache write failed:', e?.message);
  }
}

/**
 * Read a cached v2 QUERY embedding (RETRIEVAL_QUERY task type) for this
 * user's text, or null on miss/error. Distinct from `getCachedEmbeddingV2`
 * (the DOCUMENT-task-type cache) — see `embeddingV2QueryCacheKey`.
 */
export async function getCachedEmbeddingV2Query(db, uid, text) {
  try {
    const key = embeddingV2QueryCacheKey(uid, text);
    const snap = await db.collection(CACHE_COLLECTION).doc(key).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (!Array.isArray(data.embedding)) return null;
    return { embedding: data.embedding, embeddingMeta: data.embeddingMeta || null };
  } catch (e) {
    console.warn('V2 query cache read failed:', e?.message);
    return null;
  }
}

/**
 * Write a cached v2 QUERY embedding for this user's text. Stores the vector
 * plus its embeddingMeta (model, dim, taskType, createdAt) — never a
 * plaintext preview. Written under `embeddingV2QueryCacheKey`, never the v1
 * or v2-document key.
 */
export async function setCachedEmbeddingV2Query(db, uid, text, embedding, embeddingMeta) {
  try {
    const key = embeddingV2QueryCacheKey(uid, text);
    await db.collection(CACHE_COLLECTION).doc(key).set({
      embedding,
      ownerUid: uid,
      embeddingMeta: embeddingMeta || null,
      embeddingModel: embeddingMeta?.model || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('V2 query cache write failed:', e?.message);
  }
}

export default {
  embeddingCacheKey,
  embeddingV2CacheKey,
  embeddingV2QueryCacheKey,
  getCachedEmbedding,
  setCachedEmbedding,
  getCachedEmbeddingV2,
  setCachedEmbeddingV2,
  getCachedEmbeddingV2Query,
  setCachedEmbeddingV2Query,
};
