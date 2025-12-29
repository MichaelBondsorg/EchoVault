/**
 * HealthKit Integration (iOS)
 *
 * Wrapper for iOS HealthKit via Capacitor plugin.
 * Handles authorization, data queries, and graceful degradation.
 *
 * Plugin: @nickmjones/capacitor-healthkit (or similar)
 * Note: Plugin must be installed separately:
 *   npm install @nickmjones/capacitor-healthkit
 *   npx cap sync
 */

import { Capacitor } from '@capacitor/core';
import { setPermissionStatus, cacheHealthData } from './platformHealth';

// Dynamically import HealthKit to avoid crashes on non-iOS platforms
let HealthKit = null;

/**
 * Initialize HealthKit plugin
 * Returns null if not on iOS or plugin not available
 */
const getHealthKitPlugin = async () => {
  if (HealthKit !== null) return HealthKit;

  if (Capacitor.getPlatform() !== 'ios') {
    return null;
  }

  try {
    // Dynamic import to prevent bundling issues on non-iOS
    const module = await import('@nickmjones/capacitor-healthkit');
    HealthKit = module.HealthKit;
    return HealthKit;
  } catch (error) {
    console.warn('HealthKit plugin not available:', error.message);
    return null;
  }
};

/**
 * Request HealthKit authorization
 *
 * @returns {Object} { authorized, deniedTypes }
 */
export const requestHealthKitPermissions = async () => {
  const plugin = await getHealthKitPlugin();

  if (!plugin) {
    return { authorized: false, error: 'HealthKit not available' };
  }

  try {
    const result = await plugin.requestAuthorization({
      read: [
        'stepCount',
        'heartRate',
        'heartRateVariabilitySDNN',
        'sleepAnalysis',
        'activeEnergyBurned',
        'workout'
      ],
      write: [] // Read-only - we never write to HealthKit
    });

    const status = result.authorized ? 'granted' : 'denied';
    await setPermissionStatus(status);

    return {
      authorized: result.authorized,
      deniedTypes: result.deniedTypes || []
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
  const plugin = await getHealthKitPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_ios' };
  }

  try {
    const status = await plugin.checkAuthorizationStatus({
      types: ['stepCount', 'sleepAnalysis']
    });

    return {
      available: true,
      status: status.status,
      canRequest: status.status === 'notDetermined'
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
  const plugin = await getHealthKitPlugin();

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
        type: w.workoutActivityType,
        duration: w.duration,
        calories: w.totalEnergyBurned
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
    const result = await plugin.queryQuantitySamples({
      sampleType: 'stepCount',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const total = (result.samples || []).reduce((sum, s) => sum + s.value, 0);
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
    const result = await plugin.queryCategorySamples({
      sampleType: 'sleepAnalysis',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const samples = result.samples || [];

    // Apple sleep values: 0=InBed, 1=Asleep, 2=Awake
    const inBedSamples = samples.filter(s => s.value === 0);
    const asleepSamples = samples.filter(s => s.value === 1);

    const calculateHours = (sampleList) => {
      return sampleList.reduce((total, s) => {
        const start = new Date(s.startDate).getTime();
        const end = new Date(s.endDate).getTime();
        return total + (end - start) / (1000 * 60 * 60);
      }, 0);
    };

    const inBedHours = calculateHours(inBedSamples);
    const asleepHours = calculateHours(asleepSamples);

    // Sleep quality based on sleep efficiency
    const efficiency = inBedHours > 0 ? asleepHours / inBedHours : 0;
    let quality = 'unknown';
    if (efficiency >= 0.85) quality = 'good';
    else if (efficiency >= 0.75) quality = 'fair';
    else if (efficiency > 0) quality = 'poor';

    return {
      totalHours: Math.round(asleepHours * 10) / 10,
      inBed: Math.round(inBedHours * 10) / 10,
      asleep: Math.round(asleepHours * 10) / 10,
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
    const result = await plugin.queryQuantitySamples({
      sampleType: 'heartRateVariabilitySDNN',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const samples = result.samples || [];
    if (samples.length === 0) {
      return { average: null, trend: 'unknown' };
    }

    const values = samples.map(s => s.value);
    const average = values.reduce((a, b) => a + b, 0) / values.length;

    // Trend based on first half vs second half
    const firstHalf = values.slice(0, Math.ceil(values.length / 2));
    const secondHalf = values.slice(Math.ceil(values.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    let trend = 'stable';
    if (secondAvg > firstAvg * 1.1) trend = 'improving';
    if (secondAvg < firstAvg * 0.9) trend = 'declining';

    return {
      average: Math.round(average),
      trend
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
    const result = await plugin.queryQuantitySamples({
      sampleType: 'heartRate',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const samples = result.samples || [];
    if (samples.length === 0) {
      return { resting: null, average: null, max: null };
    }

    const values = samples.map(s => s.value);
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);

    // Resting HR is typically the lowest values (bottom 10%)
    const sorted = [...values].sort((a, b) => a - b);
    const restingValues = sorted.slice(0, Math.ceil(sorted.length * 0.1));
    const resting = restingValues.reduce((a, b) => a + b, 0) / restingValues.length;

    return {
      resting: Math.round(resting),
      average: Math.round(average),
      max: Math.round(max)
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
  const plugin = await getHealthKitPlugin();

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
