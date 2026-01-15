/**
 * Analysis Router
 *
 * Routes entry analysis to local or server based on:
 * - Platform (iOS vs Web)
 * - Network status (online vs offline)
 * - Confidence thresholds
 *
 * This is the main entry point for platform-aware analysis routing.
 */

import { Capacitor } from '@capacitor/core';
import { classify } from './localClassifier';
import { analyze as analyzeSentiment, getLabel } from './localSentiment';

// Confidence threshold for accepting local analysis
const LOCAL_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Route classification to appropriate analyzer
 *
 * @param {string} text - Text to classify
 * @param {Object} options - Routing options
 * @param {boolean} options.isOnline - Network status
 * @param {Function} options.serverClassify - Server classification function
 * @param {boolean} options.forceLocal - Force local analysis
 * @returns {Promise<Object>} Classification result
 */
export const routeClassification = async (text, options = {}) => {
  const {
    isOnline = true,
    serverClassify,
    forceLocal = false
  } = options;

  const platform = Capacitor.getPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  // Always use local on native platforms (for speed)
  // or when offline, or when forced
  if (isNative || !isOnline || forceLocal) {
    const localResult = classify(text);

    // If high confidence or offline, return local result
    if (localResult.confidence >= LOCAL_CONFIDENCE_THRESHOLD || !isOnline || forceLocal) {
      return {
        ...localResult,
        source: 'local',
        needsServerVerification: localResult.confidence < LOCAL_CONFIDENCE_THRESHOLD && isOnline
      };
    }

    // Low confidence + online + has server function: try server
    if (serverClassify && isOnline) {
      try {
        const serverResult = await serverClassify(text);
        return {
          ...serverResult,
          source: 'server',
          localFallback: localResult
        };
      } catch (error) {
        console.warn('[AnalysisRouter] Server classification failed, using local:', error);
        return {
          ...localResult,
          source: 'local',
          serverError: error.message
        };
      }
    }

    return {
      ...localResult,
      source: 'local'
    };
  }

  // Web + online: prefer server
  if (serverClassify) {
    try {
      const serverResult = await serverClassify(text);
      return {
        ...serverResult,
        source: 'server'
      };
    } catch (error) {
      console.warn('[AnalysisRouter] Server classification failed, using local fallback:', error);
      const localResult = classify(text);
      return {
        ...localResult,
        source: 'local',
        serverError: error.message
      };
    }
  }

  // No server function available - use local
  const localResult = classify(text);
  return {
    ...localResult,
    source: 'local'
  };
};

/**
 * Route sentiment analysis to appropriate analyzer
 *
 * @param {string} text - Text to analyze
 * @param {Object} options - Routing options
 * @param {boolean} options.isOnline - Network status
 * @param {Function} options.serverAnalyze - Server analysis function
 * @param {Object} options.voiceTone - Voice tone data to incorporate
 * @param {boolean} options.forceLocal - Force local analysis
 * @returns {Promise<Object>} Sentiment result
 */
export const routeSentiment = async (text, options = {}) => {
  const {
    isOnline = true,
    serverAnalyze,
    voiceTone,
    forceLocal = false
  } = options;

  const platform = Capacitor.getPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  // Always use local first for native (speed)
  const localResult = analyzeSentiment(text, { voiceTone });

  // If offline, forced local, or native with good confidence: return local
  if (!isOnline || forceLocal || (isNative && localResult.confidence >= LOCAL_CONFIDENCE_THRESHOLD)) {
    return {
      ...localResult,
      label: getLabel(localResult.score),
      source: 'local'
    };
  }

  // Try server if available and online
  if (serverAnalyze && isOnline) {
    try {
      const serverResult = await serverAnalyze(text);
      return {
        score: serverResult.mood_score ?? localResult.score,
        confidence: 0.9, // Server is generally higher confidence
        label: getLabel(serverResult.mood_score ?? localResult.score),
        source: 'server',
        localFallback: localResult
      };
    } catch (error) {
      console.warn('[AnalysisRouter] Server sentiment failed, using local:', error);
      return {
        ...localResult,
        label: getLabel(localResult.score),
        source: 'local',
        serverError: error.message
      };
    }
  }

  return {
    ...localResult,
    label: getLabel(localResult.score),
    source: 'local'
  };
};

/**
 * Perform full local analysis (classification + sentiment)
 *
 * @param {string} text - Text to analyze
 * @param {Object} options - Analysis options
 * @param {Object} options.voiceTone - Voice tone data
 * @returns {Object} Combined analysis result
 */
export const performLocalAnalysis = (text, options = {}) => {
  const startTime = performance.now();

  const classification = classify(text);
  const sentiment = analyzeSentiment(text, { voiceTone: options.voiceTone });

  const analysisTime = performance.now() - startTime;

  return {
    entry_type: classification.entry_type,
    classification_confidence: classification.confidence,
    extracted_tasks: classification.extracted_tasks || [],
    mood_score: sentiment.score,
    sentiment_confidence: sentiment.confidence,
    sentiment_label: getLabel(sentiment.score),
    // Placeholders for server enrichment
    title: null,
    tags: [],
    framework: null,
    // Metadata
    source: 'local',
    analyzed_locally: true,
    local_analysis_time_ms: Math.round(analysisTime)
  };
};

/**
 * Check if local analysis should be used
 *
 * @param {boolean} isOnline - Network status
 * @returns {Object} Strategy info
 */
export const getAnalysisStrategy = (isOnline) => {
  const platform = Capacitor.getPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  if (!isOnline) {
    return {
      strategy: 'local_only',
      useLocal: true,
      useServer: false,
      reason: 'offline'
    };
  }

  if (isNative) {
    return {
      strategy: 'local_first',
      useLocal: true,
      useServer: true,
      reason: 'native_platform'
    };
  }

  return {
    strategy: 'server_first',
    useLocal: false,
    useServer: true,
    reason: 'web_platform'
  };
};

/**
 * Compare local vs server analysis (for quality tracking)
 *
 * @param {Object} localAnalysis - Local analysis result
 * @param {Object} serverAnalysis - Server analysis result
 * @returns {Object} Comparison metrics
 */
export const compareAnalysis = (localAnalysis, serverAnalysis) => {
  if (!localAnalysis || !serverAnalysis) {
    return { comparable: false };
  }

  return {
    comparable: true,
    classificationMatch: localAnalysis.entry_type === serverAnalysis.entry_type,
    moodScoreDiff: Math.abs(
      (localAnalysis.mood_score ?? 0.5) - (serverAnalysis.mood_score ?? 0.5)
    ),
    localConfidence: localAnalysis.classification_confidence,
    tasksExtractedLocal: (localAnalysis.extracted_tasks || []).length,
    tasksExtractedServer: (serverAnalysis.extracted_tasks || []).length
  };
};

export default {
  routeClassification,
  routeSentiment,
  performLocalAnalysis,
  getAnalysisStrategy,
  compareAnalysis
};
