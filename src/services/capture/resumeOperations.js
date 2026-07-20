/**
 * resumeIncompleteOperations — launch-time recovery for voice captures that
 * were interrupted (app killed, crash, power loss) mid-pipeline.
 *
 * The operationStore is the durable source of truth: each incomplete op tells
 * us how far a capture got. On launch we finish each one idempotently:
 *
 *   in-flight (local_ready / uploading / transcribing), attempts < 5:
 *     - no vault audio        -> needs_attention('audio-missing')
 *     - an entry already      -> duplicate-delivery guard: link + complete
 *       exists for this op       (NEVER transcribe a second time)
 *     - otherwise             -> re-run via handleAudioRetry(recordingId, opId)
 *     - attempts >= 5         -> left as-is (surfaced, no auto-retry)
 *
 *   past-the-write (entry_saved / enriching):
 *     - entry exists          -> complete (enrichment self-heals)
 *     - entry vanished        -> needs_attention('entry-missing')
 *
 *   needs_attention: left untouched (it's already surfaced to the user).
 *
 * The idempotency key is the entry's `operationId` field (written by
 * buildCoreEntry): querying `where('operationId','==',opId)` tells us whether
 * a prior run already delivered the entry, so a duplicate launch resume can
 * never create a second entry for the same recording.
 *
 * Firestore / store / vault are injectable so this is fully unit-testable; the
 * defaults wire up the real services.
 */
// Import firestore primitives directly (not via config/firebase) so this
// module stays free of Firebase app-init side effects — same pattern as
// buildCoreEntry. The `db` handle is always passed in by the caller.
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../config/constants';
import { audioVault as defaultVault } from '../audio/audioVault';
import defaultStore from './operationStore';

const IN_FLIGHT_STAGES = ['local_ready', 'uploading', 'transcribing'];
const POST_WRITE_STAGES = ['entry_saved', 'enriching'];
const MAX_ATTEMPTS = 5;

/**
 * Default idempotency probe: does an entry already exist for this op?
 * Returns the entry id or null.
 */
async function defaultFindEntryByOperationId(db, ownerUid, opId) {
  const entriesCol = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', ownerUid, 'entries');
  const snap = await getDocs(query(entriesCol, where('operationId', '==', opId), limit(1)));
  return snap.empty ? null : snap.docs[0].id;
}

export async function resumeIncompleteOperations({
  ownerUid,
  db,
  handleAudioRetry,
  store = defaultStore,
  vault = defaultVault,
  findEntryByOperationId = defaultFindEntryByOperationId,
}) {
  if (!ownerUid) return { resumed: 0, completed: 0, needsAttention: 0 };

  const summary = { resumed: 0, completed: 0, needsAttention: 0 };
  let incomplete = [];
  try {
    incomplete = await store.listIncomplete(ownerUid);
  } catch (error) {
    console.warn('[Capture] resume: could not list incomplete ops:', error?.message);
    return summary;
  }

  for (const op of incomplete) {
    // One op failing (transient Firestore error, etc.) must never abort the
    // recovery of the others.
    try {
      const { opId, stage, recordingId, attempts = 0 } = op;

      if (IN_FLIGHT_STAGES.includes(stage)) {
        // Attempt cap: an op stuck in-flight by an app kill would otherwise be
        // auto-retried every launch forever (a poison recording = launch
        // crash-loop). Once attempts reaches the cap, stop retrying and surface
        // it for manual attention instead.
        if (attempts >= MAX_ATTEMPTS) {
          await store.markNeedsAttention(ownerUid, opId, 'retry-exhausted');
          summary.needsAttention += 1;
          continue;
        }

        const recording = recordingId ? await vault.getRecording(ownerUid, recordingId) : null;
        if (!recording) {
          await store.markNeedsAttention(ownerUid, opId, 'audio-missing');
          summary.needsAttention += 1;
          continue;
        }

        // Duplicate-delivery guard: if a prior run already saved the entry,
        // link + complete instead of transcribing again.
        const existingEntryId = await findEntryByOperationId(db, ownerUid, opId);
        if (existingEntryId) {
          await store.advance(ownerUid, opId, 'entry_saved', { entryId: existingEntryId });
          await store.completeOperation(ownerUid, opId);
          summary.completed += 1;
          continue;
        }

        // Count this resume attempt BEFORE dispatching, so a retry that never
        // returns (app killed again mid-retry) still advances toward the cap.
        await store.recordAttempt(ownerUid, opId);
        await handleAudioRetry(recordingId, opId);
        summary.resumed += 1;
        continue;
      }

      if (POST_WRITE_STAGES.includes(stage)) {
        // Verify the entry actually exists (don't just trust the stored
        // entryId) — enrichment self-heals server/client-side afterward.
        const existingEntryId = await findEntryByOperationId(db, ownerUid, opId);
        if (existingEntryId) {
          await store.completeOperation(ownerUid, opId);
          summary.completed += 1;
        } else {
          await store.markNeedsAttention(ownerUid, opId, 'entry-missing');
          summary.needsAttention += 1;
        }
        continue;
      }

      // needs_attention (or any unknown stage): leave it surfaced, no auto-retry.
    } catch (error) {
      console.warn('[Capture] resume: op recovery failed, continuing:', op?.opId, error?.message);
    }
  }

  return summary;
}

export default resumeIncompleteOperations;
