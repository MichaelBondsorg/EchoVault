/**
 * Pattern Detector
 *
 * Identifies correlations between narrative content, biometric data,
 * health metrics, and environmental factors.
 * This is the foundation layer that feeds into temporal and causal analysis.
 */

import { extractHealthSignals } from '../../health/healthFormatter';
import { extractEnvironmentSignals } from '../../environment/environmentFormatter';
import {
  GENERIC_TRIGGERS,
  hasMinimumContext,
  matchesGenericTrigger,
} from './genericTriggers';

// ============================================================
// PATTERN DEFINITIONS
// ============================================================

/**
 * Environment-based patterns to detect
 * These patterns map environmental conditions to expected mood/biometric signatures
 */
export const ENVIRONMENT_PATTERNS = {
  // Sunshine patterns (SAD-related)
  LOW_SUNSHINE: {
    id: 'low_sunshine',
    condition: (env) => env?.sunshinePercent != null && env.sunshinePercent < 30,
    category: 'environment',
    expectedSignature: { mood: 'depressed', energy: 'low' },
    label: 'Low sunshine day'
  },
  HIGH_SUNSHINE: {
    id: 'high_sunshine',
    condition: (env) => env?.sunshinePercent != null && env.sunshinePercent >= 70,
    category: 'environment',
    expectedSignature: { mood: 'elevated', energy: 'high' },
    label: 'Sunny day'
  },

  // Weather patterns
  RAINY_WEATHER: {
    id: 'rainy_weather',
    condition: (env) => /rain|storm|drizzle/i.test(env?.weatherLabel || ''),
    category: 'environment',
    expectedSignature: { mood: 'variable', activity: 'reduced' },
    label: 'Rainy weather'
  },
  COLD_WEATHER: {
    id: 'cold_weather',
    condition: (env) => env?.temperature != null && env.temperature < 40,
    category: 'environment',
    expectedSignature: { activity: 'reduced', mood: 'variable' },
    label: 'Cold weather'
  },

  // Light context patterns
  JOURNALING_AFTER_DARK: {
    id: 'journaling_after_dark',
    condition: (env) => env?.isAfterDark === true,
    category: 'environment',
    expectedSignature: { reflection: 'elevated' },
    label: 'After dark journaling'
  },
  SHORT_DAYLIGHT: {
    id: 'short_daylight',
    condition: (env) => env?.daylightHours != null && env.daylightHours < 10,
    category: 'environment',
    expectedSignature: { mood: 'risk_lower', energy: 'risk_lower' },
    label: 'Short daylight hours'
  }
};

/**
 * Health-based patterns to detect
 * These patterns map health metrics to expected signatures
 */
export const HEALTH_PATTERNS = {
  // Sleep patterns
  POOR_SLEEP: {
    id: 'poor_sleep',
    condition: (health) => (health?.sleepHours != null && health.sleepHours < 6) ||
                           (health?.sleepScore != null && health.sleepScore < 50),
    category: 'health',
    expectedSignature: { mood: 'risk_lower', energy: 'low', hrv: 'depressed' },
    label: 'Poor sleep'
  },
  GREAT_SLEEP: {
    id: 'great_sleep',
    condition: (health) => health?.sleepHours >= 8 && health?.sleepScore >= 80,
    category: 'health',
    expectedSignature: { mood: 'elevated', energy: 'high', recovery: 'good' },
    label: 'Great sleep'
  },

  // Stress/HRV patterns
  ELEVATED_STRESS: {
    id: 'elevated_stress',
    condition: (health) => health?.hrvTrend === 'declining' ||
                           health?.stressLevel === 'elevated' ||
                           (health?.hrv != null && health.hrv < 25),
    category: 'health',
    expectedSignature: { mood: 'risk_lower', anxiety: 'elevated' },
    label: 'Elevated stress markers'
  },

  // Recovery patterns
  LOW_RECOVERY: {
    id: 'low_recovery',
    condition: (health) => health?.recoveryScore != null && health.recoveryScore < 34,
    category: 'health',
    expectedSignature: { energy: 'low', strain_tolerance: 'reduced' },
    label: 'Low recovery (red zone)'
  },
  HIGH_RECOVERY: {
    id: 'high_recovery',
    condition: (health) => health?.recoveryScore != null && health.recoveryScore >= 67,
    category: 'health',
    expectedSignature: { energy: 'high', strain_tolerance: 'elevated' },
    label: 'High recovery (green zone)'
  },

  // Activity patterns
  WORKOUT_COMPLETED: {
    id: 'workout_completed',
    condition: (health) => health?.hadWorkout === true,
    category: 'health',
    expectedSignature: { mood: 'improved', endorphins: 'elevated' },
    label: 'Workout completed'
  },
  SEDENTARY_DAY: {
    id: 'sedentary_day',
    condition: (health) => health?.steps != null && health.steps < 3000 &&
                           !health?.hadWorkout,
    category: 'health',
    expectedSignature: { energy: 'stagnant', mood: 'variable' },
    label: 'Low movement day'
  },

  // High strain
  HIGH_STRAIN: {
    id: 'high_strain',
    condition: (health) => health?.strainScore != null && health.strainScore > 15,
    category: 'health',
    expectedSignature: { recovery_needed: 'high', next_day_hrv: 'variable' },
    label: 'High strain day'
  }
};

