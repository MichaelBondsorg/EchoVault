/**
 * prepareDurableRecording — the durable-commit decision at the front of the
 * voice pipeline, extracted from App.jsx#handleAudioWrapper.
 *
 * The durability invariant: at this destructive boundary, either the previous
 * durable copy (the native draft) or the next durable copy (the vault
 * recording) MUST exist. Concretely:
 *
 *   - Retry path (existingRecordingId): the recording is already vaulted;
 *     succeed immediately and never touch the native draft here.
 *   - Fresh save: write the recording to the audio vault FIRST. Only once the
 *     vault confirms do we delete the native draft — never before. If the
 *     vault write fails, we return `blocked` and leave the native draft in
 *     place; the caller MUST NOT proceed to transcription (transcription
 *     without a durable local copy risks losing the recording on any failure).
 *
 * Pure-ish: all side effects are injected (audioVault, deleteNativeDraft) so
 * this is exhaustively testable without Capacitor/Firestore.
 *
 * @param {Object} args
 * @param {string} args.ownerUid
 * @param {string} args.base64
 * @param {string} args.mimeType
 * @param {string} [args.existingRecordingId]  Retry of an already-vaulted recording.
 * @param {Object} args.audioVault             Must expose saveRecording(uid, base64, mime).
 * @param {string} [args.nativeDraftId]        Native draft to delete AFTER vault confirm (native only).
 * @param {(uid: string, draftId: string) => Promise<void>} [args.deleteNativeDraft]
 * @returns {Promise<{ ok: true, recordingId: string } | { ok: false, blocked: true, reason: string }>}
 */
export async function prepareDurableRecording({
  ownerUid,
  base64,
  mimeType,
  existingRecordingId,
  audioVault,
  nativeDraftId,
  deleteNativeDraft,
}) {
  // Retry path: the recording is already durable in the vault. Reuse its id;
  // the native draft (if any) was already handed off on the original attempt.
  if (existingRecordingId) {
    return { ok: true, recordingId: existingRecordingId };
  }

  // Durable local backup BEFORE any network call. saveRecording returns
  // { id } on success / { error } on failure and never throws; treat a null
  // (legacy shim) as an I/O failure too.
  const result = await audioVault.saveRecording(ownerUid, base64, mimeType);
  const recordingId = result?.id;
  if (!recordingId) {
    return { ok: false, blocked: true, reason: result?.error || 'io' };
  }

  // Vault confirmed — the recording is now durable. Only NOW is it safe to
  // delete the native draft (the previous durable copy). A deletion failure
  // is non-fatal: worst case the native recovery scan re-adopts an already
  // vaulted recording, which is idempotent.
  if (nativeDraftId && typeof deleteNativeDraft === 'function') {
    await deleteNativeDraft(ownerUid, nativeDraftId).catch(() => {});
  }

  return { ok: true, recordingId };
}

export default prepareDurableRecording;
