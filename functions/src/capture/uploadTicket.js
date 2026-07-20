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

// Strict ISO-8601 instant (with timezone offset or Z). Bounds what we sign into
// the object's custom metadata as capture provenance.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// Custom-metadata header names sent on the PUT. GCS stores each `x-goog-meta-X`
// header as custom metadata under the key `X` (prefix stripped, lowercased) —
// see onAudioUploaded.js, which reads `captured-at` / `capture-timezone`.
const CAPTURED_AT_HEADER = 'x-goog-meta-captured-at';
const CAPTURE_TZ_HEADER = 'x-goog-meta-capture-timezone';

/** Validate an IANA timezone id via Intl (throws RangeError for unknown ids). */
function isValidTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

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
 * Optional capture provenance ({capturedAt, captureTimezone}) is signed into the
 * URL as `x-goog-meta-*` extension headers when provided, so the finalize trigger
 * can recover the moment of capture. Because they are part of the V4 signature,
 * the client MUST send back exactly the headers named in the returned
 * `requiredHeaders` map — sending fewer/other/different values fails with
 * SignatureDoesNotMatch.
 *
 * @param {object} args
 * @param {string} args.uid              Authenticated user id (from request.auth.uid).
 * @param {string} args.operationId      Client capture op id — MUST be a UUID.
 * @param {string} args.mimeType         Requested audio MIME type — MUST be allowed.
 * @param {string} [args.capturedAt]     Capture instant, strict ISO-8601 with offset/Z.
 * @param {string} [args.captureTimezone] IANA timezone id (validated via Intl).
 * @param {object} deps
 * @param {object} deps.storage          admin Storage instance (getStorage()).
 * @param {Function} [deps.now]          Clock injection for tests; defaults to Date.now.
 * @returns {Promise<{uploadUrl:string, objectPath:string, expiresAt:string, requiredHeaders:object}>}
 * @throws {HttpsError} invalid-argument on bad operationId / mimeType / provenance.
 */
export async function issueCaptureUploadTicketCore(
  { uid, operationId, mimeType, capturedAt, captureTimezone },
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

  // Optional provenance — validated strictly, then bound into the signature.
  // `requiredHeaders` echoes every header the client MUST send on the PUT.
  const extensionHeaders = {};
  const requiredHeaders = { 'Content-Type': mimeType };
  if (capturedAt !== undefined && capturedAt !== null) {
    if (typeof capturedAt !== 'string' || !ISO_8601_RE.test(capturedAt)) {
      throw new HttpsError('invalid-argument', 'capturedAt must be an ISO-8601 instant');
    }
    extensionHeaders[CAPTURED_AT_HEADER] = capturedAt;
    requiredHeaders[CAPTURED_AT_HEADER] = capturedAt;
  }
  if (captureTimezone !== undefined && captureTimezone !== null) {
    if (!isValidTimezone(captureTimezone)) {
      throw new HttpsError('invalid-argument', 'captureTimezone must be a valid IANA timezone');
    }
    extensionHeaders[CAPTURE_TZ_HEADER] = captureTimezone;
    requiredHeaders[CAPTURE_TZ_HEADER] = captureTimezone;
  }

  const objectPath = captureObjectPath(uid, operationId);
  const expiresAtMs = now() + UPLOAD_TICKET_TTL_MS;

  // V4 write URL bound to contentType (+ any provenance extension headers): the
  // PUT must send exactly these headers or Cloud Storage rejects the signature.
  const signOptions = {
    version: 'v4',
    action: 'write',
    expires: expiresAtMs,
    contentType: mimeType,
  };
  if (Object.keys(extensionHeaders).length > 0) {
    signOptions.extensionHeaders = extensionHeaders;
  }

  const [uploadUrl] = await storage.bucket().file(objectPath).getSignedUrl(signOptions);

  return {
    uploadUrl,
    objectPath,
    expiresAt: new Date(expiresAtMs).toISOString(),
    requiredHeaders,
  };
}

export default { issueCaptureUploadTicketCore, captureObjectPath, ALLOWED_UPLOAD_MIME_TYPES, CAPTURE_UPLOAD_PREFIX, UPLOAD_TICKET_TTL_MS };
