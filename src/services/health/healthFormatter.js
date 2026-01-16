/**
 * Health Context Formatter
 *
 * Formats health data (HealthKit, Whoop) for AI consumption.
 * Produces human-readable summaries with key signals for:
 * - AI Chat (askJournalAI)
 * - Insight Generation (generateInsight)
 * - Day Summaries (generateDaySummary)
 * - Nexus 2.0 pattern detection
 */

/**
 * Format health context for AI consumption (compact, single-line)
 * Used in entry context strings for chat and insights
 *
 * @param {Object} healthContext - Health data from entry
 * @returns {string|null} Formatted health string or null if no data
 */
export const formatHealthForAI = (healthContext) => {
  if (!healthContext) return null;

  const parts = [];

  // Sleep summary
  if (healthContext.sleep?.totalHours) {
    const quality = healthContext.sleep.quality ||
                    (healthContext.sleep.score >= 80 ? 'excellent' :
                     healthContext.sleep.score >= 60 ? 'good' :
                     healthContext.sleep.score >= 40 ? 'fair' : 'poor');
    parts.push(`Sleep: ${healthContext.sleep.totalHours.toFixed(1)}h (${quality})`);
    if (healthContext.sleep.score) {
      parts.push(`score: ${healthContext.sleep.score}/100`);
    }
  }

  // HRV/Stress indicators
  if (healthContext.heart?.hrv) {
    const status = healthContext.heart.hrvTrend ||
                   (healthContext.heart.hrv >= 50 ? 'good recovery' :
                    healthContext.heart.hrv >= 30 ? 'normal' : 'elevated stress');
    parts.push(`HRV: ${healthContext.heart.hrv}ms (${status})`);
  }

  if (healthContext.heart?.restingRate) {
    parts.push(`RHR: ${healthContext.heart.restingRate}bpm`);
  }

  // Recovery (Whoop)
  if (healthContext.recovery?.score) {
    parts.push(`Recovery: ${healthContext.recovery.score}%`);
  }

  // Strain (Whoop)
  if (healthContext.strain?.score) {
    parts.push(`Strain: ${healthContext.strain.score.toFixed(1)}`);
  }

  // Activity
  if (healthContext.activity?.stepsToday) {
    parts.push(`Steps: ${healthContext.activity.stepsToday.toLocaleString()}`);
  }

  if (healthContext.activity?.hasWorkout && healthContext.activity?.workouts?.length) {
    const workout = healthContext.activity.workouts[0];
    const type = workout.type || workout.activityType || 'exercise';
    const duration = workout.duration || workout.durationMinutes;
    if (duration) {
      parts.push(`Workout: ${type} (${Math.round(duration)}min)`);
    }
  }

  return parts.length > 0 ? `[Health: ${parts.join(' | ')}]` : null;
};

/**
 * Format health data for detailed analysis (multi-line, verbose)
 * Used in day summaries and deep analysis
 *
 * @param {Object} healthContext - Health data from entry
 * @returns {string|null} Formatted health sections or null if no data
 */
export const formatHealthDetailed = (healthContext) => {
  if (!healthContext) return null;

  const sections = [];

  if (healthContext.sleep) {
    const s = healthContext.sleep;
    sections.push(`SLEEP: ${s.totalHours?.toFixed(1) || '?'}h total, ` +
                  `quality: ${s.quality || 'unknown'}, ` +
                  `score: ${s.score || '?'}/100` +
                  (s.stages ? `, deep: ${s.stages.deep?.toFixed(1) || '?'}h, ` +
                             `REM: ${s.stages.rem?.toFixed(1) || '?'}h` : ''));
  }

  if (healthContext.heart) {
    const h = healthContext.heart;
    sections.push(`HEART: HRV ${h.hrv || '?'}ms (${h.hrvTrend || 'unknown trend'}), ` +
                  `RHR ${h.restingRate || '?'}bpm` +
                  (h.stressIndicator ? `, stress: ${h.stressIndicator}` : ''));
  }

  if (healthContext.recovery) {
    sections.push(`RECOVERY: ${healthContext.recovery.score}% ` +
                  `(${healthContext.recovery.status || 'unknown'})`);
  }

  if (healthContext.strain) {
    sections.push(`STRAIN: ${healthContext.strain.score?.toFixed(1) || '?'}`);
  }

  if (healthContext.activity) {
    const a = healthContext.activity;
    sections.push(`ACTIVITY: ${a.stepsToday?.toLocaleString() || '?'} steps, ` +
                  `${a.totalExerciseMinutes || 0}min exercise` +
                  (a.hasWorkout ? `, workout: ${a.workouts?.[0]?.type || 'yes'}` : ''));
  }

  return sections.length > 0 ? sections.join('\n') : null;
};

