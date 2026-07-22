/**
 * Pure/injectable core of `backfill-embeddings-v2.js`, extracted so the unit
 * test can import it WITHOUT resolving `firebase-admin` (which is installed
 * only for local admin runs via `scripts/npm install` — CI's vitest never
 * installs scripts/ deps, and the pre-extraction test failed CI's vite
 * import-analysis on exactly that unresolvable import while passing locally
 * against an untracked scripts/node_modules; see the 2026-07-22 M4 deploy
 * failure).
 *
 * Everything here is admin-free: `saveCheckpoint` takes an injected
 * `serverTimestampFn` (the script passes the real
 * `admin.firestore.FieldValue.serverTimestamp`), and all Firestore access
 * goes through the injected `db`/doc handles. The script re-exports these
 * symbols so its own public surface is unchanged.
 */
import {
  generateEmbeddingV2,
  buildEmbeddingMeta,
  EMBEDDING_V2_TASK_TYPE,
} from '../functions/src/ai/embeddingV2.js';

export const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
export const DEFAULT_CHECKPOINT_PATH = 'migration_state/embeddingsV2';
export const GAP_CHECKPOINT_PATH = 'migration_state/embeddingsV2gap';

/**
 * Which checkpoint doc a run uses — gap mode gets its own so it never races
 * default mode's `lastPath`/counts (M4). Exported for direct unit testing.
 */
export function resolveCheckpointPath(includeMissingV1) {
  return includeMissingV1 ? GAP_CHECKPOINT_PATH : DEFAULT_CHECKPOINT_PATH;
}

export async function loadCheckpoint(db, checkpointPath, restart = false) {
  if (restart) return { lastPath: null, processed: 0, updated: 0, skipped: 0 };
  const snap = await db.doc(checkpointPath).get();
  if (!snap.exists) return { lastPath: null, processed: 0, updated: 0, skipped: 0 };
  const d = snap.data() || {};
  return {
    lastPath: d.lastPath || null,
    processed: d.processed || 0,
    updated: d.updated || 0,
    skipped: d.skipped || 0,
  };
}

/**
 * @param {() => any} [serverTimestampFn] - injected timestamp factory; the
 *   CLI passes `admin.firestore.FieldValue.serverTimestamp` so prod
 *   checkpoints keep their FieldValue sentinel; the default keeps this
 *   module admin-free for tests.
 */
export async function saveCheckpoint(
  db,
  checkpointPath,
  cp,
  done = false,
  dryRun = false,
  serverTimestampFn = () => new Date().toISOString(),
) {
  if (dryRun) return;
  await db.doc(checkpointPath).set(
    { ...cp, done, updatedAt: serverTimestampFn() },
    { merge: true }
  );
}

// Per-user consent cache. Only an EXPLICIT aiProcessing:false blocks backfill.
const consentCache = new Map();
async function userAllowsAi(db, uid) {
  if (consentCache.has(uid)) return consentCache.get(uid);
  let allowed = true;
  try {
    const snap = await db.doc(`artifacts/${APP_COLLECTION_ID}/users/${uid}/settings/consent`).get();
    if (snap.exists && snap.data()?.aiProcessing === false) allowed = false;
  } catch (e) {
    console.warn(`[consent] read failed for ${uid}, treating as allowed: ${e?.message}`);
  }
  consentCache.set(uid, allowed);
  return allowed;
}

/** Test seam: the consent cache is module-level; reset between test cases. */
export function __resetConsentCache() {
  consentCache.clear();
}

function uidFromEntryRef(ref) {
  // .../users/{uid}/entries/{entryId} -> parent=entries, parent.parent=user doc
  return ref.parent?.parent?.id || null;
}

/**
 * Pure eligibility classifier (M4). Kept side-effect free and exported so
 * both modes' entry-selection logic is unit-testable without a live
 * Firestore doc.
 *
 * @param {{embedding?: any, embeddingV2?: any, text?: any}} data - raw entry doc data
 * @param {{includeMissingV1: boolean}} opts
 * @returns {{eligible: boolean, reason?: string}}
 */
export function classifyEntry(data, { includeMissingV1 } = {}) {
  const hasV1 = Array.isArray(data?.embedding);
  const hasV2 = Array.isArray(data?.embeddingV2);
  const hasText = typeof data?.text === 'string' && data.text.trim().length > 0;

  if (hasV2) return { eligible: false, reason: 'already-has-v2' };
  if (!hasText) return { eligible: false, reason: 'no-text' };

  if (includeMissingV1) {
    // Gap mode targets entries with NEITHER vector.
    if (hasV1) return { eligible: false, reason: 'has-v1-use-default-mode' };
    return { eligible: true };
  }

  // Default mode targets entries that already have v1 — unchanged contract.
  if (!hasV1) return { eligible: false, reason: 'no-v1-use-gap-mode' };
  return { eligible: true };
}

/**
 * Process a single entry doc: classify, consent-gate, generate v2 (unless
 * dry-run), write. Mutates `cp` counters in place. Exported for unit
 * testing with a fake doc/db — never reads `process.argv`/env directly.
 *
 * @returns {Promise<{eligible: boolean, reason?: string, dryRun?: boolean, update?: object}>}
 */
export async function processEntryDoc(doc, cp, {
  db,
  apiKey,
  v2Model,
  dryRun,
  includeMissingV1,
  generateEmbeddingV2Fn = generateEmbeddingV2,
} = {}) {
  cp.processed += 1;
  const data = doc.data() || {};

  const classification = classifyEntry(data, { includeMissingV1 });
  if (!classification.eligible) {
    cp.skipped += 1;
    return classification;
  }

  const uid = uidFromEntryRef(doc.ref);
  if (!uid || !(await userAllowsAi(db, uid))) {
    cp.skipped += 1;
    return { eligible: false, reason: 'consent' };
  }

  if (dryRun) {
    cp.updated += 1;
    return { eligible: true, dryRun: true };
  }

  const v2 = await generateEmbeddingV2Fn(data.text, apiKey, {
    model: v2Model,
    taskType: EMBEDDING_V2_TASK_TYPE,
  });
  if (!v2) {
    cp.skipped += 1;
    return { eligible: false, reason: 'v2-generation-failed' };
  }

  const embeddingMeta = buildEmbeddingMeta({
    model: v2Model,
    dim: v2.dim,
    taskType: EMBEDDING_V2_TASK_TYPE,
  });
  // v2-ONLY payload — the `embedding` (v1) key is NEVER written by this
  // script in either mode: v1 is either already present (default mode, left
  // untouched) or permanently unavailable upstream (gap mode) and must
  // never be fabricated.
  const update = { embeddingV2: v2.embedding, embeddingMeta };
  await doc.ref.update(update);
  cp.updated += 1;
  return { eligible: true, update };
}
