/**
 * Sync Orchestrator Service
 *
 * Coordinates syncing between local offline storage and Firestore.
 * Handles conflict resolution, batch operations, and maintains
 * consistency between local and server state.
 */

import { Capacitor } from '@capacitor/core';
import { syncPendingEntries, addSyncListener, hasPendingEntries } from '../offline/offlineManager';

// Sync configuration
const SYNC_CONFIG = {
  // Minimum time between syncs (ms)
  debounceDelay: 1000,
  // Maximum entries per batch
  batchSize: 10,
  // Background sync interval when online (ms)
  backgroundInterval: 60000 // 1 minute
};

// State
let isInitialized = false;
let backgroundSyncTimer = null;
let lastSyncAttempt = null;
let onlineStatus = true;

// Callbacks
let saveEntryToServer = null;
let onSyncComplete = null;
let activeOwnerUid = null;

/**
 * Initialize the sync orchestrator
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.saveEntry - Function to save entry to server
 * @param {Function} options.onComplete - Callback when sync completes
 * @returns {Function} Cleanup function
 */
export const initializeSyncOrchestrator = ({ ownerUid, saveEntry, onComplete }) => {
  if (isInitialized) {
    console.warn('[SyncOrchestrator] Already initialized');
    return () => {};
  }

  saveEntryToServer = saveEntry;
  onSyncComplete = onComplete;
  activeOwnerUid = ownerUid;
  isInitialized = true;

  // Listen for sync events
  const unsubscribe = addSyncListener(handleSyncEvent);

  // Start background sync if online
  if (onlineStatus) {
    startBackgroundSync();
  }

  console.log('[SyncOrchestrator] Initialized');

  return () => {
    if (activeOwnerUid === ownerUid) {
      isInitialized = false;
      activeOwnerUid = null;
      saveEntryToServer = null;
      onSyncComplete = null;
      stopBackgroundSync();
    }
    unsubscribe();
    console.log('[SyncOrchestrator] Cleaned up');
  };
};

/**
 * Handle network status changes
 *
 * @param {boolean} isOnline - Current online status
 */
export const handleNetworkChange = async (isOnline) => {
  const wasOffline = !onlineStatus;
  onlineStatus = isOnline;

  console.log('[SyncOrchestrator] Network status changed:', isOnline ? 'online' : 'offline');

  if (isOnline && wasOffline) {
    // Coming back online - trigger sync
    console.log('[SyncOrchestrator] Back online, triggering sync');
    await triggerSync();
    startBackgroundSync();
  } else if (!isOnline) {
    stopBackgroundSync();
  }
};

/**
 * Trigger a sync operation (debounced)
 *
 * @param {Object} options - Sync options
 * @param {boolean} options.force - Force immediate sync
 * @returns {Promise<Object|null>} Sync results or null if debounced
 */
export const triggerSync = async ({ force = false } = {}) => {
  if (!isInitialized || !saveEntryToServer || !activeOwnerUid) {
    console.warn('[SyncOrchestrator] Not initialized or missing saveEntry function');
    return null;
  }

  if (!onlineStatus) {
    console.log('[SyncOrchestrator] Offline, skipping sync');
    return null;
  }

  // Debounce check
  const now = Date.now();
  if (!force && lastSyncAttempt && (now - lastSyncAttempt) < SYNC_CONFIG.debounceDelay) {
    console.log('[SyncOrchestrator] Debounced, skipping sync');
    return null;
  }

  lastSyncAttempt = now;

  // Check if there's anything to sync
  const ownerUid = activeOwnerUid;
  const capturedSave = saveEntryToServer;
  const hasPending = await hasPendingEntries(ownerUid);
  if (!hasPending) {
    console.log('[SyncOrchestrator] No pending entries to sync');
    return { skipped: true, reason: 'no_pending' };
  }

  // Perform sync
  const results = await syncPendingEntries(
    ownerUid,
    (entry) => syncEntryToServer(ownerUid, capturedSave, entry)
  );

  return results;
};

/**
 * Sync a single entry to the server
 *
 * @param {Object} offlineEntry - Offline entry to sync
 * @returns {Promise<Object>} Server response with id and analysis
 */
