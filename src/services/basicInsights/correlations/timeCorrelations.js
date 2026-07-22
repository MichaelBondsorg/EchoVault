/**
 * Time-Mood Correlations
 *
 * Analyzes entry timestamps to find temporal patterns in mood.
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`) — `mood01`/`timestampMs`, never
 * raw `analysis.mood_score`/`createdAt`. `timestampMs` is the adapter's
 * `effectiveDate ?? createdAt` parse (same field precedence as `dateKey`,
 * just not truncated to a calendar day) — needed here because hour/
 * day-of-week classification requires the actual instant, not just which
 * calendar day it fell on.
 *
 * Day-grounding: every group (weekend/weekday, each time-of-day bucket,
 * each specific day-of-week) requires at least `THRESHOLDS.MIN_UNIQUE_DAYS`
 * distinct calendar days, not just entries — several entries the same
 * afternoon must not read as a temporal pattern.
 *
 * Baseline: weekend-vs-weekday and time-of-day-best-vs-worst were already
 * non-overlapping complements (every entry falls in exactly one side; no
 * all-entries-average anti-pattern there). The specific day-of-week
 * sub-analysis was NOT: it used to compare a day's mood against the
 * average of ALL entries, which includes that day's own entries inside its
 * own baseline — fixed to compare against the complement (every OTHER
 * day), via the same `computeComplementBaseline` helper the other
 * basicInsights engines use (which also guards the empty-group
 * `average([])`->`0` class for all three sub-analyses here).
 *
 * Example insights:
 * - "Weekend mood averages 15% higher than weekdays"
 * - "Morning entries show 12% better mood than evening"
 * - "Mondays show 10% lower mood than your other entries"
 */

import {
  average,
  determineStrength,
  generateInsightId,
  countUniqueDays,
  computeComplementBaseline
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES,
  TIME_GROUPS
} from '../utils/thresholds';

/**
 * Get time classification for an entry's Date
 * @param {Date} date - Entry date
 * @returns {Object} Time classification
 */
const classifyTime = (date) => {
  const dayOfWeek = date.getDay();
  const hour = date.getHours();

  const isWeekend = TIME_GROUPS.dayOfWeek.weekend.includes(dayOfWeek);
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];

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
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} Time insight objects
 */
