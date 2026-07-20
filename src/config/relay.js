/**
 * Voice relay endpoint resolution.
 *
 * Centralizes how the app decides where the voice relay server lives, so a
 * production bundle can never silently fall back to a developer's localhost
 * websocket. `getRelayWsUrl()`/`getRelayHttpUrl()` return `null` when the
 * relay is unusable in the current environment; callers must treat `null`
 * as "feature disabled" rather than attempting a connection.
 */

// Warn at most once per module instance — repeated calls (e.g. retries)
// shouldn't spam the console, and the message intentionally omits the
// invalid value so nothing sensitive ends up in logs.
let warnedMissingRelayUrl = false;

const isValidRelayWsUrl = (url) =>
  typeof url === 'string' && url.startsWith('wss://') && !url.includes('localhost');

/**
 * Resolve the voice relay websocket URL.
 *
 * - Any environment: a configured `VITE_VOICE_RELAY_URL` is used only if it
 *   is a `wss://` URL that does not reference localhost.
 * - Dev (`import.meta.env.DEV`): falls back to the local relay server when
 *   no valid URL is configured.
 * - Otherwise (prod/CI): returns `null` and warns once.
 */
export function getRelayWsUrl() {
  const configured = import.meta.env.VITE_VOICE_RELAY_URL;
  if (isValidRelayWsUrl(configured)) {
    return configured;
  }

  if (import.meta.env.DEV) {
    return 'ws://localhost:8080/voice';
  }

  if (!warnedMissingRelayUrl) {
    warnedMissingRelayUrl = true;
    console.warn('[relay] Voice relay is disabled: no valid production relay URL is configured.');
  }
  return null;
}

/**
 * Derive the relay's HTTP(S) base URL from its websocket URL.
 * Null-propagating: returns `null` whenever `getRelayWsUrl()` does.
 */
export function getRelayHttpUrl() {
  const wsUrl = getRelayWsUrl();
  if (!wsUrl) return null;

  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/voice(?:\?.*)?$/, '');
}
