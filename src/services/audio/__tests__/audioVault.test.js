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
    // Backdate via the metadata index (both createdAt and vaultedAt, since
    // this recording predates the vaultedAt-based retention clock).
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    index[oldId].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    index[oldId].vaultedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('engram_audio_vault_index', JSON.stringify(index));
    const freshId = await audioVault.saveRecording('RlJFU0g=', 'audio/webm');

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(oldId)).toBeNull();
    expect(await audioVault.getRecording(freshId)).not.toBeNull();
  });

  it('retention is measured from vaultedAt, not createdAt: a capture-time-overridden createdAt that looks stale is NOT purged while vaultedAt is fresh', async () => {
    // e.g. a background-captured recording whose createdAt was overridden to
    // the original capture time (10 days ago) but was only just swept into
    // the vault (vaultedAt = now). It should get its full retention window
    // starting from vaultedAt, not be purged immediately because createdAt
    // already looks old.
    const staleCreatedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const id = await audioVault.saveRecording('QUJD', 'audio/mp4', { createdAt: staleCreatedAt });

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(0);
    expect(await audioVault.getRecording(id)).not.toBeNull();
  });

  it('retention purges based on a backdated vaultedAt even when createdAt is fresh', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/mp4');
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    index[id].vaultedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('engram_audio_vault_index', JSON.stringify(index));

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(id)).toBeNull();
  });

  it('falls back to createdAt for pre-existing entries with no vaultedAt field', async () => {
    const id = await audioVault.saveRecording('QUJD', 'audio/mp4');
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    delete index[id].vaultedAt;
    index[id].createdAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
    localStorage.setItem('engram_audio_vault_index', JSON.stringify(index));

    const deleted = await audioVault.cleanupExpired();
    expect(deleted).toBe(1);
    expect(await audioVault.getRecording(id)).toBeNull();
  });

  it('saveRecording stamps vaultedAt with the current wall-clock time regardless of a createdAt override', async () => {
    const before = Date.now();
    const staleCreatedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const id = await audioVault.saveRecording('QUJD', 'audio/mp4', { createdAt: staleCreatedAt });
    const index = JSON.parse(localStorage.getItem('engram_audio_vault_index'));
    expect(index[id].vaultedAt).toBeGreaterThanOrEqual(before);
  });

  it('saveRecording honors options.createdAt (e.g. a background-capture timestamp)', async () => {
    const capturedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const id = await audioVault.saveRecording('QUJD', 'audio/webm', { createdAt: capturedAt });
    const rec = await audioVault.getRecording(id);
    expect(rec.createdAt).toBe(capturedAt);
  });

  it('saveRecording defaults createdAt to now when options are omitted', async () => {
    const before = Date.now();
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    const rec = await audioVault.getRecording(id);
    expect(rec.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('never throws when storage fails — returns null id', async () => {
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'));
    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(id).toBeNull();
    spy.mockRestore();
  });

  it('returns null and leaves no orphan when the index write fails after a successful blob write', async () => {
    const setItemSpy = localStorage.setItem.getMockImplementation();
    localStorage.setItem.mockImplementation((key, value) => {
      if (key === 'engram_audio_vault_index') {
        throw new Error('quota exceeded');
      }
      return setItemSpy(key, value);
    });

    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(id).toBeNull();
    // The blob write path (Filesystem.writeFile, native mode) should have
    // been rolled back — deleteFile is best-effort so just assert no
    // orphan/entry is discoverable via the (now-restored) index.
    localStorage.setItem.mockImplementation(setItemSpy);
    expect(await audioVault.listOrphans()).toHaveLength(0);
  });

  it('dispatches engram:audio-vault-changed on save, link, and delete', async () => {
    const events = [];
    const listener = () => events.push(1);
    window.addEventListener('engram:audio-vault-changed', listener);

    const id = await audioVault.saveRecording('QUJD', 'audio/webm');
    expect(events.length).toBe(1);

    await audioVault.linkEntry(id, 'entry-123');
    expect(events.length).toBe(2);

    await audioVault.deleteRecording(id);
    expect(events.length).toBe(3);

    window.removeEventListener('engram:audio-vault-changed', listener);
  });
});
