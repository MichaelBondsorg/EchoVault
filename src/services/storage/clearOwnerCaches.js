/**
 * Owner-scoped local cache clearing (plan task A4; extended by PRIV-01 —
 * docs/superpowers/plans/2026-07-24-full-product-review.md).
 *
 * Called at logout so a signed-out owner's cached health data can't be read
 * by the next person to use a shared device. Deliberately scoped to a
 * single uid: isolation between accounts already comes from key scoping
 * (see docs/adr/0001-owner-scoped-local-data.md), so clearing owner A's
 * caches must never touch owner B's — this is not a device-wide wipe.
 */
import { Preferences } from '@capacitor/preferences';
import { signOutRemovalKeysFor } from './storageRegistry';

// Legacy (pre owner-scoping) global WHOOP keys. Deleted unconditionally at
// logout too, so they never linger to be adopted by the next signed-in
// account.
const LEGACY_KEYS = ['whoop_cached_summary', 'whoop_link_status'];

const knownOwnerKeys = (uid) => [
  `whoop_cached_summary::${uid}`,
  `whoop_link_status::${uid}`,
];

const removeKey = async (key) => {
  try {
    await Preferences.remove({ key });
  } catch {
    // Best-effort — a failed removal here shouldn't block logout.
  }
};

const removeLocalStorageKey = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Best-effort — a failed removal here shouldn't block logout.
  }
};

const removeSessionStorageKey = (key) => {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Best-effort — a failed removal here shouldn't block logout.
  }
};

/**
 * Remove owner `uid`'s scoped Preferences caches, plus any legacy unowned
 * global caches. No-ops (clears nothing) if `uid` is falsy, rather than
 * ever falling back to a blanket wipe.
 *
 * PRIV-01: also removes every key `src/services/storage/storageRegistry.js`
 * declares with `signOutBehavior: 'remove'` for this owner — the registry,
 * not a second hand-maintained list, is the source of truth for what
 * logout deletes. Preferences-backed registry entries are also covered by
 * the generic `::uid` suffix sweep below (belt-and-suspenders); this loop
 * is what actually reaches localStorage/sessionStorage-backed registry
 * entries, since the generic sweep only walks Preferences.keys().
 * Registry entries with `signOutBehavior: 'retain'` (e.g. dismissed-prompt
 * state) are deliberately NOT touched — isolation for those comes from key
 * scoping alone, matching the ADR's reasoning for drafts/consent/audio
 * vault.
 */
export const clearOwnerCaches = async (uid) => {
  if (!uid) return;

  for (const key of knownOwnerKeys(uid)) {
    await removeKey(key);
  }

  // Sweep any other Preferences key carrying this owner's suffix, so future
  // owner-scoped caches are covered without needing to update this list.
  try {
    const { keys } = await Preferences.keys();
    const suffix = `::${uid}`;
    const discovered = (keys || []).filter((key) => key.endsWith(suffix));
    for (const key of discovered) {
      await removeKey(key);
    }
  } catch {
    // Preferences.keys() unavailable — the known keys above are still cleared.
  }

  for (const key of LEGACY_KEYS) {
    await removeKey(key);
  }

  for (const { backend, key } of signOutRemovalKeysFor(uid)) {
    if (backend === 'preferences') {
      await removeKey(key);
    } else if (backend === 'localStorage') {
      removeLocalStorageKey(key);
    } else if (backend === 'sessionStorage+localStorage') {
      removeSessionStorageKey(key);
      removeLocalStorageKey(key);
    }
  }
};

export default clearOwnerCaches;
