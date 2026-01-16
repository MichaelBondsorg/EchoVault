/**
 * Health-Mood Correlation Analysis
 *
 * Correlates health metrics with mood scores to identify patterns.
 * Uses statistical correlation to find meaningful relationships.
 *
 * Key insight: "Your mood is 23% higher on days you get 7+ hours of sleep"
 */

/**
 * Calculate Pearson correlation coefficient
 *
 * @param {Array} x - First variable values
 * @param {Array} y - Second variable values
 * @returns {number} Correlation coefficient (-1 to 1)
 */
const pearsonCorrelation = (x, y) => {
  if (x.length !== y.length || x.length < 3) return null;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
};

/**
 * Analyze correlations between health metrics and mood
 *
 * @param {Array} entries - Journal entries with mood_score
 * @param {Array} healthHistory - Daily health summaries
 * @returns {Object} Correlation analysis
 */
export const analyzeHealthMoodCorrelations = (entries, healthHistory) => {
  if (!entries?.length || !healthHistory?.length) {
    return { available: false, reason: 'insufficient_data' };
  }

  // Match entries with health data by date
  const paired = pairEntriesWithHealth(entries, healthHistory);

  if (paired.length < 5) {
    return { available: false, reason: 'insufficient_pairs', count: paired.length };
  }

  // Calculate correlations
  const correlations = {
    sleep: analyzeSleepCorrelation(paired),
    steps: analyzeStepsCorrelation(paired),
    workout: analyzeWorkoutCorrelation(paired),
    stress: analyzeStressCorrelation(paired),
    recovery: analyzeRecoveryCorrelation(paired),
    strain: analyzeStrainCorrelation(paired)
  };

  // Generate insights
  const insights = generateHealthInsights(correlations, paired);

  // Generate recommendations
  const recommendations = generateHealthRecommendations(correlations, paired);

  return {
    available: true,
    pairsAnalyzed: paired.length,
    correlations,
    insights,
    recommendations,
    analyzedAt: new Date().toISOString()
  };
};

/**
 * Pair entries with health data by matching dates
 */
const pairEntriesWithHealth = (entries, healthHistory) => {
  const healthByDate = {};
  for (const h of healthHistory) {
    if (h.date) {
      healthByDate[h.date] = h;
    }
  }

  const pairs = [];
  for (const entry of entries) {
    const entryDate = (entry.createdAt?.toDate?.() || new Date(entry.createdAt))
      .toISOString().split('T')[0];

    if (healthByDate[entryDate] && entry.analysis?.mood_score !== undefined) {
      pairs.push({
        date: entryDate,
        moodScore: entry.analysis.mood_score,
        health: healthByDate[entryDate]
      });
    }
  }

  return pairs;
};

/**
 * Analyze sleep-mood correlation
 */
const analyzeSleepCorrelation = (pairs) => {
  const validPairs = pairs.filter(p => p.health.sleep?.totalHours !== null);

  if (validPairs.length < 5) {
    return { available: false, reason: 'insufficient_sleep_data' };
  }

  const sleepHours = validPairs.map(p => p.health.sleep.totalHours);
  const moods = validPairs.map(p => p.moodScore);

  const correlation = pearsonCorrelation(sleepHours, moods);

  // Calculate mood difference above/below 7 hours
  const above7 = validPairs.filter(p => p.health.sleep.totalHours >= 7);
  const below7 = validPairs.filter(p => p.health.sleep.totalHours < 7);

  const avgMoodAbove7 = above7.length > 0
    ? above7.reduce((sum, p) => sum + p.moodScore, 0) / above7.length
    : null;
  const avgMoodBelow7 = below7.length > 0
    ? below7.reduce((sum, p) => sum + p.moodScore, 0) / below7.length
    : null;

  const moodDifference = avgMoodAbove7 !== null && avgMoodBelow7 !== null
    ? avgMoodAbove7 - avgMoodBelow7
    : null;

  const percentDifference = moodDifference !== null && avgMoodBelow7 > 0
    ? Math.round((moodDifference / avgMoodBelow7) * 100)
    : null;

  return {
    available: true,
    correlation: Math.round(correlation * 100) / 100,
    strength: getCorrelationStrength(correlation),
    avgSleepHours: Math.round(sleepHours.reduce((a, b) => a + b, 0) / sleepHours.length * 10) / 10,
    moodWhenWellRested: avgMoodAbove7 !== null ? Math.round(avgMoodAbove7 * 100) / 100 : null,
    moodWhenTired: avgMoodBelow7 !== null ? Math.round(avgMoodBelow7 * 100) / 100 : null,
    percentBoost: percentDifference,
    sampleSize: validPairs.length
  };
};

