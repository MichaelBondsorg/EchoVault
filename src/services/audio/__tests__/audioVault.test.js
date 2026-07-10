import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Filesystem } from '@capacitor/filesystem';

// Force the native code path so the Filesystem mock is exercised
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true }
}));

import { audioVault } from '../audioVault';

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
    const id = await audioVault.saveRecording('QUJDREVG', 'audio/webm');
    expect(id).toBeTruthy();
    const rec = await audioVault.getRecording(id);
    expect(rec.base64).toBe('QUJDREVG');
    expect(rec.mime).toBe('audio/webm');
    expect(rec.entryId).toBeNull();
  });

  it('linkEntry marks a recording as non-orphaned', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(await audioVault.listOrphans()).toHaveLength(1);
    await audioVault.linkEntry(id, 'entry-123');
    expect(await audioVault.listOrphans()).toHaveLength(0);
    expect((await audioVault.getRecording(id)).entryId).toBe('entry-123');
  });

  it('deleteRecording removes audio and metadata', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    await audioVault.deleteRecording(id);
    expect(await audioVault.getRecording(id)).toBeNull();
    expect(await audioVault.listOrphans()).toHaveLength(0);
  });

  it('cleanupExpired deletes recordings older than 7 days but keeps fresh ones', async () => {
    const oldId = await audioVault.saveRecording('T0xE', 'audio/webm');
    // Backdate via the metadata index
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    index[oldId].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('engram_audio_vault_index', JSON.stringify(index));
    const freshId = await audioVault.saveRecording('RlJFU0g=', 'audio/webm');

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(oldId)).toBeNull();
    expect(await audioVault.getRecording(freshId)).not.toBeNull();
  });

  it('never throws when storage fails — returns null id', async () => {
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(id).toBeNull();
    spy.mockRestore();
  });
});
