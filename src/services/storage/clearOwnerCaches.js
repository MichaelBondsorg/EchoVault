/**
 * Owner-scoped local cache clearing (plan task A4).
 *
 * Called at logout so a signed-out owner's cached health data can't be read
 * by the next person to use a shared device. Deliberately scoped to a
 * single uid: isolation between accounts already comes from key scoping
 * (see docs/adr/0001-owner-scoped-local-data.md), so clearing owner A's
 * caches must never touch owner B's — this is not a device-wide wipe.
 */
import { Preferences } from '@capacitor/preferences';

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

/**
 * Remove owner `uid`'s scoped Preferences caches, plus any legacy unowned
 * global caches. No-ops (clears nothing) if `uid` is falsy, rather than
 * ever falling back to a blanket wipe.
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
};

export default clearOwnerCaches;
