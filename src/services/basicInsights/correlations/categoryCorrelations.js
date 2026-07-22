/**
 * Entry Category/Type-Mood Correlations
 *
 * Analyzes mood patterns based on entry categorization:
 * - Entry category (work, personal, health, relationships, growth)
 * - Entry type (reflection, vent, task, decision)
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`). `entry_type` is stored
 * TOP-LEVEL by the current write pipeline — this file used to read
 * `entry.analysis.entry_type`, which is never written there (a legacy
 * shape), so entry-type correlations silently never fired. Entries whose
 * category/entryType is UNKNOWN (adapter sentinel — no value found at any
 * known location) are dropped from that specific grouping analysis
 * entirely, never counted into either the present or the complement group.
 *
 * Baseline: non-overlapping complement (this category/type's entries vs
 * every OTHER known-category/type entry — never an all-entries average
 * that double-counts the group being measured inside its own baseline).
 *
 * Day-grounding: a category/type must appear on at least
 * `THRESHOLDS.MIN_UNIQUE_DAYS` distinct calendar days.
 *
 * Example insights:
 * - "Work entries show 15% lower mood than your other entries"
 * - "Reflection entries show 12% higher mood than your other entries"
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
import { isUnknown } from '../../insights/entryAdapter';

/**
 * Category display configuration
 */
const CATEGORY_CONFIG = {
  personal: { label: 'Personal', emoji: '👤' },
  work: { label: 'Work', emoji: '💼' },
  health: { label: 'Health', emoji: '🏥' },
  relationships: { label: 'Relationships', emoji: '❤️' },
  growth: { label: 'Growth', emoji: '🌱' }
};

/**
 * Entry type display configuration
 */
const ENTRY_TYPE_CONFIG = {
  reflection: { label: 'Reflection', emoji: '🪞' },
  vent: { label: 'Venting', emoji: '💨' },
  task: { label: 'Task-focused', emoji: '✅' },
  decision: { label: 'Decision-making', emoji: '🤔' }
};

/**
 * Build present/absent complement groups keyed by a lowercased string
 * field, dropping UNKNOWN-valued entries from the analysis entirely.
 * @param {Array} entriesWithMood - adapter-normalized entries
 * @param {(entry: Object) => (string|symbol)} fieldGetter
 * @returns {{knownEntries: Array<{entry: Object, key: string}>, keys: Set<string>}}
 */
const groupByKnownField = (entriesWithMood, fieldGetter) => {
  const knownEntries = [];
  const keys = new Set();
  for (const entry of entriesWithMood) {
    const value = fieldGetter(entry);
    if (isUnknown(value) || typeof value !== 'string' || value.length === 0) continue;
    const key = value.toLowerCase();
    knownEntries.push({ entry, key });
    keys.add(key);
  }
  return { knownEntries, keys };
};

/**
 * Compute category-mood correlations
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} Category insight objects
 */
export const computeCategoryCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const entriesWithMood = entries.filter(e => e.mood01 != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const insights = [];

  // ===== ENTRY CATEGORY CORRELATIONS =====
  const { knownEntries: knownCategoryEntries, keys: categoryKeys } =
    groupByKnownField(entriesWithMood, (e) => e.category);

  for (const categoryKey of categoryKeys) {
    const presentGroup = knownCategoryEntries.filter(ke => ke.key === categoryKey);
    const absentGroup = knownCategoryEntries.filter(ke => ke.key !== categoryKey);

    if (presentGroup.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const presentDayCount = countUniqueDays(presentGroup.map(ke => ke.entry));
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    const { insufficient, presentMood, absentMood, moodDelta } = computeComplementBaseline({
      presentMoods: presentGroup.map(ke => ke.entry.mood01),
      absentMoods: absentGroup.map(ke => ke.entry.mood01)
    });
    if (insufficient) continue;
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, presentGroup.length);
    if (strength === 'weak') continue;

    const config = CATEGORY_CONFIG[categoryKey] || { label: categoryKey, emoji: '📝' };
    const direction = moodDelta > 0 ? 'positive' : 'negative';

    insights.push({
      id: generateInsightId(CATEGORIES.CATEGORY, `category_${categoryKey}`),
      category: CATEGORIES.CATEGORY,
      insight: moodDelta > 0
        ? `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% higher mood than your other entries`
        : `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% lower mood than your other entries`,
      moodDelta,
      direction,
      strength,
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      categoryMood: Math.round(presentMood * 100),
      baselineMood: Math.round(absentMood * 100), // complement (other-category) group's average mood
      recommendation: moodDelta < 0 && categoryKey === 'work'
        ? 'Consider work-life balance strategies'
        : null,
      entryIds: presentGroup.map(ke => ke.entry.id).filter(Boolean)
    });
  }

  // ===== ENTRY TYPE CORRELATIONS =====
  const { knownEntries: knownTypeEntries, keys: typeKeys } =
    groupByKnownField(entriesWithMood, (e) => e.entryType);

  for (const typeKey of typeKeys) {
    const presentGroup = knownTypeEntries.filter(ke => ke.key === typeKey);
    const absentGroup = knownTypeEntries.filter(ke => ke.key !== typeKey);

    if (presentGroup.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const presentDayCount = countUniqueDays(presentGroup.map(ke => ke.entry));
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    const { insufficient, presentMood, absentMood, moodDelta } = computeComplementBaseline({
      presentMoods: presentGroup.map(ke => ke.entry.mood01),
      absentMoods: absentGroup.map(ke => ke.entry.mood01)
    });
    if (insufficient) continue;
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, presentGroup.length);
    if (strength === 'weak') continue;

    const config = ENTRY_TYPE_CONFIG[typeKey] || { label: typeKey, emoji: '📝' };
    const direction = moodDelta > 0 ? 'positive' : 'negative';

    insights.push({
      id: generateInsightId(CATEGORIES.CATEGORY, `type_${typeKey}`),
      category: CATEGORIES.CATEGORY,
      insight: moodDelta > 0
        ? `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% higher mood than your other entries`
        : `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% lower mood than your other entries`,
      moodDelta,
      direction,
      strength,
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      entryType: typeKey,
      recommendation: typeKey === 'vent' && moodDelta < 0
        ? 'Venting may reflect rather than cause low mood - consider balanced journaling'
        : typeKey === 'reflection' && moodDelta > 0
        ? 'Reflective journaling tends to appear alongside a better mood'
        : null,
      entryIds: presentGroup.map(ke => ke.entry.id).filter(Boolean)
    });
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeCategoryCorrelations
};
