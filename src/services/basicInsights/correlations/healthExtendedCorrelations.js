/**
 * Extended Health-Mood Correlations
 *
 * Additional health metrics beyond the basic healthCorrelations.js
 * Includes: strain, deep sleep, REM sleep, calories
 *
 * Example insights:
 * - "High strain days (15+) correlate with 12% lower mood"
 * - "More deep sleep correlates with 18% better mood"
 * - "Active calorie days (500+) show 15% mood improvement"
 */

import {
  average,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES
} from '../utils/thresholds';

/**
 * Extract extended health signals from healthContext
 * @param {Object} healthContext - Entry health context
 * @returns {Object} Extracted signals
 */
const extractExtendedHealthSignals = (healthContext) => {
  if (!healthContext) return {};

  const signals = {};

  // Strain (Whoop - 0-21 scale)
  if (healthContext.strain?.score != null) {
    signals.strainScore = healthContext.strain.score;
  }

  // Deep sleep hours
  if (healthContext.sleep?.stages?.deep != null) {
    signals.deepSleepHours = healthContext.sleep.stages.deep;
  }

  // REM sleep hours
  if (healthContext.sleep?.stages?.rem != null) {
    signals.remSleepHours = healthContext.sleep.stages.rem;
  }

  // Active calories
  if (healthContext.activity?.activeCalories != null) {
    signals.activeCalories = healthContext.activity.activeCalories;
  }

  // Total calories
  if (healthContext.activity?.totalCalories != null) {
    signals.totalCalories = healthContext.activity.totalCalories;
  }

  // Exercise minutes
  if (healthContext.activity?.totalExerciseMinutes != null) {
    signals.exerciseMinutes = healthContext.activity.totalExerciseMinutes;
  }

  // Distance (if available)
  if (healthContext.activity?.distance != null) {
    signals.distance = healthContext.activity.distance;
  }

  return signals;
};

/**
 * Compute extended health-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} Extended health insight objects
 */
