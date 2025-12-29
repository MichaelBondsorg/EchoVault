/**
 * Connection Nudge Service
 *
 * Generates context-aware nudges to encourage social connection.
 * Uses timing, mood patterns, and burnout signals to determine
 * when and how to encourage reaching out.
 */

import { analyzeSocialHealth, getSocialQuickActions } from './socialTracker';

// Nudge timing preferences
export const NUDGE_TIMING = {
  // Best times to suggest social connection
  optimal: {
    evening: { start: 17, end: 21 },  // After work
    weekend: { days: [0, 6] }         // Saturday, Sunday
  },
  // Avoid nudging during these times
  avoid: {
    morning_rush: { start: 7, end: 9 },
    deep_work: { start: 9, end: 12 }
  }
};

/**
 * Check if it's a good time for a social nudge
 */
export const isGoodTimeForNudge = () => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();

  // Weekend is always good
  if (NUDGE_TIMING.optimal.weekend.days.includes(day)) {
    return { good: true, reason: 'weekend' };
  }

  // Evening hours are good
  if (hour >= NUDGE_TIMING.optimal.evening.start &&
    hour <= NUDGE_TIMING.optimal.evening.end) {
    return { good: true, reason: 'evening' };
  }

  // Avoid morning rush
  if (hour >= NUDGE_TIMING.avoid.morning_rush.start &&
    hour < NUDGE_TIMING.avoid.morning_rush.end) {
    return { good: false, reason: 'morning_rush' };
  }

  // Avoid deep work hours
  if (hour >= NUDGE_TIMING.avoid.deep_work.start &&
    hour < NUDGE_TIMING.avoid.deep_work.end) {
    return { good: false, reason: 'deep_work' };
  }

  // Afternoon is neutral
  return { good: true, reason: 'afternoon' };
};

/**
 * Generate a connection nudge based on social health and context
 *
 * @param {Object} socialHealth - Result from analyzeSocialHealth
 * @param {Object} context - Additional context (mood, burnout risk, etc)
 * @returns {Object|null} Nudge to show, or null if not appropriate
 */
export const generateConnectionNudge = (socialHealth, context = {}) => {
  const { burnoutRisk, currentMood, lastNudgeTime } = context;

  // Don't nudge if we just nudged
  if (lastNudgeTime) {
    const hoursSinceNudge = (Date.now() - new Date(lastNudgeTime).getTime()) / (1000 * 60 * 60);
    if (hoursSinceNudge < 24) {
      return null;
    }
  }

  // Check if it's a good time
  const timing = isGoodTimeForNudge();
  if (!timing.good && socialHealth.riskLevel !== 'high') {
    return null;
  }

  // High isolation risk - always nudge
  if (socialHealth.isolationRisk && socialHealth.riskLevel === 'high') {
    return generateIsolationNudge(socialHealth);
  }

  // High burnout risk + low personal connections = nudge
  if (burnoutRisk?.riskLevel === 'high' && socialHealth.isImbalanced) {
    return generateBurnoutSocialNudge(socialHealth);
  }

  // Moderate risk during good timing
  if (socialHealth.riskLevel === 'moderate' && timing.good) {
    return generateGentleNudge(socialHealth);
  }

  // Low mood + neglected connections
  if (currentMood?.score < 0.4 && socialHealth.neglectedConnections?.length > 0) {
    return generateMoodSupportNudge(socialHealth, currentMood);
  }

  return null;
};

/**
 * High isolation risk nudge
 */
const generateIsolationNudge = (socialHealth) => {
  const suggestions = socialHealth.suggestions || [];
  const quickActions = getSocialQuickActions(socialHealth);

  return {
    type: 'isolation_alert',
    priority: 'high',
    title: 'Checking in on connection',
    message: 'It\'s been a while since you mentioned personal connections. Social support is one of the strongest predictors of resilience.',
    subMessage: socialHealth.neglectedConnections?.length > 0
      ? `You haven\'t mentioned ${socialHealth.neglectedConnections[0].name} in ${socialHealth.neglectedConnections[0].daysSince} days.`
      : null,
    actions: quickActions.slice(0, 2),
    dismissible: true,
    dismissOptions: [
      { id: 'not_now', label: 'Not right now' },
      { id: 'prefer_solitude', label: 'I prefer solitude right now' },
      { id: 'already_connected', label: 'I\'ve been connecting offline' }
    ],
    icon: 'Heart',
    color: 'rose'
  };
};

/**
 * Burnout + social imbalance nudge
 */
