/**
 * useWakeLock state-machine tests (CAP-02).
 *
 * Covers the review's required fix: `shouldStayAwake` (desired) tracked
 * separately from the current lock handle; visibility-reacquire fires only
 * while the operation is still active; the video fallback is only ever
 * CREATED from a gesture-initiated requestWakeLock() call, never from the
 * visibilitychange handler (gesture-safety).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWakeLock } from '../useWakeLock';

const fireVisibilityChange = (state) => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useWakeLock (CAP-02)', () => {
  let sentinels;

  beforeEach(() => {
    sentinels = [];
    // jsdom doesn't implement real media playback, and `paused` is a
    // getter-only property on the real prototype — replace all three with a
    // small in-memory implementation so the video-fallback path is
    // deterministic instead of hitting jsdom's "Not implemented" warning.
    const pausedState = new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get() { return pausedState.get(this) ?? true; },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
      pausedState.set(this, false);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
      pausedState.set(this, true);
    });
  });

  afterEach(() => {
    delete navigator.wakeLock;
    document.querySelectorAll('video').forEach((v) => v.remove());
    // Deliberately not vi.restoreAllMocks() here: the play/pause spies must
    // stay installed through React's own unmount-cleanup pass (which also
    // runs after this file's afterEach registers), or the real jsdom
    // HTMLMediaElement.pause() (unimplemented) fires instead. Each test's
    // beforeEach reinstalls fresh spies anyway.
  });

  const installWakeLockApi = ({ rejectOnce = false } = {}) => {
    let calls = 0;
    navigator.wakeLock = {
      request: vi.fn(async () => {
        calls += 1;
        if (rejectOnce && calls === 1) throw new Error('denied');
        const listeners = {};
        const sentinel = {
          released: false,
          addEventListener: (evt, cb) => { listeners[evt] = cb; },
          release: vi.fn(async () => {
            sentinel.released = true;
            listeners.release?.();
          }),
          __emitRelease: () => listeners.release?.(),
        };
        sentinels.push(sentinel);
        return sentinel;
      }),
    };
  };

  it('acquire-at-start: requestWakeLock acquires the Screen Wake Lock API sentinel and reports locked', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    let acquired;
    await act(async () => {
      acquired = await result.current.requestWakeLock();
    });

    expect(acquired).toBe(true);
    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen');
    expect(result.current.isLocked).toBe(true);
  });

  it('release: releaseWakeLock releases the sentinel and reports unlocked', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => { await result.current.requestWakeLock(); });
    expect(result.current.isLocked).toBe(true);

    await act(async () => { await result.current.releaseWakeLock(); });

    expect(result.current.isLocked).toBe(false);
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('requestWakeLock is idempotent: a second call while already locked does not request a second sentinel (no orphaned lock)', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => { await result.current.requestWakeLock(); });
    await act(async () => { await result.current.requestWakeLock(); });

    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('visibility-reacquire only-while-active: a browser-dropped sentinel is reacquired on visibilitychange while the operation is still active', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => { await result.current.requestWakeLock(); });
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);

    // Browser silently drops the lock (tab backgrounded) without
    // releaseWakeLock() ever running.
    await act(async () => { sentinels[0].__emitRelease(); });
    expect(result.current.isLocked).toBe(false);

    await act(async () => { fireVisibilityChange('visible'); });

    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(result.current.isLocked).toBe(true);
  });

  it('visibility-reacquire only-while-active: does NOT reacquire once releaseWakeLock has ended the operation', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => { await result.current.requestWakeLock(); });
    await act(async () => { await result.current.releaseWakeLock(); });
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);

    await act(async () => { fireVisibilityChange('visible'); });

    // No reacquire — the operation already ended.
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);
    expect(result.current.isLocked).toBe(false);
  });

  it('visibility-reacquire ignores non-visible transitions', async () => {
    installWakeLockApi();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => { await result.current.requestWakeLock(); });
    await act(async () => { sentinels[0].__emitRelease(); });

    await act(async () => { fireVisibilityChange('hidden'); });

    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  describe('gesture-safety (no Wake Lock API — video fallback)', () => {
    it('requestWakeLock (the gesture-initiated call) creates and plays the NoSleep video', async () => {
      const { result } = renderHook(() => useWakeLock());

      let acquired;
      await act(async () => {
        acquired = await result.current.requestWakeLock();
      });

      expect(acquired).toBe(true);
      const video = document.querySelector('video');
      expect(video).toBeTruthy();
      expect(video.paused).toBe(false);
      expect(result.current.isLocked).toBe(true);
    });

    it('visibility-reacquire never CREATES a video element — only resumes one an earlier gesture already created', async () => {
      const { result } = renderHook(() => useWakeLock());

      await act(async () => { await result.current.requestWakeLock(); });
      const video = document.querySelector('video');
      expect(video).toBeTruthy();

      video.pause(); // simulate the browser pausing playback
      await act(async () => { fireVisibilityChange('visible'); });

      // Still exactly one video element — never recreated.
      expect(document.querySelectorAll('video').length).toBe(1);
      expect(document.querySelector('video')).toBe(video);
    });

    it('visibility-reacquire never creates a video element if requestWakeLock was never called from a gesture in the first place', async () => {
      renderHook(() => useWakeLock());

      // No requestWakeLock() call at all — shouldStayAwake is false, so a
      // stray visibilitychange event must be a complete no-op.
      await act(async () => { fireVisibilityChange('visible'); });

      expect(document.querySelector('video')).toBeNull();
    });

    it('falls back to video when the Wake Lock API request rejects', async () => {
      installWakeLockApi({ rejectOnce: true });
      const { result } = renderHook(() => useWakeLock());

      let acquired;
      await act(async () => {
        acquired = await result.current.requestWakeLock();
      });

      expect(acquired).toBe(true);
      expect(document.querySelector('video')).toBeTruthy();
    });
  });
});
