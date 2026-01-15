/**
 * Offline Store Service
 *
 * Persistent storage for offline entries using Capacitor Preferences.
 * Provides IndexedDB-like API for storing and retrieving entries
 * that haven't been synced to the server yet.
 */

import { Preferences } from '@capacitor/preferences';

const OFFLINE_ENTRIES_KEY = 'offline_entries_queue';
const OFFLINE_METADATA_KEY = 'offline_metadata';

/**
 * Get all offline entries from storage
 * @returns {Promise<Array>} Array of offline entries
 */
export const getOfflineEntries = async () => {
  try {
    const { value } = await Preferences.get({ key: OFFLINE_ENTRIES_KEY });
    if (!value) return [];
    return JSON.parse(value);
  } catch (error) {
    console.error('[OfflineStore] Error reading offline entries:', error);
    return [];
  }
};

/**
 * Save an entry to offline storage
 * @param {Object} entry - Entry to save
 * @returns {Promise<Object>} Saved entry with offline metadata
 */
export const saveOfflineEntry = async (entry) => {
  try {
    const entries = await getOfflineEntries();

    const offlineEntry = {
      ...entry,
      offlineId: entry.offlineId || generateOfflineId(),
      syncStatus: 'pending',
      retryCount: 0,
      createdOfflineAt: new Date().toISOString(),
      lastAttemptAt: null
    };

    entries.push(offlineEntry);

    await Preferences.set({
      key: OFFLINE_ENTRIES_KEY,
      value: JSON.stringify(entries)
    });

    await updateMetadata({ lastSaved: new Date().toISOString() });

    console.log('[OfflineStore] Saved entry:', offlineEntry.offlineId);
    return offlineEntry;
  } catch (error) {
    console.error('[OfflineStore] Error saving offline entry:', error);
    throw error;
  }
};

/**
 * Update an existing offline entry
 * @param {string} offlineId - Offline ID of entry to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated entry or null if not found
 */
