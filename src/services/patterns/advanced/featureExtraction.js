/**
 * Advanced Feature Extraction Service
 *
 * Extracts rich features from journal entries for pattern detection:
 * - Temporal features (time, day, week, season)
 * - Entity features (people, places, activities)
 * - Contextual features (weather, health, sleep)
 * - Linguistic features (self-talk patterns)
 * - Sequential features (relative to previous entries)
 */

// Word lists for linguistic analysis
const NEGATIVE_WORDS = [
  'bad', 'terrible', 'awful', 'horrible', 'sad', 'angry', 'frustrated',
  'anxious', 'worried', 'stressed', 'depressed', 'lonely', 'tired',
  'exhausted', 'overwhelmed', 'disappointed', 'hurt', 'upset', 'scared',
  'afraid', 'nervous', 'irritated', 'annoyed', 'miserable', 'hopeless',
  'helpless', 'worthless', 'guilty', 'ashamed', 'regret', 'hate', 'fail'
];

const POSITIVE_WORDS = [
  'good', 'great', 'amazing', 'wonderful', 'happy', 'joy', 'excited',
  'grateful', 'thankful', 'blessed', 'love', 'peaceful', 'calm', 'relaxed',
  'confident', 'proud', 'accomplished', 'satisfied', 'content', 'hopeful',
  'optimistic', 'energized', 'motivated', 'inspired', 'strong', 'success',
  'achieve', 'win', 'celebrate', 'enjoy', 'fun', 'beautiful', 'nice'
];

const OBLIGATION_WORDS = [
  'should', 'must', 'have to', 'need to', 'ought to', 'supposed to',
  'got to', 'obligated', 'required', 'expected'
];

const UNCERTAINTY_WORDS = [
  'maybe', 'perhaps', 'might', 'could', 'possibly', 'probably',
  'uncertain', 'unsure', "don't know", 'not sure', 'wonder', 'confused'
];

/**
 * Get week of year for a date
 */
const getWeekOfYear = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
};

/**
 * Get season for a date (Northern Hemisphere)
 */
const getSeason = (date) => {
  const month = new Date(date).getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
};

/**
 * Check if date is near a holiday
 */
const isNearHoliday = (date) => {
  const d = new Date(date);
  const month = d.getMonth();
  const day = d.getDate();

  // Major US holidays (approximate)
  const holidays = [
    { month: 0, day: 1 },   // New Year
    { month: 1, day: 14 },  // Valentine's
    { month: 6, day: 4 },   // 4th of July
    { month: 9, day: 31 },  // Halloween
    { month: 10, start: 20, end: 30 }, // Thanksgiving week
    { month: 11, start: 20, end: 31 }, // Christmas/Holidays
  ];

  return holidays.some(h => {
    if (h.start && h.end) {
      return month === h.month && day >= h.start && day <= h.end;
    }
    return month === h.month && Math.abs(day - h.day) <= 3;
  });
};

/**
 * Count words matching a list (case-insensitive)
 */
const countMatchingWords = (text, wordList) => {
  if (!text) return 0;
  const lowerText = text.toLowerCase();
  return wordList.reduce((count, word) => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = lowerText.match(regex);
    return count + (matches?.length || 0);
  }, 0);
};

/**
 * Count self-references (I, me, my, myself)
 */
const countSelfReferences = (text) => {
  if (!text) return 0;
  const selfWords = ['\\bi\\b', '\\bme\\b', '\\bmy\\b', '\\bmyself\\b', "\\bi'm\\b", "\\bi've\\b", "\\bi'll\\b"];
  const pattern = new RegExp(selfWords.join('|'), 'gi');
  const matches = text.match(pattern);
  return matches?.length || 0;
};

/**
 * Extract entities from tags by type
 */
export const extractEntitiesByType = (tags, prefix) => {
  if (!tags?.length) return [];
  return tags
    .filter(t => t.startsWith(prefix))
    .map(t => t.replace(prefix, '').replace(/_/g, ' '));
};

/**
 * Count entities by type
 */
const countEntitiesByType = (tags, prefix) => {
  return extractEntitiesByType(tags, prefix).length;
};

/**
 * Check if entity is first mention in entry history
 */
const isFirstMention = (entry, prefix, allEntries) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);
  const entryTags = entry.tags?.filter(t => t.startsWith(prefix)) || [];

  if (entryTags.length === 0) return false;

  // Check if any of these entities appeared before
  const previousEntries = allEntries.filter(e => {
    const d = new Date(e.effectiveDate || e.createdAt);
    return d < entryDate;
  });

  const previousTags = new Set();
  previousEntries.forEach(e => {
    e.tags?.filter(t => t.startsWith(prefix)).forEach(t => previousTags.add(t));
  });

  return entryTags.some(t => !previousTags.has(t));
};

