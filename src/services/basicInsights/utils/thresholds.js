/**
 * Thresholds and Configuration for Basic Insights
 *
 * Centralized configuration for all insight generation parameters.
 * Adjust these values to tune insight sensitivity and quality.
 */

export const THRESHOLDS = {
  // Minimum entries required to generate any insights
  MIN_ENTRIES: 5,

  // Minimum data points per specific metric/factor.
  // R4 P0-closure Minor 5: raised back 3 -> 5, the plan's explicit floor
  // (docs/superpowers/plans/2026-07-22-r4-insight-integrity.md) — 3 was a
  // pre-R4 "surface more insights while fine-tuning" relaxation that
  // undercut the day-level grounding work done elsewhere in R4 (a
  // per-factor comparison this thin is exactly the kind of thing R4's
  // unique-day gating was meant to guard against). Every current usage
  // site gates a per-factor group comparison (activityCorrelations,
  // categoryCorrelations, healthExtendedCorrelations, timeCorrelations) —
  // none gates "any insights at all" (that's MIN_ENTRIES, above, untouched)
  // — so a single shared constant is correct here; no MIN_FACTOR_ENTRIES
  // split was needed.
  MIN_DATA_POINTS: 5,

  // Minimum mentions for people/entity correlations
  MIN_MENTIONS: 3,

  // Minimum mood delta (percentage) to show an insight
  // Lowered from 8% to 5% to be more permissive
  MIN_MOOD_DELTA: 5,

  // Time-to-live for cached insights (hours)
  TTL_HOURS: 12,

  // Maximum insights to return (prevents overwhelming users)
  MAX_INSIGHTS: 10,

  // Maximum insights per category
  MAX_PER_CATEGORY: 3,

  // R4 day-grounding floor (DR finding 4): a factor must appear on at
  // least this many DISTINCT calendar days (adapter dateKey), not merely
  // this many entries, before an insight is emitted for it — several
  // journal entries the same afternoon should not read as a pattern.
  // Applied ALONGSIDE (not instead of) MIN_DATA_POINTS/MIN_MENTIONS.
  // Review-driven floor, revisable as real usage data comes in.
  MIN_UNIQUE_DAYS: 3
};

/**
 * Insight categories
 */
export const CATEGORIES = {
  ACTIVITY: 'activity',
  PEOPLE: 'people',
  HEALTH: 'health',
  ENVIRONMENT: 'environment',
  TIME: 'time',
  CATEGORY: 'category',      // Entry category (work, personal, health, etc.)
  THEMES: 'themes',          // Themes and emotions from analysis
  SLEEP_DETAIL: 'sleep_detail' // Deep sleep, REM, etc.
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
    // Note: Removed generic "read" which matched past-tense usage ("I read the email")
    // Now only matches "reading" (activity) and "book"
    patterns: [/\breading\b/gi, /\bbook(s)?\b/gi],
    label: 'Reading',
    emoji: '📚'
  },
  journaling: {
    // Note: Removed generic "journal" and "write/writing" which matched meta-references
    // (talking about the journaling app, "write there", etc.)
    // Now only matches activity forms: "journaling", "journaled"
    patterns: [/\bjournaling\b/gi, /\bjournaled\b/gi],
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
