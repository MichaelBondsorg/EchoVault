/**
 * Session Buffer Service
 *
 * Solves the "sync gap" problem: when a user journals and then immediately
 * opens chat, the Cloud Function hasn't yet extracted memories from that entry.
 *
 * The session buffer stores volatile context about the most recent entry in
 * sessionStorage (survives page refresh) or fast-expiring localStorage.
 *
 * This context is passed directly to the chat component as "volatile memory"
 * until the Cloud Function commits the permanent memory update.
 *
 * PRIV-01 (docs/superpowers/plans/2026-07-24-full-product-review.md,
 * src/services/storage/storageRegistry.js's 'memory.sessionBuffer' row):
 * this buffer carries raw entry text and analysis, so every function below
 * now REQUIRES an owner uid and reads/writes an owner-scoped key —
 * `ownerStorageKey(uid, 'session/buffer')` — instead of the old global
 * `engram_session_buffer` key. No production write call to the legacy key
 * was ever found (see git history / the plan's evidence), so there is
 * nothing to migrate forward: `quarantineLegacySessionBuffer` below simply
 * deletes it, unconditionally, once — it is never claimed by whichever
 * account happens to be signed in.
 */
import { ownerStorageKey } from '../storage/ownerScopedStorage';

const BUFFER_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes - enough for Cloud Function to process

// Legacy (pre owner-scoping) global key.
const LEGACY_SESSION_BUFFER_KEY = 'engram_session_buffer';

const sessionBufferKey = (uid) => ownerStorageKey(uid, 'session/buffer');

/**
 * Delete the legacy unowned global buffer key from both storages,
 * unconditionally. Safe to call repeatedly (idempotent) and safe to call
 * with no owner known yet — this is a quarantine, not a per-owner
 * operation. Called once at module load ("startup") and again from the
 * auth login handler ("login") per PRIV-01's required fix; either call
 * alone is sufficient, both together are cheap and idempotent.
 */
export const quarantineLegacySessionBuffer = () => {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(LEGACY_SESSION_BUFFER_KEY);
    }
  } catch {
    // Best-effort.
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LEGACY_SESSION_BUFFER_KEY);
    }
  } catch {
    // Best-effort.
  }
};

/**
 * One-time sweep of pre-migration unowned voice transcripts. Voice transcripts
 * used to be stored with a per-session key `voice_transcript_<sessionId>`
 * (unowned, one per session). This sweep removes those legacy orphaned keys,
 * never touching the new owner-scoped format `engram:v2:owner:...` that the
 * owned key invariant is enforced on.
 *
 * Idempotent: safe to call repeatedly on every app startup + login. Called
 * at module load and at login (same pattern as quarantineLegacySessionBuffer).
 */
export const sweepLegacyVoiceTranscripts = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('voice_transcript_')) {
          localStorage.removeItem(k);
        }
      }
    }
  } catch {
    // Best-effort.
  }
};

// "At startup": runs once, the first time this module is imported.
quarantineLegacySessionBuffer();
sweepLegacyVoiceTranscripts();

/**
 * Store a recent entry in the session buffer, scoped to the given owner.
 * Called immediately after saving an entry.
 *
 * @param {string} ownerUid - Required. The signed-in owner's uid.
 * @param {Object} entry - The entry that was just saved
 * @param {Object} analysis - The analysis results from the entry
 */
export const setSessionBuffer = (ownerUid, entry, analysis) => {
  if (!ownerUid) return null;

  const buffer = {
    recentEntry: {
      id: entry.id,
      text: entry.text,
      analysis: {
        mood_score: analysis?.mood_score,
        entry_type: analysis?.entry_type,
        tags: analysis?.tags || [],
        entities: analysis?.entities || [],
        therapeutic_response: analysis?.therapeutic_response
      },
      timestamp: new Date().toISOString()
    },
    expiresAt: new Date(Date.now() + BUFFER_EXPIRY_MS).toISOString(),
    createdAt: new Date().toISOString()
  };

  const key = sessionBufferKey(ownerUid);
  try {
    // Prefer sessionStorage (cleared on tab close, survives refresh)
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(key, JSON.stringify(buffer));
    } else if (typeof localStorage !== 'undefined') {
      // Fallback to localStorage with explicit expiry check
      localStorage.setItem(key, JSON.stringify(buffer));
    }
  } catch (e) {
    console.warn('Failed to set session buffer:', e);
  }

  return buffer;
};

