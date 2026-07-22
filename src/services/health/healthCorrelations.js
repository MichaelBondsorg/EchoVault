/**
 * Health-Mood Correlations Service
 *
 * Computes statistical correlations between health metrics and mood.
 * Used by Nexus 2.0 to generate insights like:
 * - "Mood is 22% higher on days with 7+ hours of sleep"
 * - "HRV above 50ms correlates with better mood"
 * - "Workout days show 18% mood improvement"
 */

import { extractHealthSignals } from './healthFormatter';
import { average, median, stdDev, pearsonCorrelation } from '../../utils/statistics';

/**
 * Compute correlations between health metrics and mood
 *
 * @param {Array} entries - Journal entries with healthContext and analysis.mood_score
 * @returns {Object|null} Correlation insights or null if insufficient data
 */
export const computeHealthMoodCorrelations = (entries) => {
  // Extract entries with both mood and health data
  const dataPoints = entries
    .filter(e => e.analysis?.mood_score != null && e.healthContext)
    .map(e => ({
      mood: e.analysis.mood_score,
      date: e.createdAt,
      ...extractHealthSignals(e.healthContext)
    }));

  if (dataPoints.length < 7) {
    return null; // Need at least 7 data points for meaningful correlations
  }

  const correlations = {};

  // ===== SLEEP-MOOD CORRELATION =====
  // R4 T1b: `average([])` returns 0 (src/utils/statistics.js), so an empty
  // good/poor group used to silently become a fabricated "0% mood" data
  // point instead of no data at all — manufacturing a large false
  // difference against whatever real value the other side had. Both sides
  // must have at least one member before this comparison runs at all.
  const sleepData = dataPoints.filter(d => d.sleepHours != null);
  if (sleepData.length >= 5) {
    // Compare good sleep (7+h) vs poor sleep (<6h)
    const goodSleepEntries = sleepData.filter(d => d.sleepHours >= 7);
    const poorSleepEntries = sleepData.filter(d => d.sleepHours < 6);

    if (goodSleepEntries.length > 0 && poorSleepEntries.length > 0) {
      const goodSleepMood = average(goodSleepEntries.map(d => d.mood));
      const poorSleepMood = average(poorSleepEntries.map(d => d.mood));
      const sleepMoods = sleepData.map(d => d.mood);
      const sleepHours = sleepData.map(d => d.sleepHours);
      const sleepCorr = pearsonCorrelation(sleepHours, sleepMoods);

      if (Math.abs(goodSleepMood - poorSleepMood) > 0.1 || Math.abs(sleepCorr) > 0.3) {
        correlations.sleepMood = {
          type: 'sleep_mood',
          correlation: sleepCorr,
          goodSleepAvgMood: goodSleepMood,
          poorSleepAvgMood: poorSleepMood,
          difference: goodSleepMood - poorSleepMood,
          insight: `Mood is ${Math.round(Math.abs(goodSleepMood - poorSleepMood) * 100)}% ${goodSleepMood > poorSleepMood ? 'higher' : 'lower'} on days with 7+ hours of sleep`,
          strength: Math.abs(sleepCorr) > 0.5 ? 'strong' : Math.abs(sleepCorr) > 0.3 ? 'moderate' : 'weak',
          sampleSize: sleepData.length
        };
      }
    }
  }

  // ===== SLEEP SCORE-MOOD CORRELATION =====
  const sleepScoreData = dataPoints.filter(d => d.sleepScore != null);
  if (sleepScoreData.length >= 5) {
    const highScoreEntries = sleepScoreData.filter(d => d.sleepScore >= 80);
    const lowScoreEntries = sleepScoreData.filter(d => d.sleepScore < 60);

    if (highScoreEntries.length > 0 && lowScoreEntries.length > 0) {
      const highScoreMood = average(highScoreEntries.map(d => d.mood));
      const lowScoreMood = average(lowScoreEntries.map(d => d.mood));

      if (Math.abs(highScoreMood - lowScoreMood) > 0.15) {
        correlations.sleepQualityMood = {
          type: 'sleep_quality_mood',
          highScoreAvgMood: highScoreMood,
          lowScoreAvgMood: lowScoreMood,
          difference: highScoreMood - lowScoreMood,
          insight: `Sleep quality (score 80+) correlates with ${Math.round((highScoreMood - lowScoreMood) * 100)}% better mood`,
          strength: highScoreMood - lowScoreMood > 0.25 ? 'strong' : 'moderate',
          sampleSize: sleepScoreData.length
        };
      }
    }
  }

  // ===== HRV-MOOD CORRELATION =====
  const hrvData = dataPoints.filter(d => d.hrv != null);
  if (hrvData.length >= 5) {
    const medianHRV = median(hrvData.map(d => d.hrv));
    const highHRVEntries = hrvData.filter(d => d.hrv >= medianHRV);
    const lowHRVEntries = hrvData.filter(d => d.hrv < medianHRV);

    if (highHRVEntries.length > 0 && lowHRVEntries.length > 0) {
      const highHRVMood = average(highHRVEntries.map(d => d.mood));
      const lowHRVMood = average(lowHRVEntries.map(d => d.mood));
      const hrvMoods = hrvData.map(d => d.mood);
      const hrvValues = hrvData.map(d => d.hrv);
      const hrvCorr = pearsonCorrelation(hrvValues, hrvMoods);

      if (Math.abs(highHRVMood - lowHRVMood) > 0.1 || Math.abs(hrvCorr) > 0.3) {
        correlations.hrvMood = {
          type: 'hrv_mood',
          correlation: hrvCorr,
          medianHRV,
          highHRVAvgMood: highHRVMood,
          lowHRVAvgMood: lowHRVMood,
          difference: highHRVMood - lowHRVMood,
          insight: `Higher HRV (${Math.round(medianHRV)}ms+) correlates with ${Math.round(Math.abs(highHRVMood - lowHRVMood) * 100)}% ${highHRVMood > lowHRVMood ? 'better' : 'worse'} mood`,
          strength: Math.abs(hrvCorr) > 0.5 ? 'strong' : Math.abs(hrvCorr) > 0.3 ? 'moderate' : 'weak',
          sampleSize: hrvData.length
        };
      }
    }
  }

  // ===== EXERCISE-MOOD CORRELATION =====
  const exerciseData = dataPoints.filter(d => d.hadWorkout != null);
  if (exerciseData.length >= 5) {
    const workoutMood = average(exerciseData.filter(d => d.hadWorkout).map(d => d.mood));
    const noWorkoutMood = average(exerciseData.filter(d => !d.hadWorkout).map(d => d.mood));
    const workoutDays = exerciseData.filter(d => d.hadWorkout).length;
    const restDays = exerciseData.filter(d => !d.hadWorkout).length;

    if (workoutDays >= 2 && restDays >= 2 && Math.abs(workoutMood - noWorkoutMood) > 0.08) {
      correlations.exerciseMood = {
        type: 'exercise_mood',
        workoutDayMood: workoutMood,
        restDayMood: noWorkoutMood,
        difference: workoutMood - noWorkoutMood,
        workoutDays,
        restDays,
        insight: `Mood averages ${Math.round(Math.abs(workoutMood - noWorkoutMood) * 100)}% ${workoutMood > noWorkoutMood ? 'higher' : 'lower'} on workout days`,
        strength: workoutMood - noWorkoutMood > 0.2 ? 'strong' : 'moderate',
        sampleSize: exerciseData.length
      };
    }
  }

  // ===== RECOVERY-MOOD CORRELATION (Whoop) =====
  const recoveryData = dataPoints.filter(d => d.recoveryScore != null);
  if (recoveryData.length >= 5) {
    const greenMood = average(recoveryData.filter(d => d.recoveryScore >= 67).map(d => d.mood));
    const yellowMood = average(recoveryData.filter(d => d.recoveryScore >= 34 && d.recoveryScore < 67).map(d => d.mood));
    const redMood = average(recoveryData.filter(d => d.recoveryScore < 34).map(d => d.mood));

    const hasGreen = recoveryData.filter(d => d.recoveryScore >= 67).length >= 2;
    const hasRed = recoveryData.filter(d => d.recoveryScore < 34).length >= 2;

    if (hasGreen && hasRed && Math.abs(greenMood - redMood) > 0.15) {
      correlations.recoveryMood = {
        type: 'recovery_mood',
        greenZoneMood: greenMood,
        yellowZoneMood: yellowMood,
        redZoneMood: redMood,
        greenRedDifference: greenMood - redMood,
        insight: `Green recovery days have ${Math.round((greenMood - redMood) * 100)}% higher mood than red days`,
        strength: 'strong',
        sampleSize: recoveryData.length
      };
    }
  }

  // ===== STEPS-MOOD CORRELATION =====
  const stepsData = dataPoints.filter(d => d.steps != null && d.steps > 0);
  if (stepsData.length >= 5) {
    const medianSteps = median(stepsData.map(d => d.steps));
    const activeStepsMood = average(stepsData.filter(d => d.steps >= 8000).map(d => d.mood));
    const lowStepsMood = average(stepsData.filter(d => d.steps < 4000).map(d => d.mood));

    if (stepsData.filter(d => d.steps >= 8000).length >= 2 &&
        stepsData.filter(d => d.steps < 4000).length >= 2 &&
        Math.abs(activeStepsMood - lowStepsMood) > 0.1) {
      correlations.stepsMood = {
        type: 'steps_mood',
        medianSteps,
        activeDayMood: activeStepsMood,
        sedentaryDayMood: lowStepsMood,
        difference: activeStepsMood - lowStepsMood,
        insight: `Active days (8k+ steps) show ${Math.round(Math.abs(activeStepsMood - lowStepsMood) * 100)}% ${activeStepsMood > lowStepsMood ? 'better' : 'worse'} mood`,
        strength: activeStepsMood - lowStepsMood > 0.2 ? 'strong' : 'moderate',
        sampleSize: stepsData.length
      };
    }
  }

  // ===== RHR-MOOD CORRELATION =====
  const rhrData = dataPoints.filter(d => d.rhr != null);
  if (rhrData.length >= 5) {
    const medianRHR = median(rhrData.map(d => d.rhr));
    const lowRHREntries = rhrData.filter(d => d.rhr <= medianRHR);
    const highRHREntries = rhrData.filter(d => d.rhr > medianRHR);

    if (lowRHREntries.length > 0 && highRHREntries.length > 0) {
      const lowRHRMood = average(lowRHREntries.map(d => d.mood));
      const highRHRMood = average(highRHREntries.map(d => d.mood));

      if (Math.abs(lowRHRMood - highRHRMood) > 0.1) {
        correlations.rhrMood = {
          type: 'rhr_mood',
          medianRHR,
          lowRHRMood,
          highRHRMood,
          difference: lowRHRMood - highRHRMood,
          insight: `Lower resting heart rate (${Math.round(medianRHR)}bpm or less) correlates with ${Math.round(Math.abs(lowRHRMood - highRHRMood) * 100)}% better mood`,
          strength: Math.abs(lowRHRMood - highRHRMood) > 0.2 ? 'strong' : 'moderate',
          sampleSize: rhrData.length
        };
      }
    }
  }

  return Object.keys(correlations).length > 0 ? correlations : null;
};

