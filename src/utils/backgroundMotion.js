/**
 * Background Motion Preference Utility
 * Gates the Cloud linen-wave ambient animation (LinenWaveBackground, spec §6.1).
 * Mirrors the accent.js / darkMode.js convention: plain localStorage-backed
 * get/set, no framework dependency, safe to call outside React.
 *
 * Storage key: 'engram-background-motion'
 * Values: 'true' | 'false' (default: true / enabled — waves render unless
 * the user has explicitly opted out, subject to prefers-reduced-motion
 * which is enforced separately at the CSS layer in cloud-motion.css).
 */

const STORAGE_KEY = 'engram-background-motion';
const DEFAULT_ENABLED = true;

function getStoredPreference() {
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Read the persisted preference (or the default if unset/invalid).
 */
export function getBackgroundMotion() {
  const stored = getStoredPreference();
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return DEFAULT_ENABLED;
}

/**
 * Persist a new preference. Returns the boolean that was stored.
 */
export function setBackgroundMotion(enabled) {
  const value = Boolean(enabled);
  localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  return value;
}