export const updateOfflineEntry = async (offlineId, updates) => {
  try {
    const entries = await getOfflineEntries();
    const index = entries.findIndex(e => e.offlineId === offlineId);

    if (index === -1) {
      console.warn('[OfflineStore] Entry not found:', offlineId);
      return null;
    }

    entries[index] = {
      ...entries[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await Preferences.set({
      key: OFFLINE_ENTRIES_KEY,
      value: JSON.stringify(entries)
    });

    return entries[index];
  } catch (error) {
    console.error('[OfflineStore] Error updating offline entry:', error);
    throw error;
  }
};

/**
 * Remove an entry from offline storage (after successful sync)
 * @param {string} offlineId - Offline ID of entry to remove
 * @returns {Promise<boolean>} True if removed, false if not found
 */
export const removeOfflineEntry = async (offlineId) => {
  try {
    const entries = await getOfflineEntries();
    const filtered = entries.filter(e => e.offlineId !== offlineId);

    if (filtered.length === entries.length) {
      return false; // Entry not found
    }

    await Preferences.set({
      key: OFFLINE_ENTRIES_KEY,
      value: JSON.stringify(filtered)
    });

    console.log('[OfflineStore] Removed entry:', offlineId);
    return true;
  } catch (error) {
    console.error('[OfflineStore] Error removing offline entry:', error);
    throw error;
  }
};

/**
 * Get entries that need to be synced
 * @param {Object} options - Filter options
 * @param {number} options.maxRetries - Maximum retry count (default: 3)
 * @returns {Promise<Array>} Entries pending sync
 */
export const getPendingEntries = async ({ maxRetries = 3 } = {}) => {
  const entries = await getOfflineEntries();
  return entries.filter(e =>
    e.syncStatus === 'pending' &&
    e.retryCount < maxRetries
  );
};

/**
 * Get entries that failed to sync
 * @returns {Promise<Array>} Failed entries
 */
export const getFailedEntries = async () => {
  const entries = await getOfflineEntries();
  return entries.filter(e => e.syncStatus === 'failed');
};

/**
 * Mark entry as syncing (in progress)
 * @param {string} offlineId - Offline ID
 * @returns {Promise<Object|null>} Updated entry
 */
export const markSyncing = async (offlineId) => {
  return updateOfflineEntry(offlineId, {
    syncStatus: 'syncing',
    lastAttemptAt: new Date().toISOString()
  });
};

/**
 * Mark entry as synced (success)
 * @param {string} offlineId - Offline ID
 * @param {string} serverId - Server-assigned ID
 * @param {Object} serverAnalysis - Analysis from server
 * @returns {Promise<Object|null>} Updated entry
 */
export const markSynced = async (offlineId, serverId, serverAnalysis = null) => {
  return updateOfflineEntry(offlineId, {
    syncStatus: 'synced',
    serverId,
    serverAnalysis,
    syncedAt: new Date().toISOString()
  });
};

/**
 * Mark entry sync as failed
 * @param {string} offlineId - Offline ID
 * @param {string} error - Error message
 * @returns {Promise<Object|null>} Updated entry
 */
export const markFailed = async (offlineId, error) => {
  const entries = await getOfflineEntries();
  const entry = entries.find(e => e.offlineId === offlineId);

  if (!entry) return null;

  const newRetryCount = (entry.retryCount || 0) + 1;
  const shouldMarkFailed = newRetryCount >= 3;

  return updateOfflineEntry(offlineId, {
    syncStatus: shouldMarkFailed ? 'failed' : 'pending',
    retryCount: newRetryCount,
    lastError: error,
    lastAttemptAt: new Date().toISOString()
  });
};

/**
 * Clear all synced entries from storage
 * @returns {Promise<number>} Number of entries cleared
 */
export const clearSyncedEntries = async () => {
  const entries = await getOfflineEntries();
  const pending = entries.filter(e => e.syncStatus !== 'synced');
  const cleared = entries.length - pending.length;

  await Preferences.set({
    key: OFFLINE_ENTRIES_KEY,
    value: JSON.stringify(pending)
  });

  console.log('[OfflineStore] Cleared', cleared, 'synced entries');
  return cleared;
};

/**
 * Get offline storage metadata
 * @returns {Promise<Object>} Metadata
 */
export const getMetadata = async () => {
  try {
    const { value } = await Preferences.get({ key: OFFLINE_METADATA_KEY });
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

/**
 * Update offline storage metadata
 * @param {Object} updates - Metadata updates
 * @returns {Promise<Object>} Updated metadata
 */
export const updateMetadata = async (updates) => {
  const metadata = await getMetadata();
  const updated = { ...metadata, ...updates };

  await Preferences.set({
    key: OFFLINE_METADATA_KEY,
    value: JSON.stringify(updated)
  });

  return updated;
};

/**
 * Get statistics about offline storage
 * @returns {Promise<Object>} Statistics
 */
export const getStats = async () => {
  const entries = await getOfflineEntries();

  return {
    total: entries.length,
    pending: entries.filter(e => e.syncStatus === 'pending').length,
    syncing: entries.filter(e => e.syncStatus === 'syncing').length,
    synced: entries.filter(e => e.syncStatus === 'synced').length,
    failed: entries.filter(e => e.syncStatus === 'failed').length,
    oldestPending: entries
      .filter(e => e.syncStatus === 'pending')
      .sort((a, b) => new Date(a.createdOfflineAt) - new Date(b.createdOfflineAt))[0]?.createdOfflineAt || null
  };
};

/**
 * Generate unique offline ID
 * @returns {string} UUID-like ID
 */
const generateOfflineId = () => {
  return 'offline_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

/**
 * Clear all offline data (use with caution)
 * @returns {Promise<void>}
 */
export const clearAll = async () => {
  await Preferences.remove({ key: OFFLINE_ENTRIES_KEY });
  await Preferences.remove({ key: OFFLINE_METADATA_KEY });
  console.log('[OfflineStore] Cleared all offline data');
};

export default {
  getOfflineEntries,
  saveOfflineEntry,
  updateOfflineEntry,
  removeOfflineEntry,
  getPendingEntries,
  getFailedEntries,
  markSyncing,
  markSynced,
  markFailed,
  clearSyncedEntries,
  getMetadata,
  updateMetadata,
  getStats,
  clearAll
};
