/**
 * Entry Processor Hook
 *
 * Provides platform-aware entry processing with local analysis
 * and offline support. Designed to integrate with existing
 * App.jsx entry save flow with minimal changes.
 *
 * Usage in App.jsx:
 *
 * const { processAndSaveEntry, isLocalAnalysisEnabled } = useEntryProcessor({
 *   serverSave: existingSaveFunction,
 *   isOnline
 * });
 *
 * // In doSaveEntry function:
 * const result = await processAndSaveEntry(entryData);
 */

import { useCallback, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { processEntry, performLocalAnalysis, isLocalAnalysisAvailable } from '../services/entries/entryProcessor';
import { queueEntry, hasPendingEntries } from '../services/offline/offlineManager';
import { initializeSyncOrchestrator, isOfflineCapable } from '../services/sync/syncOrchestrator';

/**
 * Hook for platform-aware entry processing
 *
 * @param {Object} options - Hook options
 * @param {Function} options.serverSave - Server save function (existing doSaveEntry logic)
 * @param {boolean} options.isOnline - Current network status
 * @param {Function} options.onLocalAnalysisComplete - Callback when local analysis is done
 * @param {Function} options.onSyncComplete - Callback when sync completes
 * @returns {Object} Entry processor interface
 */
export const useEntryProcessor = ({
  serverSave,
  isOnline = true,
  onLocalAnalysisComplete,
  onSyncComplete
} = {}) => {
  const platform = Capacitor.getPlatform();
  const isNative = isOfflineCapable();

  /**
   * Process and save an entry with platform-aware optimization
   *
   * On iOS:
   * - Performs local analysis for immediate feedback (<200ms)
   * - If online, also sends to server for enhanced analysis
   * - If offline, queues for later sync
   *
   * On Web:
   * - Uses server analysis directly
   *
   * @param {Object} entryData - Entry data
   * @returns {Promise<Object>} Processing result
   */
  const processAndSaveEntry = useCallback(async (entryData) => {
    console.log('[useEntryProcessor] Processing entry on', platform, 'online:', isOnline);

    const startTime = performance.now();

    // Determine text to analyze
    const textToAnalyze = entryData.transcriptionText || entryData.text;

    if (!textToAnalyze || textToAnalyze.trim().length === 0) {
      throw new Error('Entry text is required');
    }

    // NATIVE PLATFORM (iOS/Android): Use local analysis
    if (isNative) {
      // Always do local analysis first for immediate feedback
      const localAnalysis = await performLocalAnalysis(textToAnalyze, {
        voiceTone: entryData.voiceTone
      });

      const localTime = performance.now() - startTime;
      console.log('[useEntryProcessor] Local analysis completed in', localTime.toFixed(0), 'ms');

      // Notify of local analysis (for UI update)
      if (onLocalAnalysisComplete) {
        onLocalAnalysisComplete(localAnalysis);
      }

      // If offline: queue for later
      if (!isOnline) {
        console.log('[useEntryProcessor] Offline - queuing entry');

        const queuedEntry = await queueEntry({
          ...entryData,
          localAnalysis,
          platform
        });

        return {
          id: queuedEntry.offlineId,
          ...entryData,
          analysis: localAnalysis,
          source: 'local',
          isOffline: true,
          needsServerSync: true,
          processingTimeMs: Math.round(performance.now() - startTime)
        };
      }

      // Online: try server save with local as fallback
      if (serverSave) {
        try {
          const serverResult = await serverSave({
            ...entryData,
            // Include local analysis as hint (server can use or ignore)
            localAnalysisHint: localAnalysis
          });

          // Merge local + server analysis
          const mergedAnalysis = {
            ...serverResult.analysis,
            // Keep local for comparison
            local_entry_type: localAnalysis.entry_type,
            local_mood_score: localAnalysis.mood_score,
            local_analysis_time_ms: localAnalysis.local_analysis_time_ms
          };

          return {
            id: serverResult.id,
            ...entryData,
            analysis: mergedAnalysis,
            source: 'merged',
            needsServerSync: false,
            processingTimeMs: Math.round(performance.now() - startTime)
          };

        } catch (error) {
          console.warn('[useEntryProcessor] Server save failed, using local:', error);

          // Queue for retry
          const queuedEntry = await queueEntry({
            ...entryData,
            localAnalysis,
            platform
          });

          return {
            id: queuedEntry.offlineId,
            ...entryData,
            analysis: localAnalysis,
            source: 'local',
            serverError: error.message,
            needsServerSync: true,
            processingTimeMs: Math.round(performance.now() - startTime)
          };
        }
      }

      // No server function - just use local
      return {
        ...entryData,
        analysis: localAnalysis,
        source: 'local',
        processingTimeMs: Math.round(performance.now() - startTime)
      };
    }

    // WEB PLATFORM: Use server directly
    if (!serverSave) {
      throw new Error('Server save function required for web platform');
    }

    const serverResult = await serverSave(entryData);

    return {
      id: serverResult.id,
      ...entryData,
      analysis: serverResult.analysis,
      source: 'server',
      needsServerSync: false,
      processingTimeMs: Math.round(performance.now() - startTime)
    };

  }, [platform, isNative, isOnline, serverSave, onLocalAnalysisComplete]);

  /**
   * Get local analysis only (for preview/immediate feedback)
   *
   * @param {string} text - Text to analyze
   * @param {Object} options - Options
   * @returns {Promise<Object>} Local analysis result
   */
  const getLocalAnalysis = useCallback(async (text, options = {}) => {
    if (!isNative) {
      return null; // Not available on web
    }
    return performLocalAnalysis(text, options);
  }, [isNative]);

  /**
   * Check if there are entries pending sync
   *
   * @returns {Promise<boolean>}
   */
  const checkPendingSync = useCallback(async () => {
    return hasPendingEntries();
  }, []);

  // Processing strategy info
  const processingStrategy = useMemo(() => {
    if (isNative && !isOnline) {
      return {
        mode: 'offline',
        description: 'Entries saved locally, will sync when online',
        expectedLatency: '<200ms'
      };
    }
    if (isNative && isOnline) {
      return {
        mode: 'hybrid',
        description: 'Local analysis for speed, server for depth',
        expectedLatency: '<200ms local, ~3s total'
      };
    }
    return {
      mode: 'server',
      description: 'Server analysis required',
      expectedLatency: '~3-5s'
    };
  }, [isNative, isOnline]);

  return {
    // Main function
    processAndSaveEntry,

    // Utilities
    getLocalAnalysis,
    checkPendingSync,

    // Status
    isLocalAnalysisEnabled: isNative,
    isOfflineCapable: isNative,
    processingStrategy,
    platform
  };
};

export default useEntryProcessor;
