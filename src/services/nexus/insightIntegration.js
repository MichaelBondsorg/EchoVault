/**
 * Nexus Insight Integration Service
 *
 * Unified entry point for generating holistic insights that combine:
 * - Health-mood correlations (HealthKit data)
 * - Environment-mood correlations (weather, sunshine, light)
 * - Context-aware reflection prompts
 * - Nexus pattern detection (narrative + health + environment)
 * - Personal baselines
 * - Causal synthesis (LLM-powered insights)
 * - Intervention effectiveness tracking
 */

import { computeHealthMoodCorrelations, getTopHealthInsights, checkHealthDataSufficiency } from '../health/healthCorrelations';
import { computeEnvironmentMoodCorrelations, getTopEnvironmentInsights, checkEnvironmentDataSufficiency } from '../environment/environmentCorrelations';
import { generateContextAwarePrompts, getTopContextPrompt, hasHighPriorityContext } from '../prompts/contextPrompts';
import { detectPatternsInPeriod } from './layer1/patternDetector';
import { calculateAndSaveBaselines, getBaselines } from './layer2/baselineManager';
import { generateCausalSynthesis } from './layer3/synthesizer';
import { updateInterventionData, getInterventionData } from './layer4/interventionTracker';
import { getWhoopHistory } from '../health/whoop';

/**
 * Generate comprehensive insights for a user
 * This is the main entry point for the Nexus insight system
 *
 * @param {string} userId - User ID
 * @param {Array} entries - Journal entries
 * @param {Object} options - Configuration options
 * @returns {Object} Comprehensive insight package
 */
export const generateComprehensiveInsights = async (userId, entries, options = {}) => {
  console.log('[InsightIntegration] Generating comprehensive insights...');

  const {
    includeCorrelations = true,
    includePrompts = true,
    includePatterns = true,
    includeBaselines = true,
    includeSynthesis = true,
    includeInterventions = true,
    todayHealth = null,
    todayEnvironment = null
  } = options;

  const insights = {
    generatedAt: new Date().toISOString(),
    userId,
    dataPoints: entries.length,
    correlations: {},
    prompts: [],
    patterns: null,
    baselines: null,
    synthesis: null,
    interventions: null,
    summary: null
  };

  // Get Whoop history for pattern detection and baselines
  let whoopHistory = null;
  try {
    whoopHistory = await getWhoopHistory(30);
  } catch (e) {
    console.warn('[InsightIntegration] Whoop data unavailable:', e.message);
  }

  // === HEALTH-MOOD CORRELATIONS ===
  if (includeCorrelations) {
    const healthSufficiency = checkHealthDataSufficiency(entries);
    if (healthSufficiency.hasEnoughData) {
      const healthCorrelations = computeHealthMoodCorrelations(entries);
      if (healthCorrelations) {
        insights.correlations.health = {
          ...healthCorrelations,
          topInsights: getTopHealthInsights(entries, 3)
        };
      }
    } else {
      insights.correlations.health = {
        insufficient: true,
        message: healthSufficiency.message,
        dataPoints: healthSufficiency.dataPoints,
        needed: healthSufficiency.needed
      };
    }

    // === ENVIRONMENT-MOOD CORRELATIONS ===
    const envSufficiency = checkEnvironmentDataSufficiency(entries);
    if (envSufficiency.hasEnoughData) {
      const envCorrelations = computeEnvironmentMoodCorrelations(entries);
      if (envCorrelations) {
        insights.correlations.environment = {
          ...envCorrelations,
          topInsights: getTopEnvironmentInsights(entries, 3)
        };
      }
    } else {
      insights.correlations.environment = {
        insufficient: true,
        message: envSufficiency.message,
        dataPoints: envSufficiency.dataPoints,
        needed: envSufficiency.needed
      };
    }
  }

  // === CONTEXT-AWARE PROMPTS ===
  if (includePrompts && (todayHealth || todayEnvironment)) {
    // Calculate recent mood average
    const recentMoods = entries
      .slice(-7)
      .map(e => e.analysis?.mood_score)
      .filter(Boolean);
    const recentMoodAvg = recentMoods.length > 0
      ? recentMoods.reduce((a, b) => a + b, 0) / recentMoods.length
      : null;

    insights.prompts = generateContextAwarePrompts(
      todayHealth,
      todayEnvironment,
      recentMoodAvg
    );
    insights.hasHighPriorityContext = hasHighPriorityContext(todayHealth, todayEnvironment);
  }

  // === PATTERN DETECTION ===
  if (includePatterns && entries.length >= 5) {
    insights.patterns = await detectPatternsInPeriod(userId, entries, whoopHistory);
  }

  // === BASELINES ===
  if (includeBaselines) {
    // Try to get existing baselines first
    insights.baselines = await getBaselines(userId);

    // If stale or missing, recalculate
    const isStale = !insights.baselines ||
      (Date.now() - insights.baselines.calculatedAt?.toDate?.()?.getTime?.() > 24 * 60 * 60 * 1000);

    if (isStale && entries.length >= 7) {
      insights.baselines = await calculateAndSaveBaselines(userId, entries);
    }
  }

  // === INTERVENTION TRACKING ===
  if (includeInterventions) {
    // Convert whoopHistory to date-keyed object
    const whoopByDate = {};
    if (whoopHistory?.days) {
      for (const day of whoopHistory.days) {
        if (day.date) whoopByDate[day.date] = day;
      }
    }

    insights.interventions = await updateInterventionData(userId, entries, whoopByDate);
  }

  // === CAUSAL SYNTHESIS (LLM) ===
  if (includeSynthesis && entries.length >= 10) {
    const recentEntries = entries.slice(-30);
    const activeThreads = []; // Could integrate with threadManager

    const synthesisContext = {
      recentEntries,
      activeThreads,
      currentState: null, // Could integrate with stateDetector
      baselines: insights.baselines,
      whoopToday: whoopHistory?.days?.[0] || null,
      interventionData: insights.interventions,
      healthCorrelations: insights.correlations?.health,
      environmentCorrelations: insights.correlations?.environment,
      todayHealth,
      todayEnvironment
    };

    insights.synthesis = await generateCausalSynthesis(userId, synthesisContext);
  }

  // === GENERATE SUMMARY ===
  insights.summary = generateInsightSummary(insights);

  console.log('[InsightIntegration] Insights generated:', {
    correlations: Object.keys(insights.correlations).length,
    prompts: insights.prompts?.length || 0,
    patterns: insights.patterns?.totalPatternsDetected || 0,
    synthesisSuccess: insights.synthesis?.success || false
  });

  return insights;
};

