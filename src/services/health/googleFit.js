/**
 * Google Fit Integration (Android)
 *
 * Wrapper for Google Fit via Capacitor plugin.
 * Mirrors HealthKit API structure for unified health data access.
 *
 * Plugin: @nickmjones/capacitor-healthkit also supports Android,
 * or use capacitor-google-fit for native Android support.
 *
 * Note: Plugin must be installed separately.
 */

import { Capacitor } from '@capacitor/core';
import { setPermissionStatus, cacheHealthData } from './platformHealth';

// Dynamically import Google Fit plugin
let GoogleFit = null;

/**
 * Initialize Google Fit plugin
 * Returns null if not on Android or plugin not available
 */
const getGoogleFitPlugin = async () => {
  if (GoogleFit !== null) return GoogleFit;

  if (Capacitor.getPlatform() !== 'android') {
    return null;
  }

  try {
    // Try multiple possible plugin names
    try {
      const module = await import('capacitor-google-fit');
      GoogleFit = module.GoogleFit;
    } catch {
      // Fallback to health connect (Android 14+)
      const module = await import('@nickmjones/capacitor-healthkit');
      GoogleFit = module.HealthKit; // Some plugins unify iOS/Android
    }

    return GoogleFit;
  } catch (error) {
    console.warn('Google Fit plugin not available:', error.message);
    return null;
  }
};

/**
 * Request Google Fit authorization
 *
 * @returns {Object} { authorized, deniedTypes }
 */
export const requestGoogleFitPermissions = async () => {
  const plugin = await getGoogleFitPlugin();

  if (!plugin) {
    return { authorized: false, error: 'Google Fit not available' };
  }

  try {
    const result = await plugin.requestAuthorization({
      read: [
        'steps',
        'heart_rate',
        'sleep',
        'activity',
        'calories'
      ],
      write: []
    });

    const status = result.authorized ? 'granted' : 'denied';
    await setPermissionStatus(status);

    return {
      authorized: result.authorized,
      deniedScopes: result.deniedScopes || []
    };
  } catch (error) {
    console.error('Google Fit authorization failed:', error);
    await setPermissionStatus('error');
    return { authorized: false, error: error.message };
  }
};

/**
 * Check current Google Fit authorization status
 */
export const checkGoogleFitPermissions = async () => {
  const plugin = await getGoogleFitPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_android' };
  }

  try {
    const status = await plugin.checkAuthorizationStatus();

    return {
      available: true,
      authorized: status.authorized,
      canRequest: !status.authorized
    };
  } catch (error) {
    return { available: false, reason: error.message };
  }
};

/**
 * Get health summary for a specific date
 *
 * @param {Date} date - Date to query
 * @returns {Object} Health summary (matches HealthKit structure)
 */
export const getGoogleFitSummary = async (date = new Date()) => {
  const plugin = await getGoogleFitPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_android' };
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // For sleep, look at previous night
  const sleepStart = new Date(startOfDay);
  sleepStart.setDate(sleepStart.getDate() - 1);
  sleepStart.setHours(18, 0, 0, 0);

  try {
    const [steps, sleep, heartRate, activity] = await Promise.all([
      querySteps(plugin, startOfDay, endOfDay),
      querySleep(plugin, sleepStart, endOfDay),
      queryHeartRate(plugin, startOfDay, endOfDay),
      queryActivity(plugin, startOfDay, endOfDay)
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
      // Google Fit doesn't provide HRV on most devices
      hrv: {
        average: null,
        trend: 'unknown',
        stressIndicator: null,
        note: 'HRV requires compatible wearable'
      },
      workouts: activity.workouts.map(w => ({
        type: w.activityType,
        duration: w.duration,
        calories: w.calories
      })),
      hasWorkout: activity.workouts.length > 0,
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
    console.error('Google Fit query failed:', error);
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
    const result = await plugin.querySteps?.({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }) || await plugin.queryQuantitySamples?.({
      sampleType: 'stepCount',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const total = result.total || (result.samples || []).reduce((sum, s) => sum + s.value, 0);
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
    const result = await plugin.querySleep?.({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }) || await plugin.queryCategorySamples?.({
      sampleType: 'sleepAnalysis',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    // Handle different response formats
    if (result.totalMinutes !== undefined) {
      const totalHours = result.totalMinutes / 60;
      return {
        totalHours: Math.round(totalHours * 10) / 10,
        inBed: totalHours,
        asleep: totalHours,
        quality: totalHours >= 7 ? 'good' : totalHours >= 5 ? 'fair' : 'poor'
      };
    }

    // Sample-based format
    const samples = result.samples || [];
    const totalMs = samples.reduce((total, s) => {
      const start = new Date(s.startDate).getTime();
      const end = new Date(s.endDate).getTime();
      return total + (end - start);
    }, 0);

    const totalHours = totalMs / (1000 * 60 * 60);
    return {
      totalHours: Math.round(totalHours * 10) / 10,
      inBed: totalHours,
      asleep: totalHours,
      quality: totalHours >= 7 ? 'good' : totalHours >= 5 ? 'fair' : 'poor'
    };
  } catch (error) {
    console.warn('Sleep query failed:', error);
    return { totalHours: null, quality: 'unknown' };
  }
};

/**
 * Query heart rate
 */
const queryHeartRate = async (plugin, start, end) => {
  try {
    const result = await plugin.queryHeartRate?.({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }) || await plugin.queryQuantitySamples?.({
      sampleType: 'heartRate',
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    // Handle different response formats
    if (result.average !== undefined) {
      return {
        resting: result.resting || null,
        average: result.average,
        max: result.max || null
      };
    }

    const samples = result.samples || [];
    if (samples.length === 0) {
      return { resting: null, average: null, max: null };
    }

    const values = samples.map(s => s.value);
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);
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
 * Query activity/workouts
 */
const queryActivity = async (plugin, start, end) => {
  try {
    const result = await plugin.queryWorkouts?.({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }) || await plugin.queryActivity?.({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    });

    const workouts = result.workouts || result.activities || [];

    return {
      workouts: workouts.map(w => ({
        activityType: w.workoutActivityType || w.activityType || 'Unknown',
        duration: w.duration || 0,
        calories: w.totalEnergyBurned || w.calories || 0
      }))
    };
  } catch (error) {
    console.warn('Activity query failed:', error);
    return { workouts: [] };
  }
};

/**
 * Get health history for correlation analysis
 *
 * @param {number} days - Number of days to query
 * @returns {Array} Daily health summaries
 */
export const getGoogleFitHistory = async (days = 14) => {
  const plugin = await getGoogleFitPlugin();

  if (!plugin) {
    return { available: false, reason: 'not_android' };
  }

  const history = [];
  const today = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    // Rate limit
    await new Promise(resolve => setTimeout(resolve, 100));

    const summary = await getGoogleFitSummary(date);
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
  requestGoogleFitPermissions,
  checkGoogleFitPermissions,
  getGoogleFitSummary,
  getGoogleFitHistory
};
