import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook to keep the device awake during long operations (CAP-02).
 *
 * Uses two strategies:
 * 1. Screen Wake Lock API (Chrome, Edge, some Android browsers) — the real
 *    API, and the ONLY strategy the spec allows to be (re)requested outside
 *    a user gesture (e.g. from a `visibilitychange` handler).
 * 2. NoSleep video trick (iOS Safari, and any other browser without the
 *    Wake Lock API) — plays a tiny invisible looping video to prevent
 *    suspension. Browsers that require user-activation for media playback
 *    (iOS Safari in particular) will silently no-op `video.play()` if it is
 *    not the direct result of a user gesture, so the video element is only
 *    ever CREATED and first played from `requestWakeLock()` itself — the
 *    function callers invoke directly from a click/tap handler. Once
 *    created, that same element is reused (never recreated) by later
 *    reacquire attempts.
 *
 * State-machine shape (the CAP-02 fix): `shouldStayAwakeRef` is the DESIRED
 * state — true from the moment a caller asks for the lock until it
 * explicitly releases it — tracked separately from `wakeLockRef`/`videoRef`,
 * which represent the CURRENT lock handle(s). The single conflated
 * `isLocked` boolean this hook used to expose as both couldn't tell "the
 * operation is still active but the OS silently dropped the lock" apart
 * from "the operation ended" — that distinction is exactly what the
 * `visibilitychange` reacquire needs: it must reacquire only while
 * `shouldStayAwakeRef.current` is true (an operation still wants the
 * screen kept on), and must never reacquire once `releaseWakeLock()` has
 * run. `isLocked` remains exposed as the CURRENT (not desired) lock state,
 * for any caller that wants to render lock status.
 */
export const useWakeLock = () => {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef(null); // Screen Wake Lock API sentinel, or null.
  const videoRef = useRef(null); // NoSleep video element, created lazily — ONLY inside a gesture-initiated requestWakeLock() call. Never created from the visibility-reacquire path.
  // Desired state — true while some caller wants the device kept awake, set
  // by requestWakeLock() and cleared by releaseWakeLock(). A ref (not
  // state): the visibilitychange listener reads the latest value without
  // needing to re-subscribe on every acquire/release.
  const shouldStayAwakeRef = useRef(false);

  // Create a tiny video element for iOS NoSleep trick. Idempotent — returns
  // the existing element if one was already created, so this never produces
  // a second <video> even if called again.
  const createNoSleepVideo = useCallback(() => {
    if (videoRef.current) return videoRef.current;

    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.loop = true;

    // Tiny 1-second silent video encoded as base64 data URI
    // This is a minimal valid MP4 that iOS will "play" to keep the page active
    video.src = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAs1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjYwMSBhMGNkN2QzIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAxNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTI1IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAQZYiEAD//8m+P5OXfBeLGOfKE3xkODvFZuBflHvnBAAAAAwBAAAADAAADAAADAAAHgTZpAB8H4kAAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAMAJ4C14oQJ/wAAHxU2RU0A8H4QAAAHAAAMAAADAAADAAADAAADAAADAAADAAADAAAJYC14oQIfAAAPiptioIB+P/AAAAcAAAMAAAMAAAMAAAMAAAMAAAMAAAMAAAkwLXihAh8AAA+Km2KggH4/4AAAAcAAAMAAAMAAAMAAAMAAAMAAAMAAAMACTAteKECHwAAD4qbYqCAfj/gAAABwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAJMC14oQIfAAAPiptioIB+P+AAAAHAAADAAADAAADAAADAAADAAADAAADAEg==';

    video.style.cssText = 'position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    videoRef.current = video;
    return video;
  }, []);

  // Try (or retry) the real Screen Wake Lock API only. Safe to call from
  // outside a user gesture — that's the whole point of the API. Idempotent:
  // a no-op (returns true without re-requesting) if a sentinel is already
  // held, so a second caller (e.g. handleAudioWrapper acquiring again once
  // processing starts, after EntryBar already acquired at recording start)
  // never orphans an earlier sentinel.
  const acquireApiLock = useCallback(async () => {
    if (wakeLockRef.current) return true;
    if (!('wakeLock' in navigator)) return false;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockRef.current = sentinel;
      sentinel.addEventListener('release', () => {
        // The OS/browser can release the sentinel out from under us (tab
        // backgrounded, battery saver, etc.) without releaseWakeLock() ever
        // running — shouldStayAwakeRef is deliberately left untouched here
        // so a later visibilitychange reacquire can still fire.
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        setIsLocked(Boolean(videoRef.current && !videoRef.current.paused));
      });
      setIsLocked(true);
      console.log('Wake lock acquired via API');
      return true;
    } catch (err) {
      console.warn('Wake Lock API failed:', err);
      wakeLockRef.current = null;
      return false;
    }
  }, []);

  // Play the NoSleep video. `allowCreate` gates whether this call is allowed
  // to CREATE the element (only true from the gesture-initiated
  // requestWakeLock() path) — the visibility-reacquire path passes false so
  // it only ever resumes an element that a prior gesture already created,
  // never conjuring a fresh `<video>` (and therefore a fresh, gesture-less
  // `.play()`) out of a background callback.
  const playVideoFallback = useCallback(async (allowCreate) => {
    let video = videoRef.current;
    if (!video) {
      if (!allowCreate) return false;
      video = createNoSleepVideo();
    }
    try {
      await video.play();
      setIsLocked(true);
      console.log('Wake lock acquired via video (iOS fallback)');
      return true;
    } catch (err) {
      console.warn('Video wake lock play failed:', err);
      return false;
    }
  }, [createNoSleepVideo]);

  // Request wake lock — the gesture-initiated entry point. Callers MUST
  // invoke this directly from a user gesture (click/tap handler), not after
  // intervening awaits, because it is the only place allowed to create +
  // play the NoSleep video fallback.
  const requestWakeLock = useCallback(async () => {
    shouldStayAwakeRef.current = true;

    const apiOk = await acquireApiLock();
    if (apiOk) return true;

    const videoOk = await playVideoFallback(/* allowCreate */ true);
    if (videoOk) return true;

    console.log('No wake lock mechanism available');
    return false;
  }, [acquireApiLock, playVideoFallback]);

  // Release wake lock — clears desired state, so no later visibilitychange
  // reacquires on behalf of an operation that has already ended.
  const releaseWakeLock = useCallback(async () => {
    shouldStayAwakeRef.current = false;

    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        console.log('Wake lock released (API)');
      } catch (err) {
        console.error('Failed to release wake lock:', err);
      }
      wakeLockRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      console.log('Wake lock released (video)');
    }

    setIsLocked(false);
  }, []);

  // Re-acquire on visibility change — ONLY while the operation is still
  // active (shouldStayAwakeRef.current), and ONLY via the Wake Lock API or
  // the already-created video element — never creates a new video here.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      if (!shouldStayAwakeRef.current) return;

      const apiOk = await acquireApiLock();
      if (apiOk) return;

      await playVideoFallback(/* allowCreate */ false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [acquireApiLock, playVideoFallback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.remove();
      }
    };
  }, []);

  return { isLocked, requestWakeLock, releaseWakeLock };
};
