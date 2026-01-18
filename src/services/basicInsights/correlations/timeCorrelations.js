/**
 * Time-Mood Correlations
 *
 * Analyzes entry timestamps to find temporal patterns in mood.
 * Uses entry.createdAt for day-of-week and time-of-day analysis.
 *
 * Example insights:
 * - "Weekend mood averages 15% higher"
 * - "Morning entries show 12% better mood"
 * - "Mondays tend to have 10% lower mood"
 */

import {
  average,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES,
  TIME_GROUPS
} from '../utils/thresholds';

/**
 * Parse timestamp to Date object
 * @param {any} timestamp - Firestore timestamp, Date, or ISO string
 * @returns {Date|null} Date object or null
 */
const parseTimestamp = (timestamp) => {
  if (!timestamp) return null;

  // Firestore Timestamp
  if (timestamp.toDate) {
    return timestamp.toDate();
  }

  // Already a Date
  if (timestamp instanceof Date) {
    return timestamp;
  }

  // ISO string or milliseconds
  const parsed = new Date(timestamp);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Get time classification for an entry
 * @param {Date} date - Entry date
 * @returns {Object} Time classification
 */
const classifyTime = (date) => {
  const dayOfWeek = date.getDay();
  const hour = date.getHours();

  // Day classification
  const isWeekend = TIME_GROUPS.dayOfWeek.weekend.includes(dayOfWeek);
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];

  // Time of day classification
  let timeOfDay;
  if (hour >= 5 && hour < 12) {
    timeOfDay = 'morning';
  } else if (hour >= 12 && hour < 17) {
    timeOfDay = 'afternoon';
  } else if (hour >= 17 && hour < 21) {
    timeOfDay = 'evening';
  } else {
    timeOfDay = 'night';
  }

  return {
    dayOfWeek,
    dayName,
    isWeekend,
    isWeekday: !isWeekend,
    timeOfDay,
    hour
  };
};

/**
 * Compute time-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} Time insight objects
 */
