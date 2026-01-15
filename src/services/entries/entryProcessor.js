/**
 * Entry Processor Service
 *
 * Platform-aware entry processing pipeline.
 * On iOS: Uses local analysis for immediate feedback, queues for sync
 * On Web: Uses server analysis directly
 *
 * This service is the main entry point for creating journal entries
 * across all platforms with consistent behavior.
 */

import { Capacitor } from '@capacitor/core';
import { queueEntry } from '../offline/offlineManager';
import { triggerSync, isOfflineCapable } from '../sync/syncOrchestrator';

// Import local analysis services (will be created next)
// These are lazy-loaded to avoid blocking initial load
let localClassifier = null;
let localSentiment = null;

/**
 * Process a new journal entry
 *
 * This is the main function that should be called when a user
 * creates a new journal entry. It handles platform detection,
 * local vs server analysis routing, and offline queuing.
 *
 * @param {Object} entryData - Entry data
 * @param {string} entryData.text - Entry text content
 * @param {string} entryData.transcriptionText - Voice transcription (optional)
 * @param {Object} entryData.voiceTone - Voice tone analysis (optional)
 * @param {Object} entryData.healthContext - Health data (optional)
 * @param {Object} entryData.environmentContext - Location/time data (optional)
 * @param {Object} options - Processing options
 * @param {boolean} options.isOnline - Current network status
 * @param {Function} options.serverAnalyze - Server analysis function
 * @param {Function} options.serverSave - Server save function
 * @returns {Promise<Object>} Processed entry
 */
export const processEntry = async (entryData, options = {}) => {
  const {
    isOnline = true,
    serverAnalyze,
    serverSave
  } = options;

  const platform = Capacitor.getPlatform();
  const isNative = isOfflineCapable();

  console.log('[EntryProcessor] Processing entry on platform:', platform, 'online:', isOnline);

  const startTime = performance.now();

  // Get text for analysis
  const textToAnalyze = entryData.transcriptionText || entryData.text;

  if (!textToAnalyze || textToAnalyze.trim().length === 0) {
    throw new Error('Entry text is required');
  }

  // Prepare base entry
  const baseEntry = {
    text: entryData.text,
    transcriptionText: entryData.transcriptionText || null,
    healthContext: entryData.healthContext || null,
    environmentContext: entryData.environmentContext || null,
    voiceTone: entryData.voiceTone || null,
    createdAt: new Date().toISOString(),
    platform
  };

  // NATIVE + OFFLINE: Local analysis + queue for sync
  if (isNative && !isOnline) {
    console.log('[EntryProcessor] Offline mode - using local analysis');
    const localAnalysis = await performLocalAnalysis(textToAnalyze);

    const queuedEntry = await queueEntry({
      ...baseEntry,
      localAnalysis
    });

    const processingTime = performance.now() - startTime;
    console.log('[EntryProcessor] Offline processing completed in', processingTime.toFixed(0), 'ms');

    return {
      ...queuedEntry,
      analysis: localAnalysis,
      source: 'local',
      processingTime,
      needsServerSync: true
    };
  }

  // NATIVE + ONLINE: Local analysis for immediate feedback, then server
  if (isNative && isOnline) {
    console.log('[EntryProcessor] Native online - local analysis with server enhancement');

    // Start local analysis immediately (non-blocking)
    const localAnalysisPromise = performLocalAnalysis(textToAnalyze);

    // Start server save/analysis (may take longer)
    let serverResult = null;
    let serverError = null;

    if (serverSave) {
      try {
        serverResult = await serverSave({
          ...baseEntry,
          // Include local analysis as fallback hint
          localAnalysisHint: await localAnalysisPromise
        });
      } catch (error) {
        console.error('[EntryProcessor] Server save failed:', error);
        serverError = error;
      }
    }

    const localAnalysis = await localAnalysisPromise;

    // If server failed, queue for later sync
    if (serverError || !serverResult) {
      console.log('[EntryProcessor] Server failed, queuing for later sync');
      const queuedEntry = await queueEntry({
        ...baseEntry,
        localAnalysis
      });

      // Try to sync in background
      triggerSync().catch(console.error);

      return {
        ...queuedEntry,
        analysis: localAnalysis,
        source: 'local',
        serverError: serverError?.message,
        needsServerSync: true
      };
    }

    // Server succeeded - merge local + server analysis
    const processingTime = performance.now() - startTime;

    return {
      id: serverResult.id,
      ...baseEntry,
      analysis: mergeAnalysis(localAnalysis, serverResult.analysis),
      localAnalysis,
      serverAnalysis: serverResult.analysis,
      source: 'merged',
      processingTime,
      needsServerSync: false
    };
  }

  // WEB: Server-only analysis
  console.log('[EntryProcessor] Web mode - server analysis only');

  if (!serverSave) {
    throw new Error('Server save function required for web platform');
  }

  const serverResult = await serverSave(baseEntry);
  const processingTime = performance.now() - startTime;

  return {
    id: serverResult.id,
    ...baseEntry,
    analysis: serverResult.analysis,
    source: 'server',
    processingTime,
    needsServerSync: false
  };
};

