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
// All pure/injectable helpers live in the admin-free lib so the unit test
// can import them without resolving firebase-admin (CI installs no
// scripts/ deps — see the lib's header comment). Re-exported here so this
// script's public surface is unchanged.
export * from './backfill-embeddings-v2.lib.mjs';
import {
  APP_COLLECTION_ID,
  resolveCheckpointPath,
  loadCheckpoint,
  saveCheckpoint,
  processEntryDoc,
} from './backfill-embeddings-v2.lib.mjs';

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

// Prod checkpoints keep the FieldValue sentinel via injection (lib default
// is an ISO string purely so the lib stays admin-free for tests).
const adminServerTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

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
    await saveCheckpoint(db, checkpointPath, cp, false, DRY_RUN, adminServerTimestamp);
    console.log(
      `[backfill-v2] processed=${cp.processed} updated=${cp.updated} skipped=${cp.skipped} ` +
      `last=${cp.lastPath}`
    );
    await sleep(BATCH_SLEEP_MS);
  }

  await saveCheckpoint(db, checkpointPath, cp, true, DRY_RUN, adminServerTimestamp);
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
