/**
 * Baseline Manager
 *
 * Calculates and maintains personal baselines for all metrics.
 * Enables comparison of current state to personal norms.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { getWhoopHistory } from '../../health/whoop';

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_WINDOW_DAYS = 30;
const MIN_DATA_POINTS = 7;

// ============================================================
// BASELINE CALCULATION
// ============================================================

/**
 * Calculate statistics for an array of values
 */
const calculateStats = (values) => {
  if (!values || values.length === 0) return null;

  const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (filtered.length === 0) return null;

  const n = filtered.length;
  const mean = filtered.reduce((a, b) => a + b, 0) / n;
  const sorted = [...filtered].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];

  // Standard deviation
  const squaredDiffs = filtered.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / n;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Percentiles
  const p25 = sorted[Math.floor(n * 0.25)];
  const p50 = sorted[Math.floor(n * 0.5)];
  const p75 = sorted[Math.floor(n * 0.75)];

  // Trend (simple: recent vs earlier)
  let trend = 0;
  if (n >= 7) {
    const recentAvg = filtered.slice(-7).reduce((a, b) => a + b, 0) / 7;
    const earlierAvg = filtered.slice(0, Math.min(7, n)).reduce((a, b) => a + b, 0) / Math.min(7, n);
    trend = (recentAvg - earlierAvg) / 7; // Change per day
  }

  return {
    mean: Math.round(mean * 100) / 100,
    stdDev: Math.round(stdDev * 100) / 100,
    min,
    max,
    percentiles: { p25, p50, p75 },
    trend: Math.round(trend * 100) / 100,
    sampleSize: n
  };
};

/**
 * Calculate global baselines from Whoop and entry data
 */
export const calculateGlobalBaselines = async (whoopHistory, entries) => {
  // Extract values
  const rhrValues = [];
  const hrvValues = [];
  const strainValues = [];
  const recoveryValues = [];
  const sleepValues = [];
  const moodValues = [];

  // Process Whoop data
  const whoopDays = whoopHistory?.days || [];
  for (const day of whoopDays) {
    if (day.heartRate?.resting) rhrValues.push(day.heartRate.resting);
    if (day.hrv?.average) hrvValues.push(day.hrv.average);
    if (day.strain?.score) strainValues.push(day.strain.score);
    if (day.recovery?.score) recoveryValues.push(day.recovery.score);
    if (day.sleep?.totalHours) sleepValues.push(day.sleep.totalHours);
  }

  // Process entry moods
  for (const entry of entries || []) {
    const mood = entry.analysis?.mood_score;
    if (mood != null) moodValues.push(mood * 100); // Convert to 0-100 scale
  }

  return {
    rhr: calculateStats(rhrValues),
    hrv: calculateStats(hrvValues),
    strain: calculateStats(strainValues),
    recovery: calculateStats(recoveryValues),
    sleep: calculateStats(sleepValues),
    mood: calculateStats(moodValues)
  };
};

/**
 * Calculate contextual baselines (the magic)
 */