/**
 * Perform local analysis on entry text
 *
 * @param {string} text - Text to analyze
 * @returns {Promise<Object>} Local analysis results
 */
export const performLocalAnalysis = async (text) => {
  const startTime = performance.now();

  // Lazy load local analysis modules
  if (!localClassifier) {
    const classifierModule = await import('../analysis/localClassifier');
    localClassifier = classifierModule;
  }

  if (!localSentiment) {
    const sentimentModule = await import('../analysis/localSentiment');
    localSentiment = sentimentModule;
  }

  // Run analysis in parallel
  const [classification, sentiment] = await Promise.all([
    localClassifier.classify(text),
    localSentiment.analyze(text)
  ]);

  const analysisTime = performance.now() - startTime;
  console.log('[EntryProcessor] Local analysis completed in', analysisTime.toFixed(0), 'ms');

  return {
    entry_type: classification.entry_type,
    classification_confidence: classification.confidence,
    mood_score: sentiment.score,
    sentiment_confidence: sentiment.confidence,
    sentiment_details: sentiment.details,
    // Placeholders for server to fill in
    title: null,
    tags: [],
    framework: null,
    extracted_tasks: classification.extracted_tasks || [],
    // Metadata
    analyzed_locally: true,
    local_analysis_time_ms: Math.round(analysisTime)
  };
};

/**
 * Merge local and server analysis results
 *
 * Strategy:
 * - Use server for: title, tags, framework, detailed analysis
 * - Use local for: quick mood score (if server took too long)
 * - Compare: classification, mood score (for quality tracking)
 *
 * @param {Object} localAnalysis - Local analysis results
 * @param {Object} serverAnalysis - Server analysis results
 * @returns {Object} Merged analysis
 */
const mergeAnalysis = (localAnalysis, serverAnalysis) => {
  if (!serverAnalysis) return localAnalysis;

  return {
    // Server wins for rich analysis
    entry_type: serverAnalysis.entry_type || localAnalysis.entry_type,
    title: serverAnalysis.title || null,
    tags: serverAnalysis.tags || [],
    framework: serverAnalysis.framework || null,
    extracted_tasks: serverAnalysis.extracted_tasks || localAnalysis.extracted_tasks || [],

    // Server wins for mood (more accurate)
    mood_score: serverAnalysis.mood_score ?? localAnalysis.mood_score,

    // Keep local for comparison/debugging
    local_classification: localAnalysis.entry_type,
    local_mood_score: localAnalysis.mood_score,
    classification_match: localAnalysis.entry_type === serverAnalysis.entry_type,
    mood_score_diff: Math.abs((serverAnalysis.mood_score ?? 0.5) - (localAnalysis.mood_score ?? 0.5)),

    // Preserve all server fields
    ...serverAnalysis,

    // Metadata
    merged: true,
    local_analysis_time_ms: localAnalysis.local_analysis_time_ms
  };
};

/**
 * Check if local analysis is available
 *
 * @returns {boolean}
 */
export const isLocalAnalysisAvailable = () => {
  return isOfflineCapable();
};

/**
 * Get processing strategy for current platform
 *
 * @param {boolean} isOnline - Current network status
 * @returns {Object} Strategy info
 */
export const getProcessingStrategy = (isOnline) => {
  const platform = Capacitor.getPlatform();
  const isNative = isOfflineCapable();

  if (isNative && !isOnline) {
    return {
      strategy: 'local_only',
      description: 'Full local analysis, queued for sync',
      expectedLatency: '<200ms'
    };
  }

  if (isNative && isOnline) {
    return {
      strategy: 'local_first',
      description: 'Local analysis for speed, server for depth',
      expectedLatency: '<200ms (local), ~3s (full)'
    };
  }

  return {
    strategy: 'server_only',
    description: 'Server analysis required',
    expectedLatency: '~3-5s'
  };
};

export default {
  processEntry,
  performLocalAnalysis,
  isLocalAnalysisAvailable,
  getProcessingStrategy
};
