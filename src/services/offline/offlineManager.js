/**
 * Offline Manager Service
 *
 * Manages offline entry queue, handles retry logic with exponential backoff,
 * and coordinates sync operations. This is the primary interface for
 * offline-first entry creation.
 */

import {
  saveOfflineEntry,
  getPendingEntries,
  getFailedEntries,
  markSyncing,
  markSynced,
  markFailed,
  removeOfflineEntry,
  clearSyncedEntries,
  getStats
} from './offlineStore';

// Sync state
let isSyncing = false;
let syncListeners = [];

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,      // 2 seconds
  maxDelay: 30000,      // 30 seconds
  backoffMultiplier: 2  // Exponential backoff
};

/**
 * Queue an entry for offline storage and eventual sync
 *
 * @param {Object} entryData - Entry data to queue
 * @param {string} entryData.text - Entry text content
 * @param {Object} entryData.localAnalysis - Local analysis results
 * @param {Object} entryData.healthContext - Health context data
 * @param {Object} entryData.environmentContext - Environment data
 * @returns {Promise<Object>} Queued entry with offline metadata
 */
export const queueEntry = async (entryData) => {
  console.log('[OfflineManager] Queueing entry for offline storage');

  const entry = await saveOfflineEntry({
    text: entryData.text,
    transcriptionText: entryData.transcriptionText || null,
    localAnalysis: entryData.localAnalysis || null,
    healthContext: entryData.healthContext || null,
    environmentContext: entryData.environmentContext || null,
    voiceTone: entryData.voiceTone || null,
    createdAt: entryData.createdAt || new Date().toISOString(),
    platform: entryData.platform || 'unknown'
  });

  // Notify listeners of queue change
  notifyListeners({ type: 'queued', entry });

  return entry;
};

/**
 * Attempt to sync all pending entries
 *
 * @param {Function} syncFn - Function to call for each entry sync
 * @param {Object} options - Sync options
 * @param {boolean} options.force - Force sync even if already syncing
 * @returns {Promise<Object>} Sync results
 */
export const syncPendingEntries = async (syncFn, { force = false } = {}) => {
  if (isSyncing && !force) {
    console.log('[OfflineManager] Sync already in progress, skipping');
    return { skipped: true, reason: 'already_syncing' };
  }

  isSyncing = true;
  notifyListeners({ type: 'sync_started' });

  const results = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    entries: []
  };

  try {
    const pending = await getPendingEntries({ maxRetries: RETRY_CONFIG.maxRetries });
    console.log('[OfflineManager] Found', pending.length, 'pending entries to sync');

    for (const entry of pending) {
      results.attempted++;

      try {
        await markSyncing(entry.offlineId);

        // Call the provided sync function
        const serverResult = await syncFn(entry);

        if (serverResult && serverResult.id) {
          await markSynced(entry.offlineId, serverResult.id, serverResult.analysis);
          results.succeeded++;
          results.entries.push({
            offlineId: entry.offlineId,
            serverId: serverResult.id,
            status: 'synced'
          });
          notifyListeners({ type: 'entry_synced', entry, serverResult });
        } else {
          throw new Error('Invalid server response - missing ID');
        }

      } catch (error) {
        console.error('[OfflineManager] Sync failed for entry:', entry.offlineId, error);
        await markFailed(entry.offlineId, error.message);
        results.failed++;
        results.entries.push({
          offlineId: entry.offlineId,
          status: 'failed',
          error: error.message
        });
        notifyListeners({ type: 'entry_failed', entry, error });

        // Add delay before next attempt (exponential backoff)
        const delay = calculateBackoffDelay(entry.retryCount || 0);
        await sleep(delay);
      }
    }

    // Clean up successfully synced entries
    if (results.succeeded > 0) {
      await clearSyncedEntries();
    }

  } finally {
    isSyncing = false;
    notifyListeners({ type: 'sync_completed', results });
  }

  console.log('[OfflineManager] Sync completed:', results);
  return results;
};

