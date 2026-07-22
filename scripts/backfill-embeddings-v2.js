/**
 * Backfill gemini-embedding-2 (v2) vectors onto existing journal entries.
 *
 * Admin-SDK maintenance script — run MANUALLY, never wired to CI.
 *
 * Modes:
 *  - Default: entries that already have a legacy v1 `embedding` but no
 *    `embeddingV2` get a v2 vector written alongside it (unchanged from the
 *    original migration backfill).
 *  - `--include-missing-v1` (embeddings migration M4, v1-retirement
 *    resilience, 2026-07-22): Google retired text-embedding-004 upstream —
 *    the v1 `embedContent` endpoint now 404s unconditionally. Before Step 0
 *    (`onEntryCreate` in functions/index.js) was fixed to generate v1 and v2
 *    INDEPENDENTLY, any entry created after the retirement but before that
 *    fix landed got written with NEITHER vector at all (the old code threw
 *    on the v1 failure before v2 was ever attempted). This mode targets
 *    exactly that gap: entries with text but NO v1 embedding AND no v2 get
 *    a V2-ONLY write. v1 is NEVER fabricated for these entries — it is
 *    permanently dead upstream — only `embeddingV2` + `embeddingMeta` are
 *    ever written, the identical payload shape default mode already writes.
 *    Uses a SEPARATE checkpoint doc (`migration_state/embeddingsV2gap`, vs.
 *    default mode's `migration_state/embeddingsV2`) so the two modes never
 *    fight over `lastPath`/counts — a paused/resumed default-mode run and a
 *    paused/resumed gap-mode run can be interleaved freely, and running one
 *    mode's `--dry-run` never perturbs the other mode's real checkpoint.
 *
 * It walks every user's entries via a collection-group query. Idempotent in
 * BOTH modes: entries that already have `embeddingV2` are always skipped,
 * so a re-run (in either mode) is always safe.
 *
 * Guarantees:
 *  - Per-user consent: skips any user whose settings/consent.aiProcessing is
 *    explicitly false (fail-open only for a MISSING doc, matching the callable
 *    consent gate).
 *  - Resumable: a checkpoint doc records the last processed entry path +
 *    running counts; a resumed run continues after it.
 *  - Rate-limited: 200ms pause between batches of 50.
 *
 * Usage (firebase-admin lives in functions/node_modules, so point NODE_PATH at
 * it — or run after `npm --prefix functions ci`):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json GEMINI_API_KEY=... \
 *   NODE_PATH=functions/node_modules \
 *     node scripts/backfill-embeddings-v2.js [--dry-run] [--restart] [--include-missing-v1]
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  service-account json (admin SDK auth)
 *   GEMINI_API_KEY                  Gemini API key for embedding generation
 *
 * Flags:
 *   --dry-run             report what WOULD be written; make no writes
 *   --restart              ignore any existing checkpoint (for the mode in
 *                           use) and start from the beginning
 *   --include-missing-v1   gap mode (M4) — see above. Uses the separate
 *                           `migration_state/embeddingsV2gap` checkpoint.
 */
import admin from 'firebase-admin';
import { getModelSync } from '../functions/src/models/registry.js';
import {
  generateEmbeddingV2,
  buildEmbeddingMeta,
  EMBEDDING_V2_TASK_TYPE,
} from '../functions/src/ai/embeddingV2.js';

export const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
export const DEFAULT_CHECKPOINT_PATH = 'migration_state/embeddingsV2';
export const GAP_CHECKPOINT_PATH = 'migration_state/embeddingsV2gap';
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 200;

const DRY_RUN = process.argv.includes('--dry-run');
const RESTART = process.argv.includes('--restart');
const INCLUDE_MISSING_V1 = process.argv.includes('--include-missing-v1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

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

export async function saveCheckpoint(db, checkpointPath, cp, done = false, dryRun = false) {
  if (dryRun) return;
  await db.doc(checkpointPath).set(
    { ...cp, done, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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

async function main() {
  const apiKey = requireEnv('GEMINI_API_KEY');
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');

  admin.initializeApp();
  const db = admin.firestore();
  const v2Model = getModelSync('embeddingV2');
  const checkpointPath = resolveCheckpointPath(INCLUDE_MISSING_V1);

  const cp = await loadCheckpoint(db, checkpointPath, RESTART);
  console.log(
    `[backfill-v2] mode=${INCLUDE_MISSING_V1 ? 'gap(--include-missing-v1)' : 'default'} ` +
    `checkpoint=${checkpointPath} model=${v2Model} dryRun=${DRY_RUN} restart=${RESTART} ` +
    `resumeAfter=${cp.lastPath || '(start)'}`
  );

  const baseQuery = db
    .collectionGroup('entries')
    .orderBy(admin.firestore.FieldPath.documentId());

  let cursor = null;
  if (cp.lastPath) {
    try {
      cursor = await db.doc(cp.lastPath).get();
    } catch {
      cursor = null;
    }
  }

  for (;;) {
    let q = baseQuery.limit(BATCH_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      cursor = doc;
      await processEntryDoc(doc, cp, {
        db,
        apiKey,
        v2Model,
        dryRun: DRY_RUN,
        includeMissingV1: INCLUDE_MISSING_V1,
      });
    }

    cp.lastPath = cursor.ref.path;
    await saveCheckpoint(db, checkpointPath, cp, false, DRY_RUN);
    console.log(
      `[backfill-v2] processed=${cp.processed} updated=${cp.updated} skipped=${cp.skipped} ` +
      `last=${cp.lastPath}`
    );
    await sleep(BATCH_SLEEP_MS);
  }

  await saveCheckpoint(db, checkpointPath, cp, true, DRY_RUN);
  console.log(
    `[backfill-v2] DONE processed=${cp.processed} updated=${cp.updated} skipped=${cp.skipped}` +
    (DRY_RUN ? ' (dry-run, no writes)' : '')
  );
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((e) => {
    console.error('[backfill-v2] fatal:', e);
    process.exit(1);
  });
}
