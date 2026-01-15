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

import { Capacitor, registerPlugin } from '@capacitor/core';
import { setPermissionStatus, cacheHealthData } from './platformHealth';

// Lazy-loaded plugin reference
let Health = null;

/**
 * Get Health plugin instance
 * Returns null if not on iOS
 */
const getHealthPlugin = () => {
  if (Capacitor.getPlatform() !== 'ios') {
    console.log('[HealthKit] Not on iOS, skipping plugin');
    return null;
  }

  if (!Health) {
    console.log('[HealthKit] Registering HealthPlugin...');
    Health = registerPlugin('HealthPlugin');
    console.log('[HealthKit] HealthPlugin registered');
  }

  return Health;
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
  'READ_TOTAL_CALORIES',
  'READ_BASAL_CALORIES',
  'READ_WORKOUTS',
  'READ_RESTING_HEART_RATE',
  'READ_EXERCISE_TIME'
];

/**
 * Request HealthKit authorization
 *
 * @returns {Object} { authorized, deniedTypes }
 */
export const requestHealthKitPermissions = async () => {
  console.log('[HealthKit] requestHealthKitPermissions called');
  const plugin = getHealthPlugin();
  console.log('[HealthKit] getHealthPlugin returned:', plugin ? 'plugin object' : 'null');

  if (!plugin) {
    console.log('[HealthKit] No plugin available');
    return { authorized: false, error: 'HealthKit not available' };
  }

  console.log('[HealthKit] Plugin obtained, checking availability...');
  console.log('[HealthKit] Plugin methods:', Object.keys(plugin || {}));

  try {
    // Check if health is available on this device
    console.log('[HealthKit] About to call isHealthAvailable...');
    const available = await plugin.isHealthAvailable();
    console.log('[HealthKit] isHealthAvailable returned');
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
 * Wrap a promise with a timeout
 */
const withTimeout = (promise, ms, name) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
    )
  ]);
};

/**
 * Get health summary for a specific date
 *
 * Returns expanded structure with detailed sleep, heart, and activity data.
 *
 * @param {Date} date - Date to query
 * @returns {Object} Health summary with nested structure
 */
