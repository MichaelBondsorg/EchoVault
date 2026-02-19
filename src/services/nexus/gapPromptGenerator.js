/**
 * Gap Prompt Generator — Nexus Extension
 *
 * Transforms detected life domain gaps (from gapDetector.js) into
 * therapeutic, non-judgmental journaling prompts using ACT/CBT framing.
 *
 * Handles premium gating, style personalization from engagement history,
 * seasonal context, domain snoozing, and engagement tracking.
 *
 * Consumers: prompt priority system (section-14), nudge orchestrator,
 * GapPromptCard frontend component (section-14).
 */

import { checkEntitlement } from '../premium';
import { detectGaps, LIFE_DOMAINS } from './gapDetector';
import { analyticsRepository } from '../../repositories/analytics';
import { db, collection, addDoc, Timestamp } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// ============================================================
// Constants
// ============================================================

export { LIFE_DOMAINS };

export const PROMPT_STYLES = ['reflective', 'exploratory', 'gratitude', 'action'];
export const VALID_RESPONSES = ['accepted', 'dismissed', 'snoozed'];

export const GAP_SCORE_THRESHOLD = 0.7;
export const SNOOZE_DURATION_DAYS = 7;

/** Words that must never appear in prompts (therapeutic safety). */
export const JUDGMENTAL_WORDS = [
  'neglecting', 'ignoring', 'failing', 'should', 'must',
  'need to', 'have to', 'ought to', 'supposed to',
];

/** Exploration vs exploitation ratio for style selection. */
const PREFERRED_WEIGHT = 0.7;
const EXPLORATION_WEIGHT = 0.3;

// ============================================================
// Prompt Templates
// ============================================================

