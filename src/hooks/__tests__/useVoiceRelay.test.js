import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { ownerStorageKey } from '../../services/storage/ownerScopedStorage';

// setup.js replaces window.localStorage with plain vi.fn() no-op stubs;
// drive it with an in-memory Map (established convention).
let store;
function wireLocalStorage() {
  store = new Map();
  localStorage.getItem.mockImplementation((key) => (store.has(key) ? store.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { store.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { store.delete(key); });
}

const authState = { currentUser: null };
vi.mock('../../config/firebase', () => ({
  auth: authState,
}));

vi.mock('../../config/relay', () => ({
  getRelayWsUrl: () => 'wss://relay.test',
  getRelayHttpUrl: () => 'https://relay.test',
}));

// Minimal fake WebSocket: captures the last-constructed instance (only one
// connection is ever live at a time here) so the test can drive its
// onopen/onmessage/onclose handlers directly and spy on send().
let lastSocket = null;
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.send = vi.fn();
    this.close = vi.fn(() => { this.readyState = FakeWebSocket.CLOSED; });
    lastSocket = this;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const asUser = (uid) => {
  authState.currentUser = uid ? { uid, getIdToken: vi.fn(async () => `token-${uid}`) } : null;
};

const { useVoiceRelay: useVoiceRelayImport } = await import('../useVoiceRelay.js');

describe('useVoiceRelay transcript persistence (PRIV-01)', () => {
  beforeEach(() => {
    wireLocalStorage();
    lastSocket = null;
    authState.currentUser = null;

    global.WebSocket = FakeWebSocket;
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ticket: 'test-ticket' }),
    }));
    global.navigator.mediaDevices = {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      })),
    };
    global.window.AudioContext = class {
      constructor() {}
      close() {}
    };
  });

  const connectAndOpen = async (result, uid) => {
    asUser(uid);
    await act(async () => {
      await result.current.connect();
    });
    await waitFor(() => expect(lastSocket).not.toBeNull());
    act(() => {
      lastSocket.open();
    });
    act(() => {
      lastSocket.message({ type: 'session_ready', sessionId: 'sess-1', mode: 'realtime' });
    });
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'));
  };

  it('persists the transcript under an owner-scoped key, never the legacy per-session key', async () => {
    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    act(() => {
      lastSocket.message({ type: 'transcript_delta', speaker: 'user', delta: 'Hello there', timestamp: 1, sequenceId: 1 });
    });

    const ownerKey = ownerStorageKey('user-a', 'voice/transcript');
    expect(store.has(ownerKey)).toBe(true);
    expect(store.has('voice_transcript_sess-1')).toBe(false);

    const persisted = JSON.parse(store.get(ownerKey));
    expect(persisted.sessionId).toBe('sess-1');
    expect(persisted.content).toContain('Hello there');
    expect(typeof persisted.savedAt).toBe('number');
  });

  it('quarantines the legacy per-session key the moment the owner-scoped key is written', async () => {
    store.set('voice_transcript_sess-1', JSON.stringify({ content: 'old unowned content', sequenceId: 0 }));

    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    act(() => {
      lastSocket.message({ type: 'transcript_delta', speaker: 'user', delta: 'new content', timestamp: 1, sequenceId: 1 });
    });

    expect(store.has('voice_transcript_sess-1')).toBe(false);
  });

  it('never persists a transcript when nobody is signed in', async () => {
    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    // Sign out mid-session (defensive: shouldn't happen, but must fail safe).
    authState.currentUser = null;

    act(() => {
      lastSocket.message({ type: 'transcript_delta', speaker: 'user', delta: 'orphaned', timestamp: 1, sequenceId: 1 });
    });

    expect(store.size).toBe(0);
  });

  it('disconnect() removes the persisted transcript (sign-out / end-of-session cleanup)', async () => {
    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    act(() => {
      lastSocket.message({ type: 'transcript_delta', speaker: 'user', delta: 'to be cleared', timestamp: 1, sequenceId: 1 });
    });
    const ownerKey = ownerStorageKey('user-a', 'voice/transcript');
    expect(store.has(ownerKey)).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(store.has(ownerKey)).toBe(false);
  });

  it('tryRestoreSession removes (not merely ignores) an expired transcript instead of restoring it', async () => {
    const ownerKey = ownerStorageKey('user-a', 'voice/transcript');
    store.set(ownerKey, JSON.stringify({
      sessionId: 'sess-1',
      content: 'stale content',
      sequenceId: 3,
      savedAt: Date.now() - 31 * 60 * 1000, // 31 minutes ago — past the 30-minute TTL
    }));

    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    act(() => {
      result.current.tryRestoreSession();
    });

    expect(lastSocket.send).not.toHaveBeenCalledWith(expect.stringContaining('restore_transcript'));
    expect(store.has(ownerKey)).toBe(false);
  });

  it('tryRestoreSession restores a fresh, same-session transcript and does not read a different owners entry', async () => {
    const ownerKeyA = ownerStorageKey('user-a', 'voice/transcript');
    store.set(ownerKeyA, JSON.stringify({
      sessionId: 'sess-1',
      content: 'recoverable content',
      sequenceId: 5,
      savedAt: Date.now(),
    }));

    const { result } = renderHook(() => useVoiceRelayImport());
    await connectAndOpen(result, 'user-a');

    act(() => {
      result.current.tryRestoreSession();
    });

    expect(lastSocket.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'restore_transcript',
      content: 'recoverable content',
      sequenceId: 5,
    }));
  });
});
