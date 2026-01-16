/**
 * Context-Aware Reflection Prompts
 *
 * Generates personalized journaling prompts based on:
 * - Health data (sleep, HRV, recovery, activity)
 * - Environment data (weather, sunshine, light)
 * - Mood trajectory
 *
 * These prompts help users reflect on how their physical state
 * and environment are affecting their mental state.
 */

import { extractHealthSignals } from '../health/healthFormatter';
import { extractEnvironmentSignals } from '../environment/environmentFormatter';

/**
 * Generate context-aware reflection prompts based on health and environment
 *
 * @param {Object} healthContext - Current health data
 * @param {Object} environmentContext - Current environment data
 * @param {number|null} recentMoodAvg - Average mood from recent entries (0-1)
 * @returns {Array} Array of prompt objects
 */
export const generateContextAwarePrompts = (healthContext, environmentContext, recentMoodAvg = null) => {
  const health = extractHealthSignals(healthContext);
  const env = extractEnvironmentSignals(environmentContext);

  const prompts = [];

  // ===== HEALTH-BASED PROMPTS =====

  // Poor sleep prompts
  if (health?.sleepHours != null && health.sleepHours < 6) {
    prompts.push({
      type: 'health_reflection',
      category: 'sleep',
      prompt: "You got less than 6 hours of sleep last night. How is that affecting your energy and focus today?",
      trigger: 'low_sleep',
      priority: 'high',
      data: { sleepHours: health.sleepHours }
    });
  } else if (health?.sleepScore != null && health.sleepScore < 50) {
    prompts.push({
      type: 'health_reflection',
      category: 'sleep',
      prompt: "Your sleep quality was lower than usual last night. How are you feeling this morning?",
      trigger: 'poor_sleep_quality',
      priority: 'high',
      data: { sleepScore: health.sleepScore }
    });
  }

  // Great sleep prompts
  if (health?.sleepHours != null && health.sleepHours >= 8 && health?.sleepScore >= 80) {
    prompts.push({
      type: 'health_reflection',
      category: 'sleep',
      prompt: "You got great sleep last night! How does that feel? What contributed to it?",
      trigger: 'great_sleep',
      priority: 'low',
      data: { sleepHours: health.sleepHours, sleepScore: health.sleepScore }
    });
  }

  // HRV/Stress prompts
  if (health?.hrvTrend === 'declining' || health?.stressLevel === 'elevated') {
    prompts.push({
      type: 'health_reflection',
      category: 'stress',
      prompt: "Your body is showing signs of elevated stress (HRV is lower than usual). What's weighing on your mind right now?",
      trigger: 'elevated_stress',
      priority: 'high',
      data: { hrv: health.hrv, hrvTrend: health.hrvTrend }
    });
  } else if (health?.hrv != null && health.hrv < 25) {
    prompts.push({
      type: 'health_reflection',
      category: 'stress',
      prompt: "Your HRV is quite low today, suggesting your body is under stress. What might be contributing to that?",
      trigger: 'very_low_hrv',
      priority: 'high',
      data: { hrv: health.hrv }
    });
  }

  // Recovery prompts (Whoop)
  if (health?.recoveryScore != null && health.recoveryScore < 34) {
    prompts.push({
      type: 'health_reflection',
      category: 'recovery',
      prompt: "Your recovery score is in the red zone today. What might you do to take it easy and recharge?",
      trigger: 'low_recovery',
      priority: 'high',
      data: { recoveryScore: health.recoveryScore }
    });
  } else if (health?.recoveryScore != null && health.recoveryScore >= 67) {
    prompts.push({
      type: 'health_reflection',
      category: 'recovery',
      prompt: "You're in the green recovery zone today! How might you make the most of this energy?",
      trigger: 'high_recovery',
      priority: 'low',
      data: { recoveryScore: health.recoveryScore }
    });
  }

  // Workout prompts
  if (health?.hadWorkout && health?.workoutType) {
    prompts.push({
      type: 'health_reflection',
      category: 'activity',
      prompt: `How did your ${health.workoutType.toLowerCase()} make you feel today?`,
      trigger: 'post_workout',
      priority: 'medium',
      data: { workoutType: health.workoutType }
    });
  } else if (health?.hadWorkout) {
    prompts.push({
      type: 'health_reflection',
      category: 'activity',
      prompt: "You got a workout in today! How are you feeling after it?",
      trigger: 'post_workout',
      priority: 'medium'
    });
  }

  // High strain prompts
  if (health?.strainScore != null && health.strainScore > 15) {
    prompts.push({
      type: 'health_reflection',
      category: 'strain',
      prompt: "You've had a high-strain day. What pushed you today, and how are you feeling about it?",
      trigger: 'high_strain',
      priority: 'medium',
      data: { strainScore: health.strainScore }
    });
  }

  // Low activity prompts
  if (health?.steps != null && health.steps < 2000 && health?.exerciseMinutes < 10) {
    prompts.push({
      type: 'health_reflection',
      category: 'activity',
      prompt: "It's been a low-movement day. Is that by choice, or would a short walk feel good?",
      trigger: 'sedentary',
      priority: 'low',
      data: { steps: health.steps }
    });
  }

  // ===== ENVIRONMENT-BASED PROMPTS =====

  // Low sunshine prompts (SAD-related)
  if (env?.isLowSunshine || (env?.sunshinePercent != null && env.sunshinePercent < 30)) {
    prompts.push({
      type: 'environment_reflection',
      category: 'light',
      prompt: "It's been a low-sunshine day. How is the lack of natural light affecting your mood or energy?",
      trigger: 'low_sunshine',
      priority: 'medium',
      data: { sunshinePercent: env.sunshinePercent }
    });
  }

  // After dark prompts (evening reflection)
  if (env?.isAfterDark && env?.lightContext === 'dark') {
    prompts.push({
      type: 'environment_reflection',
      category: 'time',
      prompt: "You're journaling after dark. How was your day? Any thoughts as it winds down?",
      trigger: 'after_dark',
      priority: 'low'
    });
  }

  // Beautiful weather prompts
  if (env?.weatherLabel && /sunny|clear/i.test(env.weatherLabel) && env?.sunshinePercent > 70) {
    prompts.push({
      type: 'environment_reflection',
      category: 'weather',
      prompt: "It's a beautiful sunny day! Did you get outside at all? How did it feel?",
      trigger: 'nice_weather',
      priority: 'low',
      data: { weatherLabel: env.weatherLabel, sunshinePercent: env.sunshinePercent }
    });
  }

  // Rainy day prompts
  if (env?.weatherLabel && /rain|storm|drizzle/i.test(env.weatherLabel)) {
    prompts.push({
      type: 'environment_reflection',
      category: 'weather',
      prompt: "It's a rainy day. Some find these cozy, others gloomy. How's the weather affecting you?",
      trigger: 'rainy_weather',
      priority: 'low',
      data: { weatherLabel: env.weatherLabel }
    });
  }

  // Fading light prompts
  if (env?.lightContext === 'fading' && env?.daylightRemaining != null && env.daylightRemaining < 1) {
    prompts.push({
      type: 'environment_reflection',
      category: 'light',
      prompt: "The sun is setting soon. Did you make the most of the daylight today?",
      trigger: 'fading_light',
      priority: 'low',
      data: { daylightRemaining: env.daylightRemaining }
    });
  }

  // Cold weather prompts
  if (env?.temperature != null && env.temperature < 40) {
    prompts.push({
      type: 'environment_reflection',
      category: 'weather',
      prompt: "It's cold outside today. How are you keeping warm and staying comfortable?",
      trigger: 'cold_weather',
      priority: 'low',
      data: { temperature: env.temperature }
    });
  }

  // Short daylight (winter) prompts
  if (env?.daylightHours != null && env.daylightHours < 10) {
    prompts.push({
      type: 'environment_reflection',
      category: 'light',
      prompt: "With shorter days, are you getting enough light exposure? How's your energy?",
      trigger: 'short_days',
      priority: 'medium',
      data: { daylightHours: env.daylightHours }
    });
  }

  // ===== COMBINED HEALTH + ENVIRONMENT PROMPTS =====

  // Poor sleep + low sunshine = double whammy
  if ((health?.sleepHours < 6 || health?.sleepScore < 50) &&
      (env?.isLowSunshine || env?.sunshinePercent < 30)) {
    prompts.push({
      type: 'combined_reflection',
      category: 'wellness',
      prompt: "Both your sleep and sunlight exposure are low today. How can you be extra gentle with yourself?",
      trigger: 'sleep_and_sunshine_low',
      priority: 'high'
    });
  }

  // Good sleep + nice weather = capitalize on it
  if (health?.sleepScore >= 75 && env?.sunshinePercent > 60) {
    prompts.push({
      type: 'combined_reflection',
      category: 'wellness',
      prompt: "You're well-rested and it's a nice day out. What would make this a great day?",
      trigger: 'optimal_conditions',
      priority: 'medium'
    });
  }

  // ===== MOOD-BASED MODIFIERS =====

  // If mood has been low, add supportive context to existing prompts
  if (recentMoodAvg != null && recentMoodAvg < 0.4) {
    // Modify high-priority prompts to be more supportive
    prompts.forEach(p => {
      if (p.priority === 'high' && p.category === 'sleep') {
        p.prompt += " Remember, it's okay to take things slowly today.";
      }
    });

    // Add a general support prompt if we don't have many
    if (prompts.length < 2) {
      prompts.push({
        type: 'mood_support',
        category: 'wellness',
        prompt: "It's been a challenging stretch. What's one small thing that might bring a moment of peace today?",
        trigger: 'low_mood_streak',
        priority: 'high'
      });
    }
  }

  // Sort by priority
  const priorityOrder = { high: 1, medium: 2, low: 3 };
  prompts.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  return prompts;
};

