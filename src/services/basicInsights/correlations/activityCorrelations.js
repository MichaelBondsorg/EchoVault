/**
 * Activity-Mood Correlations
 *
 * Detects activities from journal entries and correlates them with mood.
 * Sources: entry.healthContext.activity, entry.analysis.tags, keyword matching
 *
 * Example insights:
 * - "Yoga boosts your mood by 22%"
 * - "Workout days show 18% improvement"
 * - "Meditation correlates with 15% better mood"
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
  ACTIVITY_PATTERNS
} from '../utils/thresholds';

/**
 * Extract activities from a single entry
 * @param {Object} entry - Journal entry
 * @returns {Set<string>} Set of detected activity keys
 */
const extractActivities = (entry) => {
  const activities = new Set();
  const text = (entry.content || entry.text || '').toLowerCase();

  // Source 1: healthContext.activity (from Whoop/HealthKit)
  if (entry.healthContext?.activity) {
    const healthActivity = entry.healthContext.activity.toLowerCase();
    // Map health activity to our categories
    if (/running|run/i.test(healthActivity)) activities.add('running');
    if (/cycling|bike/i.test(healthActivity)) activities.add('exercise');
    if (/swimming|swim/i.test(healthActivity)) activities.add('swimming');
    if (/yoga/i.test(healthActivity)) activities.add('yoga');
    if (/strength|lifting|weights/i.test(healthActivity)) activities.add('exercise');
    if (/walk|hiking/i.test(healthActivity)) activities.add('walking');
  }

  // Source 2: healthContext.hadWorkout flag
  if (entry.healthContext?.hadWorkout) {
    activities.add('exercise');
  }

  // Source 3: tags (check both entry.tags and entry.analysis.tags)
  // Note: Structured tags like @activity:yoga are stored at entry.tags
  const allTags = [
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...(Array.isArray(entry.analysis?.tags) ? entry.analysis.tags : [])
  ];

  for (const tag of allTags) {
    const tagLower = (tag || '').toLowerCase();

    // Check for structured activity tags (e.g., @activity:yoga)
    if (tagLower.startsWith('@activity:')) {
      const activityName = tagLower.replace('@activity:', '').replace(/_/g, ' ');
      // Map to known activity keys
      for (const [activityKey, config] of Object.entries(ACTIVITY_PATTERNS)) {
        if (config.patterns.some(p => p.test(activityName))) {
          activities.add(activityKey);
        }
      }
    }

    // Also check regular tags against patterns
    for (const [activityKey, config] of Object.entries(ACTIVITY_PATTERNS)) {
      if (config.patterns.some(p => p.test(tagLower))) {
        activities.add(activityKey);
      }
    }
  }

  // Source 4: Keyword matching in entry text
  for (const [activityKey, config] of Object.entries(ACTIVITY_PATTERNS)) {
    for (const pattern of config.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        activities.add(activityKey);
        break; // Only need one match per activity
      }
    }
  }

  return activities;
};

/**
 * Compute activity-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} Activity insight objects
 */
export const computeActivityCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with mood scores
  const entriesWithMood = entries.filter(e => e.analysis?.mood_score != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Calculate baseline mood (average across all entries)
  const allMoods = entriesWithMood.map(e => e.analysis.mood_score);
  const baselineMood = average(allMoods);

  // Track activity occurrences, moods, and entry references
  const activityStats = new Map();

  for (const entry of entriesWithMood) {
    const mood = entry.analysis.mood_score;
    const activities = extractActivities(entry);
    const entryId = entry.id || entry.entryId;

    for (const activity of activities) {
      if (!activityStats.has(activity)) {
        activityStats.set(activity, {
          moods: [],
          entryIds: [],
          entryCount: 0
        });
      }
      const stats = activityStats.get(activity);
      stats.moods.push(mood);
      if (entryId) stats.entryIds.push(entryId);
      stats.entryCount++;
    }
  }

  // Generate insights for activities with enough data
  const insights = [];

  for (const [activityKey, stats] of activityStats) {
    if (stats.entryCount < THRESHOLDS.MIN_DATA_POINTS) {
      continue;
    }

    const activityMood = average(stats.moods);
    const moodDelta = calculateMoodDelta(activityMood, baselineMood);

    // Skip if delta is below threshold
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) {
      continue;
    }

    const activityConfig = ACTIVITY_PATTERNS[activityKey];
    const strength = determineStrength(moodDelta, stats.entryCount);

    // Only include moderate or strong insights
    if (strength === 'weak') {
      continue;
    }

    const direction = moodDelta > 0 ? 'positive' : 'negative';
    const verb = moodDelta > 0 ? 'boosts' : 'lowers';
    const absPercent = Math.abs(moodDelta);

    insights.push({
      id: generateInsightId(CATEGORIES.ACTIVITY, activityKey),
      category: CATEGORIES.ACTIVITY,
      insight: `${activityConfig.emoji} ${activityConfig.label} ${verb} your mood by ${absPercent}%`,
      moodDelta,
      direction,
      strength,
      sampleSize: stats.entryCount,
      baselineMood: Math.round(baselineMood * 100),
      activityMood: Math.round(activityMood * 100),
      activityKey,
      activityLabel: activityConfig.label,
      recommendation: moodDelta > 0
        ? `Try ${activityConfig.label.toLowerCase()} when feeling low`
        : null,
      entryIds: stats.entryIds // References to cited entries
    });
  }

  // Sort by absolute mood delta (strongest correlations first)
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  // Return top insights
  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

/**
 * Get a single top activity insight
 * @param {Array} entries - Journal entries
 * @returns {Object|null} Top activity insight or null
 */
export const getTopActivityInsight = (entries) => {
  const insights = computeActivityCorrelations(entries);
  return insights.length > 0 ? insights[0] : null;
};

export default {
  computeActivityCorrelations,
  getTopActivityInsight,
  extractActivities
};