/**
 * Get the session buffer if it hasn't expired, scoped to the given owner.
 * An expired buffer is REMOVED here (not merely ignored), so a stale hit
 * can never reappear later.
 *
 * @param {string} ownerUid - Required. The signed-in owner's uid.
 * @returns {Object|null} The session buffer or null if expired/not found
 */
export const getSessionBuffer = (ownerUid) => {
  if (!ownerUid) return null;

  const key = sessionBufferKey(ownerUid);
  try {
    let bufferStr = null;

    if (typeof sessionStorage !== 'undefined') {
      bufferStr = sessionStorage.getItem(key);
    }

    if (!bufferStr && typeof localStorage !== 'undefined') {
      bufferStr = localStorage.getItem(key);
    }

    if (!bufferStr) return null;

    const buffer = JSON.parse(bufferStr);

    // Check expiry
    if (isExpired(buffer.expiresAt)) {
      clearSessionBuffer(ownerUid);
      return null;
    }

    return buffer;
  } catch (e) {
    console.warn('Failed to get session buffer:', e);
    return null;
  }
};

/**
 * Check if a timestamp has expired
 *
 * @param {string|Date} expiresAt - The expiry timestamp
 * @returns {boolean} True if expired
 */
export const isExpired = (expiresAt) => {
  if (!expiresAt) return true;

  const expiryDate = new Date(expiresAt);
  return expiryDate < new Date();
};

/**
 * Clear the session buffer for the given owner.
 * Called when memory extraction Cloud Function confirms completion (and by
 * sign-out — see clearOwnerCaches.js — and by an expired read above).
 *
 * @param {string} ownerUid - Required. The signed-in owner's uid.
 */
export const clearSessionBuffer = (ownerUid) => {
  if (!ownerUid) return;
  const key = sessionBufferKey(ownerUid);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(key);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('Failed to clear session buffer:', e);
  }
};

/**
 * Check if the session buffer contains a specific entry
 *
 * @param {string} ownerUid - Required. The signed-in owner's uid.
 * @param {string} entryId - The entry ID to check
 * @returns {boolean} True if the entry is in the buffer
 */
export const hasEntryInBuffer = (ownerUid, entryId) => {
  const buffer = getSessionBuffer(ownerUid);
  return buffer?.recentEntry?.id === entryId;
};

/**
 * Update the session buffer expiry
 * Useful if the user is actively chatting
 *
 * @param {string} ownerUid - Required. The signed-in owner's uid.
 */
export const extendBufferExpiry = (ownerUid) => {
  if (!ownerUid) return;
  const buffer = getSessionBuffer(ownerUid);
  if (buffer) {
    buffer.expiresAt = new Date(Date.now() + BUFFER_EXPIRY_MS).toISOString();

    const key = sessionBufferKey(ownerUid);
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(key, JSON.stringify(buffer));
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(buffer));
      }
    } catch (e) {
      console.warn('Failed to extend session buffer:', e);
    }
  }
};

/**
 * Format session buffer for chat context
 * Returns a context-friendly representation of the volatile memory
 */
export const formatBufferForContext = (buffer) => {
  if (!buffer?.recentEntry) return null;

  const entry = buffer.recentEntry;
  const parts = [];

  parts.push(`[JUST JOURNALED - ${getTimeSince(entry.timestamp)}]`);

  if (entry.analysis?.mood_score !== undefined) {
    const moodPercent = Math.round(entry.analysis.mood_score * 100);
    parts.push(`Mood: ${moodPercent}%`);
  }

  if (entry.analysis?.entry_type) {
    parts.push(`Type: ${entry.analysis.entry_type}`);
  }

  // Include a snippet of the entry text for context
  if (entry.text) {
    const snippet = entry.text.length > 200
      ? entry.text.substring(0, 200) + '...'
      : entry.text;
    parts.push(`Entry: "${snippet}"`);
  }

  // Include key tags/entities
  if (entry.analysis?.tags?.length > 0) {
    const keyTags = entry.analysis.tags.filter(t => t.startsWith('@')).slice(0, 5);
    if (keyTags.length > 0) {
      parts.push(`Mentions: ${keyTags.join(', ')}`);
    }
  }

  return parts.join('\n');
};

/**
 * Get human-readable time since timestamp
 */
const getTimeSince = (timestamp) => {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  return `${diffHours} hours ago`;
};

export default {
  setSessionBuffer,
  getSessionBuffer,
  clearSessionBuffer,
  hasEntryInBuffer,
  extendBufferExpiry,
  formatBufferForContext,
  isExpired,
  quarantineLegacySessionBuffer,
  sweepLegacyVoiceTranscripts
};