/**
 * Get the top context prompt for display
 * Returns the highest priority prompt, or null if none
 *
 * @param {Object} healthContext - Current health data
 * @param {Object} environmentContext - Current environment data
 * @param {number|null} recentMoodAvg - Average mood from recent entries
 * @returns {Object|null} Top prompt or null
 */
export const getTopContextPrompt = (healthContext, environmentContext, recentMoodAvg = null) => {
  const prompts = generateContextAwarePrompts(healthContext, environmentContext, recentMoodAvg);
  return prompts.length > 0 ? prompts[0] : null;
};

/**
 * Get prompts filtered by category
 *
 * @param {Object} healthContext - Current health data
 * @param {Object} environmentContext - Current environment data
 * @param {string} category - Category to filter by (sleep, stress, weather, etc.)
 * @returns {Array} Filtered prompts
 */
export const getPromptsByCategory = (healthContext, environmentContext, category) => {
  const prompts = generateContextAwarePrompts(healthContext, environmentContext);
  return prompts.filter(p => p.category === category);
};

/**
 * Check if there are any high-priority context prompts
 * Useful for showing indicators in the UI
 *
 * @param {Object} healthContext - Current health data
 * @param {Object} environmentContext - Current environment data
 * @returns {boolean} True if high-priority prompts exist
 */
export const hasHighPriorityContext = (healthContext, environmentContext) => {
  const prompts = generateContextAwarePrompts(healthContext, environmentContext);
  return prompts.some(p => p.priority === 'high');
};

export default {
  generateContextAwarePrompts,
  getTopContextPrompt,
  getPromptsByCategory,
  hasHighPriorityContext
};
