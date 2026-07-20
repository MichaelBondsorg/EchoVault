/**
 * Web recording chunk durability.
 *
 * MediaRecorder's `ondataavailable` chunks used to live only in a
 * `const chunks = []` closure in EntryBar — a tab crash/reload mid-recording
 * lost the audio entirely. This store persists each chunk to IndexedDB as
 * it arrives so a relaunch can recover and hand it off to the audio vault.
 *
 * Raw IndexedDB, no wrapper library. Schema lives in ./idbCaptureDb.js
 * (shared with audioVault.js's `vault` store — see that file for why).
 *
 * Feature-detected: if IndexedDB is unavailable, every function is a no-op
 * returning null. Callers must tolerate that (treat null as "nothing to
 * recover" / "write silently skipped").
 */
import { parseOwnerUid } from '../../domain/storage/ownerScope';
import { hasIndexedDb, openCaptureDb, getKeyRange, reqP } from './idbCaptureDb';

const withStores = async (names, mode) => {
  const db = await openCaptureDb();
  if (!db) return null;
  const tx = db.transaction(names, mode);
  return Object.fromEntries(names.map((name) => [name, tx.objectStore(name)]));
};

export const openStore = () => openCaptureDb();

export const appendChunk = async (ownerUid, draftId, seq, blob, mimeType) => {
  if (!hasIndexedDb()) return null;
  const owner = parseOwnerUid(ownerUid);
  if (!draftId) return null;
  const stores = await withStores(['chunks', 'meta'], 'readwrite');
  if (!stores) return null;

  await reqP(stores.chunks.put({ ownerUid: owner, draftId, seq, blob, mimeType }));
  const existingMeta = await reqP(stores.meta.get([owner, draftId]));
  await reqP(stores.meta.put({
    ownerUid: owner,
    draftId,
    mimeType,
    startedAt: existingMeta?.startedAt ?? Date.now(),
    lastSeq: seq,
  }));
  return true;
};

export const listDrafts = async (ownerUid) => {
  if (!hasIndexedDb()) return null;
  const owner = parseOwnerUid(ownerUid);
  const stores = await withStores(['chunks', 'meta'], 'readonly');
  if (!stores) return null;

  const allMeta = await reqP(stores.meta.getAll());
  const ownerMeta = allMeta.filter((m) => m.ownerUid === owner);
  const KeyRange = getKeyRange();

  const drafts = [];
  for (const meta of ownerMeta) {
    const chunks = await reqP(
      stores.chunks.index('byDraft').getAll(KeyRange.only([owner, meta.draftId]))
    );
    drafts.push({
      draftId: meta.draftId,
      mimeType: meta.mimeType,
      startedAt: meta.startedAt,
      chunkCount: chunks.length,
    });
  }
  return drafts;
};

export const readDraftBlob = async (ownerUid, draftId) => {
  if (!hasIndexedDb()) return null;
  const owner = parseOwnerUid(ownerUid);
  const stores = await withStores(['chunks', 'meta'], 'readonly');
  if (!stores) return null;

  const KeyRange = getKeyRange();
  const chunkRecords = await reqP(stores.chunks.index('byDraft').getAll(KeyRange.only([owner, draftId])));
  if (!chunkRecords.length) return null;

  const meta = await reqP(stores.meta.get([owner, draftId]));
  const mimeType = meta?.mimeType ?? chunkRecords[0].mimeType;
  const blobs = chunkRecords.sort((a, b) => a.seq - b.seq).map((c) => c.blob);
  return new Blob(blobs, { type: mimeType });
};

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('chunk_blob_read_failed'));
    reader.onloadend = () => {
      const result = reader.result || '';
      const base64 = typeof result === 'string' ? result.split(',')[1] : '';
      resolve(base64 || '');
    };
    reader.readAsDataURL(blob);
  });

/**
 * Adopt any leftover chunked drafts (from a tab death mid-recording) into
 * durable custody via `adopt` (normally audioVault.saveRecording). Mirrors
 * nativeCaptureAdapter's recoverNativeDrafts: on success the chunk draft is
 * deleted (the vault is now the durable copy — the resulting orphan
 * surfaces via the existing pending-audio banner); on adoption failure the
 * chunks are left in place so the next launch retries.
 */
export const recoverWebDrafts = async (ownerUid, adopt) => {
  const drafts = await listDrafts(ownerUid);
  if (!drafts || !drafts.length) return 0;
  let recovered = 0;
  for (const draft of drafts) {
    const blob = await readDraftBlob(ownerUid, draft.draftId);
    if (!blob) continue;
    const base64 = await blobToBase64(blob).catch(() => '');
    if (!base64) continue;
    const adoptedId = await adopt(base64, draft.mimeType);
    if (adoptedId) {
      await deleteDraft(ownerUid, draft.draftId);
      recovered += 1;
    }
  }
  return recovered;
};

export const deleteDraft = async (ownerUid, draftId) => {
  if (!hasIndexedDb()) return null;
  const owner = parseOwnerUid(ownerUid);
  const stores = await withStores(['chunks', 'meta'], 'readwrite');
  if (!stores) return null;

  const KeyRange = getKeyRange();
  const chunkRecords = await reqP(stores.chunks.index('byDraft').getAll(KeyRange.only([owner, draftId])));
  for (const record of chunkRecords) {
    await reqP(stores.chunks.delete([owner, draftId, record.seq]));
  }
  await reqP(stores.meta.delete([owner, draftId]));
  return true;
};
