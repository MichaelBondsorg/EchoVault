/** Parse an engram:// capture deep link. Returns {mode} or null if not a capture link. */
export function parseCaptureLink(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'engram:' || url.host !== 'capture') return null;
    const mode = url.searchParams.get('mode');
    return { mode: mode === 'text' ? 'text' : 'voice' };
  } catch {
    return null;
  }
}

export const CAPTURE_REQUEST_MAX_AGE_MS = 60_000;

/** A capture request older than CAPTURE_REQUEST_MAX_AGE_MS must not auto-start the mic. */
export function isCaptureRequestStale(request, now = Date.now()) {
  return !request || typeof request.ts !== 'number' || now - request.ts > CAPTURE_REQUEST_MAX_AGE_MS;
}