export const computeExtendedHealthCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with mood scores and health context
  const entriesWithData = entries
    .filter(e => e.analysis?.mood_score != null && e.healthContext)
    .map(e => ({
      mood: e.analysis.mood_score,
      entryId: e.id || e.entryId,
      ...extractExtendedHealthSignals(e.healthContext)
    }));

  if (entriesWithData.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Calculate baseline mood
  const allMoods = entriesWithData.map(e => e.mood);
  const baselineMood = average(allMoods);

  const insights = [];

  // ===== STRAIN-MOOD CORRELATION (Whoop) =====
  const strainEntries = entriesWithData.filter(e => e.strainScore != null);
  if (strainEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {
    const highStrainEntries = strainEntries.filter(e => e.strainScore >= 15);
    const lowStrainEntries = strainEntries.filter(e => e.strainScore < 10);

    if (highStrainEntries.length >= 2 && lowStrainEntries.length >= 2) {
      const highStrainMood = average(highStrainEntries.map(e => e.mood));
      const lowStrainMood = average(lowStrainEntries.map(e => e.mood));
      const moodDelta = calculateMoodDelta(highStrainMood, lowStrainMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
        const strength = determineStrength(moodDelta, strainEntries.length);

        if (strength !== 'weak') {
          const better = highStrainMood > lowStrainMood ? 'high' : 'low';
          insights.push({
            id: generateInsightId(CATEGORIES.HEALTH, 'strain'),
            category: CATEGORIES.HEALTH,
            insight: better === 'high'
              ? `🔥 High strain days (15+) correlate with ${Math.abs(moodDelta)}% better mood`
              : `🔥 Lower strain days (<10) correlate with ${Math.abs(moodDelta)}% better mood`,
            moodDelta: better === 'high' ? moodDelta : -moodDelta,
            direction: better === 'high' ? 'positive' : 'negative',
            strength,
            sampleSize: strainEntries.length,
            recommendation: better === 'low'
              ? 'Consider moderating physical exertion when feeling stressed'
              : 'Physical challenge seems to boost your mood',
            entryIds: (better === 'high' ? highStrainEntries : lowStrainEntries).map(e => e.entryId).filter(Boolean)
          });
        }
      }
    }
  }

  // ===== DEEP SLEEP-MOOD CORRELATION =====
  const deepSleepEntries = entriesWithData.filter(e => e.deepSleepHours != null);
  if (deepSleepEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {
    const goodDeepSleep = deepSleepEntries.filter(e => e.deepSleepHours >= 1.5);
    const poorDeepSleep = deepSleepEntries.filter(e => e.deepSleepHours < 1);

    if (goodDeepSleep.length >= 2 && poorDeepSleep.length >= 2) {
      const goodMood = average(goodDeepSleep.map(e => e.mood));
      const poorMood = average(poorDeepSleep.map(e => e.mood));
      const moodDelta = calculateMoodDelta(goodMood, poorMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
        const strength = determineStrength(moodDelta, deepSleepEntries.length);

        if (strength !== 'weak') {
          insights.push({
            id: generateInsightId(CATEGORIES.SLEEP_DETAIL, 'deep_sleep'),
            category: CATEGORIES.SLEEP_DETAIL,
            insight: `🌙 Good deep sleep (1.5h+) correlates with ${Math.abs(moodDelta)}% better mood`,
            moodDelta,
            direction: 'positive',
            strength,
            sampleSize: deepSleepEntries.length,
            recommendation: 'Prioritize sleep hygiene for better deep sleep',
            entryIds: goodDeepSleep.map(e => e.entryId).filter(Boolean)
          });
        }
      }
    }
  }

  // ===== REM SLEEP-MOOD CORRELATION =====
  const remSleepEntries = entriesWithData.filter(e => e.remSleepHours != null);
  if (remSleepEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {
    const goodREM = remSleepEntries.filter(e => e.remSleepHours >= 1.5);
    const poorREM = remSleepEntries.filter(e => e.remSleepHours < 1);

    if (goodREM.length >= 2 && poorREM.length >= 2) {
      const goodMood = average(goodREM.map(e => e.mood));
      const poorMood = average(poorREM.map(e => e.mood));
      const moodDelta = calculateMoodDelta(goodMood, poorMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
        const strength = determineStrength(moodDelta, remSleepEntries.length);

        if (strength !== 'weak') {
          insights.push({
            id: generateInsightId(CATEGORIES.SLEEP_DETAIL, 'rem_sleep'),
            category: CATEGORIES.SLEEP_DETAIL,
            insight: `💤 Good REM sleep (1.5h+) correlates with ${Math.abs(moodDelta)}% better mood`,
            moodDelta,
            direction: 'positive',
            strength,
            sampleSize: remSleepEntries.length,
            recommendation: 'REM sleep helps emotional processing - maintain consistent sleep schedule',
            entryIds: goodREM.map(e => e.entryId).filter(Boolean)
          });
        }
      }
    }
  }

  // ===== ACTIVE CALORIES-MOOD CORRELATION =====
  const calorieEntries = entriesWithData.filter(e => e.activeCalories != null);
  if (calorieEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {
    const activeCalorieEntries = calorieEntries.filter(e => e.activeCalories >= 500);
    const lowCalorieEntries = calorieEntries.filter(e => e.activeCalories < 200);

    if (activeCalorieEntries.length >= 2 && lowCalorieEntries.length >= 2) {
      const activeMood = average(activeCalorieEntries.map(e => e.mood));
      const lowMood = average(lowCalorieEntries.map(e => e.mood));
      const moodDelta = calculateMoodDelta(activeMood, lowMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
        const strength = determineStrength(moodDelta, calorieEntries.length);

        if (strength !== 'weak') {
          insights.push({
            id: generateInsightId(CATEGORIES.HEALTH, 'active_calories'),
            category: CATEGORIES.HEALTH,
            insight: `🔥 Active days (500+ calories burned) show ${Math.abs(moodDelta)}% better mood`,
            moodDelta,
            direction: 'positive',
            strength,
            sampleSize: calorieEntries.length,
            recommendation: 'Try to stay physically active throughout the day',
            entryIds: activeCalorieEntries.map(e => e.entryId).filter(Boolean)
          });
        }
      }
    }
  }

  // ===== EXERCISE MINUTES-MOOD CORRELATION =====
  const exerciseEntries = entriesWithData.filter(e => e.exerciseMinutes != null);
  if (exerciseEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {
    const activeExercise = exerciseEntries.filter(e => e.exerciseMinutes >= 30);
    const lowExercise = exerciseEntries.filter(e => e.exerciseMinutes < 10);

    if (activeExercise.length >= 2 && lowExercise.length >= 2) {
      const activeMood = average(activeExercise.map(e => e.mood));
      const lowMood = average(lowExercise.map(e => e.mood));
      const moodDelta = calculateMoodDelta(activeMood, lowMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
        const strength = determineStrength(moodDelta, exerciseEntries.length);

        if (strength !== 'weak') {
          insights.push({
            id: generateInsightId(CATEGORIES.HEALTH, 'exercise_minutes'),
            category: CATEGORIES.HEALTH,
            insight: `⏱️ 30+ minutes of exercise correlates with ${Math.abs(moodDelta)}% better mood`,
            moodDelta,
            direction: 'positive',
            strength,
            sampleSize: exerciseEntries.length,
            recommendation: 'Aim for at least 30 minutes of exercise daily',
            entryIds: activeExercise.map(e => e.entryId).filter(Boolean)
          });
        }
      }
    }
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeExtendedHealthCorrelations
};