export const calculateContextualBaselines = async (whoopHistory, entries, threads) => {
  const contextual = {};
  const whoopByDate = {};

  // Index Whoop data by date
  const whoopDays = whoopHistory?.days || [];
  for (const day of whoopDays) {
    if (day.date) {
      whoopByDate[day.date] = day;
    }
  }

  // === STATE-BASED BASELINES ===

  // Find entries with career-waiting keywords
  const careerWaitingDays = new Set();
  for (const entry of entries) {
    const text = (entry.text || '').toLowerCase();
    if (text.match(/waiting|haven't heard|following up|pending/)) {
      const date = getEntryDate(entry);
      if (date) careerWaitingDays.add(date);
    }
  }

  if (careerWaitingDays.size >= MIN_DATA_POINTS) {
    const waitingMetrics = extractMetricsForDays(whoopByDate, entries, careerWaitingDays);
    contextual['state:career_waiting'] = {
      rhr: calculateStats(waitingMetrics.rhr),
      hrv: calculateStats(waitingMetrics.hrv),
      mood: calculateStats(waitingMetrics.mood),
      strain: calculateStats(waitingMetrics.strain),
      sampleDays: careerWaitingDays.size
    };
  }

  // === ENTITY-BASED BASELINES ===

  const entityPatterns = {
    'spencer': /spencer/i,
    'sterling': /sterling|dog walk|walked.*dog/i,
    'kobe': /kobe/i
  };

  for (const [entity, pattern] of Object.entries(entityPatterns)) {
    const entityDays = new Set();
    for (const entry of entries) {
      const text = entry.text || '';
      if (pattern.test(text)) {
        const date = getEntryDate(entry);
        if (date) entityDays.add(date);
      }
    }

    if (entityDays.size >= 3) { // Lower threshold for entities
      const metrics = extractMetricsForDays(whoopByDate, entries, entityDays);
      contextual[`entity:${entity}`] = {
        mood: calculateStats(metrics.mood),
        hrv: calculateStats(metrics.hrv),
        rhr: calculateStats(metrics.rhr),
        sampleDays: entityDays.size
      };
    }
  }

  // === ACTIVITY-BASED BASELINES ===

  const activityPatterns = {
    'yoga': /yoga|flow|vinyasa|c3/i,
    'barrys': /barry'?s|barrys/i,
    'sterling_walk': /walked? sterling|sterling.*walk|walk.*sterling/i,
    'gym': /gym|lift|workout|lifted/i
  };

  for (const [activity, pattern] of Object.entries(activityPatterns)) {
    const activityDays = new Set();
    for (const entry of entries) {
      const text = entry.text || '';
      if (pattern.test(text)) {
        const date = getEntryDate(entry);
        if (date) activityDays.add(date);
      }
    }

    if (activityDays.size >= 3) {
      const metrics = extractMetricsForDays(whoopByDate, entries, activityDays);

      // Also calculate next-day effects
      const nextDayDates = new Set([...activityDays].map(d => {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return next.toISOString().split('T')[0];
      }));
      const nextDayMetrics = extractMetricsForDays(whoopByDate, entries, nextDayDates);

      contextual[`activity:${activity}`] = {
        sameDayMood: calculateStats(metrics.mood),
        sameDayStrain: calculateStats(metrics.strain),
        nextDayRecovery: calculateStats(nextDayMetrics.recovery),
        nextDayHRV: calculateStats(nextDayMetrics.hrv),
        sampleDays: activityDays.size
      };
    }
  }

  // === TEMPORAL BASELINES ===

  const dayOfWeekMetrics = Array(7).fill(null).map(() => ({
    mood: [], rhr: [], hrv: [], strain: [], recovery: []
  }));

  for (const entry of entries) {
    const date = getEntryDate(entry);
    if (!date) continue;

    const dow = new Date(date).getDay();
    const whoop = whoopByDate[date];

    if (entry.analysis?.mood_score != null) {
      dayOfWeekMetrics[dow].mood.push(entry.analysis.mood_score * 100);
    }
    if (whoop?.heartRate?.resting) dayOfWeekMetrics[dow].rhr.push(whoop.heartRate.resting);
    if (whoop?.hrv?.average) dayOfWeekMetrics[dow].hrv.push(whoop.hrv.average);
    if (whoop?.strain?.score) dayOfWeekMetrics[dow].strain.push(whoop.strain.score);
    if (whoop?.recovery?.score) dayOfWeekMetrics[dow].recovery.push(whoop.recovery.score);
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < 7; i++) {
    if (dayOfWeekMetrics[i].mood.length >= 2) {
      contextual[`temporal:${dayNames[i]}`] = {
        mood: calculateStats(dayOfWeekMetrics[i].mood),
        strain: calculateStats(dayOfWeekMetrics[i].strain),
        recovery: calculateStats(dayOfWeekMetrics[i].recovery)
      };
    }
  }

  return contextual;
};

/**
 * Extract metrics for specific days
 */
const extractMetricsForDays = (whoopByDate, entries, daySet) => {
  const metrics = { rhr: [], hrv: [], strain: [], recovery: [], mood: [] };

  for (const date of daySet) {
    const whoop = whoopByDate[date];
    if (whoop) {
      if (whoop.heartRate?.resting) metrics.rhr.push(whoop.heartRate.resting);
      if (whoop.hrv?.average) metrics.hrv.push(whoop.hrv.average);
      if (whoop.strain?.score) metrics.strain.push(whoop.strain.score);
      if (whoop.recovery?.score) metrics.recovery.push(whoop.recovery.score);
    }

    // Find entries for this date
    const dayEntries = entries.filter(e => getEntryDate(e) === date);

    for (const entry of dayEntries) {
      const mood = entry.analysis?.mood_score;
      if (mood != null) metrics.mood.push(mood * 100);
    }
  }

  return metrics;
};

/**
 * Calculate correlation between two metric arrays
 */
export const calculateCorrelation = (x, y) => {
  if (x.length !== y.length || x.length < 5) return null;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((total, xi, i) => total + xi * y[i], 0);
  const sumX2 = x.reduce((total, xi) => total + xi * xi, 0);
  const sumY2 = y.reduce((total, yi) => total + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
};

/**
 * Calculate all correlations between metrics
 */
export const calculateCorrelations = (whoopHistory, entries) => {
  // Align data by date
  const alignedData = [];
  const whoopByDate = {};

  const whoopDays = whoopHistory?.days || [];
  for (const day of whoopDays) {
    if (day.date) whoopByDate[day.date] = day;
  }

  for (const entry of entries) {
    const date = getEntryDate(entry);
    if (!date) continue;

    const whoop = whoopByDate[date];
    const mood = entry.analysis?.mood_score;

    if (whoop && mood != null) {
      alignedData.push({
        date,
        mood: mood * 100,
        rhr: whoop.heartRate?.resting,
        hrv: whoop.hrv?.average,
        strain: whoop.strain?.score,
        recovery: whoop.recovery?.score,
        sleep: whoop.sleep?.totalHours
      });
    }
  }

  if (alignedData.length < 7) return {};

  // Calculate correlations
  const correlations = {};
  const metrics = ['mood', 'rhr', 'hrv', 'strain', 'recovery', 'sleep'];

  for (let i = 0; i < metrics.length; i++) {
    for (let j = i + 1; j < metrics.length; j++) {
      const m1 = metrics[i];
      const m2 = metrics[j];

      const values1 = alignedData.map(d => d[m1]).filter(v => v != null);
      const values2 = alignedData.map(d => d[m2]).filter(v => v != null);

      if (values1.length === values2.length && values1.length >= 7) {
        const corr = calculateCorrelation(values1, values2);
        if (corr !== null) {
          correlations[`${m1}_${m2}`] = corr;
        }
      }
    }
  }

  return correlations;
};

/**
 * Main function: Calculate and save all baselines
 */
export const calculateAndSaveBaselines = async (userId, entries = []) => {
  console.log('[BaselineManager] Calculating baselines for user:', userId);

  try {
    // Fetch Whoop history
    let whoopHistory = { available: false, days: [] };
    try {
      whoopHistory = await getWhoopHistory(DEFAULT_WINDOW_DAYS);
    } catch (e) {
      console.warn('[BaselineManager] Whoop data unavailable:', e.message);
    }

    // Calculate baselines
    const global = await calculateGlobalBaselines(whoopHistory, entries);
    const contextual = await calculateContextualBaselines(whoopHistory, entries, []);
    const correlations = calculateCorrelations(whoopHistory, entries);

    const baselines = {
      calculatedAt: Timestamp.now(),
      dataWindowDays: DEFAULT_WINDOW_DAYS,
      whoopDaysConnected: whoopHistory.days?.length || 0,
      global,
      contextual,
      correlations
    };

    // Save to Firestore
    const baselineRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'baselines'
    );
    await setDoc(baselineRef, baselines);

    console.log('[BaselineManager] Baselines saved');
    return baselines;
  } catch (error) {
    console.error('[BaselineManager] Failed to calculate baselines:', error);
    return null;
  }
};

/**
 * Get current baselines
 */
export const getBaselines = async (userId) => {
  if (!userId) return null;

  try {
    const baselineRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'baselines'
    );

    const baselineDoc = await getDoc(baselineRef);
    if (!baselineDoc.exists()) return null;

    return baselineDoc.data();
  } catch (error) {
    console.error('[BaselineManager] Failed to get baselines:', error);
    return null;
  }
};

