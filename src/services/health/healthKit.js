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

// Dynamically import Health plugin to avoid crashes on non-iOS platforms
let HealthPlugin = null;

/**
 * Initialize Health plugin
 * Returns null if not on iOS or plugin not available
 */
const getHealthPlugin = async () => {
  if (HealthPlugin !== null) return HealthPlugin;

  if (Capacitor.getPlatform() !== 'ios') {
    return null;
  }

  try {
    // Dynamic import to prevent bundling issues on non-iOS
    // Uses capacitor-health-extended - Capacitor 8 compatible
    const module = await import('@flomentumsolutions/capacitor-health-extended');
    HealthPlugin = module.CapacitorHealthExtended || module.default;
    return HealthPlugin;
  } catch (error) {
    console.warn('Health plugin not available:', error.message);
    console.warn('To enable HealthKit, run: npm install @flomentumsolutions/capacitor-health-extended && npx cap sync');
    return null;
  }
};

/**
 * Data types we request from HealthKit
 */
const HEALTH_PERMISSIONS = {
  read: [
    'steps',
    'heart_rate',
    'heart_rate_variability',
    'sleep',
    'active_calories',
    'workouts'
  ],
  write: [] // Read-only - we never write to HealthKit
};

/**
 * Request HealthKit authorization
 *
 * @returns {Object} { authorized, deniedTypes }
 */
export const requestHealthKitPermissions = async () => {
  const plugin = await getHealthPlugin();

  if (!plugin) {
    return { authorized: false, error: 'HealthKit not available' };
  }

  try {
    // Check if health is available on this device
    const available = await plugin.isHealthAvailable();
    if (!available.available) {
      return { authorized: false, error: 'HealthKit not available on this device' };
    }

    // Request permissions
    const result = await plugin.requestHealthPermissions({
      read: HEALTH_PERMISSIONS.read,
      write: HEALTH_PERMISSIONS.write
    });

    const status = result.granted ? 'granted' : 'denied';
    await setPermissionStatus(status);

    return {
      authorized: result.granted,
      deniedTypes: result.deniedPermissions || []
    };
  } catch (error) {
    console.error('HealthKit authorization failed:', error);
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
      read: ['steps', 'sleep']
    });

    return {
      available: true,
      status: status.granted ? 'authorized' : 'notDetermined',
      canRequest: !status.granted
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
        type: w.type || w.workoutActivityType,
        duration: w.duration,
        calories: w.calories || w.totalEnergyBurned
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
      endDate: end.toISOString()
    });

    return { total: Math.round(result.value || 0) };
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
    const result = await plugin.queryAggregated({
      dataType: 'sleep',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    // Result is in minutes, convert to hours
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
    const result = await plugin.queryLatestSample({
      dataType: 'heart_rate_variability',
      startDate: start.toISOString(),
      endDate: end.toISOString()
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
    const result = await plugin.queryWorkouts({
      startDate: start.toISOString(),
      endDate: end.toISOString()
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
    const result = await plugin.queryLatestSample({
      dataType: 'heart_rate',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    if (!result || result.value === undefined) {
      return { resting: null, average: null, max: null };
    }

    // With single sample, we can only get current HR
    const hr = Math.round(result.value);
    return {
      resting: hr, // Best approximation with single sample
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
