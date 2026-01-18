/**
 * Thresholds and Configuration for Basic Insights
 *
 * Centralized configuration for all insight generation parameters.
 * Adjust these values to tune insight sensitivity and quality.
 */

export const THRESHOLDS = {
  // Minimum entries required to generate any insights
  MIN_ENTRIES: 7,

  // Minimum data points per specific metric/factor
  MIN_DATA_POINTS: 5,

  // Minimum mentions for people/entity correlations
  MIN_MENTIONS: 3,

  // Minimum mood delta (percentage) to show an insight
  // 8% = meaningful but not too strict
  MIN_MOOD_DELTA: 8,

  // Time-to-live for cached insights (hours)
  TTL_HOURS: 12,

  // Maximum insights to return (prevents overwhelming users)
  MAX_INSIGHTS: 8,

  // Maximum insights per category
  MAX_PER_CATEGORY: 3
};

/**
 * Insight categories
 */
export const CATEGORIES = {
  ACTIVITY: 'activity',
  PEOPLE: 'people',
  HEALTH: 'health',
  ENVIRONMENT: 'environment',
  TIME: 'time'
};

/**
 * Activity keywords to detect in entries
 * Maps activity name to search patterns
 */
export const ACTIVITY_PATTERNS = {
  yoga: {
    patterns: [/\byoga\b/gi, /\bstretching\b/gi],
    label: 'Yoga',
    emoji: '🧘'
  },
  meditation: {
    patterns: [/\bmeditat(e|ion|ing)\b/gi, /\bmindful(ness)?\b/gi],
    label: 'Meditation',
    emoji: '🧘‍♂️'
  },
  exercise: {
    patterns: [/\bexercis(e|ing)\b/gi, /\bworkout\b/gi, /\bgym\b/gi, /\blifting\b/gi],
    label: 'Exercise',
    emoji: '💪'
  },
  running: {
    patterns: [/\brunn(ing)?\b/gi, /\bjog(ging)?\b/gi],
    label: 'Running',
    emoji: '🏃'
  },
  walking: {
    patterns: [/\bwalk(ing|ed)?\b/gi, /\bhike|hiking\b/gi],
    label: 'Walking',
    emoji: '🚶'
  },
  swimming: {
    patterns: [/\bswim(ming)?\b/gi, /\bpool\b/gi],
    label: 'Swimming',
    emoji: '🏊'
  },
  therapy: {
    patterns: [/\btherap(y|ist)\b/gi, /\bcounseling\b/gi],
    label: 'Therapy',
    emoji: '💬'
  },
  reading: {
    patterns: [/\bread(ing)?\b/gi, /\bbook\b/gi],
    label: 'Reading',
    emoji: '📚'
  },
  journaling: {
    patterns: [/\bjournal(ing)?\b/gi, /\bwrit(e|ing)\b/gi],
    label: 'Journaling',
    emoji: '📝'
  },
  cooking: {
    patterns: [/\bcook(ing|ed)?\b/gi, /\bbak(e|ing|ed)\b/gi],
    label: 'Cooking',
    emoji: '👨‍🍳'
  },
  nature: {
    patterns: [/\bnature\b/gi, /\boutdoors?\b/gi, /\bpark\b/gi, /\bbeach\b/gi],
    label: 'Nature time',
    emoji: '🌳'
  }
};

/**
 * People/entity types to detect
 */
export const PEOPLE_PATTERNS = {
  family: {
    patterns: [/\bfamily\b/gi, /\bmom\b/gi, /\bdad\b/gi, /\bparent(s)?\b/gi, /\bsibling(s)?\b/gi, /\bbrother\b/gi, /\bsister\b/gi],
    label: 'Family',
    type: 'group',
    emoji: '👨‍👩‍👧'
  },
  friends: {
    patterns: [/\bfriend(s)?\b/gi, /\bbuddy|buddies\b/gi],
    label: 'Friends',
    type: 'group',
    emoji: '👋'
  },
  partner: {
    patterns: [/\bpartner\b/gi, /\bspouse\b/gi, /\bhusband\b/gi, /\bwife\b/gi, /\bgirlfriend\b/gi, /\bboyfriend\b/gi],
    label: 'Partner',
    type: 'person',
    emoji: '❤️'
  },
  pet: {
    patterns: [/\bpet(s)?\b/gi, /\bdog\b/gi, /\bcat\b/gi, /\bpuppy\b/gi, /\bkitty\b/gi],
    label: 'Pet',
    type: 'pet',
    emoji: '🐾'
  },
  coworkers: {
    patterns: [/\bcoworker(s)?\b/gi, /\bcolleague(s)?\b/gi, /\bteam\b/gi],
    label: 'Coworkers',
    type: 'group',
    emoji: '💼'
  },
  kids: {
    patterns: [/\bkid(s)?\b/gi, /\bchild(ren)?\b/gi, /\bson\b/gi, /\bdaughter\b/gi],
    label: 'Kids',
    type: 'group',
    emoji: '👶'
  }
};

/**
 * Time-based groupings
 */
export const TIME_GROUPS = {
  dayOfWeek: {
    weekend: [0, 6],  // Sunday, Saturday
    weekday: [1, 2, 3, 4, 5]  // Monday - Friday
  },
  timeOfDay: {
    morning: { start: 5, end: 12 },    // 5am - 12pm
    afternoon: { start: 12, end: 17 }, // 12pm - 5pm
    evening: { start: 17, end: 21 },   // 5pm - 9pm
    night: { start: 21, end: 5 }       // 9pm - 5am
  }
};

export default {
  THRESHOLDS,
  CATEGORIES,
  ACTIVITY_PATTERNS,
  PEOPLE_PATTERNS,
  TIME_GROUPS
};