/**
 * Combined patterns (health + environment)
 */
export const COMBINED_PATTERNS = {
  DOUBLE_WHAMMY: {
    id: 'double_whammy',
    condition: (health, env) =>
      ((health?.sleepHours != null && health.sleepHours < 6) ||
       (health?.sleepScore != null && health.sleepScore < 50)) &&
      (env?.isLowSunshine || (env?.sunshinePercent != null && env.sunshinePercent < 30)),
    category: 'combined',
    expectedSignature: { mood: 'high_risk_lower', energy: 'low', self_care: 'needed' },
    label: 'Poor sleep + low sunshine'
  },
  OPTIMAL_CONDITIONS: {
    id: 'optimal_conditions',
    condition: (health, env) =>
      health?.sleepScore >= 75 &&
      env?.sunshinePercent > 60,
    category: 'combined',
    expectedSignature: { mood: 'elevated', energy: 'high', potential: 'high' },
    label: 'Well-rested + sunny day'
  },
  RECOVERY_OPPORTUNITY: {
    id: 'recovery_opportunity',
    condition: (health, env) =>
      health?.recoveryScore >= 67 &&
      (/sunny|clear/i.test(env?.weatherLabel || '')),
    category: 'combined',
    expectedSignature: { activity_potential: 'high', mood: 'elevated' },
    label: 'High recovery + nice weather'
  }
};

/**
 * Core narrative patterns to detect
 * These patterns map narrative content to expected biometric signatures.
 *
 * R4 T2 (DR finding 5): trigger data lives ONLY in genericTriggers.js — a
 * generic, non-personal vocabulary — and is imported here, never declared
 * inline. This is enforced by a structural lint test
 * (layer1/__tests__/patternDetector.test.js) so a future edit can't
 * reintroduce personal literals by adding a new inline trigger list
 * directly in this file.
 */
export const NARRATIVE_PATTERNS = GENERIC_TRIGGERS;

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * Detect patterns in a single entry
 * @param {Object} entry - Journal entry
 * @param {Object} whoopData - Same-day Whoop data
 * @returns {Array} Detected patterns with confidence scores
 */