/**
 * Analyze steps-mood correlation
 */
const analyzeStepsCorrelation = (pairs) => {
  const validPairs = pairs.filter(p => p.health.steps !== null);

  if (validPairs.length < 5) {
    return { available: false, reason: 'insufficient_steps_data' };
  }

  const steps = validPairs.map(p => p.health.steps);
  const moods = validPairs.map(p => p.moodScore);

  const correlation = pearsonCorrelation(steps, moods);

  // Compare active vs sedentary days (5000 steps threshold)
  const activeDays = validPairs.filter(p => p.health.steps >= 5000);
  const sedentaryDays = validPairs.filter(p => p.health.steps < 5000);

  const avgMoodActive = activeDays.length > 0
    ? activeDays.reduce((sum, p) => sum + p.moodScore, 0) / activeDays.length
    : null;
  const avgMoodSedentary = sedentaryDays.length > 0
    ? sedentaryDays.reduce((sum, p) => sum + p.moodScore, 0) / sedentaryDays.length
    : null;

  return {
    available: true,
    correlation: Math.round(correlation * 100) / 100,
    strength: getCorrelationStrength(correlation),
    avgDailySteps: Math.round(steps.reduce((a, b) => a + b, 0) / steps.length),
    moodOnActiveDays: avgMoodActive !== null ? Math.round(avgMoodActive * 100) / 100 : null,
    moodOnSedentaryDays: avgMoodSedentary !== null ? Math.round(avgMoodSedentary * 100) / 100 : null,
    sampleSize: validPairs.length
  };
};

/**
 * Analyze workout-mood correlation
 */
const analyzeWorkoutCorrelation = (pairs) => {
  const workoutDays = pairs.filter(p => p.health.hasWorkout);
  const restDays = pairs.filter(p => !p.health.hasWorkout);

  if (workoutDays.length < 3 || restDays.length < 3) {
    return { available: false, reason: 'insufficient_workout_data' };
  }

  const avgMoodWorkout = workoutDays.reduce((sum, p) => sum + p.moodScore, 0) / workoutDays.length;
  const avgMoodRest = restDays.reduce((sum, p) => sum + p.moodScore, 0) / restDays.length;

  const moodBoost = avgMoodWorkout - avgMoodRest;
  const percentBoost = avgMoodRest > 0
    ? Math.round((moodBoost / avgMoodRest) * 100)
    : null;

  return {
    available: true,
    workoutDays: workoutDays.length,
    restDays: restDays.length,
    moodOnWorkoutDays: Math.round(avgMoodWorkout * 100) / 100,
    moodOnRestDays: Math.round(avgMoodRest * 100) / 100,
    moodBoost: Math.round(moodBoost * 100) / 100,
    percentBoost
  };
};

/**
 * Analyze stress (HRV) - mood correlation
 */
