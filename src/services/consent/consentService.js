/**
 * Fail-closed client consent service.
 *
 * Replaces the previous best-effort `setDoc(settings/consent, ...)` calls in
 * App.jsx with a service that:
 *   1. Disables AI processing locally, synchronously, before any async work —
 *      so a revoke can never be lost even if the device is offline or the
 *      server call fails.
 *   2. Queues the server-authoritative callable (`revokeAiProcessing` /
 *      `grantAiProcessing`) in a retryable outbox (Capacitor Preferences) so
 *      it is guaranteed to eventually reach the server.
 *   3. Never re-enables AI processing locally on a failed/rejected callable —
 *      a revoke is a one-way local action; only a subsequent explicit grant
 *      can turn it back on.
 *
 * The outbox is owner-scoped and holds at most one pending op per uid — a
 * grant and a queued revoke for the same user can never both be outstanding
 * (last write wins), matching how a real user's intent works: whatever they
 * did most recently is the thing that should reach the server.
 */
import { Preferences } from '@capacitor/preferences';
import { revokeAiProcessingFn, grantAiProcessingFn } from '../../config/firebase';
import { ownerStorageKey } from '../storage/ownerScopedStorage';

// Kept in lockstep with the legacy version App.jsx has used since the
// first-run consent modal shipped. Not exported — this module owns writing
// these legacy keys so App.jsx no longer has to.
const AI_CONSENT_VERSION = '1';

const localMarkerKey = (uid) => `engram:aiConsent::${uid}`;
const outboxKey = (uid) => `consent_outbox::${uid}`;

/**
 * Synchronous, best-effort local marker write. Wrapped in try/catch because
 * localStorage can throw in private browsing / storage-restricted contexts —
 * that must never block the (more important) outbox enqueue that follows.
 */
const setLocalMarker = (uid, value) => {
  try {
    localStorage.setItem(localMarkerKey(uid), value);
  } catch {
    /* private mode / storage unavailable — nothing more we can do here */
  }
};

/**
 * Mirrors the legacy per-owner localStorage markers App.jsx has read/written
 * since the first-run consent modal shipped, so existing UI (e.g. the
 * first-run gate effect) keeps working unmodified.
 */
const setLegacyMarkers = (uid, granted) => {
  try {
    if (granted) {
      localStorage.setItem(ownerStorageKey(uid, 'consent/aiVersion'), AI_CONSENT_VERSION);
      localStorage.setItem(ownerStorageKey(uid, 'consent/aiAcceptedAt'), new Date().toISOString());
      localStorage.removeItem(ownerStorageKey(uid, 'consent/aiDeclinedVersion'));
    } else {
      localStorage.removeItem(ownerStorageKey(uid, 'consent/aiVersion'));
      localStorage.removeItem(ownerStorageKey(uid, 'consent/aiAcceptedAt'));
      localStorage.setItem(ownerStorageKey(uid, 'consent/aiDeclinedVersion'), AI_CONSENT_VERSION);
    }
  } catch {
    /* private mode / storage unavailable */
  }
};

/** Overwrite the owner's outbox slot with the newest op (last-wins). */
const enqueueOp = async (uid, type) => {
  const op = { type, uid, at: Date.now(), attempts: 0 };
  await Preferences.set({ key: outboxKey(uid), value: JSON.stringify(op) });
};

const readOp = async (uid) => {
  const { value } = await Preferences.get({ key: outboxKey(uid) });
  if (!value) return null;
  try {
    const op = JSON.parse(value);
    if (!op || (op.type !== 'revoke' && op.type !== 'grant')) return null;
    return op;
  } catch {
    return null;
  }
};

/**
 * Drain the outbox for `uid`: attempt the queued callable, remove the op on
 * success, or bump its attempt count and leave it queued on failure. Never
 * throws — callers (app launch, 'online', visibilitychange) fire-and-forget
 * this.
 */
export async function flushConsentOutbox(uid) {
  if (!uid) return;

  let op;
  try {
    op = await readOp(uid);
  } catch {
    return;
  }
  if (!op) return;

  const fn = op.type === 'revoke' ? revokeAiProcessingFn : grantAiProcessingFn;
  try {
    await fn();
    await Preferences.remove({ key: outboxKey(uid) });
  } catch (error) {
    const bumped = {
      ...op,
      attempts: (op.attempts || 0) + 1,
      lastError: error?.message,
      lastAttemptAt: Date.now(),
    };
    try {
      await Preferences.set({ key: outboxKey(uid), value: JSON.stringify(bumped) });
    } catch {
      /* best effort — the local disable already happened, that's what matters */
    }
  }
}

/**
 * Revoke AI-processing consent. Fail-closed: the local marker flips
 * synchronously before any async work, and a failed/rejected callable never
 * re-enables it. Returns void — never throws.
 */
export async function revokeAiConsent(uid) {
  if (!uid) return;

  // 1. Local disable first, synchronously, before any async work. This must
  //    survive app restart even if everything below fails.
  setLocalMarker(uid, 'revoked');
  setLegacyMarkers(uid, false);

  // 2 & 3. Queue the server call and try to flush it immediately. A failure
  //    here only affects the outbox — it can never re-enable local state.
  try {
    await enqueueOp(uid, 'revoke');
  } catch {
    return;
  }
  await flushConsentOutbox(uid);
}

/**
 * Grant AI-processing consent. Returns void — never throws.
 */
export async function grantAiConsent(uid) {
  if (!uid) return;

  setLocalMarker(uid, 'granted');
  setLegacyMarkers(uid, true);

  try {
    await enqueueOp(uid, 'grant');
  } catch {
    return;
  }
  await flushConsentOutbox(uid);
}

/**
 * Synchronous local read of whether AI processing is enabled on this device
 * for `uid`. Default (no marker written yet) is `true` — matches the legacy
 * behavior of the version-marker check this replaces.
 */
export function isAiLocallyEnabled(uid) {
  if (!uid) return true;
  try {
    const marker = localStorage.getItem(localMarkerKey(uid));
    if (marker === 'revoked') return false;
    return true;
  } catch {
    return true;
  }
}
