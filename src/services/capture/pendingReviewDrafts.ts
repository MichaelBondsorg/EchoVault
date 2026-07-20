/**
 * Owner-scoped localStorage tracking for native drafts that have been
 * flagged `needsReview` by nativeCaptureAdapter's stale-`recording`
 * conversion (see recoverNativeDrafts / isStaleRecordingDraft).
 *
 * Without this, a converted draft would be picked back up and silently
 * auto-adopted into the vault by the pre-existing
 * stored/needsReview/interrupted auto-adopt branch on the NEXT recovery
 * pass (e.g. next app launch) — defeating the whole point of surfacing it
 * for an explicit human Transcribe/Discard decision in
 * CaptureReliabilityCenter. A draftId stays "pending review" until the user
 * acts on it (Transcribe or Discard), at which point the caller clears it.
 */
const keyFor = (ownerUid: string): string => `pending_review_drafts::${ownerUid}`;

const readSet = (ownerUid: string): string[] => {
  try {
    const raw = localStorage.getItem(keyFor(ownerUid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeSet = (ownerUid: string, ids: string[]): void => {
  try {
    if (ids.length) {
      localStorage.setItem(keyFor(ownerUid), JSON.stringify(ids));
    } else {
      localStorage.removeItem(keyFor(ownerUid));
    }
  } catch {
    /* storage may be unavailable — best-effort only */
  }
};

export const markPendingReview = (ownerUid: string, draftId: string): void => {
  if (!ownerUid || !draftId) return;
  const ids = readSet(ownerUid);
  if (!ids.includes(draftId)) writeSet(ownerUid, [...ids, draftId]);
};

export const isPendingReview = (ownerUid: string, draftId: string): boolean => {
  if (!ownerUid || !draftId) return false;
  return readSet(ownerUid).includes(draftId);
};

export const clearPendingReview = (ownerUid: string, draftId: string): void => {
  if (!ownerUid || !draftId) return;
  const ids = readSet(ownerUid);
  if (!ids.includes(draftId)) return;
  writeSet(ownerUid, ids.filter((id) => id !== draftId));
};