/**
 * Get top health insights for display
 * @param {Array} entries - Journal entries
 * @param {number} maxInsights - Maximum insights to return
 * @returns {Array} Top insights sorted by strength
 */
export const getTopHealthInsights = (entries, maxInsights = 3) => {
  const correlations = computeHealthMoodCorrelations(entries);
  if (!correlations) return [];

  const insights = Object.values(correlations)
    .filter(c => c.insight)
    .sort((a, b) => {
      const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
      return (strengthOrder[b.strength] || 0) - (strengthOrder[a.strength] || 0);
    })
    .slice(0, maxInsights);

  return insights;
};

/**
 * Check if user has enough data for correlations
 * @param {Array} entries - Journal entries
 * @returns {Object} { hasEnoughData, dataPoints, message }
 */
export const checkHealthDataSufficiency = (entries) => {
  const withHealth = entries.filter(e => e.healthContext && e.analysis?.mood_score != null);

  if (withHealth.length < 7) {
    return {
      hasEnoughData: false,
      dataPoints: withHealth.length,
      needed: 7,
      message: `Need ${7 - withHealth.length} more entries with health data for correlations`
    };
  }

  return {
    hasEnoughData: true,
    dataPoints: withHealth.length,
    message: 'Sufficient data for health-mood correlations'
  };
};

export default {
  computeHealthMoodCorrelations,
  getTopHealthInsights,
  checkHealthDataSufficiency
};