const analyzeStressCorrelation = (pairs) => {
  const validPairs = pairs.filter(p => p.health.hrv?.average !== null);

  if (validPairs.length < 5) {
    return { available: false, reason: 'insufficient_hrv_data' };
  }

  const hrvValues = validPairs.map(p => p.health.hrv.average);
  const moods = validPairs.map(p => p.moodScore);

  // Higher HRV = lower stress = better mood (expect positive correlation)
  const correlation = pearsonCorrelation(hrvValues, moods);

  // Compare by stress indicator
  const lowStress = validPairs.filter(p => p.health.hrv.stressIndicator === 'low');
  const highStress = validPairs.filter(p => p.health.hrv.stressIndicator === 'high');

  const avgMoodLowStress = lowStress.length > 0
    ? lowStress.reduce((sum, p) => sum + p.moodScore, 0) / lowStress.length
    : null;
  const avgMoodHighStress = highStress.length > 0
    ? highStress.reduce((sum, p) => sum + p.moodScore, 0) / highStress.length
    : null;

  return {
    available: true,
    correlation: Math.round(correlation * 100) / 100,
    strength: getCorrelationStrength(correlation),
    avgHRV: Math.round(hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length),
    moodWhenRelaxed: avgMoodLowStress !== null ? Math.round(avgMoodLowStress * 100) / 100 : null,
    moodWhenStressed: avgMoodHighStress !== null ? Math.round(avgMoodHighStress * 100) / 100 : null,
    sampleSize: validPairs.length
  };
};

/**
 * Analyze Whoop recovery - mood correlation
 * Recovery score (0-100) indicates readiness
 */
const analyzeRecoveryCorrelation = (pairs) => {
  const validPairs = pairs.filter(p => p.health.recovery?.score !== null && p.health.recovery?.score !== undefined);

  if (validPairs.length < 5) {
    return { available: false, reason: 'insufficient_recovery_data' };
  }

  const recoveryScores = validPairs.map(p => p.health.recovery.score);
  const moods = validPairs.map(p => p.moodScore);

  const correlation = pearsonCorrelation(recoveryScores, moods);

  // Compare by recovery status (green: 67+, yellow: 34-66, red: <34)
  const greenRecovery = validPairs.filter(p => p.health.recovery.score >= 67);
  const redRecovery = validPairs.filter(p => p.health.recovery.score < 34);

  const avgMoodGreen = greenRecovery.length > 0
    ? greenRecovery.reduce((sum, p) => sum + p.moodScore, 0) / greenRecovery.length
    : null;
  const avgMoodRed = redRecovery.length > 0
    ? redRecovery.reduce((sum, p) => sum + p.moodScore, 0) / redRecovery.length
    : null;

  const moodDifference = avgMoodGreen !== null && avgMoodRed !== null
    ? avgMoodGreen - avgMoodRed
    : null;

  const percentDifference = moodDifference !== null && avgMoodRed > 0
    ? Math.round((moodDifference / avgMoodRed) * 100)
    : null;

  return {
    available: true,
    correlation: Math.round(correlation * 100) / 100,
    strength: getCorrelationStrength(correlation),
    avgRecovery: Math.round(recoveryScores.reduce((a, b) => a + b, 0) / recoveryScores.length),
    moodWhenRecovered: avgMoodGreen !== null ? Math.round(avgMoodGreen * 100) / 100 : null,
    moodWhenDepleted: avgMoodRed !== null ? Math.round(avgMoodRed * 100) / 100 : null,
    percentBoost: percentDifference,
    sampleSize: validPairs.length
  };
};

/**
 * Analyze Whoop strain - mood correlation
 * Strain (0-21) measures exertion level
 */
const analyzeStrainCorrelation = (pairs) => {
  const validPairs = pairs.filter(p => p.health.strain?.score !== null && p.health.strain?.score !== undefined);

  if (validPairs.length < 5) {
    return { available: false, reason: 'insufficient_strain_data' };
  }

  const strainScores = validPairs.map(p => p.health.strain.score);
  const moods = validPairs.map(p => p.moodScore);

  const correlation = pearsonCorrelation(strainScores, moods);

  // Compare high strain vs low strain days (10 is moderate threshold)
  const highStrainDays = validPairs.filter(p => p.health.strain.score >= 10);
  const lowStrainDays = validPairs.filter(p => p.health.strain.score < 10);

  const avgMoodHighStrain = highStrainDays.length > 0
    ? highStrainDays.reduce((sum, p) => sum + p.moodScore, 0) / highStrainDays.length
    : null;
  const avgMoodLowStrain = lowStrainDays.length > 0
    ? lowStrainDays.reduce((sum, p) => sum + p.moodScore, 0) / lowStrainDays.length
    : null;

  return {
    available: true,
    correlation: Math.round(correlation * 100) / 100,
    strength: getCorrelationStrength(correlation),
    avgStrain: Math.round(strainScores.reduce((a, b) => a + b, 0) / strainScores.length * 10) / 10,
    moodOnHighStrainDays: avgMoodHighStrain !== null ? Math.round(avgMoodHighStrain * 100) / 100 : null,
    moodOnLowStrainDays: avgMoodLowStrain !== null ? Math.round(avgMoodLowStrain * 100) / 100 : null,
    sampleSize: validPairs.length
  };
};

