/**
 * Unified Health Data Service
 *
 * Cross-platform health data access with graceful fallbacks:
 * - iOS: HealthKit
 * - Android: Google Fit
 * - Web: Cached data from last native session
 * - All platforms: Manual input option
 *
 * Key design principle: Health data enhances insights but is never required.
 * The app works fully without any health data.
 */

import { getHealthDataStrategy, cacheHealthData, getCachedHealthData, detectPlatform } from './platformHealth';
import { getHealthKitSummary, getHealthKitHistory, requestHealthKitPermissions, checkHealthKitPermissions } from './healthKit';
import { getGoogleFitSummary, getGoogleFitHistory, requestGoogleFitPermissions, checkGoogleFitPermissions } from './googleFit';
import { isWhoopLinked, getWhoopSummary, getWhoopHistory } from './whoop';

/**
 * Get current health summary using best available method
 *
 * Priority: Whoop (cloud) > Native HealthKit/GoogleFit > Cache > Manual
 *
 * @param {Date} date - Date to query (default: today)
 * @returns {Object} Health summary with source info
 */
export const getHealthSummary = async (date = new Date()) => {
  // Check for Whoop first (works on all platforms)
  try {
    const whoopLinked = await isWhoopLinked();
    if (whoopLinked) {
      return await getWhoopSummary(date);
    }
  } catch (error) {
    console.warn('Whoop check failed, falling back to native:', error);
  }

  // Fall back to native/cache strategy
  const strategy = await getHealthDataStrategy();

  switch (strategy.strategy) {
    case 'healthkit':
      return await getHealthKitSummary(date);

    case 'googlefit':
      return await getGoogleFitSummary(date);

    case 'cache':
      // Return cached data with freshness info
      return {
        ...strategy.cachedData,
        source: 'cache',
        cacheAge: strategy.cacheAge,
        note: 'Data from your last mobile session'
      };

    case 'manual':
    default:
      return {
        available: false,
        source: 'none',
        note: 'Health data available when using the mobile app'
      };
  }
};

/**
 * Get health history for correlation analysis
 *
 * Priority: Whoop (cloud) > Native HealthKit/GoogleFit
 *
 * @param {number} days - Days to query
 * @returns {Object} Health history
 */
export const getHealthHistory = async (days = 14) => {
  // Check for Whoop first (works on all platforms)
  try {
    const whoopLinked = await isWhoopLinked();
    if (whoopLinked) {
      return await getWhoopHistory(days);
    }
  } catch (error) {
    console.warn('Whoop history failed, falling back to native:', error);
  }

  const { platform } = detectPlatform();

  if (platform === 'ios') {
    return await getHealthKitHistory(days);
  }

  if (platform === 'android') {
    return await getGoogleFitHistory(days);
  }

  // Web - no history available
  return {
    available: false,
    reason: 'web_platform',
    note: 'Historical health data only available on mobile or with Whoop'
  };
};

/**
 * Request health permissions for current platform
 *
 * @returns {Object} Permission result
 */
export const requestHealthPermissions = async () => {
  const { platform } = detectPlatform();

  if (platform === 'ios') {
    return await requestHealthKitPermissions();
  }

  if (platform === 'android') {
    return await requestGoogleFitPermissions();
  }

  return {
    available: false,
    reason: 'web_platform'
  };
};

/**
 * Check current health permission status
 *
 * @returns {Object} Permission status
 */
export const checkHealthPermissions = async () => {
  const { platform } = detectPlatform();

  if (platform === 'ios') {
    return await checkHealthKitPermissions();
  }

  if (platform === 'android') {
    return await checkGoogleFitPermissions();
  }

  return {
    available: false,
    reason: 'web_platform'
  };
};

/**
 * Get health context for entry enrichment
 *
 * Returns expanded health context to store with journal entries.
 * Used to correlate mood with health metrics.
 *
 * Structure matches the expanded HealthKit/Whoop summary format:
 * - sleep: totalHours, quality, score, stages
 * - heart: restingRate, currentRate, hrv, stressIndicator
 * - activity: stepsToday, calories, exerciseMinutes, workouts
 *
 * @returns {Object|null} Health context or null if unavailable
 */
