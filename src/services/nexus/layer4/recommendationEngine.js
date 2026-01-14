/**
 * Recommendation Engine
 *
 * Generates personalized, context-aware action recommendations
 * based on current state, intervention effectiveness, and timing.
 */

import { getInterventionData } from './interventionTracker';

// ============================================================
// RECOMMENDATION GENERATION
// ============================================================

/**
 * Generate recommendations for current context
 */
export const generateRecommendations = async (userId, context) => {
  console.log('[RecommendationEngine] Generating recommendations...');

  const { currentState, whoopToday, recentMood, timeOfDay } = context;

  const interventionData = await getInterventionData(userId);
  if (!interventionData) return [];

  const recommendations = [];

  // Get state-specific interventions
  const stateInterventions = getInterventionsForState(
    currentState?.primary,
    interventionData
  );

  // Score and rank recommendations
  for (const intervention of stateInterventions) {
    const score = scoreRecommendation(intervention, context);

    if (score > 0.5) {
      recommendations.push({
        intervention: intervention.name,
        category: intervention.category,
        score,
        reasoning: generateReasoning(intervention, currentState, context),
        timing: suggestTiming(intervention, timeOfDay),
        expectedOutcome: predictOutcome(intervention, context)
      });
    }
  }

  return recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);  // Top 3 recommendations
};

/**
 * Get interventions that work well for a given state
 */
const getInterventionsForState = (state, interventionData) => {
  const stateInterventionMap = {
    'career_waiting': ['sterling_walk', 'yoga', 'creative', 'social'],
    'career_rejection': ['spencer_time', 'acts_of_service', 'yoga', 'social'],
    'low_mood': ['yoga', 'sterling_walk', 'spencer_time', 'acts_of_service'],
    'high_strain': ['rest_day', 'yoga', 'sleep_focus'],
    'recovery_mode': ['rest_day', 'walk', 'sleep_focus'],
    'burnout_risk': ['rest_day', 'sleep_focus', 'social'],
    'stable': ['gym', 'barrys', 'creative', 'social']
  };

  const relevantInterventions = stateInterventionMap[state] || stateInterventionMap['stable'];

  return relevantInterventions
    .map(name => ({
      name,
      ...(interventionData.interventions?.[name] || {})
    }))
    .filter(i => i.effectiveness || i.category);
};

/**
 * Score a recommendation based on context
 */
const scoreRecommendation = (intervention, context) => {
  const { currentState, whoopToday, recentMood, timeOfDay } = context;

  let score = intervention.effectiveness?.global?.score || 0.5;

  // Boost for context-specific effectiveness
  if (intervention.effectiveness?.contextual?.[`during:${currentState?.primary}`]) {
    const contextScore = intervention.effectiveness.contextual[`during:${currentState.primary}`].score;
    score = Math.max(score, contextScore);
  }

  // Adjust for time of day
  const timeBoost = getTimeBoost(intervention.name, timeOfDay);
  score += timeBoost;

  // Adjust for current recovery
  if (whoopToday?.recovery?.score) {
    if (whoopToday.recovery.score < 40 && intervention.category === 'physical') {
      score -= 0.2;  // Reduce physical recommendations on low recovery
    }
    if (whoopToday.recovery.score < 40 && intervention.category === 'recovery') {
      score += 0.2;  // Boost recovery recommendations
    }
  }

  // Adjust for recent mood
  if (recentMood < 40 && intervention.name === 'acts_of_service') {
    score += 0.15;  // This user's pattern shows acts of service help during low mood
  }

  return Math.max(0, Math.min(1, score));
};

/**
 * Get time-of-day boost for intervention
 */
const getTimeBoost = (intervention, timeOfDay) => {
  const optimalTimes = {
    yoga: ['morning', 'afternoon'],
    barrys: ['morning'],
    sterling_walk: ['morning', 'evening'],
    gym: ['morning', 'afternoon'],
    rest_day: ['any'],
    social: ['evening'],
    creative: ['afternoon', 'evening']
  };

  const optimal = optimalTimes[intervention] || ['any'];
  if (optimal.includes('any') || optimal.includes(timeOfDay)) {
    return 0.1;
  }
  return -0.05;
};

/**
 * Generate reasoning for recommendation
 */
const generateReasoning = (intervention, currentState, context) => {
  const templates = {
    'career_waiting': {
      'sterling_walk': `You're in a waiting period with elevated stress markers. Sterling walks have historically recovered your HRV by ${intervention.effectiveness?.global?.hrvDelta?.mean || 12}ms within 24 hours.`,
      'yoga': `During career uncertainty, yoga has been your most effective physical reset, with a ${Math.round((intervention.effectiveness?.global?.score || 0.8) * 100)}% effectiveness rate.`,
      'creative': `Working on creative projects provides a sense of agency when career outcomes feel out of your control.`
    },
    'low_mood': {
      'acts_of_service': `When your mood is low, doing something for someone else has historically boosted your mood by ${intervention.effectiveness?.global?.moodDelta?.mean || 15} points.`,
      'spencer_time': `Spencer's presence has a stabilizing effect on your mood.`
    }
  };

  return templates[currentState?.primary]?.[intervention.name] ||
    `Based on your history, ${intervention.name.replace(/_/g, ' ')} has a ${Math.round((intervention.effectiveness?.global?.score || 0.7) * 100)}% effectiveness rate.`;
};

/**
 * Suggest optimal timing
 */
const suggestTiming = (intervention, currentTimeOfDay) => {
  const optimalTiming = {
    yoga: 'This morning if possible, or early afternoon',
    sterling_walk: 'Before 7pm for optimal HRV recovery',
    barrys: 'Morning classes tend to set a better tone for your day',
    rest_day: 'Today and tomorrow if needed',
    social: 'This evening',
    creative: 'When you have 30+ uninterrupted minutes'
  };

  return optimalTiming[intervention.name] || 'When you have time today';
};

/**
 * Predict outcome if recommendation is followed
 */
const predictOutcome = (intervention, context) => {
  const moodDelta = intervention.effectiveness?.global?.moodDelta?.mean || 10;
  const hrvDelta = intervention.effectiveness?.global?.hrvDelta?.mean;

  let prediction = `Expected mood improvement: +${Math.round(moodDelta)} points`;

  if (hrvDelta) {
    prediction += `. HRV recovery: +${Math.round(hrvDelta)}ms within 24 hours`;
  }

  return {
    description: prediction,
    confidence: intervention.effectiveness?.global?.score || 0.7,
    timeframe: '24-48 hours'
  };
};
