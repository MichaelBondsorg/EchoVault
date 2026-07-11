import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Filesystem, Directory } from '@capacitor/filesystem';

// Force the native code path by default so the Filesystem mock is exercised;
// individual tests flip isNativePlatform back to false via spyOn where needed.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true }
}));

import { Capacitor } from '@capacitor/core';
import { sweepCaptureInbox } from '../captureInbox';
import { audioVault } from '../audioVault';

const INBOX = 'engram-inbox';

// The project's global test setup (src/test/setup.js) stubs `localStorage` as
// bare vi.fn()s with no backing store. audioVault (which sweepCaptureInbox
// delegates to for the actual vault write) needs real read-your-write
// persistence across calls within a test — same shim used in audioVault.test.js.
beforeEach(() => {
  const store = new Map();
  localStorage.getItem.mockImplementation((k) => (store.has(k) ? store.get(k) : null));
  localStorage.setItem.mockImplementation((k, v) => { store.set(k, String(v)); });
  localStorage.removeItem.mockImplementation((k) => { store.delete(k); });
  localStorage.clear.mockImplementation(() => { store.clear(); });
  Filesystem.__reset();
  localStorage.clear();
});

async function seed(id, { sidecar, data = 'QUJDREVG' } = {}) {
  await Filesystem.mkdir({ path: INBOX, directory: Directory.Data, recursive: true });
  await Filesystem.writeFile({ path: `${INBOX}/${id}.m4a`, directory: Directory.Data, data });
  if (sidecar !== undefined) {
    await Filesystem.writeFile({
      path: `${INBOX}/${id}.json`,
      directory: Directory.Data,
      data: JSON.stringify(sidecar)
    });
  }
}

describe('sweepCaptureInbox', () => {
  it('returns [] on non-native platforms without touching the filesystem', async () => {
    const platformSpy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValueOnce(false);
    const readdirSpy = vi.spyOn(Filesystem, 'readdir');

    const result = await sweepCaptureInbox();

    expect(result).toEqual([]);
    expect(readdirSpy).not.toHaveBeenCalled();
    platformSpy.mockRestore();
    readdirSpy.mockRestore();
  });

  it('returns [] when the inbox directory does not exist yet', async () => {
    const result = await sweepCaptureInbox();
    expect(result).toEqual([]);
  });

  it('sweeps a captured recording with a sidecar into the vault with the overridden createdAt, and empties the inbox', async () => {
    const capturedAt = '2026-01-01T12:00:00.000Z';
    await seed('abc', { sidecar: { capturedAt, mime: 'audio/mp4' } });

    const results = await sweepCaptureInbox();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ mime: 'audio/mp4', capturedAt, base64: 'QUJDREVG' });
    expect(results[0].recordingId).toBeTruthy();

    // Vault entry carries the capture-time createdAt, not sweep time.
    const rec = await audioVault.getRecording(results[0].recordingId);
    expect(rec.createdAt).toBe(Date.parse(capturedAt));

    // Inbox is emptied.
    const { files } = await Filesystem.readdir({ path: INBOX, directory: Directory.Data });
    expect(files).toHaveLength(0);
  });

  it('processes an orphan .m4a with no sidecar using defaults', async () => {
    await seed('orphan'); // no sidecar written
    const before = Date.now();

    const results = await sweepCaptureInbox();

    expect(results).toHaveLength(1);
    expect(results[0].mime).toBe('audio/mp4');
    expect(Date.parse(results[0].capturedAt)).toBeGreaterThanOrEqual(before);

    const { files } = await Filesystem.readdir({ path: INBOX, directory: Directory.Data });
    expect(files).toHaveLength(0);
  });

  it('leaves the inbox files in place when the vault save fails', async () => {
    await seed('failing', { sidecar: { capturedAt: '2026-01-01T00:00:00.000Z', mime: 'audio/mp4' } });
    // The first writeFile call after this spy is installed is audioVault's
    // internal blob write (setup's writeFile calls already ran above).
    const spy = vi.spyOn(Filesystem, 'writeFile').mockRejectedValueOnce(new Error('disk full'));

    const results = await sweepCaptureInbox();

    expect(results).toHaveLength(0);
    const { files } = await Filesystem.readdir({ path: INBOX, directory: Directory.Data });
    expect(files.map(f => f.name).sort()).toEqual(['failing.json', 'failing.m4a']);
    spy.mockRestore();
  });

  it('never throws on a malformed sidecar — falls back to defaults', async () => {
    await seed('bad', { data: 'QUJD' }); // no sidecar from seed()
    await Filesystem.writeFile({ path: `${INBOX}/bad.json`, directory: Directory.Data, data: 'not json{{' });

    const results = await sweepCaptureInbox();

    expect(results).toHaveLength(1);
    expect(results[0].mime).toBe('audio/mp4');
  });

  it('sweeps multiple recordings in one pass', async () => {
    await seed('one', { sidecar: { capturedAt: '2026-01-01T00:00:00.000Z', mime: 'audio/mp4' } });
    await seed('two', { sidecar: { capturedAt: '2026-01-02T00:00:00.000Z', mime: 'audio/mp4' } });

    const results = await sweepCaptureInbox();

    expect(results).toHaveLength(2);
    const { files } = await Filesystem.readdir({ path: INBOX, directory: Directory.Data });
    expect(files).toHaveLength(0);
  });
});
