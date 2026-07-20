/**
 * Capture upload ticket — issues a short-lived V4 signed URL that lets the iOS
 * background URLSession PUT a captured .m4a straight to Cloud Storage, without
 * routing the audio bytes through the WebView bridge (base64) or a callable.
 *
 * SECURITY: ownership is derived from the object PATH (the `uid` segment the
 * SERVER writes into it here), never from client-supplied custom object
 * metadata — a client can set arbitrary metadata on its own upload, so the
 * onFinalized trigger trusts only the server-issued path. See
 * onAudioUploaded.js's parseCaptureObjectPath.
 */
import { HttpsError } from 'firebase-functions/v2/https';

// Container/codec MIME types iOS/web capture can produce. The stored object is
// always `.m4a`; the signed URL binds Content-Type to the requested mimeType so
// the client's PUT must match.
export const ALLOWED_UPLOAD_MIME_TYPES = ['audio/mp4', 'audio/m4a', 'audio/aac', 'audio/webm'];

// Signed URL lifetime. Short enough to bound abuse of a leaked URL, long enough
// for a background upload to start on a poor connection.
export const UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000;

// Path prefix under the default bucket for pending capture uploads. Kept here so
// the ticket issuer, the finalize trigger, and the retention sweeper agree.
export const CAPTURE_UPLOAD_PREFIX = 'capture-uploads';

// operationId must be a canonical UUID: it is interpolated into a storage path,
// so restricting it to hex+hyphens also forecloses path traversal ('..', '/').
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build the server-owned object path. uid comes from auth, opId is validated. */
export function captureObjectPath(uid, operationId) {
  return `${CAPTURE_UPLOAD_PREFIX}/${uid}/${operationId}.m4a`;
}

/**
 * Core logic for the issueCaptureUploadTicket callable, split out so it can be
 * unit-tested without importing the whole functions/index.js monolith. The
 * onCall wrapper in index.js supplies `uid` (from request.auth), runs the
 * consent gate, and passes real admin Storage.
 *
 * @param {object} args
 * @param {string} args.uid           Authenticated user id (from request.auth.uid).
 * @param {string} args.operationId   Client capture op id — MUST be a UUID.
 * @param {string} args.mimeType      Requested audio MIME type — MUST be allowed.
 * @param {object} deps
 * @param {object} deps.storage       admin Storage instance (getStorage()).
 * @param {Function} [deps.now]       Clock injection for tests; defaults to Date.now.
 * @returns {Promise<{uploadUrl:string, objectPath:string, expiresAt:string}>}
 * @throws {HttpsError} invalid-argument on bad operationId / mimeType.
 */
export async function issueCaptureUploadTicketCore(
  { uid, operationId, mimeType },
  { storage, now = () => Date.now() }
) {
  if (!uid || typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }
  if (typeof operationId !== 'string' || !UUID_RE.test(operationId)) {
    throw new HttpsError('invalid-argument', 'operationId must be a valid UUID');
  }
  if (typeof mimeType !== 'string' || !ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
    throw new HttpsError('invalid-argument', 'Unsupported audio mimeType');
  }

  const objectPath = captureObjectPath(uid, operationId);
  const expiresAtMs = now() + UPLOAD_TICKET_TTL_MS;

  // V4 write URL bound to contentType: the PUT must send a matching Content-Type
  // header or Cloud Storage rejects it.
  const [uploadUrl] = await storage.bucket().file(objectPath).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: expiresAtMs,
    contentType: mimeType,
  });

  return {
    uploadUrl,
    objectPath,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export default { issueCaptureUploadTicketCore, captureObjectPath, ALLOWED_UPLOAD_MIME_TYPES, CAPTURE_UPLOAD_PREFIX, UPLOAD_TICKET_TTL_MS };