export const computeTimeCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with a known mood01 and a usable timestamp, classify
  // once per entry.
  const entriesWithData = entries
    .filter(e => e.mood01 != null && e.timestampMs != null)
    .map(e => ({
      entry: e,
      mood: e.mood01,
      ...classifyTime(new Date(e.timestampMs))
    }));

  if (entriesWithData.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const insights = [];

  // ===== WEEKEND VS WEEKDAY =====
  const weekendEntries = entriesWithData.filter(e => e.isWeekend);
  const weekdayEntries = entriesWithData.filter(e => e.isWeekday);

  if (weekendEntries.length >= THRESHOLDS.MIN_DATA_POINTS &&
      weekdayEntries.length >= THRESHOLDS.MIN_DATA_POINTS) {

    const { insufficient, presentMood: weekendMood, absentMood: weekdayMood, moodDelta } = computeComplementBaseline({
      presentMoods: weekendEntries.map(e => e.mood),
      absentMoods: weekdayEntries.map(e => e.mood)
    });

    if (!insufficient && Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
      const better = weekendMood > weekdayMood ? 'weekend' : 'weekday';
      const betterGroup = better === 'weekend' ? weekendEntries : weekdayEntries;
      const betterDayCount = countUniqueDays(betterGroup.map(e => e.entry));

      if (betterDayCount >= THRESHOLDS.MIN_UNIQUE_DAYS) {
        const strength = determineStrength(moodDelta, weekendEntries.length + weekdayEntries.length);

        if (strength !== 'weak') {
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
            uniqueDayCount: betterDayCount,
            weekendMood: Math.round(weekendMood * 100),
            weekdayMood: Math.round(weekdayMood * 100),
            peakTime: better,
            recommendation: better === 'weekend'
              ? 'Consider what makes weekends special and bring elements into weekdays'
              : null,
            entryIds: betterGroup.map(e => e.entry.id).filter(Boolean)
          });
        }
      }
    }
  }

  // ===== TIME OF DAY =====
  // Only buckets that clear BOTH the entry-count and day-grounding floors
  // are eligible to be compared as "best"/"worst".
  const timeStats = [];
  for (const time of ['morning', 'afternoon', 'evening', 'night']) {
    const groupEntries = entriesWithData.filter(e => e.timeOfDay === time);
    if (groupEntries.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const dayCount = countUniqueDays(groupEntries.map(e => e.entry));
    if (dayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    timeStats.push({
      time,
      mood: average(groupEntries.map(e => e.mood)),
      entries: groupEntries,
      dayCount
    });
  }

  if (timeStats.length >= 2) {
    timeStats.sort((a, b) => b.mood - a.mood);
    const best = timeStats[0];
    const worst = timeStats[timeStats.length - 1];

    const { insufficient, presentMood: bestMood, absentMood: worstMood, moodDelta } = computeComplementBaseline({
      presentMoods: best.entries.map(e => e.mood),
      absentMoods: worst.entries.map(e => e.mood)
    });

    if (!insufficient && Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA) {
      const strength = determineStrength(moodDelta, best.entries.length + worst.entries.length);

      if (strength !== 'weak') {
        const timeEmoji = { morning: '🌅', afternoon: '☀️', evening: '🌆', night: '🌙' };

        insights.push({
          id: generateInsightId(CATEGORIES.TIME, 'time_of_day'),
          category: CATEGORIES.TIME,
          insight: `${timeEmoji[best.time]} ${capitalize(best.time)} entries show ${Math.abs(moodDelta)}% better mood than ${worst.time}`,
          moodDelta,
          direction: 'positive',
          strength,
          sampleSize: best.entries.length + worst.entries.length,
          uniqueDayCount: best.dayCount,
          bestTime: best.time,
          bestMood: Math.round(bestMood * 100),
          worstTime: worst.time,
          worstMood: Math.round(worstMood * 100),
          recommendation: `You seem to be at your best in the ${best.time}`,
          entryIds: best.entries.map(e => e.entry.id).filter(Boolean)
        });
      }
    }
  }

  // ===== SPECIFIC DAY OF WEEK =====
  const dayGroups = {};
  for (const e of entriesWithData) {
    if (!dayGroups[e.dayName]) dayGroups[e.dayName] = [];
    dayGroups[e.dayName].push(e);
  }

  for (const [day, dayEntries] of Object.entries(dayGroups)) {
    if (dayEntries.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const dayCount = countUniqueDays(dayEntries.map(e => e.entry));
    if (dayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    // Non-overlapping complement: this day vs every OTHER day. Previously
    // this compared against an all-entries average that included this
    // day's own entries inside its own baseline.
    const otherEntries = entriesWithData.filter(e => e.dayName !== day);

    const { insufficient, presentMood: dayMood, absentMood: otherMood, moodDelta } = computeComplementBaseline({
      presentMoods: dayEntries.map(e => e.mood),
      absentMoods: otherEntries.map(e => e.mood)
    });
    if (insufficient) continue;

    // Higher threshold for individual days (more specific) — preserved
    // from pre-R4 tuning.
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA + 2) continue;

    const strength = determineStrength(moodDelta, dayEntries.length);
    if (strength === 'weak') continue;

    const direction = moodDelta > 0 ? 'positive' : 'negative';
    const absPercent = Math.abs(moodDelta);

    insights.push({
      id: generateInsightId(CATEGORIES.TIME, day.toLowerCase()),
      category: CATEGORIES.TIME,
      insight: moodDelta > 0
        ? `📆 ${day}s show ${absPercent}% higher mood than your other entries`
        : `📆 ${day}s show ${absPercent}% lower mood than your other entries`,
      moodDelta,
      direction,
      strength,
      sampleSize: dayEntries.length,
      uniqueDayCount: dayCount,
      dayName: day,
      dayMood: Math.round(dayMood * 100),
      baselineMood: Math.round(otherMood * 100), // complement (every other day) group's average mood
      recommendation: moodDelta < 0
        ? `Consider planning enjoyable activities for ${day}s`
        : null,
      entryIds: dayEntries.map(e => e.entry.id).filter(Boolean)
    });
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
 * @param {Array} entries - Adapter-normalized entries
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