export const detectPatternsInEntry = (entry, whoopData = null) => {
  const text = (entry.text || '').toLowerCase();
  const detectedPatterns = [];

  // Extract health and environment signals from entry context
  const healthSignals = entry.healthContext ? extractHealthSignals(entry.healthContext) : null;
  const envSignals = entry.environmentContext ? extractEnvironmentSignals(entry.environmentContext) : null;

  // Detect narrative patterns (text-based).
  // Minimum-context gate (R4 T2 / DR finding 5): a sparse entry ("Great!")
  // carries no interpretable context for a keyword match, so narrative
  // pattern detection is skipped entirely below MIN_ENTRY_WORDS. Combined
  // with word-boundary matching (matchesGenericTrigger), this replaces the
  // old bare-substring matching that fired on 918 detections/163 entries.
  if (hasMinimumContext(text)) {
    for (const [key, pattern] of Object.entries(NARRATIVE_PATTERNS)) {
      const matches = pattern.triggers.filter(trigger =>
        matchesGenericTrigger(text, trigger)
      );

      if (matches.length > 0) {
        detectedPatterns.push({
          patternId: pattern.id,
          patternType: 'narrative',
          category: pattern.category,
          triggers: matches,
          confidence: Math.min(0.5 + (matches.length * 0.15), 0.95),
          entryId: entry.id,
          entryDate: getEntryDate(entry),
          mood: entry.analysis?.mood_score,
          whoopData: whoopData ? {
            rhr: whoopData.heartRate?.resting,
            hrv: whoopData.hrv?.average,
            strain: whoopData.strain?.score,
            recovery: whoopData.recovery?.score,
            sleep: whoopData.sleep?.totalHours
          } : null
        });
      }
    }
  }

  // Detect health patterns (from healthContext)
  if (healthSignals) {
    for (const [key, pattern] of Object.entries(HEALTH_PATTERNS)) {
      try {
        if (pattern.condition(healthSignals)) {
          detectedPatterns.push({
            patternId: pattern.id,
            patternType: 'health',
            category: pattern.category,
            label: pattern.label,
            expectedSignature: pattern.expectedSignature,
            confidence: 0.9, // High confidence for metric-based detection
            entryId: entry.id,
            entryDate: getEntryDate(entry),
            mood: entry.analysis?.mood_score,
            healthData: {
              sleepHours: healthSignals.sleepHours,
              sleepScore: healthSignals.sleepScore,
              hrv: healthSignals.hrv,
              recoveryScore: healthSignals.recoveryScore,
              strainScore: healthSignals.strainScore,
              steps: healthSignals.steps,
              hadWorkout: healthSignals.hadWorkout
            }
          });
        }
      } catch (e) {
        // Pattern condition failed, skip
      }
    }
  }

  // Detect environment patterns (from environmentContext)
  if (envSignals) {
    for (const [key, pattern] of Object.entries(ENVIRONMENT_PATTERNS)) {
      try {
        if (pattern.condition(envSignals)) {
          detectedPatterns.push({
            patternId: pattern.id,
            patternType: 'environment',
            category: pattern.category,
            label: pattern.label,
            expectedSignature: pattern.expectedSignature,
            confidence: 0.9, // High confidence for metric-based detection
            entryId: entry.id,
            entryDate: getEntryDate(entry),
            mood: entry.analysis?.mood_score,
            environmentData: {
              sunshinePercent: envSignals.sunshinePercent,
              weatherLabel: envSignals.weatherLabel,
              temperature: envSignals.temperature,
              daylightHours: envSignals.daylightHours,
              isAfterDark: envSignals.isAfterDark,
              lightContext: envSignals.lightContext
            }
          });
        }
      } catch (e) {
        // Pattern condition failed, skip
      }
    }
  }

  // Detect combined patterns (health + environment)
  if (healthSignals && envSignals) {
    for (const [key, pattern] of Object.entries(COMBINED_PATTERNS)) {
      try {
        if (pattern.condition(healthSignals, envSignals)) {
          detectedPatterns.push({
            patternId: pattern.id,
            patternType: 'combined',
            category: pattern.category,
            label: pattern.label,
            expectedSignature: pattern.expectedSignature,
            confidence: 0.95, // Very high confidence for combined detection
            entryId: entry.id,
            entryDate: getEntryDate(entry),
            mood: entry.analysis?.mood_score,
            healthData: {
              sleepScore: healthSignals.sleepScore,
              recoveryScore: healthSignals.recoveryScore
            },
            environmentData: {
              sunshinePercent: envSignals.sunshinePercent,
              weatherLabel: envSignals.weatherLabel
            }
          });
        }
      } catch (e) {
        // Pattern condition failed, skip
      }
    }
  }

  return detectedPatterns;
};

/**
 * Detect patterns across a time period
 * @param {string} userId - User ID
 * @param {Array} entries - Journal entries
 * @param {Object} whoopHistory - Whoop data keyed by date (from getWhoopHistory().days)
 * @returns {Object} Pattern analysis results
 */
