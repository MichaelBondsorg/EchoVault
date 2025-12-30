/**
 * HealthKit Integration (iOS)
 *
 * Wrapper for iOS HealthKit via Capacitor plugin.
 * Handles authorization, data queries, and graceful degradation.
 *
 * Plugin: @flomentumsolutions/capacitor-health-extended (Capacitor 8 compatible)
 *
 * SETUP INSTRUCTIONS:
 * 1. Install the plugin:
 *    npm install @flomentumsolutions/capacitor-health-extended
 *    npx cap sync
 *
 * 2. Add HealthKit capability in Xcode:
 *    - Open ios/App/App.xcworkspace
 *    - Select App target → Signing & Capabilities
 *    - Click "+ Capability" → Add "HealthKit"
 *
 * 3. Info.plist permissions are already configured
 */

import { Capacitor } from '@capacitor/core';
import { setPermissionStatus, cacheHealthData } from './platformHealth';

// Lazy-loaded plugin reference (only loaded on iOS)
let HealthPlugin = null;

/**
 * Get Health plugin instance
 * Returns null if not on iOS
 * Uses dynamic import to avoid loading native plugin in web
 */
const getHealthPlugin = async () => {
  if (Capacitor.getPlatform() !== 'ios') {
    console.log('[HealthKit] Not on iOS, skipping plugin');
    return null;
  }

  // Lazy load the plugin only when needed on iOS
  if (!HealthPlugin) {
    try {
      const module = await import('@flomentumsolutions/capacitor-health-extended');
      HealthPlugin = module.Health;
      console.log('[HealthKit] Plugin loaded dynamically');
    } catch (error) {
      console.error('[HealthKit] Failed to load plugin:', error);
      return null;
    }
  }

  console.log('[HealthKit] Using Health plugin from @flomentumsolutions/capacitor-health-extended');
  return HealthPlugin;
};

/**
 * Data types we request from HealthKit
 * Uses the plugin's HealthPermission format (uppercase with READ_ prefix)
 */
const HEALTH_PERMISSIONS = [
  'READ_STEPS',
  'READ_HEART_RATE',
  'READ_HRV',
  'READ_SLEEP',
  'READ_ACTIVE_CALORIES',
  'READ_WORKOUTS',
  'READ_RESTING_HEART_RATE'
];

/**
 * Request HealthKit authorization
 *
 * @returns {Object} { authorized, deniedTypes }
 */
export const requestHealthKitPermissions = async () => {
  console.log('[HealthKit] requestHealthKitPermissions called');
  const plugin = await getHealthPlugin();

  if (!plugin) {
    console.log('[HealthKit] No plugin available');
    return { authorized: false, error: 'HealthKit not available' };
  }

  console.log('[HealthKit] Plugin obtained, checking availability...');

  try {
    // Check if health is available on this device
    console.log('[HealthKit] Calling isHealthAvailable...');
    const available = await plugin.isHealthAvailable();
    console.log('[HealthKit] isHealthAvailable result:', JSON.stringify(available));

    if (!available.available) {
      return { authorized: false, error: 'HealthKit not available on this device' };
    }

    // Request permissions using the plugin's expected format
    console.log('[HealthKit] Calling requestHealthPermissions with:', HEALTH_PERMISSIONS);
    const result = await plugin.requestHealthPermissions({
      permissions: HEALTH_PERMISSIONS
    });
    console.log('[HealthKit] requestHealthPermissions result:', JSON.stringify(result));

    // Check if all requested permissions were granted
    const allGranted = HEALTH_PERMISSIONS.every(
      perm => result.permissions && result.permissions[perm] === true
    );

    const deniedTypes = HEALTH_PERMISSIONS.filter(
      perm => result.permissions && result.permissions[perm] !== true
    );

    const status = allGranted ? 'granted' : (deniedTypes.length < HEALTH_PERMISSIONS.length ? 'partial' : 'denied');
    await setPermissionStatus(status);

    return {
      authorized: allGranted || deniedTypes.length < HEALTH_PERMISSIONS.length,
      deniedTypes
    };
  } catch (error) {
    console.error('[HealthKit] Authorization failed:', error);
    console.error('[HealthKit] Error details:', error?.message, error?.code, error?.stack);
    await setPermissionStatus('error');
    return { authorized: false, error: error.message };
  }
};

/**
 * Check current HealthKit authorization status
 */
