/** Durable, owner-scoped local storage for voice recordings. */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { encodedOwnerSegment, ownerStorageKey, requireOwner } from '../storage/ownerScopedStorage';
import { openCaptureDb, hasIndexedDb, reqP } from '../capture/idbCaptureDb';

const LEGACY_INDEX_KEY = 'engram_audio_vault_index';
const RETENTION_DAYS = 7;
// All new web blobs move into IndexedDB (see idbCaptureDb.js's `vault`
// store) rather than localStorage — a single JSON blob-per-key localStorage
// scheme shares the browser's small (~5-10MB) per-origin quota with the
// rest of the app, which is what forced the old 10MB cap. Moving audio out
// entirely (not just blobs over some size threshold) keeps one read/write
// path instead of two, and frees the old headroom for everything else.
// 50MB is enforced ourselves by summing each index entry's recorded `size`
// (base64 length) on save — IndexedDB's real quota is far larger, this is a
// deliberate app-level ceiling, not a browser limit.
const WEB_MAX_BYTES = 50 * 1024 * 1024;
// Fallback cap ONLY used when IndexedDB itself is unavailable (e.g. some
// private-browsing modes, very old browsers) and we must fall back to the
// pre-migration localStorage-blob path for a single save.
const LEGACY_WEB_SINGLE_MAX_BYTES = 10 * 1024 * 1024;
const RECORDING_ID_PATTERN = /^rec_\d+_[a-z0-9]{6}$/;

const isNative = () => Capacitor.isNativePlatform();
const ownerDir = (ownerUid) => `audio-vault/${encodedOwnerSegment(ownerUid)}`;
const requireRecordingId = (id) => {
  if (typeof id !== 'string' || !RECORDING_ID_PATTERN.test(id)) {
    throw new Error('audio_recording_id_invalid');
  }
  return id;
};
const filePath = (ownerUid, id) => `${ownerDir(ownerUid)}/${requireRecordingId(id)}.b64`;
const indexKey = (ownerUid) => ownerStorageKey(ownerUid, 'audio/index');
const webKey = (ownerUid, id) => ownerStorageKey(ownerUid, `audio/blob/${id}`);

const quarantineLegacyIndex = () => {
  try {
    const legacy = localStorage.getItem(LEGACY_INDEX_KEY);
    if (!legacy) return;
    localStorage.setItem('engram:quarantine:audio-index', legacy);
    localStorage.removeItem(LEGACY_INDEX_KEY);
  } catch { /* storage may be unavailable */ }
};

const readIndex = (ownerUid) => {
  quarantineLegacyIndex();
  try {
    const parsed = JSON.parse(localStorage.getItem(indexKey(ownerUid))) || {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, meta]) => meta?.ownerUid === ownerUid)
    );
  } catch { return {}; }
};

const writeIndex = (ownerUid, index) => {
  try {
    localStorage.setItem(indexKey(ownerUid), JSON.stringify(index));
    return true;
  } catch (error) {
    console.warn('[audioVault] could not persist owner index:', error.message);
    return false;
  }
};

const emitChanged = (ownerUid) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('engram:audio-vault-changed', { detail: { ownerUid } }));
  }
};

const sumWebBytes = (index) =>
  Object.values(index).reduce((total, meta) => total + (meta?.size || 0), 0);

const idbPutBlob = async (ownerUid, id, base64) => {
  const db = await openCaptureDb();
  if (!db) return false;
  const tx = db.transaction(['vault'], 'readwrite');
  await reqP(tx.objectStore('vault').put({ ownerUid, id, base64 }));
  return true;
};

const idbGetBlob = async (ownerUid, id) => {
  const db = await openCaptureDb();
  if (!db) return null;
  const tx = db.transaction(['vault'], 'readonly');
  const record = await reqP(tx.objectStore('vault').get([ownerUid, id]));
  return record ? record.base64 : null;
};

const idbDeleteBlob = async (ownerUid, id) => {
  const db = await openCaptureDb();
  if (!db) return;
  const tx = db.transaction(['vault'], 'readwrite');
  await reqP(tx.objectStore('vault').delete([ownerUid, id]));
};

