/**
 * Backfill gemini-embedding-2 (v2) vectors onto existing journal entries.
 *
 * Admin-SDK maintenance script — run MANUALLY, never wired to CI. It walks every
 * user's entries via a collection-group query and, for each entry that already
 * has a legacy v1 `embedding` but no `embeddingV2`, generates the v2 vector and
 * writes `embeddingV2` + `embeddingMeta` alongside the v1 field (same-space by
 * field name). Idempotent: entries that already have `embeddingV2` are skipped,
 * so a re-run is always safe.
 *
 * Guarantees:
 *  - Per-user consent: skips any user whose settings/consent.aiProcessing is
 *    explicitly false (fail-open only for a MISSING doc, matching the callable
 *    consent gate).
 *  - Resumable: a checkpoint doc (migration_state/embeddingsV2) records the last
 *    processed entry path + running counts; a resumed run continues after it.
 *  - Rate-limited: 200ms pause between batches of 50.
 *
 * Usage (firebase-admin lives in functions/node_modules, so point NODE_PATH at
 * it — or run after `npm --prefix functions ci`):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/sa.json GEMINI_API_KEY=... \
 *   NODE_PATH=functions/node_modules \
 *     node scripts/backfill-embeddings-v2.js [--dry-run] [--restart]
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  service-account json (admin SDK auth)
 *   GEMINI_API_KEY                  Gemini API key for embedding generation
 *
 * Flags:
 *   --dry-run   report what WOULD be written; make no writes
 *   --restart   ignore any existing checkpoint and start from the beginning
 */
import admin from 'firebase-admin';
import { getModelSync } from '../functions/src/models/registry.js';
import {
  generateEmbeddingV2,
  buildEmbeddingMeta,
  EMBEDDING_V2_TASK_TYPE,
} from '../functions/src/ai/embeddingV2.js';

const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
const CHECKPOINT_PATH = 'migration_state/embeddingsV2';
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 200;

const DRY_RUN = process.argv.includes('--dry-run');
const RESTART = process.argv.includes('--restart');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function loadCheckpoint(db) {
  if (RESTART) return { lastPath: null, processed: 0, updated: 0, skipped: 0 };
  const snap = await db.doc(CHECKPOINT_PATH).get();
  if (!snap.exists) return { lastPath: null, processed: 0, updated: 0, skipped: 0 };
  const d = snap.data() || {};
  return {
    lastPath: d.lastPath || null,
    processed: d.processed || 0,
    updated: d.updated || 0,
    skipped: d.skipped || 0,
  };
}

async function saveCheckpoint(db, cp, done = false) {
  if (DRY_RUN) return;
  await db.doc(CHECKPOINT_PATH).set(
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

async function main() {
  const apiKey = requireEnv('GEMINI_API_KEY');
  requireEnv('GOOGLE_APPLICATION_CREDENTIALS');

  admin.initializeApp();
  const db = admin.firestore();
  const v2Model = getModelSync('embeddingV2');

  const cp = await loadCheckpoint(db);
  console.log(
    `[backfill-v2] model=${v2Model} dryRun=${DRY_RUN} restart=${RESTART} ` +
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
      cp.processed += 1;
      cursor = doc;
      const data = doc.data() || {};

      // Only entries that were embedded (v1) but not yet dual-indexed.
      if (!Array.isArray(data.embedding)) { cp.skipped += 1; continue; }
      if (Array.isArray(data.embeddingV2)) { cp.skipped += 1; continue; }
      if (typeof data.text !== 'string' || !data.text.trim()) { cp.skipped += 1; continue; }

      const uid = uidFromEntryRef(doc.ref);
      if (!uid || !(await userAllowsAi(db, uid))) { cp.skipped += 1; continue; }

      if (DRY_RUN) { cp.updated += 1; continue; }

      const v2 = await generateEmbeddingV2(data.text, apiKey, {
        model: v2Model,
        taskType: EMBEDDING_V2_TASK_TYPE,
      });
      if (!v2) { cp.skipped += 1; continue; }

      const embeddingMeta = buildEmbeddingMeta({
        model: v2Model,
        dim: v2.dim,
        taskType: EMBEDDING_V2_TASK_TYPE,
      });
      await doc.ref.update({ embeddingV2: v2.embedding, embeddingMeta });
      cp.updated += 1;
    }

    cp.lastPath = cursor.ref.path;
    await saveCheckpoint(db, cp, false);
    console.log(
      `[backfill-v2] processed=${cp.processed} updated=${cp.updated} skipped=${cp.skipped} ` +
      `last=${cp.lastPath}`
    );
    await sleep(BATCH_SLEEP_MS);
  }

  await saveCheckpoint(db, cp, true);
  console.log(
    `[backfill-v2] DONE processed=${cp.processed} updated=${cp.updated} skipped=${cp.skipped}` +
    (DRY_RUN ? ' (dry-run, no writes)' : '')
  );
}

main().catch((e) => {
  console.error('[backfill-v2] fatal:', e);
  process.exit(1);
});
