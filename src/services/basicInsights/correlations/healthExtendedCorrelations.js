/**
 * Extended Health-Mood Correlations
 *
 * Additional health metrics beyond the basic healthCorrelations.js
 * Includes: strain, deep sleep, REM sleep, calories, exercise minutes.
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`) — reads `entry.healthSignals`
 * (built via the REAL `extractHealthSignals`, `src/services/health/
 * healthFormatter.js`, extended with the extra fields this file needs)
 * rather than reaching into raw `healthContext.*` paths itself, so this
 * file can never drift out of sync with the real object shape again — the
 * adapter is the one place that shape lives.
 *
 * Baseline: each metric splits entries into a high-value group and a
 * low-value group with a deliberate excluded middle band (e.g. strain
 * >=15 vs <10) — a non-overlapping complement by construction. Both groups
 * are checked for emptiness BEFORE averaging (`healthCorrelations`-class
 * `average([])`->`0` guard) via the shared `computeComplementBaseline`.
 *
 * Day-grounding: the reported (high-value) group must appear on at least
 * `THRESHOLDS.MIN_UNIQUE_DAYS` distinct calendar days.
 *
 * Wording: association only ("correlates with"), never causal claims about
 * what "helps"/"boosts" the user's mood.
 *
 * Example insights:
 * - "High strain days (15+) correlate with 12% lower mood"
 * - "More deep sleep correlates with 18% better mood"
 * - "Active calorie days (500+) show 15% mood improvement"
 */

import {
  determineStrength,
  generateInsightId,
  countUniqueDays,
  computeComplementBaseline
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES
} from '../utils/thresholds';

/**
 * Compute extended health-mood correlations
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} Extended health insight objects
 */
export const computeExtendedHealthCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with a known mood01 and health signals
  const entriesWithData = entries.filter(e => e.mood01 != null && e.healthSignals);

  if (entriesWithData.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const insights = [];

  /**
   * Shared logic for a threshold-split metric: high group (>= highCutoff)
   * vs low group (< lowCutoff), excluded middle band, complement baseline
   * with the empty-group guard, and day-grounding on the high group.
   */
  const emitThresholdInsight = ({
    metricField, highCutoff, lowCutoff, categoryId, insightIdKey,
    buildInsightText, buildRecommendation, entryIdsFromHighGroup = true
  }) => {
    const withMetric = entriesWithData.filter(e => e.healthSignals[metricField] != null);
    if (withMetric.length < THRESHOLDS.MIN_DATA_POINTS) return;

    const highGroup = withMetric.filter(e => e.healthSignals[metricField] >= highCutoff);
    const lowGroup = withMetric.filter(e => e.healthSignals[metricField] < lowCutoff);

    if (highGroup.length < 2 || lowGroup.length < 2) return;

    const highDayCount = countUniqueDays(highGroup);
    if (highDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) return;

    const { insufficient, presentMood: highMood, absentMood: lowMood, moodDelta } = computeComplementBaseline({
      presentMoods: highGroup.map(e => e.mood01),
      absentMoods: lowGroup.map(e => e.mood01)
    });
    if (insufficient) return;
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) return;

    const strength = determineStrength(moodDelta, withMetric.length);
    if (strength === 'weak') return;

    const better = highMood > lowMood ? 'high' : 'low';
    const citedGroup = entryIdsFromHighGroup
      ? (better === 'high' ? highGroup : lowGroup)
      : highGroup;

    insights.push({
      id: generateInsightId(categoryId, insightIdKey),
      category: categoryId,
      insight: buildInsightText({ better, moodDelta: Math.abs(moodDelta) }),
      moodDelta: better === 'high' ? moodDelta : -moodDelta,
      direction: better === 'high' ? 'positive' : 'negative',
      strength,
      sampleSize: withMetric.length,
      uniqueDayCount: highDayCount,
      recommendation: buildRecommendation ? buildRecommendation({ better }) : null,
      entryIds: citedGroup.map(e => e.id).filter(Boolean)
    });
  };

  // ===== STRAIN-MOOD CORRELATION (Whoop) =====
  emitThresholdInsight({
    metricField: 'strainScore',
    highCutoff: 15,
    lowCutoff: 10,
    categoryId: CATEGORIES.HEALTH,
    insightIdKey: 'strain',
    buildInsightText: ({ better, moodDelta }) => better === 'high'
      ? `🔥 High strain days (15+) correlate with a ${moodDelta}% better mood`
      : `🔥 Lower strain days (<10) correlate with a ${moodDelta}% better mood`,
    buildRecommendation: ({ better }) => better === 'high'
      ? 'Physical challenge tends to appear alongside a better mood for you'
      : 'Consider moderating physical exertion when feeling stressed'
  });

  // ===== DEEP SLEEP-MOOD CORRELATION =====
  emitThresholdInsight({
    metricField: 'deepSleepHours',
    highCutoff: 1.5,
    lowCutoff: 1,
    categoryId: CATEGORIES.SLEEP_DETAIL,
    insightIdKey: 'deep_sleep',
    buildInsightText: ({ moodDelta }) => `🌙 Good deep sleep (1.5h+) correlates with a ${moodDelta}% better mood`,
    buildRecommendation: () => 'Prioritize sleep hygiene for better deep sleep',
    entryIdsFromHighGroup: true
  });

  // ===== REM SLEEP-MOOD CORRELATION =====
  emitThresholdInsight({
    metricField: 'remSleepHours',
    highCutoff: 1.5,
    lowCutoff: 1,
    categoryId: CATEGORIES.SLEEP_DETAIL,
    insightIdKey: 'rem_sleep',
    buildInsightText: ({ moodDelta }) => `💤 Good REM sleep (1.5h+) correlates with a ${moodDelta}% better mood`,
    buildRecommendation: () => 'REM sleep is associated with emotional processing - maintain a consistent sleep schedule'
  });

  // ===== ACTIVE CALORIES-MOOD CORRELATION =====
  emitThresholdInsight({
    metricField: 'activeCalories',
    highCutoff: 500,
    lowCutoff: 200,
    categoryId: CATEGORIES.HEALTH,
    insightIdKey: 'active_calories',
    buildInsightText: ({ moodDelta }) => `🔥 Active days (500+ calories burned) show a ${moodDelta}% better mood`,
    buildRecommendation: () => 'Try to stay physically active throughout the day'
  });

  // ===== EXERCISE MINUTES-MOOD CORRELATION =====
  emitThresholdInsight({
    metricField: 'exerciseMinutes',
    highCutoff: 30,
    lowCutoff: 10,
    categoryId: CATEGORIES.HEALTH,
    insightIdKey: 'exercise_minutes',
    buildInsightText: ({ moodDelta }) => `⏱️ 30+ minutes of exercise correlates with a ${moodDelta}% better mood`,
    buildRecommendation: () => 'Aim for at least 30 minutes of exercise daily'
  });

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeExtendedHealthCorrelations
};