export const checkHealthKitPermissions = async () => {
  const plugin = await getHealthPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_ios' };
  }

  try {
    const available = await plugin.isHealthAvailable();
    if (!available.available) {
      return { available: false, reason: 'not_supported' };
    }

    const status = await plugin.checkHealthPermissions({
      permissions: ['READ_STEPS', 'READ_SLEEP']
    });

    const hasPermissions = status.permissions &&
      (status.permissions['READ_STEPS'] === true || status.permissions['READ_SLEEP'] === true);

    return {
      available: true,
      status: hasPermissions ? 'authorized' : 'notDetermined',
      canRequest: !hasPermissions
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
};

/**
 * Get health summary for a specific date
 *
 * @param {Date} date - Date to query
 * @returns {Object} Health summary
 */
export const getHealthKitSummary = async (date = new Date()) => {
  const plugin = await getHealthPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_ios' };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // For sleep, we need to look at the previous night
  const sleepStart = new Date(startOfDay);
  sleepStart.setDate(sleepStart.getDate() - 1);
  sleepStart.setHours(18, 0, 0, 0); // Start from 6 PM previous day

  try {
    const [steps, sleep, hrv, workouts, heartRate] = await Promise.all([
      querySteps(plugin, startOfDay, endOfDay),
      querySleep(plugin, sleepStart, endOfDay),
      queryHRV(plugin, startOfDay, endOfDay),
      queryWorkouts(plugin, startOfDay, endOfDay),
      queryHeartRate(plugin, startOfDay, endOfDay)
    ]);

    const summary = {
      available: true,
      date: date.toISOString().split('T')[0],
      steps: steps.total,
      stepsGoalMet: steps.total >= 10000,
      sleep: {
        totalHours: sleep.totalHours,
        quality: sleep.quality,
        inBed: sleep.inBed,
        asleep: sleep.asleep
      },
      hrv: {
        average: hrv.average,
        trend: hrv.trend,
        stressIndicator: calculateStressFromHRV(hrv.average)
      },
      workouts: workouts.map(w => ({
        type: w.workoutType,
        duration: w.duration,
        calories: w.calories
      })),
      hasWorkout: workouts.length > 0,
      heartRate: {
        resting: heartRate.resting,
        average: heartRate.average,
        max: heartRate.max
      },
      queriedAt: new Date().toISOString()
    };

    // Cache for web access
    await cacheHealthData(summary);

    return summary;
  } catch (error) {
    console.error('HealthKit query failed:', error);
    return {
      available: false,
      error: error.message,
      partial: true
    };
  }
};

/**
 * Query step count
 */
const querySteps = async (plugin, start, end) => {
  try {
    const result = await plugin.queryAggregated({
      dataType: 'steps',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      bucket: 'day'
    });

    // aggregatedData is an array of daily samples
    const total = result.aggregatedData?.reduce((sum, sample) => sum + (sample.value || 0), 0) || 0;
    return { total: Math.round(total) };
  } catch (error) {
    console.warn('Steps query failed:', error);
    return { total: null };
  }
};

/**
 * Query sleep data
 */
const querySleep = async (plugin, start, end) => {
  try {
    // Use queryLatestSample for sleep - it returns the most recent sleep session
    const result = await plugin.queryLatestSample({
      dataType: 'sleep'
    });

    if (!result || result.value === undefined) {
      return { totalHours: null, quality: 'unknown' };
    }

    // Result value is in minutes, convert to hours
    const totalMinutes = result.value || 0;
    const totalHours = totalMinutes / 60;

    // Estimate quality based on duration
    let quality = 'unknown';
    if (totalHours >= 7) quality = 'good';
    else if (totalHours >= 5) quality = 'fair';
    else if (totalHours > 0) quality = 'poor';

    return {
      totalHours: Math.round(totalHours * 10) / 10,
      inBed: Math.round(totalHours * 10) / 10,
      asleep: Math.round(totalHours * 10) / 10,
      quality
    };
  } catch (error) {
    console.warn('Sleep query failed:', error);
    return { totalHours: null, quality: 'unknown' };
  }
};

/**
 * Query Heart Rate Variability (HRV)
 */
const queryHRV = async (plugin, start, end) => {
  try {
    // Plugin uses 'hrv' not 'heart_rate_variability', and only takes dataType
    const result = await plugin.queryLatestSample({
      dataType: 'hrv'
    });

    if (!result || result.value === undefined) {
      return { average: null, trend: 'unknown' };
    }

    return {
      average: Math.round(result.value),
      trend: 'stable' // Would need historical data to calculate trend
    };
  } catch (error) {
    console.warn('HRV query failed:', error);
    return { average: null, trend: 'unknown' };
  }
};

/**
 * Query workouts
 */
const queryWorkouts = async (plugin, start, end) => {
  try {
    // Plugin requires these boolean flags
    const result = await plugin.queryWorkouts({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      includeHeartRate: false,
      includeRoute: false,
      includeSteps: false
    });

    return result.workouts || [];
  } catch (error) {
    console.warn('Workouts query failed:', error);
    return [];
  }
};

/**
 * Query heart rate
 */
const queryHeartRate = async (plugin, start, end) => {
  try {
    // Query both latest heart rate and resting heart rate
    const [hrResult, restingResult] = await Promise.all([
      plugin.queryLatestSample({ dataType: 'heart-rate' }),
      plugin.queryLatestSample({ dataType: 'resting-heart-rate' }).catch(() => null)
    ]);

    const hr = hrResult?.value !== undefined ? Math.round(hrResult.value) : null;
    const resting = restingResult?.value !== undefined ? Math.round(restingResult.value) : hr;

    return {
      resting: resting,
      average: hr,
      max: hr
    };
  } catch (error) {
    console.warn('Heart rate query failed:', error);
    return { resting: null, average: null, max: null };
  }
};

/**
 * Calculate stress indicator from HRV
 * Higher HRV = lower stress, Lower HRV = higher stress
 */
const calculateStressFromHRV = (hrv) => {
  if (hrv === null) return null;

  // These thresholds vary by age/fitness, using general guidelines
  if (hrv >= 50) return 'low';
  if (hrv >= 30) return 'moderate';
  return 'high';
};

/**
 * Get health history for correlation analysis
 *
 * @param {number} days - Number of days to query
 * @returns {Array} Daily health summaries
 */
export const getHealthKitHistory = async (days = 14) => {
  const plugin = await getHealthPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_ios' };
  }

  const history = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Rate limit to avoid overwhelming HealthKit
    await new Promise(resolve => setTimeout(resolve, 100));

    const summary = await getHealthKitSummary(date);
    if (summary.available) {
      history.push(summary);
    }
  }

  return {
    available: true,
    days: history.length,
    history
  };
};

export default {
  requestHealthKitPermissions,
  checkHealthKitPermissions,
  getHealthKitSummary,
  getHealthKitHistory
};
