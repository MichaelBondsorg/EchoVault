/**
 * backgroundUploadStore — owner-scoped, localStorage-backed breadcrumbs for
 * voice captures enqueued via the native background-upload path (CAP-01,
 * flag: `nativeBackgroundUpload`, default OFF — ships DARK this sprint; see
 * docs/quality/device-validation-matrix.md rows 11-14).
 *
 * Mirrors `pendingReviewDrafts.ts`'s storage shape (a single JSON array under
 * an owner-scoped key), NOT `operationStore.ts`'s Preferences-backed
 * CaptureOp/CaptureStage machinery: the background-upload path's audio never
 * enters the local audio vault (there is no `recordingId`), so it does not
 * fit `operationStore`'s stage vocabulary or `resumeIncompleteOperations`'
 * vault-lookup assumptions — folding it in there would make a background op
 * look like "audio-missing" to that unrelated recovery path. This store
 * exists purely so `reconcileNativeBackgroundUploads`
 * (see `nativeBackgroundUpload.js`) and the upload-event listeners have a
 * durable local breadcrumb to resolve against.
 *
 * Owner isolation: every read/write is keyed by `capture_bg_uploads::{uid}` —
 * an account switch reads a different key entirely, so a prior owner's
 * pending-upload breadcrumbs can never surface for the next signed-in owner.
 *
 * Content-free by construction: records store only operationId/draftId/
 * status/error-class/timestamps — never transcript text or audio content.
 */
const keyFor = (ownerUid) => `capture_bg_uploads::${ownerUid}`;

function readAll(ownerUid) {
  try {
    const raw = localStorage.getItem(keyFor(ownerUid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(ownerUid, records) {
  try {
    if (records.length) {
      localStorage.setItem(keyFor(ownerUid), JSON.stringify(records));
    } else {
      localStorage.removeItem(keyFor(ownerUid));
    }
  } catch {
    // Best-effort — a persistence failure must never break capture. Worst
    // case: reconcile-on-launch has nothing to check, which is exactly the
    // pre-CAP-01 (flag-off) behavior.
  }
}

/** Record a newly-enqueued background upload. Replaces any stale record for the same operationId. */
export function recordQueued(ownerUid, { operationId, draftId }) {
  if (!ownerUid || !operationId || !draftId) return;
  const records = readAll(ownerUid).filter((r) => r.operationId !== operationId);
  records.push({ operationId, draftId, status: 'queued', queuedAt: Date.now(), updatedAt: Date.now() });
  writeAll(ownerUid, records);
}

/** Drop the breadcrumb entirely — the upload is fully resolved (complete, or confirmed duplicate/expired). */
export function clearByOperationId(ownerUid, operationId) {
  if (!ownerUid || !operationId) return;
  writeAll(ownerUid, readAll(ownerUid).filter((r) => r.operationId !== operationId));
}

/** Drop the breadcrumb for a draftId (used by the captureUploadComplete listener, which only knows draftId). */
export function clearByDraftId(ownerUid, draftId) {
  if (!ownerUid || !draftId) return;
  writeAll(ownerUid, readAll(ownerUid).filter((r) => r.draftId !== draftId));
}

/** Mark a record failed (errorCode only — content-free) by draftId. Leaves it for reconcile/manual retry. */
export function markFailedByDraftId(ownerUid, draftId, errorCode) {
  if (!ownerUid || !draftId) return;
  const records = readAll(ownerUid);
  const record = records.find((r) => r.draftId === draftId);
  if (!record) return;
  record.status = 'failed';
  record.errorCode = errorCode;
  record.updatedAt = Date.now();
  writeAll(ownerUid, records);
}

export function findByDraftId(ownerUid, draftId) {
  if (!ownerUid || !draftId) return null;
  return readAll(ownerUid).find((r) => r.draftId === draftId) || null;
}

export function listPending(ownerUid) {
  if (!ownerUid) return [];
  return readAll(ownerUid);
}

export default {
  recordQueued,
  clearByOperationId,
  clearByDraftId,
  markFailedByDraftId,
  findByDraftId,
  listPending,
};