export const computeTimeCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with mood scores and valid timestamps
  const entriesWithData = entries
    .filter(e => e.analysis?.mood_score != null && e.createdAt)
    .map(e => {
      const date = parseTimestamp(e.createdAt);
      if (!date) return null;
      return {
        mood: e.analysis.mood_score,
        date,
        ...classifyTime(date)
      };
    })
    .filter(e => e !== null);

  if (entriesWithData.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Calculate baseline mood
  const allMoods = entriesWithData.map(e => e.mood);
  const baselineMood = average(allMoods);

  const insights = [];

  // ===== WEEKEND VS WEEKDAY =====
  const weekendEntries = entriesWithData.filter(e => e.isWeekend);
  const weekdayEntries = entriesWithData.filter(e => e.isWeekday);

  if (weekendEntries.length >= THRESHOLDS.MIN_DATA_POINTS &&
      weekdayEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {

    const weekendMood = average(weekendEntries.map(e => e.mood));
    const weekdayMood = average(weekdayEntries.map(e => e.mood));
    const moodDelta = calculateMoodDelta(weekendMood, weekdayMood);

    if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
      const strength = determineStrength(moodDelta, weekendEntries.length + weekdayEntries.length);

      if (strength !== 'weak') {
        const better = weekendMood > weekdayMood ? 'weekend' : 'weekday';
        const absPercent = Math.abs(moodDelta);

        insights.push({
          id: generateInsightId(CATEGORIES.TIME, 'weekend_weekday'),
          category: CATEGORIES.TIME,
          insight: better === 'weekend'
            ? `📅 Weekend mood averages ${absPercent}% higher than weekdays`
            : `📅 Weekday mood averages ${absPercent}% higher than weekends`,
          moodDelta: better === 'weekend' ? moodDelta : -moodDelta,
          direction: 'positive',
          strength,
          sampleSize: entriesWithData.length,
          weekendMood: Math.round(weekendMood * 100),
          weekdayMood: Math.round(weekdayMood * 100),
          peakTime: better,
          recommendation: better === 'weekend'
            ? 'Consider what makes weekends special and bring elements into weekdays'
            : null
        });
      }
    }
  }

  // ===== TIME OF DAY =====
  const timeGroups = {
    morning: entriesWithData.filter(e => e.timeOfDay === 'morning'),
    afternoon: entriesWithData.filter(e => e.timeOfDay === 'afternoon'),
    evening: entriesWithData.filter(e => e.timeOfDay === 'evening'),
    night: entriesWithData.filter(e => e.timeOfDay === 'night')
  };

  // Find best and worst times with enough data
  const timeStats = [];
  for (const [time, entries] of Object.entries(timeGroups)) {
    if (entries.length >= THRESHOLDS.MIN_DATA_POINTS) {
      timeStats.push({
        time,
        mood: average(entries.map(e => e.mood)),
        count: entries.length
      });
    }
  }

  if (timeStats.length >= 2) {
    // Sort by mood to find best and worst
    timeStats.sort((a, b) => b.mood - a.mood);
    const best = timeStats[0];
    const worst = timeStats[timeStats.length - 1];
    const moodDelta = calculateMoodDelta(best.mood, worst.mood);

    if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
      const strength = determineStrength(moodDelta, best.count + worst.count);

      if (strength !== 'weak') {
        const timeEmoji = {
          morning: '🌅',
          afternoon: '☀️',
          evening: '🌆',
          night: '🌙'
        };

        insights.push({
          id: generateInsightId(CATEGORIES.TIME, 'time_of_day'),
          category: CATEGORIES.TIME,
          insight: `${timeEmoji[best.time]} ${capitalize(best.time)} entries show ${Math.abs(moodDelta)}% better mood than ${worst.time}`,
          moodDelta,
          direction: 'positive',
          strength,
          sampleSize: timeStats.reduce((sum, t) => sum + t.count, 0),
          bestTime: best.time,
          bestMood: Math.round(best.mood * 100),
          worstTime: worst.time,
          worstMood: Math.round(worst.mood * 100),
          recommendation: `You seem to be at your best in the ${best.time}`
        });
      }
    }
  }

  // ===== SPECIFIC DAY OF WEEK =====
  const dayGroups = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (const entry of entriesWithData) {
    const day = entry.dayName;
    if (!dayGroups[day]) {
      dayGroups[day] = [];
    }
    dayGroups[day].push(entry.mood);
  }

  // Find days with significant deviation from baseline
  for (const [day, moods] of Object.entries(dayGroups)) {
    if (moods.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const dayMood = average(moods);
    const moodDelta = calculateMoodDelta(dayMood, baselineMood);

    // Higher threshold for individual days (more specific)
    if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA + 2) {
      const strength = determineStrength(moodDelta, moods.length);

      if (strength !== 'weak') {
        const direction = moodDelta > 0 ? 'positive' : 'negative';
        const absPercent = Math.abs(moodDelta);

        insights.push({
          id: generateInsightId(CATEGORIES.TIME, day.toLowerCase()),
          category: CATEGORIES.TIME,
          insight: moodDelta > 0
            ? `📆 ${day}s tend to be ${absPercent}% above your average mood`
            : `📆 ${day}s tend to be ${absPercent}% below your average mood`,
          moodDelta,
          direction,
          strength,
          sampleSize: moods.length,
          dayName: day,
          dayMood: Math.round(dayMood * 100),
          baselineMood: Math.round(baselineMood * 100),
          recommendation: moodDelta < 0
            ? `Consider planning enjoyable activities for ${day}s`
            : null
        });
      }
    }
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  // Return top insights
  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

/**
 * Helper to capitalize string
 */
const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

/**
 * Get a single top time insight
 * @param {Array} entries - Journal entries
 * @returns {Object|null} Top time insight or null
 */
export const getTopTimeInsight = (entries) => {
  const insights = computeTimeCorrelations(entries);
  return insights.length > 0 ? insights[0] : null;
};

export default {
  computeTimeCorrelations,
  getTopTimeInsight
};
