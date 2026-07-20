/**
 * Web-backend coverage for audioVault: blobs move from a 10MB localStorage
 * cap into IndexedDB (50MB owner cap, size tracked in the localStorage
 * index), with a localStorage-first read path so blobs saved before this
 * migration remain readable. Native-path behavior is covered by the
 * existing audioVault.test.js (which forces isNativePlatform() true) —
 * this file exercises the web branch, which the shared @capacitor/core
 * mock already defaults to (isNativePlatform: () => false).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeIndexedDb } from '../../../test/mocks/fakeIndexedDb';
import { __resetCaptureDb } from '../../capture/idbCaptureDb';
import { audioVault } from '../audioVault';

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';
const OWNER_INDEX_KEY = 'engram:v2:owner:user-a:audio%2Findex';

let fakeIdb;

beforeEach(() => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
  localStorage.clear.mockImplementation(() => { store.clear(); });

  fakeIdb = createFakeIndexedDb();
  globalThis.indexedDB = fakeIdb;
  globalThis.IDBKeyRange = fakeIdb.IDBKeyRange;
  __resetCaptureDb();
});

describe('audioVault — web backend on IndexedDB', () => {
  it('round-trips a recording through IndexedDB (not localStorage) when IndexedDB is available', async () => {
    const { id } = await audioVault.saveRecording(OWNER, 'QUJDREVG', 'audio/webm');
    expect(id).toBeTruthy();
    expect(localStorage.getItem(`engram:v2:owner:user-a:audio%2Fblob%2F${id}`)).toBeNull();

    const rec = await audioVault.getRecording(OWNER, id);
    expect(rec.base64).toBe('QUJDREVG');
    expect(rec.mime).toBe('audio/webm');
  });

  it('still reads a legacy localStorage blob saved before the IndexedDB migration', async () => {
    delete globalThis.indexedDB;
    delete globalThis.IDBKeyRange;
    const { id } = await audioVault.saveRecording(OWNER, 'TEdBQ1k=', 'audio/webm');

    // IndexedDB becomes available again (e.g. a later session) — the
    // pre-existing localStorage blob must still be readable.
    globalThis.indexedDB = fakeIdb;
    globalThis.IDBKeyRange = fakeIdb.IDBKeyRange;
    __resetCaptureDb();

    const rec = await audioVault.getRecording(OWNER, id);
    expect(rec.base64).toBe('TEdBQ1k=');
  });

  it('deleteRecording removes an IndexedDB-backed blob', async () => {
    const { id } = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    await audioVault.deleteRecording(OWNER, id);
    expect(await audioVault.getRecording(OWNER, id)).toBeNull();
  });

  it('returns { error: quota } once the 50MB owner cap would be exceeded', async () => {
    const { id } = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    const index = JSON.parse(localStorage.getItem(OWNER_INDEX_KEY));
    index[id].size = 50 * 1024 * 1024; // pretend this owner is already at the cap
    localStorage.setItem(OWNER_INDEX_KEY, JSON.stringify(index));

    const result = await audioVault.saveRecording(OWNER, 'QUJDREVG', 'audio/webm');
    expect(result).toEqual({ error: 'quota' });
  });

  it('falls back to localStorage (bounded) when IndexedDB is unavailable', async () => {
    delete globalThis.indexedDB;
    delete globalThis.IDBKeyRange;
    const result = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(result.id).toBeTruthy();
    expect(localStorage.getItem(`engram:v2:owner:user-a:audio%2Fblob%2F${result.id}`)).toBe('QUJD');
  });

  it('never exposes one owner recording to another owner (IndexedDB path)', async () => {
    const { id } = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(await audioVault.getRecording(OTHER_OWNER, id)).toBeNull();
    expect(await audioVault.listOrphans(OTHER_OWNER)).toEqual([]);
  });

  it('cleanupExpired deletes an IndexedDB-backed recording past retention', async () => {
    const { id } = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    const index = JSON.parse(localStorage.getItem(OWNER_INDEX_KEY));
    index[id].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(OWNER_INDEX_KEY, JSON.stringify(index));

    const deleted = await audioVault.cleanupExpired(OWNER);
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(OWNER, id)).toBeNull();
  });
});