/**
 * Compare current values to baseline
 */
export const compareToBaseline = (currentValue, baseline, metric) => {
  if (!baseline || !baseline[metric]?.mean) return null;

  const mean = baseline[metric].mean;
  const stdDev = baseline[metric].stdDev || mean * 0.1;

  const delta = currentValue - mean;
  const zScore = stdDev > 0 ? delta / stdDev : 0;

  let status = 'normal';
  if (zScore > 2) status = 'significantly_elevated';
  else if (zScore > 1) status = 'elevated';
  else if (zScore < -2) status = 'significantly_depressed';
  else if (zScore < -1) status = 'depressed';

  return {
    current: currentValue,
    baseline: mean,
    delta,
    deltaPercent: Math.round((delta / mean) * 100),
    zScore: Math.round(zScore * 100) / 100,
    status,
    interpretation: generateInterpretation(metric, delta, zScore)
  };
};

const generateInterpretation = (metric, delta, zScore) => {
  const direction = delta > 0 ? 'higher' : 'lower';
  const magnitude = Math.abs(zScore) > 2 ? 'significantly' : Math.abs(zScore) > 1 ? 'noticeably' : 'slightly';

  const metricNames = {
    rhr: 'resting heart rate',
    hrv: 'heart rate variability',
    strain: 'strain',
    recovery: 'recovery score',
    mood: 'mood'
  };

  return `Your ${metricNames[metric] || metric} is ${magnitude} ${direction} than your baseline`;
};

// ============================================================
// UTILITIES
// ============================================================

const getEntryDate = (entry) => {
  const date = entry.effectiveDate || entry.createdAt;
  if (!date) return null;

  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  if (date.toDate) {
    return date.toDate().toISOString().split('T')[0];
  }
  return null;
};