/**
 * Generate a summary of all insights for quick display
 */
const generateInsightSummary = (insights) => {
  const summary = {
    highlights: [],
    warnings: [],
    opportunities: []
  };

  // Health correlation highlights
  if (insights.correlations?.health?.topInsights?.length > 0) {
    const topHealth = insights.correlations.health.topInsights[0];
    if (topHealth.strength === 'strong') {
      summary.highlights.push({
        type: 'health_correlation',
        message: topHealth.insight,
        strength: topHealth.strength
      });
    }
  }

  // Environment correlation highlights
  if (insights.correlations?.environment?.topInsights?.length > 0) {
    const topEnv = insights.correlations.environment.topInsights[0];
    if (topEnv.strength === 'strong') {
      summary.highlights.push({
        type: 'environment_correlation',
        message: topEnv.insight,
        strength: topEnv.strength
      });
    }
  }

  // SAD warning
  if (insights.correlations?.environment?.lowSunshineWarning) {
    summary.warnings.push({
      type: 'sad_warning',
      message: insights.correlations.environment.lowSunshineWarning.insight,
      recommendation: insights.correlations.environment.lowSunshineWarning.recommendation
    });
  }

  // High-priority context prompts
  if (insights.hasHighPriorityContext && insights.prompts?.length > 0) {
    const highPriority = insights.prompts.filter(p => p.priority === 'high');
    for (const prompt of highPriority.slice(0, 2)) {
      summary.warnings.push({
        type: prompt.type,
        category: prompt.category,
        message: prompt.prompt,
        trigger: prompt.trigger
      });
    }
  }

  // Combined pattern opportunities
  if (insights.patterns?.byType?.combined?.length > 0) {
    for (const pattern of insights.patterns.byType.combined) {
      if (pattern.patternId === 'optimal_conditions') {
        summary.opportunities.push({
          type: 'optimal_conditions',
          message: 'You have optimal conditions today (good sleep + sunny weather)',
          label: pattern.label
        });
      }
    }
  }

  // LLM synthesis highlights
  if (insights.synthesis?.success && insights.synthesis?.insight) {
    summary.highlights.push({
      type: 'nexus_insight',
      title: insights.synthesis.insight.title,
      message: insights.synthesis.insight.summary,
      urgency: insights.synthesis.insight.metadata?.urgency
    });
  }

  return summary;
};

/**
 * Get quick context insights for current entry
 * Lightweight version for real-time feedback
 *
 * @param {Object} healthContext - Current health data
 * @param {Object} environmentContext - Current environment data
 * @param {Array} recentEntries - Last few entries for mood context
 * @returns {Object} Quick insights
 */
