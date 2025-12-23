/**
 * Day Score Service
 *
 * Calculates day scores using the day_summaries collection for efficient reads.
 * The day_summaries are pre-computed by a Cloud Function trigger on signal writes.
 *
 * Scoring strategy:
 * - If entries exist: Entry mood 60% + Signal sentiment 40% (blended)
 * - If only signals: Signal sentiment 100% (forward-referenced day)
 * - If only entries: Entry mood 100%
 * - Plans always have weight 0 (neutral facts)
 */

import { getDaySummaries } from '../signals';

/**
 * Format a Date to YYYY-MM-DD string
 */
export const formatDateKey = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split('T')[0];
};

/**
 * Get the last N days as date key strings
 */
export const getLastNDayKeys = (n = 30) => {
  const keys = [];
  const today = new Date();

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    keys.push(formatDateKey(d));
  }

  return keys;
};

/**
 * Get day score data for a range of dates
 *
 * Returns a map of dateKey -> { dayScore, entryMood, signalSentiment, scoreSource, ... }
 *
 * @param {string} userId - The user ID
 * @param {number} days - Number of days to fetch (default 30)
 * @returns {Promise<Object>} Map of date keys to summary data
 */
export const getDayScores = async (userId, days = 30) => {
  const dateKeys = getLastNDayKeys(days);

  try {
    const summaries = await getDaySummaries(userId, dateKeys);
    return summaries;
  } catch (error) {
    console.error('Failed to fetch day summaries:', error);
    return {};
  }
};

/**
 * Get day score for a specific date
 *
 * @param {string} userId - The user ID
 * @param {Date} date - The date to get score for
 * @returns {Promise<Object|null>} Day summary or null
 */
export const getDayScore = async (userId, date) => {
  const dateKey = formatDateKey(date);
  const summaries = await getDaySummaries(userId, [dateKey]);
  return summaries[dateKey] || null;
};

/**
 * Calculate combined day score from entries and signals (client-side fallback)
 *
 * This is used when day_summaries haven't been computed yet.
 * Normally the Cloud Function handles this, but this provides a fallback.
 *
 * @param {Array} entries - Entries recorded on this day
 * @param {Array} signals - Signals targeting this day
 * @returns {Object} { dayScore, entryMood, signalSentiment, scoreSource }
 */
export const calculateDayScoreLocal = (entries, signals) => {
  // Calculate entry mood average
  const moodEntries = entries.filter(e =>
    e.entry_type !== 'task' &&
    typeof e.analysis?.mood_score === 'number'
  );

  const entryMood = moodEntries.length > 0
    ? moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length
    : null;

  // Calculate signal sentiment (exclude plans, they have weight 0)
  const scoringSignals = signals.filter(s =>
    s.type !== 'plan' &&
    s.status !== 'dismissed'
  );

  let signalSentiment = null;
  if (scoringSignals.length > 0) {
    const sentimentValues = {
      positive: 1,
      excited: 0.8,
      hopeful: 0.6,
      neutral: 0,
      anxious: -0.3,
      negative: -0.5,
      dreading: -0.7
    };

    const total = scoringSignals.reduce((sum, s) => {
      return sum + (sentimentValues[s.sentiment] || 0);
    }, 0);

    const rawAvg = total / scoringSignals.length; // -1 to 1 scale
    signalSentiment = (rawAvg + 1) / 2; // Convert to 0-1 scale
  }

  // Dynamic weighting
  let dayScore = null;
  let scoreSource = 'none';

  if (entryMood !== null && signalSentiment !== null) {
    dayScore = (entryMood * 0.6) + (signalSentiment * 0.4);
    scoreSource = 'blended';
  } else if (entryMood !== null) {
    dayScore = entryMood;
    scoreSource = 'entries_only';
  } else if (signalSentiment !== null) {
    dayScore = signalSentiment;
    scoreSource = 'signals_only';
  }

  return {
    dayScore,
    entryMood,
    signalSentiment,
    scoreSource,
    entryCount: entries.length,
    signalCount: signals.length,
    scoringSignalCount: scoringSignals.length
  };
};

/**
 * Get mood label from score
 */
export const getMoodLabel = (score) => {
  if (typeof score !== 'number') return '';
  if (score >= 0.75) return 'Great';
  if (score >= 0.55) return 'Good';
  if (score >= 0.45) return 'Okay';
  if (score >= 0.25) return 'Low';
  return 'Struggling';
};

/**
 * Get mood color from score (CSS variable or fallback)
 */
export const getMoodColor = (score) => {
  if (typeof score !== 'number') return 'var(--color-warm-200, #e7e5e4)';
  if (score >= 0.75) return 'var(--color-mood-great, #22c55e)';
  if (score >= 0.55) return 'var(--color-mood-good, #84cc16)';
  if (score >= 0.45) return 'var(--color-mood-neutral, #eab308)';
  if (score >= 0.25) return 'var(--color-mood-low, #3b82f6)';
  return 'var(--color-mood-struggling, #8b5cf6)';
};

export default {
  getDayScores,
  getDayScore,
  calculateDayScoreLocal,
  formatDateKey,
  getLastNDayKeys,
  getMoodLabel,
  getMoodColor
};