export const audioVault = {
  /**
   * Persist a recording durably. Never throws. Returns a discriminated result:
   *   - `{ id }` on success
   *   - `{ error: 'quota' | 'io' }` on failure
   * so the caller can BLOCK transcription (and keep the native draft) rather
   * than silently proceed with no durable local copy. `error: 'quota'` means a
   * capacity limit was hit (oversized web blob / index write rejected);
   * `error: 'io'` means the underlying storage write failed.
   */
  async saveRecording(ownerUid, base64, mime) {
    const owner = requireOwner(ownerUid);
    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (isNative()) {
        await Filesystem.mkdir({ path: ownerDir(owner), directory: Directory.Data, recursive: true }).catch(() => {});
        await Filesystem.writeFile({ path: filePath(owner, id), directory: Directory.Data, data: base64 });
      } else {
        const existingTotal = sumWebBytes(readIndex(owner));
        if (existingTotal + base64.length > WEB_MAX_BYTES) return { error: 'quota' };
        if (hasIndexedDb()) {
          const ok = await idbPutBlob(owner, id, base64);
          if (!ok) return { error: 'io' };
        } else {
          if (base64.length > LEGACY_WEB_SINGLE_MAX_BYTES) return { error: 'quota' };
          localStorage.setItem(webKey(owner, id), base64);
        }
      }

      const index = readIndex(owner);
      index[id] = { ownerUid: owner, createdAt: Date.now(), mime, entryId: null, size: base64.length };
      if (!writeIndex(owner, index)) {
        if (isNative()) {
          await Filesystem.deleteFile({ path: filePath(owner, id), directory: Directory.Data }).catch(() => {});
        } else if (hasIndexedDb()) {
          await idbDeleteBlob(owner, id).catch(() => {});
        } else {
          localStorage.removeItem(webKey(owner, id));
        }
        return { error: 'quota' };
      }
      emitChanged(owner);
      return { id };
    } catch (error) {
      console.warn('[audioVault] saveRecording failed:', error.message);
      return { error: 'io' };
    }
  },

  async getRecording(ownerUid, id) {
    const owner = requireOwner(ownerUid);
    requireRecordingId(id);
    const meta = readIndex(owner)[id];
    if (!meta) return null;
    try {
      let base64;
      if (isNative()) {
        base64 = (await Filesystem.readFile({ path: filePath(owner, id), directory: Directory.Data })).data;
      } else {
        // localStorage first: blobs saved before the IndexedDB migration
        // still live there. New saves are IDB-only, so this is a fast miss
        // for them.
        base64 = localStorage.getItem(webKey(owner, id));
        if (!base64 && hasIndexedDb()) {
          base64 = await idbGetBlob(owner, id);
        }
      }
      return base64 ? { base64, mime: meta.mime, createdAt: meta.createdAt, entryId: meta.entryId } : null;
    } catch { return null; }
  },

  async linkEntry(ownerUid, id, entryId) {
    const owner = requireOwner(ownerUid);
    requireRecordingId(id);
    const index = readIndex(owner);
    if (!index[id]) return false;
    index[id].entryId = entryId;
    const saved = writeIndex(owner, index);
    if (saved) emitChanged(owner);
    return saved;
  },

  async deleteRecording(ownerUid, id) {
    const owner = requireOwner(ownerUid);
    requireRecordingId(id);
    try {
      if (isNative()) {
        await Filesystem.deleteFile({ path: filePath(owner, id), directory: Directory.Data }).catch(() => {});
      } else {
        // Best-effort against both backends — a recording may be a legacy
        // localStorage blob, an IndexedDB blob, or (transiently) neither.
        localStorage.removeItem(webKey(owner, id));
        if (hasIndexedDb()) await idbDeleteBlob(owner, id).catch(() => {});
      }
    } finally {
      const index = readIndex(owner);
      delete index[id];
      writeIndex(owner, index);
      emitChanged(owner);
    }
  },

  async listOrphans(ownerUid) {
    const owner = requireOwner(ownerUid);
    return Object.entries(readIndex(owner))
      .filter(([, meta]) => !meta.entryId)
      .map(([id, meta]) => ({ id, createdAt: meta.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  async cleanupExpired(ownerUid) {
    const owner = requireOwner(ownerUid);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const index = readIndex(owner);
    let deleted = 0;
    for (const [id, meta] of Object.entries(index)) {
      if (meta.createdAt < cutoff) {
        await this.deleteRecording(owner, id);
        deleted += 1;
      }
    }
    return deleted;
  },

  async clearOwner(ownerUid) {
    const owner = requireOwner(ownerUid);
    for (const id of Object.keys(readIndex(owner))) {
      await this.deleteRecording(owner, id);
    }
    localStorage.removeItem(indexKey(owner));
  },
};