export const getHealthKitSummary = async (date = new Date()) => {
  console.log('[HealthKit] getHealthKitSummary called');
  const plugin = getHealthPlugin();

  if (!plugin) {
    console.log('[HealthKit] No plugin, returning not_ios');
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

  console.log('[HealthKit] Starting parallel queries...');

  try {
    // Query all health data in parallel with timeouts (10s each)
    const QUERY_TIMEOUT = 10000;
    const [steps, sleep, hrv, workouts, heartRate, calories, exerciseTime] = await Promise.all([
      withTimeout(querySteps(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'steps').catch(e => { console.warn('[HealthKit] steps failed:', e.message); return { total: null }; }),
      withTimeout(querySleep(plugin, sleepStart, endOfDay), QUERY_TIMEOUT, 'sleep').catch(e => { console.warn('[HealthKit] sleep failed:', e.message); return { totalHours: null, quality: 'unknown', score: null, stages: null }; }),
      withTimeout(queryHRV(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'hrv').catch(e => { console.warn('[HealthKit] hrv failed:', e.message); return { average: null, trend: 'unknown' }; }),
      withTimeout(queryWorkouts(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'workouts').catch(e => { console.warn('[HealthKit] workouts failed:', e.message); return []; }),
      withTimeout(queryHeartRate(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'heartRate').catch(e => { console.warn('[HealthKit] heartRate failed:', e.message); return { resting: null, average: null, max: null }; }),
      withTimeout(queryCalories(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'calories').catch(e => { console.warn('[HealthKit] calories failed:', e.message); return { active: null, total: null, basal: null }; }),
      withTimeout(queryExerciseTime(plugin, startOfDay, endOfDay), QUERY_TIMEOUT, 'exerciseTime').catch(e => { console.warn('[HealthKit] exerciseTime failed:', e.message); return null; })
    ]);

    console.log('[HealthKit] All queries completed');

    // Build expanded summary structure
    const summary = {
      available: true,
      date: date.toISOString().split('T')[0],

      // Sleep (enhanced with score and stages)
      sleep: {
        totalHours: sleep.totalHours,
        quality: sleep.quality,
        score: sleep.score,
        stages: sleep.stages,  // { deep, core, rem, awake }
        inBed: sleep.inBed,
        asleep: sleep.asleep
      },

      // Heart (enhanced with actual HRV value)
      heart: {
        restingRate: heartRate.resting,
        currentRate: heartRate.average,
        hrv: hrv.average,           // Actual HRV value in ms
        hrvTrend: hrv.trend,
        stressIndicator: calculateStressFromHRV(hrv.average)
      },

      // Activity (enhanced with calories and exercise time)
      activity: {
        stepsToday: steps.total,
        stepsGoalMet: steps.total >= 10000,
        totalCaloriesBurned: calories.total,
        activeCaloriesBurned: calories.active,
        basalCaloriesBurned: calories.basal,
        totalExerciseMinutes: exerciseTime,
        workouts: workouts.map(w => ({
          type: w.type,
          duration: w.durationMinutes,
          calories: Math.round(w.totalEnergyBurned || w.calories || 0),
          startTime: w.startTime,
          endTime: w.endTime,
          heartRateSamples: w.heartRateSamples || []
        })),
        hasWorkout: workouts.length > 0
      },

      // Metadata
      source: 'healthkit',
      capturedAt: new Date().toISOString()
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
  console.log('[HealthKit] querySteps starting...');
  try {
    const result = await plugin.queryAggregated({
      dataType: 'steps',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      bucket: 'day'
    });
    console.log('[HealthKit] querySteps completed');

    // aggregatedData is an array of daily samples
    const total = result.aggregatedData?.reduce((sum, sample) => sum + (sample.value || 0), 0) || 0;
    return { total: Math.round(total) };
  } catch (error) {
    console.warn('[HealthKit] Steps query failed:', error);
    return { total: null };
  }
};

/**
 * Query sleep data with full stage breakdown using EchoVault fork's sleep-stages endpoint
 */
const querySleep = async (plugin, start, end) => {
  console.log('[HealthKit] querySleep starting (using sleep-stages)...');
  try {
    const result = await plugin.queryLatestSample({ dataType: 'sleep-stages' });
    console.log('[HealthKit] querySleep (sleep-stages) completed:', JSON.stringify(result));

    if (!result || result.total === undefined || result.total <= 0) {
      console.log('[HealthKit] No sleep-stages data, falling back to basic');
      return querySleepBasic(plugin, start, end);
    }

    // Convert minutes to hours for stages
    const stages = {
      deep: Math.round(result.deep * 100) / 100 / 60,  // Convert min to hours
      core: Math.round(result.core * 100) / 100 / 60,
      rem: Math.round(result.rem * 100) / 100 / 60,
      awake: Math.round(result.awake * 100) / 100 / 60
    };

    const totalHours = result.total / 60;
    const quality = totalHours >= 7 ? 'good' : totalHours >= 5 ? 'fair' : 'poor';

    // Calculate sleep score - try native first (iOS), fallback to JS
    const sleepData = {
      totalMinutes: result.total,
      deepMinutes: result.deep,
      coreMinutes: result.core,
      remMinutes: result.rem,
      awakeMinutes: result.awake,
      awakePeriods: result.awakePeriods || 0,
      inBedStart: result.inBedStart,
      inBedEnd: result.inBedEnd
    };
    const score = await getNativeSleepScore(plugin, sleepData);

    return {
      totalHours: Math.round(totalHours * 10) / 10,
      inBed: result.inBedEnd && result.inBedStart
        ? Math.round((result.inBedEnd - result.inBedStart) / 1000 / 60 / 60 * 10) / 10
        : Math.round((totalHours / 0.92) * 10) / 10,
      asleep: Math.round(totalHours * 10) / 10,
      quality,
      score,
      stages,
      inBedStart: result.inBedStart,
      inBedEnd: result.inBedEnd
    };
  } catch (error) {
    console.warn('[HealthKit] Sleep-stages query failed, falling back to basic:', error.message);
    return querySleepBasic(plugin, start, end);
  }
};

/**
 * Fallback basic sleep query (for older plugin versions or errors)
 */
const querySleepBasic = async (plugin, start, end) => {
  console.log('[HealthKit] querySleepBasic starting...');
  try {
    const [sleepResult, remResult] = await Promise.all([
      plugin.queryLatestSample({ dataType: 'sleep' }),
      plugin.queryLatestSample({ dataType: 'sleep-rem' }).catch(() => null)
    ]);
    console.log('[HealthKit] querySleepBasic completed');

    if (!sleepResult || sleepResult.value === undefined) {
      return { totalHours: null, quality: 'unknown', score: null, stages: null };
    }

    const totalMinutes = sleepResult.value || 0;
    const remMinutes = remResult?.value || 0;
    const totalHours = totalMinutes / 60;

    // Estimate stages when we only have total + REM
    const stages = {
      deep: Math.round(totalHours * 0.17 * 100) / 100,
      core: Math.round(totalHours * 0.55 * 100) / 100,
      rem: Math.round((remMinutes / 60) * 100) / 100,
      awake: 0
    };

    let quality = 'unknown';
    if (totalHours >= 7) quality = 'good';
    else if (totalHours >= 5) quality = 'fair';
    else if (totalHours > 0) quality = 'poor';

    // Simplified score without full data
    const score = calculateSleepScoreBasic({ totalMinutes, remMinutes });

    return {
      totalHours: Math.round(totalHours * 10) / 10,
      inBed: Math.round((totalHours / 0.92) * 10) / 10,
      asleep: Math.round(totalHours * 10) / 10,
      quality,
      score,
      stages
    };
  } catch (error) {
    console.warn('Basic sleep query failed:', error);
    return { totalHours: null, quality: 'unknown', score: null, stages: null };
  }
};

/**
 * Try to calculate sleep score natively (iOS) for <10ms performance
 * Falls back to JavaScript calculation if native fails
 *
 * @param {Object} plugin - Health plugin instance
 * @param {Object} data - Sleep data from sleep-stages endpoint
 * @returns {Promise<number>} Sleep score 0-100
 */
const getNativeSleepScore = async (plugin, data) => {
  const {
    totalMinutes,
    deepMinutes,
    coreMinutes,
    remMinutes,
    awakeMinutes,
    awakePeriods,
    inBedStart,
    inBedEnd
  } = data;

  // Calculate time in bed from timestamps (ms to minutes)
  const inBedMinutes = inBedEnd > inBedStart
    ? (inBedEnd - inBedStart) / 1000 / 60
    : totalMinutes / 0.92;

  try {
    const startTime = performance.now();
    const result = await plugin.calculateSleepScore({
      totalMinutes,
      deepMinutes: deepMinutes || 0,
      coreMinutes: coreMinutes || 0,
      remMinutes: remMinutes || 0,
      awakeMinutes: awakeMinutes || 0,
      awakePeriods: awakePeriods || 0,
      inBedMinutes
    });
    const elapsed = performance.now() - startTime;
    console.log(`[HealthKit] Native sleep score calculated in ${elapsed.toFixed(1)}ms:`, result.score);
    return result.score;
  } catch (error) {
    console.warn('[HealthKit] Native sleep score failed, using JS fallback:', error.message);
    return calculateSleepScoreJS(data);
  }
};

/**
 * Calculate sleep score from full HealthKit sleep stage data (JavaScript version)
 * Uses Michael's complete formula with all available data
 *
 * @param {Object} data - Sleep data from sleep-stages endpoint
 * @returns {number} Sleep score 0-100
 */
const calculateSleepScoreJS = ({
  totalMinutes,
  deepMinutes,
  coreMinutes,
  remMinutes,
  awakeMinutes,
  awakePeriods,
  inBedStart,
  inBedEnd
}) => {
  if (!totalMinutes || totalMinutes <= 0) return null;

  // Calculate time in bed from timestamps (ms to minutes)
  const timeInBed = inBedEnd > inBedStart ? (inBedEnd - inBedStart) / 1000 / 60 : totalMinutes / 0.92;

  // Duration score (30%) - optimal 7-9 hours
  const durationScore = scoreDuration(totalMinutes, 420, 540);

  // Efficiency score (20%) - time asleep / time in bed
  const efficiency = timeInBed > 0 ? (totalMinutes / timeInBed) * 100 : 92;
  const efficiencyScore = Math.min(100, efficiency);

  // Deep sleep quality (20%) - optimal 13-23% of total
  const deepRatio = deepMinutes / totalMinutes;
  const deepScore = scoreInRange(deepRatio, 0.13, 0.23);

  // REM quality (15%) - optimal 18-28% of total
  const remRatio = remMinutes / totalMinutes;
  const remScore = scoreInRange(remRatio, 0.18, 0.28);

  // Continuity (15%) - penalize wake-ups
  const continuityScore = Math.max(0, 100 - (awakePeriods * 8) - (awakeMinutes * 1.5));

  const score = Math.round(
    durationScore * 0.30 +
    efficiencyScore * 0.20 +
    deepScore * 0.20 +
    remScore * 0.15 +
    continuityScore * 0.15
  );

  return Math.max(0, Math.min(100, score));
};

/**
 * Simplified sleep score for when full data isn't available
 */
const calculateSleepScoreBasic = ({ totalMinutes, remMinutes }) => {
  if (!totalMinutes || totalMinutes <= 0) return null;

  const durationScore = scoreDuration(totalMinutes, 420, 540);
  const remRatio = remMinutes / totalMinutes;
  const remScore = scoreInRange(remRatio, 0.18, 0.28);
  const nonRemScore = scoreInRange(1 - remRatio, 0.70, 0.82);

  return Math.round(durationScore * 0.40 + remScore * 0.30 + nonRemScore * 0.30);
};

/**
 * Score duration based on optimal range
 */
const scoreDuration = (value, minOptimal, maxOptimal) => {
  if (value >= minOptimal && value <= maxOptimal) {
    return 100;
  }
  if (value < minOptimal) {
    return Math.max(0, (value / minOptimal) * 100);
  }
  // Above optimal (oversleeping) - slight penalty
  const excess = value - maxOptimal;
  return Math.max(60, 100 - (excess / 60) * 10);
};

/**
 * Score a ratio based on optimal range
 */
const scoreInRange = (ratio, minOptimal, maxOptimal) => {
  if (ratio >= minOptimal && ratio <= maxOptimal) {
    return 100;
  }
  if (ratio < minOptimal) {
    return Math.max(0, (ratio / minOptimal) * 100);
  }
  const excess = ratio - maxOptimal;
  return Math.max(50, 100 - (excess / 0.10) * 25);
};

/**
 * Query Heart Rate Variability (HRV)
 */
const queryHRV = async (plugin, start, end) => {
  console.log('[HealthKit] queryHRV starting...');
  try {
    // Plugin uses 'hrv' not 'heart_rate_variability', and only takes dataType
    const result = await plugin.queryLatestSample({
      dataType: 'hrv'
    });
    console.log('[HealthKit] queryHRV completed');

    if (!result || result.value === undefined) {
      return { average: null, trend: 'unknown' };
    }

    return {
      average: Math.round(result.value),
      trend: 'stable' // Would need historical data to calculate trend
    };
  } catch (error) {
    console.warn('[HealthKit] HRV query failed:', error);
    return { average: null, trend: 'unknown' };
  }
};

/**
 * Query workouts with heart rate samples
 */
const queryWorkouts = async (plugin, start, end) => {
  console.log('[HealthKit] queryWorkouts starting...');
  try {
    // Include heart rate samples during workouts
    const result = await plugin.queryWorkouts({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      includeHeartRate: true,  // Get HR samples during workout
      includeRoute: false,
      includeSteps: true       // Get step count during workout
    });
    console.log('[HealthKit] queryWorkouts completed');

    // Map workouts to expanded format
    return (result.workouts || []).map(w => ({
      ...w,
      // Format workout type to readable name
      type: formatWorkoutType(w.workoutType),
      // Duration in minutes
      durationMinutes: Math.round(w.duration / 60),
      // Format times
      startTime: new Date(w.startDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      endTime: new Date(w.endDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
      // Heart rate samples (if available)
      heartRateSamples: w.heartRate || []
    }));
  } catch (error) {
    console.warn('Workouts query failed:', error);
    return [];
  }
};

/**
 * Format HealthKit workout type to readable name
 */
const formatWorkoutType = (type) => {
  const typeMap = {
    'HKWorkoutActivityTypeRunning': 'Running',
    'HKWorkoutActivityTypeWalking': 'Walking',
    'HKWorkoutActivityTypeCycling': 'Cycling',
    'HKWorkoutActivityTypeSwimming': 'Swimming',
    'HKWorkoutActivityTypeYoga': 'Yoga',
    'HKWorkoutActivityTypeFunctionalStrengthTraining': 'Strength Training',
    'HKWorkoutActivityTypeTraditionalStrengthTraining': 'Strength Training',
    'HKWorkoutActivityTypeHighIntensityIntervalTraining': 'HIIT',
    'HKWorkoutActivityTypePilates': 'Pilates',
    'HKWorkoutActivityTypeDance': 'Dance',
    'HKWorkoutActivityTypeElliptical': 'Elliptical',
    'HKWorkoutActivityTypeRowing': 'Rowing',
    'HKWorkoutActivityTypeStairClimbing': 'Stair Climbing',
    'HKWorkoutActivityTypeCoreTraining': 'Core Training',
    'HKWorkoutActivityTypeFlexibility': 'Flexibility',
    'HKWorkoutActivityTypeMixedCardio': 'Cardio',
    'HKWorkoutActivityTypeOther': 'Workout'
  };
  return typeMap[type] || type?.replace('HKWorkoutActivityType', '') || 'Workout';
};

/**
 * Query calories (active, total, basal)
 */
const queryCalories = async (plugin, start, end) => {
  console.log('[HealthKit] queryCalories starting...');
  try {
    const [activeResult, totalResult, basalResult] = await Promise.all([
      plugin.queryAggregated({
        dataType: 'active-calories',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        bucket: 'day'
      }).catch(() => null),
      plugin.queryAggregated({
        dataType: 'total-calories',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        bucket: 'day'
      }).catch(() => null),
      plugin.queryAggregated({
        dataType: 'basal-calories',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        bucket: 'day'
      }).catch(() => null)
    ]);
    console.log('[HealthKit] queryCalories completed');

    const active = activeResult?.aggregatedData?.reduce((sum, s) => sum + (s.value || 0), 0) || 0;
    const total = totalResult?.aggregatedData?.reduce((sum, s) => sum + (s.value || 0), 0) || 0;
    const basal = basalResult?.aggregatedData?.reduce((sum, s) => sum + (s.value || 0), 0) || 0;

    return {
      active: Math.round(active),
      total: Math.round(total || active + basal),  // Fallback if total not available
      basal: Math.round(basal)
    };
  } catch (error) {
    console.warn('Calories query failed:', error);
    return { active: null, total: null, basal: null };
  }
};

/**
 * Query exercise time
 */
const queryExerciseTime = async (plugin, start, end) => {
  console.log('[HealthKit] queryExerciseTime starting...');
  try {
    const result = await plugin.queryAggregated({
      dataType: 'exercise-time',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      bucket: 'day'
    });
    console.log('[HealthKit] queryExerciseTime completed');

    const minutes = result.aggregatedData?.reduce((sum, s) => sum + (s.value || 0), 0) || 0;
    return Math.round(minutes);
  } catch (error) {
    console.warn('[HealthKit] Exercise time query failed:', error);
    return null;
  }
};

/**
 * Query heart rate
 */
const queryHeartRate = async (plugin, start, end) => {
  console.log('[HealthKit] queryHeartRate starting...');
  try {
    // Query both latest heart rate and resting heart rate
    const [hrResult, restingResult] = await Promise.all([
      plugin.queryLatestSample({ dataType: 'heart-rate' }),
      plugin.queryLatestSample({ dataType: 'resting-heart-rate' }).catch(() => null)
    ]);
    console.log('[HealthKit] queryHeartRate completed');

    const hr = hrResult?.value !== undefined ? Math.round(hrResult.value) : null;
    const resting = restingResult?.value !== undefined ? Math.round(restingResult.value) : hr;

    return {
      resting: resting,
      average: hr,
      max: hr
    };
  } catch (error) {
    console.warn('[HealthKit] Heart rate query failed:', error);
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
