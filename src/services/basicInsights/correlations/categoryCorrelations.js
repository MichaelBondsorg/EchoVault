/**
 * Entry Category/Type-Mood Correlations
 *
 * Analyzes mood patterns based on entry categorization:
 * - Entry category (work, personal, health, relationships, growth)
 * - Entry type (reflection, vent, task, decision)
 *
 * Example insights:
 * - "Work entries show 15% lower mood than average"
 * - "Reflection entries correlate with 12% better mood"
 * - "Relationship entries have 18% higher mood"
 */

import {
  average,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES
} from '../utils/thresholds';

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
 * Compute category-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} Category insight objects
 */
export const computeCategoryCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with mood scores
  const entriesWithMood = entries.filter(e => e.analysis?.mood_score != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Calculate baseline mood
  const allMoods = entriesWithMood.map(e => e.analysis.mood_score);
  const baselineMood = average(allMoods);

  const insights = [];

  // ===== ENTRY CATEGORY CORRELATIONS =====
  const categoryGroups = {};

  for (const entry of entriesWithMood) {
    // Get category from entry or classification
    const category = entry.category || entry.classification?.primary_category;
    if (!category) continue;

    const categoryLower = category.toLowerCase();
    if (!categoryGroups[categoryLower]) {
      categoryGroups[categoryLower] = { moods: [], entryIds: [] };
    }
    categoryGroups[categoryLower].moods.push(entry.analysis.mood_score);
    if (entry.id || entry.entryId) {
      categoryGroups[categoryLower].entryIds.push(entry.id || entry.entryId);
    }
  }

  // Generate insights for categories with enough data
  for (const [category, data] of Object.entries(categoryGroups)) {
    if (data.moods.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const categoryMood = average(data.moods);
    const moodDelta = calculateMoodDelta(categoryMood, baselineMood);

    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, data.moods.length);
    if (strength === 'weak') continue;

    const config = CATEGORY_CONFIG[category] || { label: category, emoji: '📝' };
    const direction = moodDelta > 0 ? 'positive' : 'negative';

    insights.push({
      id: generateInsightId(CATEGORIES.CATEGORY, `category_${category}`),
      category: CATEGORIES.CATEGORY,
      insight: moodDelta > 0
        ? `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% higher mood than average`
        : `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% lower mood than average`,
      moodDelta,
      direction,
      strength,
      sampleSize: data.moods.length,
      categoryMood: Math.round(categoryMood * 100),
      baselineMood: Math.round(baselineMood * 100),
      recommendation: moodDelta < 0 && category === 'work'
        ? 'Consider work-life balance strategies'
        : null,
      entryIds: data.entryIds
    });
  }

  // ===== ENTRY TYPE CORRELATIONS =====
  const typeGroups = {};

  for (const entry of entriesWithMood) {
    const entryType = entry.analysis?.entry_type;
    if (!entryType) continue;

    const typeLower = entryType.toLowerCase();
    if (!typeGroups[typeLower]) {
      typeGroups[typeLower] = { moods: [], entryIds: [] };
    }
    typeGroups[typeLower].moods.push(entry.analysis.mood_score);
    if (entry.id || entry.entryId) {
      typeGroups[typeLower].entryIds.push(entry.id || entry.entryId);
    }
  }

  // Generate insights for entry types with enough data
  for (const [entryType, data] of Object.entries(typeGroups)) {
    if (data.moods.length < THRESHOLDS.MIN_DATA_POINTS) continue;

    const typeMood = average(data.moods);
    const moodDelta = calculateMoodDelta(typeMood, baselineMood);

    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, data.moods.length);
    if (strength === 'weak') continue;

    const config = ENTRY_TYPE_CONFIG[entryType] || { label: entryType, emoji: '📝' };
    const direction = moodDelta > 0 ? 'positive' : 'negative';

    insights.push({
      id: generateInsightId(CATEGORIES.CATEGORY, `type_${entryType}`),
      category: CATEGORIES.CATEGORY,
      insight: moodDelta > 0
        ? `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% higher mood`
        : `${config.emoji} ${config.label} entries show ${Math.abs(moodDelta)}% lower mood`,
      moodDelta,
      direction,
      strength,
      sampleSize: data.moods.length,
      entryType,
      recommendation: entryType === 'vent' && moodDelta < 0
        ? 'Venting may reflect rather than cause low mood - consider balanced journaling'
        : entryType === 'reflection' && moodDelta > 0
        ? 'Reflective journaling seems to help your mood'
        : null,
      entryIds: data.entryIds
    });
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeCategoryCorrelations
};