export const detectPatternsInPeriod = async (userId, entries, whoopHistory = null) => {
  const allPatterns = [];

  // Convert whoopHistory array to date-keyed object if needed
  const whoopByDate = {};
  if (whoopHistory?.days) {
    for (const day of whoopHistory.days) {
      if (day.date) {
        whoopByDate[day.date] = day;
      }
    }
  } else if (whoopHistory && typeof whoopHistory === 'object') {
    Object.assign(whoopByDate, whoopHistory);
  }

  for (const entry of entries) {
    const entryDate = getEntryDate(entry);
    const whoopData = whoopByDate[entryDate] || null;

    const patterns = detectPatternsInEntry(entry, whoopData);
    allPatterns.push(...patterns);
  }

  // Aggregate patterns by type and id
  const patternCounts = {};
  const patternMoods = {};
  const patternBiometrics = {};
  const patternHealthData = {};
  const patternEnvData = {};
  const patternTypes = {};

  for (const pattern of allPatterns) {
    const id = pattern.patternId;

    if (!patternCounts[id]) {
      patternCounts[id] = 0;
      patternMoods[id] = [];
      patternBiometrics[id] = [];
      patternHealthData[id] = [];
      patternEnvData[id] = [];
      patternTypes[id] = pattern.patternType;
    }

    patternCounts[id]++;
    if (pattern.mood != null) patternMoods[id].push(pattern.mood);
    if (pattern.whoopData) patternBiometrics[id].push(pattern.whoopData);
    if (pattern.healthData) patternHealthData[id].push(pattern.healthData);
    if (pattern.environmentData) patternEnvData[id].push(pattern.environmentData);
  }

  // Calculate aggregates
  const patternAnalysis = {};

  for (const [id, count] of Object.entries(patternCounts)) {
    const moods = patternMoods[id];
    const biometrics = patternBiometrics[id];
    const healthData = patternHealthData[id];
    const envData = patternEnvData[id];
    const patternType = patternTypes[id];

    // Find the pattern definition from appropriate source
    let patternDef = Object.values(NARRATIVE_PATTERNS).find(p => p.id === id);
    if (!patternDef) patternDef = Object.values(HEALTH_PATTERNS).find(p => p.id === id);
    if (!patternDef) patternDef = Object.values(ENVIRONMENT_PATTERNS).find(p => p.id === id);
    if (!patternDef) patternDef = Object.values(COMBINED_PATTERNS).find(p => p.id === id);

    patternAnalysis[id] = {
      patternId: id,
      patternType,
      category: patternDef?.category,
      label: patternDef?.label,
      occurrences: count,
      mood: {
        mean: moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        min: moods.length > 0 ? Math.min(...moods) : null,
        max: moods.length > 0 ? Math.max(...moods) : null
      },
      biometrics: biometrics.length > 0 ? {
        avgRHR: average(biometrics.map(b => b.rhr).filter(Boolean)),
        avgHRV: average(biometrics.map(b => b.hrv).filter(Boolean)),
        avgStrain: average(biometrics.map(b => b.strain).filter(Boolean)),
        avgRecovery: average(biometrics.map(b => b.recovery).filter(Boolean))
      } : null,
      healthMetrics: healthData.length > 0 ? {
        avgSleepHours: average(healthData.map(h => h.sleepHours).filter(Boolean)),
        avgSleepScore: average(healthData.map(h => h.sleepScore).filter(Boolean)),
        avgHRV: average(healthData.map(h => h.hrv).filter(Boolean)),
        avgRecovery: average(healthData.map(h => h.recoveryScore).filter(Boolean)),
        avgSteps: average(healthData.map(h => h.steps).filter(Boolean)),
        workoutRate: healthData.filter(h => h.hadWorkout).length / healthData.length
      } : null,
      environmentMetrics: envData.length > 0 ? {
        avgSunshine: average(envData.map(e => e.sunshinePercent).filter(Boolean)),
        avgTemp: average(envData.map(e => e.temperature).filter(Boolean)),
        avgDaylightHours: average(envData.map(e => e.daylightHours).filter(Boolean)),
        afterDarkRate: envData.filter(e => e.isAfterDark).length / envData.length
      } : null
    };
  }

  // Group patterns by type for easier consumption
  const byType = {
    narrative: [],
    health: [],
    environment: [],
    combined: []
  };

  for (const analysis of Object.values(patternAnalysis)) {
    if (byType[analysis.patternType]) {
      byType[analysis.patternType].push(analysis);
    }
  }

  return {
    rawPatterns: allPatterns,
    aggregated: patternAnalysis,
    byType,
    totalEntries: entries.length,
    totalPatternsDetected: allPatterns.length,
    patternTypeCounts: {
      narrative: byType.narrative.length,
      health: byType.health.length,
      environment: byType.environment.length,
      combined: byType.combined.length
    }
  };
};

/**
 * Calculate correlation between pattern presence and a biometric
 * @param {Array} dataPoints - Array of {patternPresent: boolean, biometricValue: number}
 * @returns {number|null} Pearson correlation coefficient or null if insufficient data
 */
export const calculateCorrelation = (dataPoints) => {
  if (dataPoints.length < 5) return null;

  const n = dataPoints.length;
  const sumX = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0), 0);
  const sumY = dataPoints.reduce((sum, d) => sum + d.biometricValue, 0);
  const sumXY = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0) * d.biometricValue, 0);
  const sumX2 = sumX; // Since X is binary
  const sumY2 = dataPoints.reduce((sum, d) => sum + d.biometricValue ** 2, 0);

  const numerator = (n * sumXY) - (sumX * sumY);
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

  if (denominator === 0) return 0;
  return numerator / denominator;
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Get date string from entry (handles various date formats)
 */
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

/**
 * Calculate average of numeric array
 */
const average = (arr) => {
  const filtered = arr.filter(v => v != null && !isNaN(v));
  return filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : null;
};
