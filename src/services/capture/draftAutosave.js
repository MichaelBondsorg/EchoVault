/**
 * Owner-scoped localStorage draft autosave for typed entry text (EntryBar)
 * and quick-log notes (QuickLogModal). Deliberately plain localStorage, not
 * the audio vault/IndexedDB stores in this directory — drafts here are
 * small strings, not blobs, so there's no capacity concern.
 */
const keyFor = (prefix, uid) => `${prefix}::${uid}`;

export const restoreDraft = (prefix, uid) => {
  if (!uid) return '';
  try {
    return localStorage.getItem(keyFor(prefix, uid)) || '';
  } catch {
    return '';
  }
};

export const writeDraft = (prefix, uid, value) => {
  if (!uid) return;
  try {
    if (value) {
      localStorage.setItem(keyFor(prefix, uid), value);
    } else {
      localStorage.removeItem(keyFor(prefix, uid));
    }
  } catch {
    /* storage may be unavailable (private browsing, quota) — best-effort only */
  }
};

export const clearDraft = (prefix, uid) => {
  if (!uid) return;
  try {
    localStorage.removeItem(keyFor(prefix, uid));
  } catch {
    /* storage may be unavailable */
  }
};
