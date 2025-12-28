/**
 * Burnout Indicators
 *
 * Keyword patterns and tag definitions for detecting burnout risk.
 * These are used by burnoutRiskScore.js to calculate risk levels.
 */

// Fatigue-related keywords
export const FATIGUE_KEYWORDS = [
  'tired', 'exhausted', 'drained', 'burned out', 'burnout', 'burnt out',
  'can\'t keep up', 'running on empty', 'no energy', 'depleted',
  'wiped out', 'worn out', 'fatigued', 'spent', 'tapped out'
];

// Overwork-related keywords
export const OVERWORK_KEYWORDS = [
  'overtime', 'working late', 'late night', 'weekend work', 'no break',
  'back-to-back', 'non-stop', 'nonstop', 'slammed', 'swamped',
  'drowning in work', 'too many meetings', 'endless meetings',
  'never-ending', 'piling up', 'behind on everything'
];

// Physical symptom keywords
export const PHYSICAL_SYMPTOMS = [
  'eyes hurt', 'eye strain', 'headache', 'migraine', 'can\'t sleep',
  'insomnia', 'stress eating', 'not eating', 'skipping meals',
  'neck pain', 'back pain', 'tense', 'tension', 'grinding teeth',
  'jaw clenching', 'stomach issues', 'nauseous', 'heart racing'
];

// Emotional exhaustion keywords
export const EMOTIONAL_EXHAUSTION = [
  'overwhelmed', 'drowning', 'nothing left', 'running on empty',
  'can\'t take it', 'at my limit', 'breaking point', 'losing it',
  'falling apart', 'shutting down', 'checked out', 'going through motions',
  'don\'t care anymore', 'what\'s the point', 'empty inside'
];

// Cynicism/detachment keywords (burnout dimension)
export const CYNICISM_KEYWORDS = [
  'don\'t care', 'whatever', 'pointless', 'waste of time',
  'why bother', 'doesn\'t matter', 'they don\'t care',
  'no one cares', 'thankless', 'unappreciated', 'invisible'
];

// Work-related tags that indicate professional stress
export const WORK_STRESS_TAGS = [
  '@project:', '@deadline:', '@meeting:', '@1on1:',
  '@client:', '@boss:', '@manager:', '@work:'
];

// Stress intensity modifiers
export const STRESS_INTENSITY_TAGS = [
  'overtime', 'rush', 'urgent', 'ASAP', 'emergency',
  'crunch', 'deadline', 'critical', 'priority', 'behind'
];

// Positive recovery indicators (reduce risk score)
export const RECOVERY_KEYWORDS = [
  'took a break', 'rested', 'day off', 'vacation', 'relaxed',
  'recharged', 'feeling better', 'recovered', 'self-care',
  'walked away', 'logged off', 'unplugged', 'disconnected'
];

// Time-based risk patterns
export const TIME_RISK_PATTERNS = {
  lateNightEntry: { startHour: 22, endHour: 5 }, // 10 PM - 5 AM
  weekendWork: [0, 6], // Sunday, Saturday
  earlyMorningRush: { startHour: 5, endHour: 7 } // 5 AM - 7 AM
};

/**
 * Check if text contains any keywords from a list
 * Returns { found: boolean, matches: string[], count: number }
 */
export const findKeywordMatches = (text, keywords) => {
  if (!text) return { found: false, matches: [], count: 0 };

  const lowerText = text.toLowerCase();
  const matches = keywords.filter(kw => lowerText.includes(kw.toLowerCase()));

  return {
    found: matches.length > 0,
    matches,
    count: matches.length
  };
};

/**
 * Check if tags contain work stress indicators
 */
export const hasWorkStressTags = (tags) => {
  if (!tags || !Array.isArray(tags)) return { found: false, matches: [], density: 0 };

  const workMatches = tags.filter(tag =>
    WORK_STRESS_TAGS.some(pattern => tag.startsWith(pattern.replace(':', '')))
  );

  const stressMatches = tags.filter(tag =>
    STRESS_INTENSITY_TAGS.some(pattern =>
      tag.toLowerCase().includes(pattern.toLowerCase())
    )
  );

  return {
    found: workMatches.length > 0 || stressMatches.length > 0,
    workTags: workMatches,
    stressTags: stressMatches,
    density: tags.length > 0 ? workMatches.length / tags.length : 0
  };
};

/**
 * Check if entry was created during high-risk time periods
 */
export const checkTimeRisk = (entryDate) => {
  const date = entryDate instanceof Date ? entryDate : new Date(entryDate);
  const hour = date.getHours();
  const day = date.getDay();

  const risks = [];

  // Late night entry
  if (hour >= TIME_RISK_PATTERNS.lateNightEntry.startHour ||
      hour < TIME_RISK_PATTERNS.lateNightEntry.endHour) {
    risks.push('late_night_entry');
  }

  // Weekend work
  if (TIME_RISK_PATTERNS.weekendWork.includes(day)) {
    risks.push('weekend_entry');
  }

  // Early morning rush
  if (hour >= TIME_RISK_PATTERNS.earlyMorningRush.startHour &&
      hour < TIME_RISK_PATTERNS.earlyMorningRush.endHour) {
    risks.push('early_morning_entry');
  }

  return {
    isRiskTime: risks.length > 0,
    risks,
    hour,
    dayOfWeek: day
  };
};

export default {
  FATIGUE_KEYWORDS,
  OVERWORK_KEYWORDS,
  PHYSICAL_SYMPTOMS,
  EMOTIONAL_EXHAUSTION,
  CYNICISM_KEYWORDS,
  WORK_STRESS_TAGS,
  STRESS_INTENSITY_TAGS,
  RECOVERY_KEYWORDS,
  TIME_RISK_PATTERNS,
  findKeywordMatches,
  hasWorkStressTags,
  checkTimeRisk
};