/**
 * Extract key health signals for pattern detection and correlations
 * Returns normalized, typed values for statistical analysis
 *
 * @param {Object} healthContext - Health data from entry
 * @returns {Object|null} Extracted signals or null if no data
 */
export const extractHealthSignals = (healthContext) => {
  if (!healthContext) return null;

  return {
    // Sleep
    sleepHours: healthContext.sleep?.totalHours || null,
    sleepScore: healthContext.sleep?.score || null,
    sleepQuality: healthContext.sleep?.quality || null,
    deepSleepHours: healthContext.sleep?.stages?.deep || null,
    remSleepHours: healthContext.sleep?.stages?.rem || null,

    // Heart/HRV
    hrv: healthContext.heart?.hrv || null,
    hrvTrend: healthContext.heart?.hrvTrend || null,
    rhr: healthContext.heart?.restingRate || null,
    stressLevel: healthContext.heart?.stressIndicator || null,

    // Whoop
    recoveryScore: healthContext.recovery?.score || null,
    recoveryStatus: healthContext.recovery?.status || null,
    strainScore: healthContext.strain?.score || null,

    // Activity
    steps: healthContext.activity?.stepsToday || null,
    exerciseMinutes: healthContext.activity?.totalExerciseMinutes || null,
    hadWorkout: healthContext.activity?.hasWorkout || false,
    workoutType: healthContext.activity?.workouts?.[0]?.type || null,
    workoutDuration: healthContext.activity?.workouts?.[0]?.duration ||
                     healthContext.activity?.workouts?.[0]?.durationMinutes || null
  };
};

/**
 * Get a brief health status summary for UI badges
 *
 * @param {Object} healthContext - Health data from entry
 * @returns {Object} Status indicators for UI
 */
export const getHealthStatus = (healthContext) => {
  if (!healthContext) return { hasData: false };

  const status = { hasData: true };

  // Sleep status
  if (healthContext.sleep?.totalHours) {
    status.sleep = {
      hours: healthContext.sleep.totalHours,
      score: healthContext.sleep.score,
      level: healthContext.sleep.score >= 80 ? 'good' :
             healthContext.sleep.score >= 60 ? 'fair' : 'poor'
    };
  }

  // HRV status
  if (healthContext.heart?.hrv) {
    status.hrv = {
      value: healthContext.heart.hrv,
      trend: healthContext.heart.hrvTrend,
      level: healthContext.heart.hrv >= 50 ? 'good' :
             healthContext.heart.hrv >= 30 ? 'normal' : 'stressed'
    };
  }

  // Recovery status (Whoop)
  if (healthContext.recovery?.score) {
    status.recovery = {
      score: healthContext.recovery.score,
      level: healthContext.recovery.score >= 67 ? 'green' :
             healthContext.recovery.score >= 34 ? 'yellow' : 'red'
    };
  }

  // Activity status
  if (healthContext.activity?.stepsToday || healthContext.activity?.hasWorkout) {
    status.activity = {
      steps: healthContext.activity.stepsToday,
      hadWorkout: healthContext.activity.hasWorkout,
      workoutType: healthContext.activity.workouts?.[0]?.type
    };
  }

  return status;
};

export default {
  formatHealthForAI,
  formatHealthDetailed,
  extractHealthSignals,
  getHealthStatus
};
