import { useState, useEffect, useCallback, useRef } from 'react';
import { handleNetworkChange, triggerSync } from '../services/sync/syncOrchestrator';
import { hasPendingEntries, addSyncListener } from '../services/offline/offlineManager';

/**
 * Hook to track network/online status with sync integration
 *
 * Features:
 * - Tracks online/offline state
 * - Triggers sync when coming back online
 * - Tracks pending entries count
 * - Provides sync status
 *
 * @param {Object} options - Hook options
 * @param {boolean} options.autoSync - Auto-sync when coming online (default: true)
 * @returns {Object} Network status info
 */
export const useNetworkStatus = ({ autoSync = true } = {}) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  const isMounted = useRef(true);

  // Check for pending entries on mount and periodically
  useEffect(() => {
    const checkPending = async () => {
      try {
        const { hasPendingEntries: check } = await import('../services/offline/offlineManager');
        const stats = await import('../services/offline/offlineStore').then(m => m.getStats());
        if (isMounted.current) {
          setPendingCount(stats.pending + stats.failed);
        }
      } catch (error) {
        console.warn('[useNetworkStatus] Error checking pending:', error);
      }
    };

    checkPending();

    // Check every 30 seconds
    const interval = setInterval(checkPending, 30000);

    return () => {
      isMounted.current = false;
      clearInterval(interval);
    };
  }, []);

  // Listen for sync events
  useEffect(() => {
    const unsubscribe = addSyncListener((event) => {
      if (!isMounted.current) return;

      switch (event.type) {
        case 'sync_started':
          setIsSyncing(true);
          break;
        case 'sync_completed':
          setIsSyncing(false);
          setLastSyncResult(event.results);
          // Update pending count
          import('../services/offline/offlineStore').then(m => m.getStats()).then(stats => {
            if (isMounted.current) {
              setPendingCount(stats.pending + stats.failed);
            }
          });
          break;
        case 'queued':
          setPendingCount(prev => prev + 1);
          break;
        case 'entry_synced':
          setPendingCount(prev => Math.max(0, prev - 1));
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  // Handle network status changes
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);

      // Notify sync orchestrator
      handleNetworkChange(true);

      // Small delay to allow network to stabilize
      setTimeout(() => {
        if (isMounted.current) {
          setWasOffline(true);
        }
      }, 100);

      // Auto-sync if enabled
      if (autoSync) {
        setTimeout(async () => {
          try {
            await triggerSync();
          } catch (error) {
            console.warn('[useNetworkStatus] Auto-sync failed:', error);
          }
        }, 500);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setWasOffline(false);

      // Notify sync orchestrator
      handleNetworkChange(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [autoSync]);

  // Reset wasOffline flag after it's been consumed
  const clearWasOffline = useCallback(() => {
    setWasOffline(false);
  }, []);

  // Manual sync trigger
  const manualSync = useCallback(async () => {
    if (!isOnline || isSyncing) return null;

    try {
      const result = await triggerSync({ force: true });
      return result;
    } catch (error) {
      console.error('[useNetworkStatus] Manual sync failed:', error);
      return { error: error.message };
    }
  }, [isOnline, isSyncing]);

  return {
    // Basic status
    isOnline,
    wasOffline,
    clearWasOffline,

    // Sync status
    isSyncing,
    pendingCount,
    hasPending: pendingCount > 0,
    lastSyncResult,

    // Actions
    manualSync
  };
};

export default useNetworkStatus;
