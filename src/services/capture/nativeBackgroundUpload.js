/**
 * nativeBackgroundUpload — CAP-01 client seam: enqueue a stopped native
 * recording for background upload, and reconcile pending uploads on next
 * launch.
 *
 * Ships DARK behind the `nativeBackgroundUpload` flag (default OFF, see
 * src/config/flags.js) — real-device verification is pending Michael's
 * physical-device pass (docs/quality/device-validation-matrix.md rows
 * 11-14). Every exported function checks the flag FIRST and returns/no-ops
 * immediately when it's off, so this module makes ZERO plugin/network calls
 * in production today. The live default capture path
 * (base64-through-WebView, EntryBar.jsx's `stopRecording`) is completely
 * untouched when the flag is off.
 *
 * The loop, once the flag is ever flipped on:
 *
 *   EntryBar.stopRecording (native branch, after the draft is finalized to
 *   disk by CaptureCoordinator.stop) -> enqueueNativeBackgroundUpload
 *     -> issueCaptureUploadTicketFn          (signed V4 PUT URL; owner path +
 *        content-type + size + 15-min expiry all server-enforced — see
 *        functions/src/capture/uploadTicket.js)
 *     -> NativeCapture.enqueueUpload         (BackgroundUploader.swift's
 *        URLSession(configuration: .background(...)) — survives suspend/
 *        termination)
 *     -> backgroundUploadStore.recordQueued  (durable local breadcrumb, so a
 *        killed app can reconcile on relaunch instead of losing track)
 *
 *   BackgroundUploader (native, possibly while suspended/terminated) PUTs the
 *   file -> Cloud Storage finalize -> onCaptureAudioUploaded (server) runs
 *   the SAME fused transcription pipeline transcribeEntry uses and writes
 *   the journal entry directly — the client is not involved in entry
 *   creation at all for this path.
 *
 *   captureUploadComplete / captureUploadFailed events (delivered whenever
 *   the app is next foregrounded, per Capacitor's plugin-event delivery) ->
 *   attachNativeBackgroundUploadListeners' handlers -> resolve or leave the
 *   breadcrumb + native draft for reconcile.
 *
 *   App launch -> reconcileNativeBackgroundUploads: for every breadcrumb
 *   that never got a live event (app was killed before the event delivered),
 *   probe Firestore for an entry with that operationId (the same
 *   duplicate-delivery probe resumeOperations.js uses) and clean up.
 *
 * Owner isolation: listeners are re-attached (never left pointing at a
 * stale owner) whenever the signed-in uid changes — see
 * attachNativeBackgroundUploadListeners — and every store read/write is
 * owner-scoped (backgroundUploadStore.js).
 *
 * Content-free logging throughout: draftId / operationId / httpStatus /
 * errorCode / byte counts only — never transcript text or audio content.
 */
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { getFlag } from '../../config/flags';
import { issueCaptureUploadTicketFn, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { NativeCapture } from './nativeCaptureAdapter';
import backgroundUploadStore from './backgroundUploadStore';

const FLAG = 'nativeBackgroundUpload';

/** Default idempotency probe: does an entry already exist for this op? Mirrors resumeOperations.js. */
async function defaultFindEntryByOperationId(ownerUid, operationId) {
  const entriesCol = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', ownerUid, 'entries');
  const snap = await getDocs(query(entriesCol, where('operationId', '==', operationId), limit(1)));
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Enqueue a just-finalized native draft for background upload. Returns
 * `true` if the upload was successfully handed to the native plugin (the
 * caller should NOT fall back to the foreground base64 path), `false`
 * otherwise (flag off, missing args, or any failure — the caller should
 * fall back to the existing foreground path so a capture is never lost).
 *
 * @param {object} args
 * @param {string} args.ownerUid
 * @param {string} args.draftId       Native CaptureDraft id (file already finalized to disk).
 * @param {string} args.mimeType      Must be one of ALLOWED_UPLOAD_MIME_TYPES server-side.
 * @param {string} [args.capturedAt]  ISO-8601 capture instant (optional provenance).
 * @param {string} [args.captureTimezone]
 * @param {string} [args.spaceId]     Context Space (flag: contextSpaces), if one is active.
 * @param {Function} [args.issueTicket]  Injectable for tests; defaults to issueCaptureUploadTicketFn.
 */
export async function enqueueNativeBackgroundUpload({
  ownerUid,
  draftId,
  mimeType,
  capturedAt,
  captureTimezone,
  spaceId,
  issueTicket = issueCaptureUploadTicketFn,
}) {
  if (!getFlag(FLAG)) return false;
  if (!ownerUid || !draftId || !mimeType) return false;

  try {
    const operationId = crypto.randomUUID();
    const ticket = await issueTicket({
      operationId,
      mimeType,
      ...(capturedAt ? { capturedAt } : {}),
      ...(captureTimezone ? { captureTimezone } : {}),
      ...(spaceId ? { spaceId } : {}),
    });
    const { uploadUrl, requiredHeaders } = ticket?.data || {};
    if (!uploadUrl) return false;

    // Content-Type travels via the dedicated `contentType` field (Swift sets
    // it explicitly); stripping it from `headers` just avoids a redundant
    // duplicate key — BackgroundUploader.swift's own comment notes either
    // one wins harmlessly, this is purely for a cleaner request.
    const headers = { ...(requiredHeaders || {}) };
    delete headers['Content-Type'];

    await NativeCapture.enqueueUpload({
      ownerUid, draftId, signedUrl: uploadUrl, contentType: mimeType, headers,
    });

    backgroundUploadStore.recordQueued(ownerUid, { operationId, draftId });
    console.log('[Capture] background upload enqueued', { draftId, operationId });
    return true;
  } catch (error) {
    console.warn('[Capture] background upload enqueue failed, caller should fall back:', error?.message);
    return false;
  }
}

// Currently-attached listener handles + the owner they belong to, so a
// second attach() call for a DIFFERENT owner tears down the first owner's
// handlers before registering new ones (Trust Sprint owner-isolation
// invariant: an account switch must never let a stale handler touch the new
// owner's local capture_bg_uploads store).
let activeHandles = [];
let activeOwnerUid = null;

async function resolveQueuedUpload(ownerUid, draftId) {
  backgroundUploadStore.clearByDraftId(ownerUid, draftId);
  // Server already deleted the uploaded object and created the entry
  // (onCaptureAudioUploaded) — the local native draft is now redundant.
  // Best-effort: a deletion failure just leaves a 'stored' draft that the
  // next recoverNativeDrafts pass would otherwise re-adopt into the
  // (foreground, base64) vault — reconcileNativeBackgroundUploads below
  // guards that case too via the same operationId probe.
  await NativeCapture.deleteDraft({ ownerUid, draftId }).catch(() => {});
}

/**
 * Attach (or re-attach, on an owner change) the captureUploadComplete/Failed
 * listeners for `ownerUid`. Safe to call repeatedly with the same uid
 * (no-ops after the first). No-ops entirely when the flag is off.
 */
export async function attachNativeBackgroundUploadListeners(ownerUid) {
  if (activeOwnerUid !== ownerUid) {
    await detachNativeBackgroundUploadListeners();
  }
  if (!getFlag(FLAG) || !ownerUid || activeOwnerUid === ownerUid) return;
  activeOwnerUid = ownerUid;

  const onComplete = await NativeCapture.addListener('captureUploadComplete', ({ draftId, httpStatus }) => {
    console.log('[Capture] background upload complete', { draftId, httpStatus });
    resolveQueuedUpload(ownerUid, draftId);
  });
  const onFailed = await NativeCapture.addListener('captureUploadFailed', ({ draftId, errorCode }) => {
    console.warn('[Capture] background upload failed', { draftId, errorCode });
    backgroundUploadStore.markFailedByDraftId(ownerUid, draftId, errorCode);
  });
  activeHandles = [onComplete, onFailed];
}

/** Tear down any currently-attached listeners. Safe to call when nothing is attached. */
export async function detachNativeBackgroundUploadListeners() {
  const handles = activeHandles;
  activeHandles = [];
  activeOwnerUid = null;
  for (const handle of handles) {
    // Promise.resolve(...) tolerates a `remove()` that returns undefined
    // synchronously (some plugin-mock/test doubles) as well as the real
    // Capacitor PluginListenerHandle contract (Promise<void>).
    await Promise.resolve(handle?.remove?.()).catch(() => {});
  }
}

/** Test-only: reset module-level listener-attachment tracking between tests. */
export function __resetListenerTrackingForTest() {
  activeHandles = [];
  activeOwnerUid = null;
}

/**
 * Launch-time reconciliation: for every locally-queued upload the app never
 * received a live event for (killed mid-upload, or before the event
 * delivered), check whether the server already created the entry and clean
 * up. No-ops entirely when the flag is off.
 */
export async function reconcileNativeBackgroundUploads({
  ownerUid,
  findEntryByOperationId = defaultFindEntryByOperationId,
} = {}) {
  if (!getFlag(FLAG) || !ownerUid) return { resolved: 0, pending: 0 };

  const pending = backgroundUploadStore.listPending(ownerUid);
  let resolved = 0;
  for (const record of pending) {
    try {
      const entryId = await findEntryByOperationId(ownerUid, record.operationId);
      if (entryId) {
        await resolveQueuedUpload(ownerUid, record.draftId);
        resolved += 1;
      }
      // No entry yet: leave the breadcrumb + native draft in place. Either
      // the upload is still genuinely in flight (BackgroundUploader survives
      // app death), or it failed and the object was left for
      // captureUploadsRetention / a future manual retry — surfacing that
      // distinction to the user is left to the Capture Reliability Center
      // once this path is enabled for real (native drafts already surface
      // there via the existing 'stored'/'needsReview' machinery).
    } catch (error) {
      console.warn('[Capture] background-upload reconcile failed for one op, continuing:', error?.message);
    }
  }
  return { resolved, pending: pending.length - resolved };
}

export default {
  enqueueNativeBackgroundUpload,
  attachNativeBackgroundUploadListeners,
  detachNativeBackgroundUploadListeners,
  reconcileNativeBackgroundUploads,
};
