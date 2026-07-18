import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';

// Force the native code path so the Filesystem mock is exercised
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true }
}));

import { audioVault } from '../audioVault';

const OWNER = 'user-a';
const OTHER_OWNER = 'user-b';

// The project's global test setup (src/test/setup.js) stubs `localStorage`
// as bare vi.fn()s with no backing store (other suites use
// `.mockReturnValue()` per assertion). audioVault needs real read-your-write
// persistence across calls within a test, so give the shared mock fns a
// real in-memory implementation here — scoped to this file only.
beforeEach(() => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
  localStorage.clear.mockImplementation(() => { store.clear(); });
});

describe('audioVault', () => {
  beforeEach(() => {
    Filesystem.__reset();
    localStorage.clear();
  });

  it('saves and retrieves a recording', async () => {
    const id = await audioVault.saveRecording(OWNER, 'QUJDREVG', 'audio/webm');
    expect(id).toBeTruthy();
    const rec = await audioVault.getRecording(OWNER, id);
    expect(rec.base64).toBe('QUJDREVG');
    expect(rec.mime).toBe('audio/webm');
    expect(rec.entryId).toBeNull();
  });

  it('linkEntry marks a recording as non-orphaned', async () => {
    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(await audioVault.listOrphans(OWNER)).toHaveLength(1);
    await audioVault.linkEntry(OWNER, id, 'entry-123');
    expect(await audioVault.listOrphans(OWNER)).toHaveLength(0);
    expect((await audioVault.getRecording(OWNER, id)).entryId).toBe('entry-123');
  });

  it('deleteRecording removes audio and metadata', async () => {
    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    await audioVault.deleteRecording(OWNER, id);
    expect(await audioVault.getRecording(OWNER, id)).toBeNull();
    expect(await audioVault.listOrphans(OWNER)).toHaveLength(0);
  });

  it('cleanupExpired deletes recordings older than 7 days but keeps fresh ones', async () => {
    const oldId = await audioVault.saveRecording(OWNER, 'T0xE', 'audio/webm');
    // Backdate via the metadata index
    const ownerIndexKey = 'engram:v2:owner:user-a:audio%2Findex';
    const index = JSON.parse(localStorage.getItem(ownerIndexKey));
    index[oldId].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem(ownerIndexKey, JSON.stringify(index));
    const freshId = await audioVault.saveRecording(OWNER, 'RlJFU0g=', 'audio/webm');

    const deleted = await audioVault.cleanupExpired(OWNER);
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(OWNER, oldId)).toBeNull();
    expect(await audioVault.getRecording(OWNER, freshId)).not.toBeNull();
  });

  it('never throws when storage fails — returns null id', async () => {
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(id).toBeNull();
    spy.mockRestore();
  });

  it('returns null and leaves no orphan when the index write fails after a successful blob write', async () => {
    const setItemSpy = localStorage.setItem.getMockImplementation();
    localStorage.setItem.mockImplementation((key, value) => {
      if (key === 'engram:v2:owner:user-a:audio%2Findex') {
        throw new Error('quota exceeded');
      }
      return setItemSpy(key, value);
    });

    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(id).toBeNull();
    // The blob write path (Filesystem.writeFile, native mode) should have
    // been rolled back — deleteFile is best-effort so just assert no
    // orphan/entry is discoverable via the (now-restored) index.
    localStorage.setItem.mockImplementation(setItemSpy);
    expect(await audioVault.listOrphans(OWNER)).toHaveLength(0);
  });

  it('dispatches engram:audio-vault-changed on save, link, and delete', async () => {
    const events = [];
    const listener = () => events.push(1);
    window.addEventListener('engram:audio-vault-changed', listener);

    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(events.length).toBe(1);

    await audioVault.linkEntry(OWNER, id, 'entry-123');
    expect(events.length).toBe(2);

    await audioVault.deleteRecording(OWNER, id);
    expect(events.length).toBe(3);

    window.removeEventListener('engram:audio-vault-changed', listener);
  });

  it('never exposes one owner recording to another owner', async () => {
    const id = await audioVault.saveRecording(OWNER, 'QUJD', 'audio/webm');
    expect(await audioVault.getRecording(OTHER_OWNER, id)).toBeNull();
    expect(await audioVault.listOrphans(OTHER_OWNER)).toEqual([]);
    expect(await audioVault.listOrphans(OWNER)).toHaveLength(1);
  });
});
