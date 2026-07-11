/**
 * Durable local storage for voice recordings. The #1 trust failure in
 * voice-capture apps is losing recordings — audio lands here the moment
 * recording stops and is retained for RETENTION_DAYS after the entry saves,
 * never gated on a cloud round-trip.
 *
 * Native: audio files via Capacitor Filesystem (Data directory).
 * Web: base64 in localStorage (secondary platform; 10MB guard).
 * Metadata index (both platforms): localStorage JSON map id -> {createdAt, mime, entryId}.
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';

const INDEX_KEY = 'engram_audio_vault_index';
const DIR = 'audio-vault';
const RETENTION_DAYS = 7;
const WEB_MAX_BYTES = 10 * 1024 * 1024;

const isNative = () => Capacitor.isNativePlatform();
const filePath = (id) => `${DIR}/${id}.b64`;
const webKey = (id) => `engram_audio_vault_${id}`;

const readIndex = () => {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY)) || {}; } catch { return {}; }
};
/** Returns true on success, false if persisting the index failed. */
const writeIndex = (index) => {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (e) {
    console.warn('[audioVault] could not persist index:', e.message);
    return false;
  }
};
/** Notify listeners (e.g. PendingAudioBanner) that vault state changed. */
const emitChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('engram:audio-vault-changed'));
  }
};

export const audioVault = {
  /**
   * Returns the recording id, or null if storage failed (never throws).
   * @param {string} base64
   * @param {string} mime
   * @param {object} [options]
   * @param {number} [options.createdAt] - ms-epoch override for the index
   *   `createdAt` (e.g. the actual capture time for a background-captured
   *   recording swept in later). Defaults to `Date.now()`.
   */
  async saveRecording(base64, mime, options = {}) {
    const { createdAt } = options;
    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (isNative()) {
        await Filesystem.mkdir({ path: DIR, directory: Directory.Data, recursive: true }).catch(() => {});
        await Filesystem.writeFile({ path: filePath(id), directory: Directory.Data, data: base64 });
      } else {
        if (base64.length > WEB_MAX_BYTES) {
          console.warn('[audioVault] recording too large for web storage:', base64.length);
          return null;
        }
        localStorage.setItem(webKey(id), base64);
      }
      const index = readIndex();
      index[id] = { createdAt: createdAt ?? Date.now(), mime, entryId: null };
      const indexed = writeIndex(index);
      if (!indexed) {
        // Blob was written but the index (the only thing that makes it
        // discoverable) wasn't — the blob is now unreachable. Clean it up
        // rather than leaking an orphaned file/localStorage entry.
        console.warn('[audioVault] index write failed after blob write; rolling back blob for', id);
        try {
          if (isNative()) {
            await Filesystem.deleteFile({ path: filePath(id), directory: Directory.Data }).catch(() => {});
          } else {
            localStorage.removeItem(webKey(id));
          }
        } catch { /* best-effort rollback */ }
        return null;
      }
      emitChanged();
      return id;
    } catch (e) {
      console.warn('[audioVault] saveRecording failed:', e.message);
      return null;
    }
  },

  async getRecording(id) {
    const meta = readIndex()[id];
    if (!meta) return null;
    try {
      let base64;
      if (isNative()) {
        base64 = (await Filesystem.readFile({ path: filePath(id), directory: Directory.Data })).data;
      } else {
        base64 = localStorage.getItem(webKey(id));
      }
      if (!base64) return null;
      return { base64, mime: meta.mime, createdAt: meta.createdAt, entryId: meta.entryId };
    } catch {
      return null;
    }
  },

  async linkEntry(id, entryId) {
    const index = readIndex();
    if (index[id]) {
      index[id].entryId = entryId;
      writeIndex(index);
      emitChanged();
    }
  },

  async deleteRecording(id) {
    try {
      if (isNative()) {
        await Filesystem.deleteFile({ path: filePath(id), directory: Directory.Data }).catch(() => {});
      } else {
        localStorage.removeItem(webKey(id));
      }
    } finally {
      const index = readIndex();
      delete index[id];
      writeIndex(index);
      emitChanged();
    }
  },

  /** Recordings that never got linked to a saved entry (transcription failed / app died). */
  async listOrphans() {
    const index = readIndex();
    return Object.entries(index)
      .filter(([, meta]) => !meta.entryId)
      .map(([id, meta]) => ({ id, createdAt: meta.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /** Delete recordings older than RETENTION_DAYS. Returns count deleted. */
  async cleanupExpired() {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const index = readIndex();
    let deleted = 0;
    for (const [id, meta] of Object.entries(index)) {
      if (meta.createdAt < cutoff) {
        await this.deleteRecording(id);
        deleted++;
      }
    }
    return deleted;
  }
};
