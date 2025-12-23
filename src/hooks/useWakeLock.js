import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook to keep the device awake during long operations
 *
 * Uses multiple strategies:
 * 1. Wake Lock API (Chrome, Edge) - proper API when available
 * 2. NoSleep video trick (iOS Safari) - plays invisible video to prevent suspension
 *
 * This is critical for iOS Safari which aggressively suspends pages and kills
 * pending network requests when the user switches apps or the screen dims.
 */
export const useWakeLock = () => {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef(null);
  const videoRef = useRef(null);
  const isIOSRef = useRef(false);

  // Detect iOS
  useEffect(() => {
    isIOSRef.current = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }, []);

  // Create a tiny video element for iOS NoSleep trick
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

  // Request wake lock
  const requestWakeLock = useCallback(async () => {
    // Strategy 1: Try Wake Lock API first (works on Chrome, Edge, some Android browsers)
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        setIsLocked(true);

        wakeLockRef.current.addEventListener('release', () => {
          console.log('Wake lock released');
          setIsLocked(false);
        });

        console.log('Wake lock acquired via API');
        return true;
      } catch (err) {
        console.warn('Wake Lock API failed, falling back to video:', err);
      }
    }

    // Strategy 2: iOS Safari - use video playback trick
    if (isIOSRef.current || !('wakeLock' in navigator)) {
      try {
        const video = createNoSleepVideo();
        await video.play();
        setIsLocked(true);
        console.log('Wake lock acquired via video (iOS fallback)');
        return true;
      } catch (err) {
        console.error('Video wake lock failed:', err);
        // On iOS, video might need user gesture - log but continue
        console.log('Note: iOS may require user interaction for video playback');
      }
    }

    console.log('No wake lock mechanism available');
    return false;
  }, [createNoSleepVideo]);

  // Release wake lock
  const releaseWakeLock = useCallback(async () => {
    // Release Wake Lock API
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake lock released (API)');
      } catch (err) {
        console.error('Failed to release wake lock:', err);
      }
    }

    // Stop video playback
    if (videoRef.current) {
      videoRef.current.pause();
      console.log('Wake lock released (video)');
    }

    setIsLocked(false);
  }, []);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isLocked) {
        // Page became visible again, try to re-acquire wake lock
        if (!wakeLockRef.current && !videoRef.current?.paused === false) {
          await requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isLocked, requestWakeLock]);

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