export const PROMPT_TEMPLATES = {
  work: {
    reflective: [
      "It's been {timeframe} since you wrote about work. What's your relationship with your professional life looking like these days?",
      "When you think about your professional world, what comes to mind right now?",
    ],
    exploratory: [
      "If you could shift one thing about your work situation, what would feel most meaningful?",
      "What's something about your career that you're curious about exploring further?",
    ],
    gratitude: [
      "What's one thing about your work you appreciate that you might not often acknowledge?",
      "Think about a recent work moment that went well. What made it good?",
    ],
    action: [
      "What's one small professional step you could explore this week?",
      "If you had an extra hour at work this week, how would you use it?",
    ],
  },
  relationships: {
    reflective: [
      "It's been {timeframe} since you reflected on your relationships. How are your connections with people feeling lately?",
      "When you think about the people in your life, who comes to mind first? What's that about?",
    ],
    exploratory: [
      "What's a relationship in your life you'd like to understand better?",
      "If you could strengthen one connection, which would it be and why?",
    ],
    gratitude: [
      "Who's someone you're grateful for right now? What makes that relationship special?",
      "Think about a recent interaction that left you feeling good. What happened?",
    ],
    action: [
      "What's one small thing you could do this week to nurture a relationship that matters to you?",
      "Is there someone you've been meaning to reach out to? What's holding you back?",
    ],
  },
  health: {
    reflective: [
      "It's been {timeframe} since you wrote about your health. How's your body feeling these days?",
      "What does wellness look like for you right now? Take a moment to check in with yourself.",
    ],
    exploratory: [
      "If you could change one thing about how you take care of yourself, what would it be?",
      "What's your body been telling you lately that you might not have been listening to?",
    ],
    gratitude: [
      "What's one thing your body does well that you might take for granted?",
      "Think about a time recently when you felt physically good. What contributed to that?",
    ],
    action: [
      "What's one small wellness step you could try this week?",
      "What's something enjoyable you could do for your body today?",
    ],
  },
  creativity: {
    reflective: [
      "It's been {timeframe} since you explored your creative side. What creative impulses have you been noticing?",
      "When you think about creativity, what feelings come up for you right now?",
    ],
    exploratory: [
      "If time and resources weren't a factor, what creative project would excite you?",
      "What's a creative hobby you've been curious about but haven't tried yet?",
    ],
    gratitude: [
      "What's a creative moment from your past that still brings you joy?",
      "What creative abilities do you have that you might not give yourself enough credit for?",
    ],
    action: [
      "What's one small creative thing you could do in the next few days?",
      "Could you spend 15 minutes this week on something creative, just for fun?",
    ],
  },
  spirituality: {
    reflective: [
      "It's been {timeframe} since you reflected on your spiritual life. What's your inner landscape looking like?",
      "When you connect with what's meaningful to you, what comes up?",
    ],
    exploratory: [
      "What questions about meaning or purpose have been on your mind lately?",
      "If you could deepen one aspect of your spiritual practice, what would it be?",
    ],
    gratitude: [
      "What's something about your life right now that feels meaningful or purposeful?",
      "When was the last time you felt a sense of wonder? What was happening?",
    ],
    action: [
      "What's one small practice of mindfulness or gratitude you could try this week?",
      "Could you take five minutes today for quiet reflection? What would you focus on?",
    ],
  },
  'personal-growth': {
    reflective: [
      "It's been {timeframe} since you thought about personal growth. How have you been growing lately, even in small ways?",
      "What have you learned about yourself recently that surprised you?",
    ],
    exploratory: [
      "If you could develop one skill or quality, what would feel most valuable to you right now?",
      "What's an area of your life where you feel like you're on the edge of a breakthrough?",
    ],
    gratitude: [
      "What's a challenge you've overcome that you can appreciate now?",
      "What personal quality are you developing that you feel good about?",
    ],
    action: [
      "What's one small learning goal you could set for this week?",
      "Is there a book, podcast, or conversation that might help you grow right now?",
    ],
  },
  family: {
    reflective: [
      "It's been {timeframe} since you wrote about family. How are things with your family feeling right now?",
      "When you think about your family, what's the first thing that comes to mind?",
    ],
    exploratory: [
      "What's something about your family dynamic you'd like to understand better?",
      "If you could improve one thing about your family relationships, what would it be?",
    ],
    gratitude: [
      "What's one thing about your family you're grateful for today?",
      "Think about a family moment that made you smile recently. What happened?",
    ],
    action: [
      "What's one small thing you could do this week to connect with a family member?",
      "Is there a family tradition or activity you've been wanting to revisit?",
    ],
  },
  finances: {
    reflective: [
      "It's been {timeframe} since you reflected on your finances. How's your relationship with money feeling right now?",
      "When you think about your financial situation, what emotions come up?",
    ],
    exploratory: [
      "If you could change one thing about your financial habits, what would make the biggest difference?",
      "What's a financial goal that excites you rather than stresses you?",
    ],
    gratitude: [
      "What's one financial decision you've made that you feel good about?",
      "What financial resource or stability do you have that you might overlook?",
    ],
    action: [
      "What's one small financial step you could take this week?",
      "Could you spend 10 minutes this week reviewing one area of your finances?",
    ],
  },
};

// ============================================================
// Seasonal Context
// ============================================================

const SEASONAL_CONTEXTS = [
  { start: [11, 20], end: [12, 31], label: 'the holiday season' },
  { start: [1, 1], end: [1, 15], label: 'the start of a new year' },
  { start: [6, 1], end: [8, 31], label: 'the summer months' },
  { start: [3, 15], end: [4, 15], label: 'the spring season' },
  { start: [9, 1], end: [9, 30], label: 'the fall season' },
];

function getSeasonalContext(date) {
  const month = date.getMonth() + 1; // 1-indexed
  const day = date.getDate();
  const dayOfYear = month * 100 + day; // simple comparison trick

  for (const season of SEASONAL_CONTEXTS) {
    const start = season.start[0] * 100 + season.start[1];
    const end = season.end[0] * 100 + season.end[1];

    // Handle year-wrapping (Nov-Dec to Dec-Jan) by checking both ranges
    if (start <= end) {
      if (dayOfYear >= start && dayOfYear <= end) return season.label;
    } else {
      if (dayOfYear >= start || dayOfYear <= end) return season.label;
    }
  }
  return null;
}

// ============================================================
// Relative Time Formatting
// ============================================================

/**
 * Convert days since last mention to human-friendly relative time.
 * @param {number|null} days
 * @returns {string}
 */