/**
 * Retry a specific failed entry
 *
 * @param {string} offlineId - Offline ID of entry to retry
 * @param {Function} syncFn - Sync function
 * @returns {Promise<Object>} Retry result
 */
export const retryEntry = async (offlineId, syncFn) => {
  const failed = await getFailedEntries();
  const entry = failed.find(e => e.offlineId === offlineId);

  if (!entry) {
    return { success: false, reason: 'not_found' };
  }

  // Reset retry count and status
  await markSyncing(offlineId);

  try {
    const serverResult = await syncFn(entry);

    if (serverResult && serverResult.id) {
      await markSynced(offlineId, serverResult.id, serverResult.analysis);
      notifyListeners({ type: 'entry_synced', entry, serverResult });
      return { success: true, serverId: serverResult.id };
    } else {
      throw new Error('Invalid server response');
    }
  } catch (error) {
    await markFailed(offlineId, error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Retry all failed entries
 *
 * @param {Function} syncFn - Sync function
 * @returns {Promise<Object>} Retry results
 */
export const retryAllFailed = async (syncFn) => {
  const failed = await getFailedEntries();
  const results = { attempted: failed.length, succeeded: 0, failed: 0 };

  for (const entry of failed) {
    const result = await retryEntry(entry.offlineId, syncFn);
    if (result.success) {
      results.succeeded++;
    } else {
      results.failed++;
    }
  }

  return results;
};

/**
 * Check if there are entries pending sync
 * @returns {Promise<boolean>}
 */
export const hasPendingEntries = async () => {
  const pending = await getPendingEntries();
  return pending.length > 0;
};

/**
 * Get current sync status
 * @returns {Promise<Object>} Sync status
 */
export const getSyncStatus = async () => {
  const stats = await getStats();
  return {
    isSyncing,
    ...stats
  };
};

/**
 * Add a sync event listener
 *
 * @param {Function} listener - Callback function
 * @returns {Function} Unsubscribe function
 */
export const addSyncListener = (listener) => {
  syncListeners.push(listener);
  return () => {
    syncListeners = syncListeners.filter(l => l !== listener);
  };
};

/**
 * Notify all listeners of sync events
 * @param {Object} event - Event data
 */
const notifyListeners = (event) => {
  syncListeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.error('[OfflineManager] Listener error:', error);
    }
  });
};

/**
 * Calculate exponential backoff delay
 *
 * @param {number} retryCount - Current retry count
 * @returns {number} Delay in milliseconds
 */
const calculateBackoffDelay = (retryCount) => {
  const delay = Math.min(
    RETRY_CONFIG.baseDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount),
    RETRY_CONFIG.maxDelay
  );
  // Add jitter (0-25% random variation)
  const jitter = delay * Math.random() * 0.25;
  return Math.round(delay + jitter);
};

/**
 * Sleep helper
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Discard a failed entry (user action)
 *
 * @param {string} offlineId - Offline ID of entry to discard
 * @returns {Promise<boolean>} True if discarded
 */
export const discardEntry = async (offlineId) => {
  const removed = await removeOfflineEntry(offlineId);
  if (removed) {
    notifyListeners({ type: 'entry_discarded', offlineId });
  }
  return removed;
};

/**
 * Get all entries that are currently queued (for UI display)
 * @returns {Promise<Array>} All offline entries
 */
export const getQueuedEntries = async () => {
  const pending = await getPendingEntries();
  const failed = await getFailedEntries();
  return [...pending, ...failed].sort((a, b) =>
    new Date(b.createdOfflineAt) - new Date(a.createdOfflineAt)
  );
};

export default {
  queueEntry,
  syncPendingEntries,
  retryEntry,
  retryAllFailed,
  hasPendingEntries,
  getSyncStatus,
  addSyncListener,
  discardEntry,
  getQueuedEntries
};