/**
 * Get days since last entry
 */
const getDaysSinceLastEntry = (entry, allEntries) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);

  const previousEntries = allEntries
    .filter(e => e.id !== entry.id)
    .map(e => new Date(e.effectiveDate || e.createdAt))
    .filter(d => d < entryDate)
    .sort((a, b) => b - a);

  if (previousEntries.length === 0) return null;

  return (entryDate - previousEntries[0]) / (1000 * 60 * 60 * 24);
};

/**
 * Get mood delta from previous entry
 */
const getMoodDelta = (entry, allEntries) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);
  const currentMood = entry.analysis?.mood_score;

  if (currentMood === undefined) return 0;

  const previousEntries = allEntries
    .filter(e => e.id !== entry.id && e.analysis?.mood_score !== undefined)
    .map(e => ({
      date: new Date(e.effectiveDate || e.createdAt),
      mood: e.analysis.mood_score
    }))
    .filter(e => e.date < entryDate)
    .sort((a, b) => b.date - a.date);

  if (previousEntries.length === 0) return 0;

  return currentMood - previousEntries[0].mood;
};

/**
 * Get previous entry mood
 */
const getPreviousEntryMood = (entry, allEntries) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);

  const previousEntries = allEntries
    .filter(e => e.id !== entry.id && e.analysis?.mood_score !== undefined)
    .map(e => ({
      date: new Date(e.effectiveDate || e.createdAt),
      mood: e.analysis.mood_score
    }))
    .filter(e => e.date < entryDate)
    .sort((a, b) => b.date - a.date);

  return previousEntries[0]?.mood ?? null;
};

/**
 * Count entries in a time window
 */
const countEntriesInWindow = (entry, allEntries, days) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);
  const windowStart = new Date(entryDate);
  windowStart.setDate(windowStart.getDate() - days);

  return allEntries.filter(e => {
    if (e.id === entry.id) return false;
    const d = new Date(e.effectiveDate || e.createdAt);
    return d >= windowStart && d < entryDate;
  }).length;
};

/**
 * Get average mood in a time window
 */
const getAvgMoodInWindow = (entry, allEntries, days) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);
  const windowStart = new Date(entryDate);
  windowStart.setDate(windowStart.getDate() - days);

  const windowEntries = allEntries.filter(e => {
    if (e.id === entry.id) return false;
    const d = new Date(e.effectiveDate || e.createdAt);
    return d >= windowStart && d < entryDate && e.analysis?.mood_score !== undefined;
  });

  if (windowEntries.length === 0) return null;

  const sum = windowEntries.reduce((s, e) => s + e.analysis.mood_score, 0);
  return sum / windowEntries.length;
};

/**
 * Get activities from previous day
 */
const getPreviousDayActivities = (entry, allEntries) => {
  const entryDate = new Date(entry.effectiveDate || entry.createdAt);
  const prevDayStart = new Date(entryDate);
  prevDayStart.setDate(prevDayStart.getDate() - 1);
  prevDayStart.setHours(0, 0, 0, 0);

  const prevDayEnd = new Date(prevDayStart);
  prevDayEnd.setHours(23, 59, 59, 999);

  const prevDayEntries = allEntries.filter(e => {
    const d = new Date(e.effectiveDate || e.createdAt);
    return d >= prevDayStart && d <= prevDayEnd;
  });

  const activities = new Set();
  prevDayEntries.forEach(e => {
    extractEntitiesByType(e.tags, '@activity:').forEach(a => activities.add(a));
  });

  return Array.from(activities);
};

/**
 * Extract comprehensive features from a journal entry
 *
 * @param {Object} entry - The journal entry
 * @param {Object[]} allEntries - All entries for context
 * @param {Object} context - Additional context (weather, health)
 * @returns {Object} Feature vector
 */