/**
 * Get correlation strength label
 */
const getCorrelationStrength = (r) => {
  const abs = Math.abs(r);
  if (abs >= 0.7) return 'strong';
  if (abs >= 0.4) return 'moderate';
  if (abs >= 0.2) return 'weak';
  return 'negligible';
};

/**
 * Generate insights from correlations
 */
const generateHealthInsights = (correlations, pairs) => {
  const insights = [];

  // Sleep insight
  if (correlations.sleep?.available && correlations.sleep.percentBoost !== null) {
    if (correlations.sleep.percentBoost > 10) {
      insights.push({
        type: 'sleep',
        priority: 'high',
        icon: 'Moon',
        message: `Your mood is ${correlations.sleep.percentBoost}% higher on days you get 7+ hours of sleep.`,
        actionable: true
      });
    } else if (correlations.sleep.percentBoost < -10) {
      insights.push({
        type: 'sleep',
        priority: 'medium',
        icon: 'Moon',
        message: `Interestingly, more sleep doesn't seem to boost your mood. Quality might matter more than quantity.`,
        actionable: false
      });
    }
  }

  // Workout insight
  if (correlations.workout?.available && correlations.workout.percentBoost !== null) {
    if (correlations.workout.percentBoost > 5) {
      insights.push({
        type: 'workout',
        priority: 'high',
        icon: 'Activity',
        message: `Days with workouts show a ${correlations.workout.moodBoost.toFixed(2)} point mood boost (${correlations.workout.percentBoost}% higher).`,
        actionable: true
      });
    }
  }

  // Steps insight
  if (correlations.steps?.available && correlations.steps.strength !== 'negligible') {
    if (correlations.steps.correlation > 0.2) {
      insights.push({
        type: 'steps',
        priority: 'medium',
        icon: 'Footprints',
        message: `There's a ${correlations.steps.strength} link between your step count and mood. More movement, better mood.`,
        actionable: true
      });
    }
  }

  // Stress/HRV insight
  if (correlations.stress?.available) {
    if (correlations.stress.moodWhenRelaxed && correlations.stress.moodWhenStressed) {
      const diff = correlations.stress.moodWhenRelaxed - correlations.stress.moodWhenStressed;
      if (diff > 0.1) {
        insights.push({
          type: 'stress',
          priority: 'high',
          icon: 'Heart',
          message: `Your HRV shows stress levels predict your mood. On relaxed days, mood is ${(diff * 100).toFixed(0)}% higher.`,
          actionable: true
        });
      }
    }
  }

  // Whoop Recovery insight
  if (correlations.recovery?.available && correlations.recovery.percentBoost !== null) {
    if (correlations.recovery.percentBoost > 10) {
      insights.push({
        type: 'recovery',
        priority: 'high',
        icon: 'TrendingUp',
        message: `Your Whoop recovery score strongly predicts mood. When recovered (green), mood is ${correlations.recovery.percentBoost}% higher.`,
        actionable: true
      });
    }
  }

  // Whoop Strain insight
  if (correlations.strain?.available) {
    if (correlations.strain.moodOnHighStrainDays && correlations.strain.moodOnLowStrainDays) {
      const diff = correlations.strain.moodOnHighStrainDays - correlations.strain.moodOnLowStrainDays;
      if (diff > 0.05) {
        insights.push({
          type: 'strain',
          priority: 'medium',
          icon: 'Zap',
          message: `Higher daily strain correlates with better mood. Active days show ${Math.round(diff * 100)}% higher mood.`,
          actionable: true
        });
      } else if (diff < -0.1) {
        insights.push({
          type: 'strain',
          priority: 'medium',
          icon: 'Zap',
          message: `High strain days may be pushing you too hard. Consider balancing activity with recovery.`,
          actionable: true
        });
      }
    }
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return insights;
};

/**
 * Generate actionable recommendations
 */
const generateHealthRecommendations = (correlations, pairs) => {
  const recommendations = [];

  // Sleep recommendation
  if (correlations.sleep?.available) {
    const avgSleep = correlations.sleep.avgSleepHours;
    if (avgSleep < 7 && correlations.sleep.percentBoost > 10) {
      recommendations.push({
        type: 'sleep',
        priority: 'high',
        title: 'Prioritize Sleep',
        message: `You're averaging ${avgSleep}h of sleep. Getting to 7+ hours could boost your mood by ${correlations.sleep.percentBoost}%.`,
        action: 'Try going to bed 30 minutes earlier tonight.'
      });
    }
  }

  // Workout recommendation
  if (correlations.workout?.available) {
    if (correlations.workout.workoutDays < correlations.workout.restDays && correlations.workout.percentBoost > 5) {
      recommendations.push({
        type: 'workout',
        priority: 'high',
        title: 'More Movement',
        message: `You work out on ${correlations.workout.workoutDays} of ${correlations.workout.workoutDays + correlations.workout.restDays} days, but workouts boost your mood ${correlations.workout.percentBoost}%.`,
        action: 'Add one more workout day this week.'
      });
    }
  }

  // Steps recommendation
  if (correlations.steps?.available) {
    if (correlations.steps.avgDailySteps < 5000 && correlations.steps.correlation > 0.2) {
      recommendations.push({
        type: 'steps',
        priority: 'medium',
        title: 'Get Moving',
        message: `You're averaging ${correlations.steps.avgDailySteps} steps. Your mood improves with more activity.`,
        action: 'Aim for a 10-minute walk after lunch.'
      });
    }
  }

  return recommendations.slice(0, 3); // Top 3 recommendations
};

/**
 * Analyze correlations with time lags
 *
 * Real insights often come from lagged relationships:
 * - "Poor sleep on Day N → low mood on Day N+1"
 * - "High strain on Day N → elevated RHR for 2 days"
 *
 * @param {Array} entries - Journal entries with mood_score
 * @param {Array} healthHistory - Daily health summaries
 * @returns {Object} Lagged correlation analysis
 */
export const analyzeLaggedCorrelations = (entries, healthHistory) => {
  if (!entries?.length || !healthHistory?.length) {
    return { available: false, reason: 'insufficient_data' };
  }

  // Build date-indexed maps
  const moodByDate = buildMoodByDate(entries);
  const healthByDate = buildHealthByDate(healthHistory);

  const results = {
    lag0: {}, // Same-day correlations
    lag1: {}, // Next-day correlations
    lag2: {}, // Two-day correlations
    insights: [],
    analyzedAt: new Date().toISOString()
  };

  // Metrics to correlate with mood
  const metrics = ['sleepHours', 'sleepScore', 'hrv', 'recovery', 'strain', 'steps'];

  for (const metric of metrics) {
    for (const lag of [0, 1, 2]) {
      const pairs = buildLaggedPairs(healthByDate, moodByDate, metric, lag);

      if (pairs.length >= 5) {
        const correlation = pearsonCorrelation(
          pairs.map(p => p.x),
          pairs.map(p => p.y)
        );

        if (correlation !== null) {
          results[`lag${lag}`][metric] = {
            correlation: Math.round(correlation * 100) / 100,
            sampleSize: pairs.length,
            significant: Math.abs(correlation) > 0.3 && pairs.length >= 10
          };

          // Generate insight for significant lagged correlations
          if (lag > 0 && Math.abs(correlation) > 0.3 && pairs.length >= 10) {
            results.insights.push({
              type: 'lagged_correlation',
              metric,
              lag,
              correlation: Math.round(correlation * 100) / 100,
              message: generateLaggedInsightMessage(metric, lag, correlation),
              confidence: calculateConfidence(correlation, pairs.length)
            });
          }
        }
      }
    }
  }

  // Sort insights by confidence
  results.insights.sort((a, b) => b.confidence - a.confidence);

  return results;
};

/**
 * Build mood by date map
 */
const buildMoodByDate = (entries) => {
  const map = {};
  for (const entry of entries) {
    if (entry.analysis?.mood_score !== undefined) {
      const dateStr = (entry.createdAt?.toDate?.() || new Date(entry.createdAt))
        .toISOString().split('T')[0];
      // Average if multiple entries per day
      if (map[dateStr]) {
        map[dateStr] = (map[dateStr] + entry.analysis.mood_score) / 2;
      } else {
        map[dateStr] = entry.analysis.mood_score;
      }
    }
  }
  return map;
};

/**
 * Build health by date map
 */
const buildHealthByDate = (healthHistory) => {
  const map = {};
  for (const h of healthHistory) {
    if (h.date) {
      map[h.date] = h;
    }
  }
  return map;
};

/**
 * Extract metric value from health data
 */
const extractMetricValue = (healthData, metric) => {
  if (!healthData) return null;

  switch (metric) {
    case 'sleepHours':
      return healthData.sleep?.totalHours || null;
    case 'sleepScore':
      return healthData.sleep?.score || null;
    case 'hrv':
      return healthData.hrv?.average || healthData.heart?.hrv || null;
    case 'recovery':
      return healthData.recovery?.score || null;
    case 'strain':
      return healthData.strain?.score || null;
    case 'steps':
      return healthData.steps || healthData.activity?.stepsToday || null;
    default:
      return null;
  }
};

/**
 * Build pairs for lagged correlation
 * @param {number} lag - Days of lag (0 = same day, 1 = next day, etc.)
 */
const buildLaggedPairs = (healthByDate, moodByDate, metric, lag) => {
  const pairs = [];

  for (const [dateStr, healthData] of Object.entries(healthByDate)) {
    const metricValue = extractMetricValue(healthData, metric);
    if (metricValue === null) continue;

    // Get mood from date + lag
    const baseDate = new Date(dateStr);
    const targetDate = new Date(baseDate);
    targetDate.setDate(targetDate.getDate() + lag);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const moodValue = moodByDate[targetDateStr];

    if (moodValue !== undefined) {
      pairs.push({ x: metricValue, y: moodValue });
    }
  }

  return pairs;
};

/**
 * Generate human-readable insight for lagged correlation
 */
const generateLaggedInsightMessage = (metric, lag, correlation) => {
  const direction = correlation > 0 ? 'positively' : 'negatively';
  const strength = Math.abs(correlation) > 0.5 ? 'strongly' : 'moderately';

  const metricLabels = {
    sleepHours: 'sleep duration',
    sleepScore: 'sleep quality',
    hrv: 'HRV',
    recovery: 'recovery score',
    strain: 'workout strain',
    steps: 'step count'
  };

  const lagLabels = {
    1: 'the next day',
    2: 'two days later'
  };

  const metricLabel = metricLabels[metric] || metric;

  if (correlation > 0) {
    return `Your ${metricLabel} ${strength} predicts better mood ${lagLabels[lag]}. Consider tracking this pattern.`;
  } else {
    return `Higher ${metricLabel} may ${strength} predict lower mood ${lagLabels[lag]}. You might be pushing too hard.`;
  }
};

/**
 * Calculate confidence based on correlation strength and sample size
 */
const calculateConfidence = (correlation, sampleSize) => {
  const absCorr = Math.abs(correlation);
  // Base confidence from correlation strength
  let confidence = absCorr * 0.5;
  // Boost for larger sample sizes
  if (sampleSize >= 30) confidence += 0.3;
  else if (sampleSize >= 15) confidence += 0.2;
  else if (sampleSize >= 10) confidence += 0.1;
  // Cap at 0.95
  return Math.min(0.95, confidence);
};

export default {
  analyzeHealthMoodCorrelations,
  analyzeLaggedCorrelations
};
