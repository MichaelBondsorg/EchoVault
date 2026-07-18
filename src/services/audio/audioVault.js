/** Durable, owner-scoped local storage for voice recordings. */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { encodedOwnerSegment, ownerStorageKey, requireOwner } from '../storage/ownerScopedStorage';

const LEGACY_INDEX_KEY = 'engram_audio_vault_index';
const RETENTION_DAYS = 7;
const WEB_MAX_BYTES = 10 * 1024 * 1024;
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

export const audioVault = {
  /** Returns the recording id, or null if storage failed (never throws). */
  async saveRecording(ownerUid, base64, mime) {
    const owner = requireOwner(ownerUid);
    const id = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      if (isNative()) {
        await Filesystem.mkdir({ path: ownerDir(owner), directory: Directory.Data, recursive: true }).catch(() => {});
        await Filesystem.writeFile({ path: filePath(owner, id), directory: Directory.Data, data: base64 });
      } else {
        if (base64.length > WEB_MAX_BYTES) return null;
        localStorage.setItem(webKey(owner, id), base64);
      }

      const index = readIndex(owner);
      index[id] = { ownerUid: owner, createdAt: Date.now(), mime, entryId: null };
      if (!writeIndex(owner, index)) {
        if (isNative()) {
          await Filesystem.deleteFile({ path: filePath(owner, id), directory: Directory.Data }).catch(() => {});
        } else {
          localStorage.removeItem(webKey(owner, id));
        }
        return null;
      }
      emitChanged(owner);
      return id;
    } catch (error) {
      console.warn('[audioVault] saveRecording failed:', error.message);
      return null;
    }
  },

  async getRecording(ownerUid, id) {
    const owner = requireOwner(ownerUid);
    requireRecordingId(id);
    const meta = readIndex(owner)[id];
    if (!meta) return null;
    try {
      const base64 = isNative()
        ? (await Filesystem.readFile({ path: filePath(owner, id), directory: Directory.Data })).data
        : localStorage.getItem(webKey(owner, id));
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
        localStorage.removeItem(webKey(owner, id));
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
