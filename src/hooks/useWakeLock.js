import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook to manage Screen Wake Lock API
 * Prevents the device from dimming/locking the screen during long operations
 * This helps prevent iOS Safari from killing pending network requests
 */
export const useWakeLock = () => {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockRef = useRef(null);

  // Request wake lock
  const requestWakeLock = useCallback(async () => {
    // Check if Wake Lock API is supported
    if (!('wakeLock' in navigator)) {
      console.log('Wake Lock API not supported');
      return false;
    }

    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      setIsLocked(true);

      // Listen for wake lock release (e.g., when tab becomes hidden)
      wakeLockRef.current.addEventListener('release', () => {
        console.log('Wake lock released');
        setIsLocked(false);
      });

      console.log('Wake lock acquired');
      return true;
    } catch (err) {
      console.error('Failed to acquire wake lock:', err);
      return false;
    }
  }, []);

  // Release wake lock
  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        setIsLocked(false);
        console.log('Wake lock released manually');
      } catch (err) {
        console.error('Failed to release wake lock:', err);
      }
    }
  }, []);

  // Re-acquire wake lock when page becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isLocked && !wakeLockRef.current) {
        // Page became visible again, try to re-acquire wake lock
        await requestWakeLock();
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
    };
  }, []);

  return { isLocked, requestWakeLock, releaseWakeLock };
};