const syncEntryToServer = async (ownerUid, saveEntry, offlineEntry) => {
  if (!saveEntry) {
    throw new Error('Save function not configured');
  }
  if (offlineEntry.ownerUid !== ownerUid) {
    throw new Error('offline_owner_mismatch');
  }

  console.log('[SyncOrchestrator] Syncing entry:', offlineEntry.offlineId);

  // Transform offline entry to server format
  const entryData = {
    text: offlineEntry.text,
    category: offlineEntry.category,
    transcriptionText: offlineEntry.transcriptionText,
    localAnalysis: offlineEntry.localAnalysis,
    healthContext: offlineEntry.healthContext,
    environmentContext: offlineEntry.environmentContext,
    voiceTone: offlineEntry.voiceTone,
    transcription: offlineEntry.transcription,
    aiProcessingConsent: offlineEntry.aiProcessingConsent !== false,
    safety_flagged: offlineEntry.safety_flagged,
    safety_user_response: offlineEntry.safety_user_response,
    has_warning_indicators: offlineEntry.has_warning_indicators,
    createdAt: offlineEntry.createdAt || offlineEntry.createdOfflineAt,
    effectiveDate: offlineEntry.effectiveDate || offlineEntry.createdAt || offlineEntry.createdOfflineAt,
    // Mark as offline-created for server to handle appropriately
    offlineCreated: true,
    offlineId: offlineEntry.offlineId
  };

  // Call the provided save function
  const result = await saveEntry(entryData);

  return result;
};

/**
 * Handle sync events from the offline manager
 *
 * @param {Object} event - Sync event
 */
const handleSyncEvent = (event) => {
  if (event.ownerUid !== activeOwnerUid) return;
  switch (event.type) {
    case 'sync_completed':
      console.log('[SyncOrchestrator] Sync completed:', event.results);
      if (onSyncComplete) {
        onSyncComplete(event.results);
      }
      break;

    case 'entry_synced':
      console.log('[SyncOrchestrator] Entry synced:', event.entry.offlineId, '→', event.serverResult.id);
      break;

    case 'entry_failed':
      console.error('[SyncOrchestrator] Entry failed:', event.entry.offlineId, event.error);
      break;

    default:
      break;
  }
};

/**
 * Start background sync timer
 */
const startBackgroundSync = () => {
  if (backgroundSyncTimer) return;

  backgroundSyncTimer = setInterval(async () => {
    if (onlineStatus) {
      await triggerSync();
    }
  }, SYNC_CONFIG.backgroundInterval);

  console.log('[SyncOrchestrator] Background sync started');
};

/**
 * Stop background sync timer
 */
const stopBackgroundSync = () => {
  if (backgroundSyncTimer) {
    clearInterval(backgroundSyncTimer);
    backgroundSyncTimer = null;
    console.log('[SyncOrchestrator] Background sync stopped');
  }
};

/**
 * Resolve conflicts between local and server versions
 *
 * Strategy: Server wins for analysis, local wins for user content
 *
 * @param {Object} localEntry - Local entry
 * @param {Object} serverEntry - Server entry
 * @returns {Object} Resolved entry
 */
export const resolveConflict = (localEntry, serverEntry) => {
  // If same content, prefer server analysis
  if (localEntry.text === serverEntry.text) {
    return {
      ...localEntry,
      analysis: serverEntry.analysis,
      serverAnalysis: serverEntry.analysis,
      conflictResolved: true,
      resolution: 'server_analysis'
    };
  }

  // Different content - keep local content but flag for review
  return {
    ...localEntry,
    conflictDetected: true,
    serverVersion: serverEntry,
    resolution: 'local_content_preserved'
  };
};

/**
 * Check if sync is needed based on current state
 *
 * @returns {Promise<boolean>}
 */
export const needsSync = async () => {
  if (!onlineStatus || !activeOwnerUid) return false;
  return await hasPendingEntries(activeOwnerUid);
};

/**
 * Get sync orchestrator status
 *
 * @returns {Object} Status info
 */
export const getOrchestratorStatus = () => {
  return {
    isInitialized,
    isOnline: onlineStatus,
    hasBackgroundSync: !!backgroundSyncTimer,
    lastSyncAttempt: lastSyncAttempt ? new Date(lastSyncAttempt).toISOString() : null,
    ownerUid: activeOwnerUid
  };
};

/**
 * Force an immediate sync (bypass debounce)
 *
 * @returns {Promise<Object>} Sync results
 */
export const forceSync = () => triggerSync({ force: true });

/**
 * Check if running on iOS (native platform)
 *
 * @returns {boolean}
 */
export const isOfflineCapable = () => {
  return Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android';
};

export default {
  initializeSyncOrchestrator,
  handleNetworkChange,
  triggerSync,
  forceSync,
  resolveConflict,
  needsSync,
  getOrchestratorStatus,
  isOfflineCapable
};
