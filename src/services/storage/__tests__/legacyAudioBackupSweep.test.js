import { describe, it, expect, beforeEach, vi } from 'vitest';

// setup.js replaces window.localStorage with a plain vi.fn() stub — wire it
// with an in-memory Map + key()/length so the prefix scan is actually
// exercised (same convention as sessionBuffer.test.js's wireStorage()).
let localStore;
function wireStorage() {
  localStore = new Map();
  localStorage.getItem.mockImplementation((key) => (localStore.has(key) ? localStore.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { localStore.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { localStore.delete(key); });
  localStorage.key = (index) => {
    const keys = Array.from(localStore.keys());
    return keys[index] ?? null;
  };
  Object.defineProperty(localStorage, 'length', {
    get() { return localStore.size; },
    configurable: true,
  });
}

describe('legacyAudioBackupSweep.js (CAP-02)', () => {
  beforeEach(() => {
    wireStorage();
  });

  it('quarantines every echov_audio_backup_* key at module load ("startup"), unconditionally — not just stale ones', async () => {
    localStore.set('echov_audio_backup_1000', JSON.stringify({ base64: 'a', mime: 'audio/webm', timestamp: Date.now() }));
    localStore.set('echov_audio_backup_2000', JSON.stringify({ base64: 'b', mime: 'audio/webm', timestamp: Date.now() }));
    localStore.set('some_unrelated_key', 'keep-me');

    vi.resetModules();
    await import('../legacyAudioBackupSweep.js');

    expect(localStore.has('echov_audio_backup_1000')).toBe(false);
    expect(localStore.has('echov_audio_backup_2000')).toBe(false);
    expect(localStore.has('some_unrelated_key')).toBe(true);
  });

  it('is idempotent — a second call with nothing left to sweep is a no-op', async () => {
    vi.resetModules();
    const { quarantineLegacyAudioBackups } = await import('../legacyAudioBackupSweep.js');

    expect(() => quarantineLegacyAudioBackups()).not.toThrow();
    expect(localStore.size).toBe(0);
  });

  it('never throws when localStorage access fails', async () => {
    vi.resetModules();
    const { quarantineLegacyAudioBackups } = await import('../legacyAudioBackupSweep.js');
    localStorage.key = () => { throw new Error('access denied'); };

    expect(() => quarantineLegacyAudioBackups()).not.toThrow();
  });
});