export function formatRelativeTime(days) {
  if (days == null) return 'a while';
  if (days <= 2) return 'recently';
  if (days <= 6) return 'a few days';
  if (days <= 13) return 'about a week';
  if (days <= 20) return 'a couple of weeks';
  if (days <= 29) return 'about three weeks';
  if (days <= 59) return 'about a month';
  if (days <= 89) return 'a couple of months';
  return 'a few months';
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Select a prompt style based on engagement preferences.
 *
 * Uses weighted random selection: 70% toward preferred styles,
 * 30% distributed among others (exploration/exploitation balance).
 *
 * @param {Object|null} preferences - Engagement preferences
 * @param {string} domain - Life domain being prompted
 * @returns {string} One of PROMPT_STYLES
 */
export function selectPromptStyle(preferences, domain) {
  const rates = preferences?.styleAcceptanceRates;

  if (!rates || Object.keys(rates).length === 0) {
    // No history: uniform random
    return PROMPT_STYLES[Math.floor(Math.random() * PROMPT_STYLES.length)];
  }

  // Compute total acceptance across all styles
  const total = PROMPT_STYLES.reduce((sum, s) => sum + (rates[s] || 0), 0);

  if (total === 0) {
    return PROMPT_STYLES[Math.floor(Math.random() * PROMPT_STYLES.length)];
  }

  // Weighted random: preferred styles get 70%, others share 30%
  const weights = PROMPT_STYLES.map(style => {
    const rate = (rates[style] || 0) / total;
    return PREFERRED_WEIGHT * rate + EXPLORATION_WEIGHT / PROMPT_STYLES.length;
  });

  const weightSum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * weightSum;

  for (let i = 0; i < PROMPT_STYLES.length; i++) {
    r -= weights[i];
    if (r <= 0) return PROMPT_STYLES[i];
  }

  return PROMPT_STYLES[PROMPT_STYLES.length - 1];
}

/**
 * Generate prompt text for a specific domain, style, and context.
 *
 * @param {string} domain - One of the 8 life domains
 * @param {string} style - One of the 4 prompt styles
 * @param {Object} context
 * @param {Object|null} context.lastMentionDate - Firestore Timestamp or null
 * @param {string|null} [context.seasonalContext] - Seasonal label
 * @returns {string} Prompt text
 */
export function getPromptForDomain(domain, style, context = {}) {
  const templates = PROMPT_TEMPLATES[domain]?.[style];
  if (!templates || templates.length === 0) {
    // Fallback: generic prompt
    return `What's been on your mind about your ${domain.replace('-', ' ')} lately?`;
  }

  // Pick a random template
  const template = templates[Math.floor(Math.random() * templates.length)];

  // Compute timeframe from lastMentionDate
  let daysSince = null;
  if (context.lastMentionDate) {
    const ms = typeof context.lastMentionDate.toMillis === 'function'
      ? context.lastMentionDate.toMillis()
      : context.lastMentionDate;
    daysSince = Math.floor((Date.now() - ms) / 86400000);
  }
  const timeframe = formatRelativeTime(daysSince);

  let text = template.replace('{timeframe}', timeframe);

  // Append seasonal context if present
  if (context.seasonalContext) {
    text += ` With ${context.seasonalContext} here, this might be a good time to reflect.`;
  }

  return text;
}

/**
 * Check if a domain is currently snoozed.
 */
function isDomainSnoozed(domain, preferences) {
  const snoozeUntil = preferences?.preferences?.snoozeUntil?.[domain];
  if (!snoozeUntil) return false;

  const snoozeMs = typeof snoozeUntil.toMillis === 'function'
    ? snoozeUntil.toMillis()
    : snoozeUntil;

  return snoozeMs > Date.now();
}

/**
 * Generate a gap prompt for a user.
 *
 * Main entry point. Checks premium entitlement, detects gaps,
 * filters snoozed domains, selects style, and generates prompt text.
 *
 * @param {string} userId
 * @param {Object} [options]
 * @param {Date} [options.currentDate] - Override for testability
 * @returns {Promise<Object|null>} Prompt object or null
 */
export async function generateGapPrompt(userId, options = {}) {
  // 1. Premium gate (fail closed)
  try {
    const entitlement = await checkEntitlement(userId, 'prompts.gaps');
    if (!entitlement.entitled) return null;
  } catch {
    return null;
  }

  // 2. Detect gaps
  let gaps;
  try {
    gaps = await detectGaps(userId);
  } catch (error) {
    console.error('[gapPromptGenerator] Gap detection failed:', error.message);
    return null;
  }

  if (!gaps || gaps.length === 0) return null;

  // 3. Load engagement preferences
  let engagementData = null;
  try {
    engagementData = await analyticsRepository.getAnalyticsDoc(userId, 'gap_engagement');
  } catch {
    // Continue without personalization
  }

  // 4. Filter snoozed domains
  const filteredGaps = gaps.filter(g => !isDomainSnoozed(g.domain, engagementData));
  if (filteredGaps.length === 0) return null;

  // 5. Take highest-scoring gap (limit 1)
  const topGap = filteredGaps[0];

  // 6. Select style
  const hasPreferences = !!engagementData?.preferences?.styleAcceptanceRates;
  const style = selectPromptStyle(engagementData?.preferences || null, topGap.domain);

  // 7. Seasonal context
  const currentDate = options.currentDate || new Date();
  const seasonalContext = getSeasonalContext(currentDate);

  // 8. Generate prompt text
  const promptText = getPromptForDomain(topGap.domain, style, {
    lastMentionDate: topGap.lastMentionDate,
    seasonalContext,
  });

  return {
    domain: topGap.domain,
    promptText,
    promptStyle: style,
    gapScore: topGap.gapScore,
    lastMentionDate: topGap.lastMentionDate,
    metadata: {
      seasonal: !!seasonalContext,
      personalized: hasPreferences,
    },
  };
}

// ============================================================
// Engagement Tracking
// ============================================================

/**
 * Read engagement preferences for a user.
 *
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
export async function getEngagementPreferences(userId) {
  try {
    return await analyticsRepository.getAnalyticsDoc(userId, 'gap_engagement');
  } catch {
    return null;
  }
}

/**
 * Record a user's response to a gap prompt.
 *
 * Writes to subcollection for history and updates preferences document
 * for accepted/snoozed responses.
 *
 * @param {string} userId
 * @param {Object} engagementData
 * @param {string} engagementData.domain
 * @param {string} engagementData.promptStyle
 * @param {string} engagementData.response - "accepted" | "dismissed" | "snoozed"
 * @param {boolean} engagementData.resultedInEntry
 * @param {Date} engagementData.timestamp
 */
export async function trackEngagement(userId, engagementData) {
  // Validate inputs before writing to Firestore
  if (!LIFE_DOMAINS.includes(engagementData.domain)) {
    console.error('[gapPromptGenerator] Invalid domain:', engagementData.domain);
    return;
  }
  if (!PROMPT_STYLES.includes(engagementData.promptStyle)) {
    console.error('[gapPromptGenerator] Invalid promptStyle:', engagementData.promptStyle);
    return;
  }
  if (!VALID_RESPONSES.includes(engagementData.response)) {
    console.error('[gapPromptGenerator] Invalid response:', engagementData.response);
    return;
  }

  try {
    // Write to history subcollection
    const historyRef = collection(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId,
      'analytics', 'gap_engagement', 'history'
    );
    await addDoc(historyRef, {
      domain: engagementData.domain,
      promptStyle: engagementData.promptStyle,
      response: engagementData.response,
      resultedInEntry: engagementData.resultedInEntry,
      timestamp: Timestamp.fromMillis(engagementData.timestamp.getTime()),
    });

    // Update preferences based on response type
    if (engagementData.response === 'accepted' || engagementData.response === 'snoozed') {
      const existing = await getEngagementPreferences(userId);
      const prefs = existing?.preferences || {
        styleAcceptanceRates: {},
        snoozeUntil: {},
      };

      if (engagementData.response === 'accepted') {
        prefs.styleAcceptanceRates = prefs.styleAcceptanceRates || {};
        prefs.styleAcceptanceRates[engagementData.promptStyle] =
          (prefs.styleAcceptanceRates[engagementData.promptStyle] || 0) + 1;
      }

      if (engagementData.response === 'snoozed') {
        prefs.snoozeUntil = prefs.snoozeUntil || {};
        const snoozeMs = Date.now() + SNOOZE_DURATION_DAYS * 86400000;
        prefs.snoozeUntil[engagementData.domain] = Timestamp.fromMillis(snoozeMs);
      }

      await analyticsRepository.setAnalyticsDoc(userId, 'gap_engagement', {
        preferences: prefs,
      });
    }
  } catch (error) {
    console.error('[gapPromptGenerator] Failed to track engagement:', error.message);
  }
}
