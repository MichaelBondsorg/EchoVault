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
 *
 * `getInterventionData` (layer4/interventionTracker.js) import removed
 * R4-P3 Task 5 per P3-D1 (docs/superpowers/plans/2026-07-23-r4-phase3-
 * action-loop.md) — interventionTracker.js is deleted whole. See
 * `getTodayRecommendations` below for how the workout/pet_walk
 * recommendations that used to key off it were resolved.
 */

import { computeEnvironmentMoodCorrelations } from '../environment/environmentCorrelations';
import { getTopContextPrompt, hasHighPriorityContext } from '../prompts/contextPrompts';
import { getBaselines } from './layer2/baselineManager';
// R4 T-p0closure (Important 1): these were previously loaded via require()
// inside getTodayRecommendations — an ESM module using CommonJS require()
// is exactly the class of bug that caused the documented prod white-screen
// (esbuild misses undefined globals; see CLAUDE.md gotchas). Neither module
// imports anything from this file or from `./orchestrator` (verified: both
// are leaf formatter modules with zero local imports), so there is no
// circular-import risk in hoisting these to static top-level imports.
import { extractHealthSignals } from '../health/healthFormatter';
import { extractEnvironmentSignals } from '../environment/environmentFormatter';

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

  // interventionTracker.js's getInterventionData(userId) call removed
  // R4-P3 Task 5 per P3-D1 — the module is deleted whole.

  // Check current conditions
  const health = todayHealth ? extractHealthSignals(todayHealth) : null;
  const env = todayEnvironment ? extractEnvironmentSignals(todayEnvironment) : null;

  // Recovery-based recommendations
  if (health?.recoveryScore < 34) {
    recommendations.push({
      type: 'recovery',
      priority: 'high',
      action: 'Take it easy today - your recovery is in the red zone',
      reasoning: 'Low recovery days benefit from lighter activity and extra rest'
    });
  } else if (health?.recoveryScore >= 67) {
    // R4 Phase 3 T5 per P3-D1: this used to also require
    // `interventions?.interventions?.workout_day?.effectiveness?.global?.score
    // > 0.6` from the now-deleted interventionTracker.js before showing at
    // all. The recovery-zone trigger is independent of that tracker (it
    // reads today's real health data, not tracked history) and the copy
    // was already fully generic — so this idea now renders unconditionally
    // on the recovery trigger alone, same generic wording, no evidence
    // claim added or removed.
    recommendations.push({
      type: 'activity',
      priority: 'medium',
      action: 'Good day for a workout - your recovery is in the green zone',
      reasoning: 'Worth trying — exercise can be a good use of a high-recovery day.'
    });
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
        reasoning: "Sunshine tends to help some people's mood — worth getting outside if you can."
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

  // Pet-walk recommendation DROPPED (not converted to a static generic
  // idea) R4 Phase 3 T5 per P3-D1. Unlike the workout idea above, this
  // recommendation had NO trigger independent of the deleted
  // interventionTracker.js — its only condition was
  // `interventions?.interventions?.pet_walk?.effectiveness?.global
  // ?.moodDelta?.mean > 0.05`, which required tracked evidence that a pet
  // walk happened at all. With no tracker, there is no honest signal left
  // to decide even WHETHER to surface a pet-walk idea (most users don't
  // have a pet); rendering it unconditionally would recommend a dog walk
  // to users who don't own a dog, which is worse than the leaked-evidence
  // problem this phase exists to fix. Dropped, not relabeled.

  return {
    recommendations: recommendations.sort((a, b) => {
      const priorityOrder = { high: 1, medium: 2, low: 3 };
      return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
    }),
    basedOn: {
      entriesAnalyzed: entries.length,
      // interventionsTracked always 0 now — interventionTracker.js
      // (the only source of this count) is deleted R4-P3 per P3-D1.
      // InsightsPage.jsx only renders this line when > 0, so this is a
      // silent no-op there, not a broken display.
      interventionsTracked: 0,
      baselinesAvailable: !!baselines
    }
  };
};

export default {
  getQuickContextInsights,
  getTodayRecommendations
};
