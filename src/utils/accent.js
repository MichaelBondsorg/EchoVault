/**
 * Accent Color Utility
 * Manages the Cloud accent theme: initialization, get, set.
 *
 * Storage keys:
 *  - Global: 'engram-accent' — always written on every setAccent() call.
 *    Stays authoritative for the pre-auth boot script (index.html), which
 *    reads this exact key synchronously before React/auth ever run, so it
 *    must always reflect the user's last choice regardless of sign-in
 *    state.
 *  - Owner-scoped (optional): ownerStorageKey(uid, 'appearance/accent') —
 *    written/read only when a uid is supplied. Lets a shared device keep a
 *    distinct accent per signed-in user while the global key still carries
 *    the "last used" value for the boot script and any signed-out state.
 *    When both are present, the owner-scoped value wins for that uid.
 *
 * This is the single implementation of accent persistence — SettingsPage
 * (previously had its own owner-scoped read/write, see cloud-redesign C6
 * task) now calls only these functions instead of touching localStorage
 * directly, so there is exactly one place that knows about both keys.
 *
 * Values: 'blue' | 'mauve' | 'terracotta' (default: 'blue')
 */
import { ownerStorageKey } from '../services/storage/ownerScopedStorage';

const STORAGE_KEY = 'engram-accent';
const OWNER_AREA = 'appearance/accent';
const VALID_ACCENTS = ['blue', 'mauve', 'terracotta'];
const DEFAULT_ACCENT = 'blue';

function applyAccent(name) {
  document.documentElement.dataset.accent = name;
}

// ownerStorageKey() throws when uid is missing/invalid (parseOwnerUid), so
// this resolves to null for any caller that doesn't have a signed-in user
// yet (e.g. the boot script equivalent path, or a logged-out Settings view)
// rather than propagating that as an error.
function resolveOwnerKey(uid) {
  if (!uid) return null;
  try {
    return ownerStorageKey(uid, OWNER_AREA);
  } catch {
    return null;
  }
}

function getStoredAccent(uid) {
  const ownerKey = resolveOwnerKey(uid);
  if (ownerKey) {
    const owned = localStorage.getItem(ownerKey);
    if (owned) return owned;
  }
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Read the persisted accent (owner-scoped first when `uid` is given, else
 * the global key) and apply it to `<html data-accent>`. Returns the
 * resolved (always-valid) accent name.
 */
export function initAccent(uid) {
  const stored = getStoredAccent(uid);
  const accent = VALID_ACCENTS.includes(stored) ? stored : DEFAULT_ACCENT;
  applyAccent(accent);
  return accent;
}

/**
 * Persist and apply a new accent. Always writes the global key (boot-script
 * authoritative); additionally writes the owner-scoped key when `uid` is
 * given. Returns the applied name, or null if `name` isn't valid (nothing
 * is written or applied in that case).
 */
export function setAccent(name, uid) {
  if (!VALID_ACCENTS.includes(name)) {
    return null;
  }
  localStorage.setItem(STORAGE_KEY, name);
  const ownerKey = resolveOwnerKey(uid);
  if (ownerKey) localStorage.setItem(ownerKey, name);
  applyAccent(name);
  return name;
}

export function getAccent() {
  return document.documentElement.dataset.accent || DEFAULT_ACCENT;
}
