import { describe, it, expect, beforeEach, vi } from 'vitest';

// setup.js replaces window.localStorage/sessionStorage with plain vi.fn()
// no-op stubs; drive them with in-memory Maps so the owner-scoped module is
// actually exercised (established convention — see
// consentService.test.js/validationMatrix.test.js's wireLocalStorage()).
let localStore;
let sessionStore;
function wireStorage() {
  localStore = new Map();
  sessionStore = new Map();
  localStorage.getItem.mockImplementation((key) => (localStore.has(key) ? localStore.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { localStore.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { localStore.delete(key); });
  // Add key() and length for iteration (used by sweepLegacyVoiceTranscripts)
  localStorage.key = (index) => {
    const keys = Array.from(localStore.keys());
    return keys[index] ?? null;
  };
  Object.defineProperty(localStorage, 'length', {
    get() { return localStore.size; },
    configurable: true
  });
  sessionStorage.getItem.mockImplementation((key) => (sessionStore.has(key) ? sessionStore.get(key) : null));
  sessionStorage.setItem.mockImplementation((key, value) => { sessionStore.set(key, String(value)); });
  sessionStorage.removeItem.mockImplementation((key) => { sessionStore.delete(key); });
}

const LEGACY_KEY = 'engram_session_buffer';

describe('sessionBuffer.js owner-required API (PRIV-01)', () => {
  beforeEach(() => {
    wireStorage();
  });

  it('quarantines the legacy global key at module load ("startup") — deleted, not adopted', async () => {
    // Seed the legacy key BEFORE the module is (re-)imported.
    sessionStore.set(LEGACY_KEY, JSON.stringify({ recentEntry: { id: 'e1', text: 'leftover' } }));
    localStore.set(LEGACY_KEY, JSON.stringify({ recentEntry: { id: 'e1', text: 'leftover' } }));

    vi.resetModules();
    await import('../sessionBuffer.js');

    expect(sessionStore.has(LEGACY_KEY)).toBe(false);
    expect(localStore.has(LEGACY_KEY)).toBe(false);
  });

  it('setSessionBuffer/getSessionBuffer require an owner uid — no-op / null without one', async () => {
    vi.resetModules();
    const { setSessionBuffer, getSessionBuffer } = await import('../sessionBuffer.js');

    const result = setSessionBuffer(undefined, { id: 'e1', text: 'hi' }, { mood_score: 0.5 });
    expect(result).toBeNull();
    expect(getSessionBuffer(undefined)).toBeNull();
    expect(sessionStore.size).toBe(0);
  });

  it('writes under an owner-scoped key, never the legacy global one', async () => {
    vi.resetModules();
    const { setSessionBuffer } = await import('../sessionBuffer.js');

    setSessionBuffer('user-a', { id: 'e1', text: 'journaled today' }, { mood_score: 0.7 });

    expect(sessionStore.has(LEGACY_KEY)).toBe(false);
    const keys = [...sessionStore.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe(LEGACY_KEY);
    expect(keys[0]).toContain('user-a');
  });

  it('never exposes owner As buffer to owner B', async () => {
    vi.resetModules();
    const { setSessionBuffer, getSessionBuffer } = await import('../sessionBuffer.js');

    setSessionBuffer('user-a', { id: 'e1', text: 'private thought' }, { mood_score: 0.4 });

    expect(getSessionBuffer('user-a')?.recentEntry?.id).toBe('e1');
    expect(getSessionBuffer('user-b')).toBeNull();
  });

  it('an expired buffer is removed on read, not merely ignored', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const { setSessionBuffer, getSessionBuffer } = await import('../sessionBuffer.js');

    setSessionBuffer('user-a', { id: 'e1', text: 'expiring soon' }, { mood_score: 0.5 });
    expect(sessionStore.size).toBe(1);

    vi.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute expiry

    expect(getSessionBuffer('user-a')).toBeNull();
    expect(sessionStore.size).toBe(0);
    vi.useRealTimers();
  });

  it('clearSessionBuffer/hasEntryInBuffer/extendBufferExpiry all no-op without an owner uid', async () => {
    vi.resetModules();
    const { setSessionBuffer, clearSessionBuffer, hasEntryInBuffer, extendBufferExpiry } = await import('../sessionBuffer.js');

    setSessionBuffer('user-a', { id: 'e1', text: 'hi' }, {});
    expect(hasEntryInBuffer(undefined, 'e1')).toBe(false);

    extendBufferExpiry(undefined); // no-op, does not throw
    clearSessionBuffer(undefined); // no-op — user-a's buffer survives
    expect(hasEntryInBuffer('user-a', 'e1')).toBe(true);

    clearSessionBuffer('user-a');
    expect(hasEntryInBuffer('user-a', 'e1')).toBe(false);
  });

  it('sweepLegacyVoiceTranscripts removes only unowned legacy voice_transcript_<sessionId> keys', async () => {
    // Seed two legacy keys and one owned key BEFORE resetting modules,
    // so they're present when the module imports and runs its sweep.
    localStore.set('voice_transcript_session-1', JSON.stringify({ content: 'old transcript 1' }));
    localStore.set('voice_transcript_session-2', JSON.stringify({ content: 'old transcript 2' }));
    // Owned key format: engram:v2:owner:<uid>:voice%2Ftranscript
    localStore.set('engram:v2:owner:user-a:voice%2Ftranscript', JSON.stringify({ sessionId: 'current', content: 'owned transcript' }));

    // Reset modules triggers the sweep at import time
    vi.resetModules();
    await import('../sessionBuffer.js');

    // Legacy keys removed
    expect(localStore.has('voice_transcript_session-1')).toBe(false);
    expect(localStore.has('voice_transcript_session-2')).toBe(false);
    // Owned key untouched
    expect(localStore.has('engram:v2:owner:user-a:voice%2Ftranscript')).toBe(true);
    expect(JSON.parse(localStore.get('engram:v2:owner:user-a:voice%2Ftranscript')).content).toBe('owned transcript');
  });

  it('sweepLegacyVoiceTranscripts is idempotent', async () => {
    // Seed one legacy key
    localStore.set('voice_transcript_session-1', JSON.stringify({ content: 'to remove' }));
    expect(localStore.has('voice_transcript_session-1')).toBe(true);

    // Reset modules triggers the first sweep at import time
    vi.resetModules();
    const { sweepLegacyVoiceTranscripts } = await import('../sessionBuffer.js');
    expect(localStore.has('voice_transcript_session-1')).toBe(false);

    // Second sweep (idempotent) does not throw or fail
    expect(() => sweepLegacyVoiceTranscripts()).not.toThrow();
  });
});
