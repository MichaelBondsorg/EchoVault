/**
 * Activity-Mood Correlations
 *
 * Detects activities from journal entries and correlates them with mood.
 * Sources: healthSignals.activityTypes (Whoop/HealthKit), tags, keyword
 * matching in entry text.
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`) — the orchestrator normalizes
 * once and passes the result down. `healthContext.activity` is an OBJECT,
 * never a string; the adapter derives `healthSignals.activityTypes`
 * (a lowercased string[] of workout type labels) so this file never touches
 * the raw healthContext shape (this WAS the live `.toLowerCase()`-on-an-
 * object crash the deep review reproduced).
 *
 * Baseline: non-overlapping complement (entries where the activity was
 * detected vs entries where it wasn't — never an all-entries average that
 * double-counts the "present" group inside its own baseline).
 *
 * Day-grounding: an activity must appear on at least
 * `THRESHOLDS.MIN_UNIQUE_DAYS` distinct calendar days, not merely
 * `THRESHOLDS.MIN_DATA_POINTS` entries, before it's surfaced.
 *
 * Wording: association only ("correlates with"), never causal
 * ("boosts"/"lowers") — same-entry co-occurrence is not evidence of effect.
 *
 * Example insights:
 * - "Yoga correlates with a 22% higher mood"
 * - "Running correlates with an 18% higher mood"
 */

import {
  calculateMoodDelta,
  determineStrength,
  generateInsightId,
  countUniqueDays,
  computeComplementBaseline
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES,
  ACTIVITY_PATTERNS
} from '../utils/thresholds';
import { isUnknown } from '../../insights/entryAdapter';

/**
 * Extract activities from a single adapter-normalized entry
 * @param {Object} entry - Adapter-normalized entry (see entryAdapter.js)
 * @returns {Set<string>} Set of detected activity keys
 */
const extractActivities = (entry) => {
  const activities = new Set();
  const text = (entry.text || '').toLowerCase();

  // Source 1: healthSignals.activityTypes (from Whoop/HealthKit workouts).
  // This is a string[] the adapter derives from
  // healthContext.activity.workouts[].type/.activityType — the REAL place
  // an activity label lives; healthContext.activity itself is an object.
  const activityTypes = entry.healthSignals?.activityTypes || [];
  for (const healthActivity of activityTypes) {
    if (/running|run/i.test(healthActivity)) activities.add('running');
    if (/cycling|bike/i.test(healthActivity)) activities.add('exercise');
    if (/swimming|swim/i.test(healthActivity)) activities.add('swimming');
    if (/yoga/i.test(healthActivity)) activities.add('yoga');
    if (/strength|lifting|weights/i.test(healthActivity)) activities.add('exercise');
    if (/walk|hiking/i.test(healthActivity)) activities.add('walking');
  }

  // Source 2: healthSignals.hadWorkout flag
  if (entry.healthSignals?.hadWorkout) {
    activities.add('exercise');
  }

  // Source 3: tags. A tags value of UNKNOWN (no tags array anywhere on the
  // entry) contributes nothing from this source rather than crashing or
  // being read as "no tags" — the other sources (health, text) still get a
  // fair chance to detect the activity.
  const tags = isUnknown(entry.tags) ? [] : entry.tags;
  for (const tag of tags) {
    const tagLower = (tag || '').toLowerCase();

    // Check for structured activity tags (e.g., @activity:yoga)
    if (tagLower.startsWith('@activity:')) {
      const activityName = tagLower.replace('@activity:', '').replace(/_/g, ' ');
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
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} Activity insight objects
 */
export const computeActivityCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with a known mood01
  const entriesWithMood = entries.filter(e => e.mood01 != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Detect activities once per entry
  const perEntry = entriesWithMood.map(entry => ({
    entry,
    activities: extractActivities(entry)
  }));

  const insights = [];

  for (const [activityKey, activityConfig] of Object.entries(ACTIVITY_PATTERNS)) {
    const presentGroup = perEntry.filter(pe => pe.activities.has(activityKey));
    const absentGroup = perEntry.filter(pe => !pe.activities.has(activityKey));

    if (presentGroup.length < THRESHOLDS.MIN_DATA_POINTS) {
      continue;
    }

    // Day-grounding: require distinct calendar days, not just entries
    const presentDayCount = countUniqueDays(presentGroup.map(pe => pe.entry));
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) {
      continue;
    }

    // Non-overlapping complement baseline. Empty-group -> insufficient,
    // never a fabricated average([])===0 comparison.
    const { insufficient, presentMood, absentMood, moodDelta } = computeComplementBaseline({
      presentMoods: presentGroup.map(pe => pe.entry.mood01),
      absentMoods: absentGroup.map(pe => pe.entry.mood01)
    });
    if (insufficient) {
      continue;
    }

    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) {
      continue;
    }

    const strength = determineStrength(moodDelta, presentGroup.length);
    if (strength === 'weak') {
      continue;
    }

    const direction = moodDelta > 0 ? 'positive' : 'negative';
    const absPercent = Math.abs(moodDelta);

    insights.push({
      id: generateInsightId(CATEGORIES.ACTIVITY, activityKey),
      category: CATEGORIES.ACTIVITY,
      // Association wording only — same-entry co-occurrence is not
      // evidence that the activity caused the mood difference.
      insight: `${activityConfig.emoji} ${activityConfig.label} correlates with a ${absPercent}% ${direction === 'positive' ? 'higher' : 'lower'} mood`,
      moodDelta,
      direction,
      strength,
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      baselineMood: Math.round(absentMood * 100), // complement (activity-absent) group's average mood
      activityMood: Math.round(presentMood * 100),
      activityKey,
      activityLabel: activityConfig.label,
      recommendation: moodDelta > 0
        ? `Try ${activityConfig.label.toLowerCase()} when feeling low`
        : null,
      entryIds: presentGroup.map(pe => pe.entry.id).filter(Boolean) // References to cited entries
    });
  }

  // Sort by absolute mood delta (strongest correlations first)
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  // Return top insights
  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

/**
 * Get a single top activity insight
 * @param {Array} entries - Adapter-normalized entries
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
