import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to track network/online status
 * @returns {Object} Network status info
 */
export const useNetworkStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Small delay to allow network to stabilize
      setTimeout(() => {
        setWasOffline(true);
      }, 100);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Reset wasOffline flag after it's been consumed
  const clearWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  return {
    isOnline,
    wasOffline,
    clearWasOffline
  };
};

export default useNetworkStatus;
