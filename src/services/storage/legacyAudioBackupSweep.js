/**
 * Legacy web-audio-backup quarantine (CAP-02).
 *
 * `useBackgroundAudio` (now deleted, src/hooks/useBackgroundAudio.js) wrote
 * unowned, un-uid-scoped raw-audio backups to localStorage under
 * `echov_audio_backup_<timestamp>`. It was never the durable capture path —
 * CaptureService/webChunkStore (IndexedDB chunk persistence, see
 * webChunkStore.js) and audioVault are — and no production call site ever
 * actually invoked its `backupAudio` writer: App.jsx called the hook but
 * never used any of its returned functions (`isProcessing` never even
 * existed on the hook's return value either). Per the CAP-02 review finding
 * ("dead legacy background-audio hook still invoked... not the authority"),
 * the hook itself is removed; this quarantines whatever keys it may have
 * already left behind on a device from before this fix shipped.
 *
 * Mirrors the PRIV-01 sweep pattern already established in
 * services/memory/sessionBuffer.js (`quarantineLegacySessionBuffer`,
 * `sweepLegacyVoiceTranscripts`) — deleted unconditionally, never claimed by
 * whichever account happens to be signed in, since these keys were never
 * owner-scoped in the first place and there is no current owner-scoped
 * replacement to migrate them into (the feature is fully dead, not
 * relocated). Not modeled as a src/services/storage/storageRegistry.js row:
 * that registry's schema (and its own contract test) requires a live
 * per-uid `ownerKeyFor`, which doesn't apply to a prefix-swept, already-dead
 * key family — the same reason `sweepLegacyVoiceTranscripts` also isn't a
 * registry row.
 */
const LEGACY_AUDIO_BACKUP_PREFIX = 'echov_audio_backup_';

/**
 * Delete every `echov_audio_backup_*` localStorage key, unconditionally.
 * Idempotent and safe to call repeatedly (a no-op once none remain).
 */
export const quarantineLegacyAudioBackups = () => {
  try {
    if (typeof localStorage === 'undefined') return;
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_AUDIO_BACKUP_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Best-effort.
  }
};

// "At startup": runs once, the first time this module is imported — same
// convention as sessionBuffer.js's quarantine calls.
quarantineLegacyAudioBackups();