const generateBurnoutSocialNudge = (socialHealth) => {
  return {
    type: 'burnout_social',
    priority: 'high',
    title: 'Work-life connection check',
    message: `Your entries have been ${Math.round(socialHealth.workPersonalRatio)}x more about work than personal connections. During stressful times, staying connected to people who care about you is especially important.`,
    subMessage: 'Even a 5-minute call can help.',
    actions: getSocialQuickActions(socialHealth).slice(0, 2),
    dismissible: true,
    dismissOptions: [
      { id: 'not_now', label: 'Not right now' },
      { id: 'work_priority', label: 'Work needs my focus right now' }
    ],
    icon: 'Scale',
    color: 'amber'
  };
};

/**
 * Gentle nudge for moderate risk
 */
const generateGentleNudge = (socialHealth) => {
  const neglected = socialHealth.neglectedConnections?.[0];

  if (neglected) {
    return {
      type: 'gentle_reconnect',
      priority: 'low',
      title: 'Quick thought',
      message: `You haven\'t mentioned ${neglected.name} in a while. A quick check-in might feel good.`,
      actions: [
        {
          id: 'text',
          label: `Text ${neglected.name}`,
          person: neglected.name
        },
        { id: 'skip', label: 'Maybe later' }
      ],
      dismissible: true,
      icon: 'MessageCircle',
      color: 'blue'
    };
  }

  return {
    type: 'gentle_connect',
    priority: 'low',
    title: 'Connection moment',
    message: 'Who\'s someone that would brighten your day to hear from?',
    actions: [
      { id: 'reach_out', label: 'Reach out to someone' },
      { id: 'skip', label: 'Not right now' }
    ],
    dismissible: true,
    icon: 'Users',
    color: 'green'
  };
};

/**
 * Low mood support nudge
 */
const generateMoodSupportNudge = (socialHealth, currentMood) => {
  const neglected = socialHealth.neglectedConnections?.[0];

  return {
    type: 'mood_support',
    priority: 'medium',
    title: 'Reach out?',
    message: 'When we\'re feeling down, connecting with someone who cares can help.',
    subMessage: neglected
      ? `${neglected.name} might be happy to hear from you.`
      : null,
    actions: [
      neglected
        ? { id: 'text', label: `Text ${neglected.name}`, person: neglected.name }
        : { id: 'call', label: 'Call a friend' },
      { id: 'skip', label: 'I\'d rather be alone right now' }
    ],
    dismissible: true,
    icon: 'Heart',
    color: 'purple'
  };
};

/**
 * Generate prompts for entry input that encourage social reflection
 */
export const getSocialPrompt = (socialHealth) => {
  if (!socialHealth || !socialHealth.available) {
    return null;
  }

  if (socialHealth.isolationRisk) {
    return {
      type: 'social_reflection',
      prompt: 'Who\'s someone you value that you haven\'t connected with recently?',
      followUp: 'What would you want to tell them?'
    };
  }

  if (socialHealth.isImbalanced) {
    return {
      type: 'balance_reflection',
      prompt: 'Outside of work, who has been on your mind lately?',
      followUp: 'What makes that relationship meaningful to you?'
    };
  }

  return null;
};

/**
 * Get personalized micro-actions for social connection
 */
export const getSocialMicroActions = (socialHealth) => {
  const actions = [];

  // 2-minute actions
  actions.push({
    duration: '2 min',
    actions: [
      'Send a "thinking of you" text',
      'React to a friend\'s social media post with a genuine comment',
      'Send a voice note instead of a text'
    ]
  });

  // 5-minute actions
  actions.push({
    duration: '5 min',
    actions: [
      'Call someone you haven\'t spoken to in a while',
      'Write a quick appreciation message to a friend',
      'Share something interesting with someone who would enjoy it'
    ]
  });

  // 15-minute actions
  actions.push({
    duration: '15 min',
    actions: [
      'Schedule a coffee or video call for this week',
      'Write a longer message catching up with an old friend',
      'Plan a small gathering or activity with friends'
    ]
  });

  // Personalized based on neglected connections
  if (socialHealth.neglectedConnections?.length > 0) {
    const person = socialHealth.neglectedConnections[0];
    actions[0].actions.unshift(`Quick text to ${person.name}: "Hey, been thinking about you!"`);
  }

  return actions;
};

export default {
  generateConnectionNudge,
  getSocialPrompt,
  getSocialMicroActions,
  isGoodTimeForNudge,
  NUDGE_TIMING
};
