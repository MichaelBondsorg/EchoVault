/**
 * Offline Services - Main Export
 *
 * Provides offline-first entry management for iOS.
 * Entries are stored locally, analyzed on-device, and synced when online.
 */

export {
  queueEntry,
  syncPendingEntries,
  retryEntry,
  retryAllFailed,
  hasPendingEntries,
  getSyncStatus,
  addSyncListener,
  discardEntry,
  getQueuedEntries
} from './offlineManager';

export {
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
  getStats
} from './offlineStore';