export const getQuickContextInsights = (healthContext, environmentContext, recentEntries = []) => {
  // Calculate recent mood
  const recentMoods = recentEntries
    .slice(-5)
    .map(e => e.analysis?.mood_score)
    .filter(Boolean);
  const recentMoodAvg = recentMoods.length > 0
    ? recentMoods.reduce((a, b) => a + b, 0) / recentMoods.length
    : null;

  // Get top prompt
  const topPrompt = getTopContextPrompt(healthContext, environmentContext, recentMoodAvg);

  // Check for high-priority context
  const hasHighPriority = hasHighPriorityContext(healthContext, environmentContext);

  return {
    topPrompt,
    hasHighPriority,
    recentMoodAvg,
    contextFlags: {
      lowSleep: healthContext?.sleep?.quality === 'poor' ||
                (healthContext?.sleep?.totalHours != null && healthContext.sleep.totalHours < 6),
      lowRecovery: healthContext?.recovery?.score < 34,
      lowSunshine: environmentContext?.daySummary?.isLowSunshine ||
                   (environmentContext?.daySummary?.sunshinePercent < 30),
      afterDark: environmentContext?.isAfterDark
    }
  };
};

/**
 * Get today's personalized recommendations
 * Based on current health, environment, and historical patterns
 */
export const getTodayRecommendations = async (userId, entries, todayHealth, todayEnvironment) => {
  const recommendations = [];

  // Get baselines
  const baselines = await getBaselines(userId);
  if (!baselines) {
    return { recommendations, message: 'Not enough data for personalized recommendations yet' };
  }

  // Get intervention effectiveness
  const interventions = await getInterventionData(userId);

  // Check current conditions
  const health = todayHealth ? require('../health/healthFormatter').extractHealthSignals(todayHealth) : null;
  const env = todayEnvironment ? require('../environment/environmentFormatter').extractEnvironmentSignals(todayEnvironment) : null;

  // Recovery-based recommendations
  if (health?.recoveryScore < 34) {
    recommendations.push({
      type: 'recovery',
      priority: 'high',
      action: 'Take it easy today - your recovery is in the red zone',
      reasoning: 'Low recovery days benefit from lighter activity and extra rest'
    });
  } else if (health?.recoveryScore >= 67) {
    // Check if exercise is effective for this user
    const workoutEffectiveness = interventions?.interventions?.workout_day?.effectiveness?.global?.score;
    if (workoutEffectiveness > 0.6) {
      recommendations.push({
        type: 'activity',
        priority: 'medium',
        action: 'Good day for a workout - your recovery is in the green zone',
        reasoning: `Exercise has been effective for you (${Math.round(workoutEffectiveness * 100)}% effectiveness)`
      });
    }
  }

  // Sunshine-based recommendations
  if (env?.isLowSunshine || (env?.sunshinePercent != null && env.sunshinePercent < 30)) {
    // Check if user is sensitive to sunshine
    const sunshineCorr = computeEnvironmentMoodCorrelations(entries)?.sunshineMood;
    if (sunshineCorr?.strength === 'strong') {
      recommendations.push({
        type: 'environment',
        priority: 'medium',
        action: 'Low sunshine today - consider light therapy or a morning walk if possible',
        reasoning: `Your mood is ${Math.round((sunshineCorr.highSunshineMood - sunshineCorr.lowSunshineMood) * 100)}% higher on sunny days`
      });
    }
  }

  // Sleep-based recommendations
  if (health?.sleepHours != null && health.sleepHours < 6) {
    recommendations.push({
      type: 'self_care',
      priority: 'high',
      action: 'Be gentle with yourself today - you got limited sleep',
      reasoning: 'Low sleep affects mood, focus, and recovery'
    });
  }

  // Workout effectiveness for mood
  if (interventions?.interventions?.sterling_walk?.effectiveness?.global?.moodDelta?.mean > 5) {
    recommendations.push({
      type: 'activity',
      priority: 'low',
      action: 'A walk with Sterling could boost your mood',
      reasoning: `Sterling walks improve your mood by ${Math.round(interventions.interventions.sterling_walk.effectiveness.global.moodDelta.mean)}% on average`
    });
  }

  return {
    recommendations: recommendations.sort((a, b) => {
      const priorityOrder = { high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    }),
    basedOn: {
      entriesAnalyzed: entries.length,
      interventionsTracked: Object.keys(interventions?.interventions || {}).length,
      baselinesAvailable: !!baselines
    }
  };
};

export default {
  generateComprehensiveInsights,
  getQuickContextInsights,
  getTodayRecommendations
};
