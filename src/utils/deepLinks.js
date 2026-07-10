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