export const extractFeatures = (entry, allEntries = [], context = {}) => {
  const date = new Date(entry.effectiveDate || entry.createdAt);

  return {
    // Temporal features
    temporal: {
      dayOfWeek: date.getDay(),
      hourOfDay: date.getHours(),
      isWeekend: [0, 6].includes(date.getDay()),
      weekOfYear: getWeekOfYear(date),
      monthOfYear: date.getMonth(),
      daysFromMonthStart: date.getDate(),
      season: getSeason(date),
      isHolidayPeriod: isNearHoliday(date)
    },

    // Entity features
    entities: {
      people: extractEntitiesByType(entry.tags, '@person:'),
      places: extractEntitiesByType(entry.tags, '@place:'),
      activities: extractEntitiesByType(entry.tags, '@activity:'),
      topics: extractEntitiesByType(entry.tags, '@topic:'),
      personCount: countEntitiesByType(entry.tags, '@person:'),
      isAlone: countEntitiesByType(entry.tags, '@person:') === 0,
      isNewPlace: isFirstMention(entry, '@place:', allEntries),
      isNewPerson: isFirstMention(entry, '@person:', allEntries)
    },

    // Contextual features (from external APIs or entry metadata)
    context: {
      weather: entry.environmentContext?.weather || context.weather,
      temperature: entry.environmentContext?.temperature || context.temperature,
      isLowLight: entry.environmentContext?.isLowSunshine,
      sleepHours: entry.healthContext?.sleepLastNight,
      sleepQuality: entry.healthContext?.sleepQuality,
      hadWorkout: entry.healthContext?.hasWorkout,
      stressIndicator: entry.healthContext?.stressIndicator,
      daylightHours: entry.environmentContext?.sunTimes?.daylightHours
    },

    // Linguistic features
    linguistic: {
      wordCount: entry.text?.split(/\s+/).length || 0,
      sentenceCount: entry.text?.split(/[.!?]+/).filter(s => s.trim()).length || 0,
      avgSentenceLength: entry.text
        ? (entry.text.split(/\s+/).length / Math.max(1, entry.text.split(/[.!?]+/).filter(s => s.trim()).length))
        : 0,
      questionCount: (entry.text?.match(/\?/g) || []).length,
      exclamationCount: (entry.text?.match(/!/g) || []).length,
      selfReferenceCount: countSelfReferences(entry.text),
      negativeWords: countMatchingWords(entry.text, NEGATIVE_WORDS),
      positiveWords: countMatchingWords(entry.text, POSITIVE_WORDS),
      obligationWords: countMatchingWords(entry.text, OBLIGATION_WORDS),
      uncertaintyWords: countMatchingWords(entry.text, UNCERTAINTY_WORDS)
    },

    // Sequential features (relative to previous entries)
    sequential: {
      daysSinceLastEntry: getDaysSinceLastEntry(entry, allEntries),
      moodDeltaFromPrevious: getMoodDelta(entry, allEntries),
      isMoodShift: Math.abs(getMoodDelta(entry, allEntries)) > 0.2,
      entriesThisWeek: countEntriesInWindow(entry, allEntries, 7),
      avgMoodLast3Days: getAvgMoodInWindow(entry, allEntries, 3),
      previousEntryMood: getPreviousEntryMood(entry, allEntries),
      previousDayActivities: getPreviousDayActivities(entry, allEntries)
    },

    // Target variable (what we're trying to predict/correlate)
    target: {
      moodScore: entry.analysis?.mood_score,
      entryType: entry.analysis?.entry_type
    },

    // Metadata
    meta: {
      entryId: entry.id,
      date: date.toISOString(),
      category: entry.category
    }
  };
};

/**
 * Extract features for all entries
 *
 * @param {Object[]} entries - All entries
 * @returns {Object[]} Array of feature vectors
 */
export const extractAllFeatures = (entries) => {
  return entries.map(entry => extractFeatures(entry, entries));
};

/**
 * Categorize sleep hours into buckets
 */
export const categorizeSleep = (hours) => {
  if (hours === null || hours === undefined) return 'unknown';
  if (hours < 5) return 'poor';
  if (hours < 7) return 'fair';
  if (hours <= 9) return 'good';
  return 'excessive';
};

/**
 * Calculate baseline statistics for features
 */
export const calculateBaselines = (features) => {
  const moods = features
    .map(f => f.target.moodScore)
    .filter(m => m !== undefined && m !== null);

  const wordCounts = features
    .map(f => f.linguistic.wordCount)
    .filter(w => w > 0);

  const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = arr => {
    const m = mean(arr);
    return Math.sqrt(arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length);
  };

  return {
    mood: {
      mean: moods.length > 0 ? mean(moods) : 0.5,
      std: moods.length > 0 ? std(moods) : 0.2
    },
    wordCount: {
      mean: wordCounts.length > 0 ? mean(wordCounts) : 100,
      std: wordCounts.length > 0 ? std(wordCounts) : 50
    }
  };
};

export default {
  extractFeatures,
  extractAllFeatures,
  categorizeSleep,
  calculateBaselines,
  extractEntitiesByType,
  countEntitiesByType
};