export const getEntryHealthContext = async () => {
  const summary = await getHealthSummary();

  if (!summary.available) {
    return null;
  }

  // Handle both old flat format (Whoop/cache) and new nested format (HealthKit)
  const isNewFormat = summary.activity !== undefined;

  if (isNewFormat) {
    // New expanded format from HealthKit
    return {
      sleep: {
        totalHours: summary.sleep?.totalHours || null,
        quality: summary.sleep?.quality || null,
        score: summary.sleep?.score || null,
        stages: summary.sleep?.stages || null
      },
      heart: {
        restingRate: summary.heart?.restingRate || null,
        currentRate: summary.heart?.currentRate || null,
        hrv: summary.heart?.hrv || null,
        hrvTrend: summary.heart?.hrvTrend || null,
        stressIndicator: summary.heart?.stressIndicator || null
      },
      activity: {
        stepsToday: summary.activity?.stepsToday || null,
        totalCaloriesBurned: summary.activity?.totalCaloriesBurned || null,
        activeCaloriesBurned: summary.activity?.activeCaloriesBurned || null,
        totalExerciseMinutes: summary.activity?.totalExerciseMinutes || null,
        hasWorkout: summary.activity?.hasWorkout || false,
        workouts: summary.activity?.workouts || []
      },
      source: summary.source || 'healthkit',
      capturedAt: new Date().toISOString()
    };
  }

  // Legacy format (Whoop, cache, or older data)
  return {
    sleep: {
      totalHours: summary.sleep?.totalHours || null,
      quality: summary.sleep?.quality || null,
      score: summary.sleepScore || null,
      stages: null
    },
    heart: {
      restingRate: summary.heartRate?.resting || null,
      currentRate: summary.heartRate?.average || null,
      hrv: summary.hrv?.average || null,
      hrvTrend: summary.hrv?.trend || null,
      stressIndicator: summary.hrv?.stressIndicator || null
    },
    activity: {
      stepsToday: summary.steps || null,
      totalCaloriesBurned: summary.calories?.total || null,
      activeCaloriesBurned: summary.calories?.active || null,
      totalExerciseMinutes: summary.exerciseMinutes || null,
      hasWorkout: summary.hasWorkout || false,
      workouts: (summary.workouts || []).map(w => ({
        type: w.type,
        duration: w.duration,
        calories: w.calories || 0,
        startTime: w.startTime || null,
        endTime: w.endTime || null
      }))
    },
    source: summary.source || 'native',
    capturedAt: new Date().toISOString()
  };
};

/**
 * Save manual health input (for web users)
 *
 * @param {Object} input - { sleepHours, hadWorkout, stressLevel }
 */
export const saveManualHealthInput = async (input) => {
  const manualData = {
    available: true,
    source: 'manual',
    date: new Date().toISOString().split('T')[0],
    sleep: {
      totalHours: input.sleepHours,
      quality: input.sleepHours >= 7 ? 'good' : input.sleepHours >= 5 ? 'fair' : 'poor'
    },
    hasWorkout: input.hadWorkout || false,
    hrv: {
      stressIndicator: input.stressLevel || null
    },
    steps: null,
    heartRate: null,
    queriedAt: new Date().toISOString()
  };

  await cacheHealthData(manualData);
  return manualData;
};

/**
 * Get health data availability status
 *
 * @returns {Object} Availability info for UI
 */
export const getHealthDataStatus = async () => {
  // Check Whoop status first
  let whoopLinked = false;
  try {
    whoopLinked = await isWhoopLinked();
  } catch {
    // Ignore Whoop check errors
  }

  if (whoopLinked) {
    return {
      isAvailable: true,
      strategy: 'whoop',
      platform: 'cloud',
      isNative: false,
      isWhoop: true,
      canRequestPermission: false,
      hasCachedData: false,
      cacheAge: null,
      message: 'Connected to Whoop'
    };
  }

  const strategy = await getHealthDataStrategy();
  const { platform, isNative } = detectPlatform();

  return {
    isAvailable: strategy.isAvailable,
    strategy: strategy.strategy,
    platform,
    isNative,
    isWhoop: false,
    canRequestPermission: isNative && strategy.permissionStatus !== 'granted',
    hasCachedData: strategy.strategy === 'cache',
    cacheAge: strategy.cacheAge || null,
    message: getStatusMessage(strategy)
  };
};

/**
 * Get human-readable status message
 */
const getStatusMessage = (strategy) => {
  switch (strategy.strategy) {
    case 'healthkit':
      return strategy.isAvailable
        ? 'Connected to Apple Health'
        : 'Apple Health permission needed';

    case 'googlefit':
      return strategy.isAvailable
        ? 'Connected to Google Fit'
        : 'Google Fit permission needed';

    case 'cache':
      return `Using data from ${strategy.cacheAge}`;

    case 'manual':
      return 'Tap to add health info manually';

    default:
      return 'Health data unavailable';
  }
};

/**
 * Refresh health data cache
 * Call this on app resume or periodically
 */
export const refreshHealthCache = async () => {
  // Check Whoop first
  try {
    const whoopLinked = await isWhoopLinked();
    if (whoopLinked) {
      const summary = await getWhoopSummary();
      if (summary.available) {
        return { refreshed: true, summary, source: 'whoop' };
      }
    }
  } catch (error) {
    console.warn('Whoop refresh failed:', error);
  }

  const { isNative, platform } = detectPlatform();

  if (!isNative) {
    return { refreshed: false, reason: 'not_native' };
  }

  try {
    const summary = platform === 'ios'
      ? await getHealthKitSummary()
      : await getGoogleFitSummary();

    if (summary.available) {
      return { refreshed: true, summary };
    }

    return { refreshed: false, reason: 'fetch_failed' };
  } catch (error) {
    return { refreshed: false, reason: error.message };
  }
};

export default {
  getHealthSummary,
  getHealthHistory,
  requestHealthPermissions,
  checkHealthPermissions,
  getEntryHealthContext,
  saveManualHealthInput,
  getHealthDataStatus,
  refreshHealthCache
};
