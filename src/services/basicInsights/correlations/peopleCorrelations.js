/**
 * People/Entity-Mood Correlations
 *
 * Detects people and social contexts from journal entries and correlates
 * them with mood. Based on entity extraction pattern from orchestrator.js.
 *
 * Sources:
 * - entry.analysis.entities (AI-extracted)
 * - entry.memoryMentions (memory graph)
 * - Keyword matching for common groups (family, friends, etc.)
 *
 * Example insights:
 * - "Time with family correlates with 22% better mood"
 * - "Friend hangouts boost mood by 18%"
 * - "Pet time shows 15% mood improvement"
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
  PEOPLE_PATTERNS
} from '../utils/thresholds';

/**
 * Extract people/entities from a single entry
 * @param {Object} entry - Journal entry
 * @returns {Map<string, {type: string, name: string}>} Map of entity keys to info
 */
const extractPeople = (entry) => {
  const people = new Map();
  const text = (entry.content || entry.text || '').toLowerCase();

  // Source 1: analysis.entities (AI-extracted named entities)
  if (entry.analysis?.entities && Array.isArray(entry.analysis.entities)) {
    for (const entity of entry.analysis.entities) {
      if (entity.name && entity.name.length > 2) {
        const key = entity.name.toLowerCase();
        if (!people.has(key)) {
          people.set(key, {
            name: entity.name,
            type: entity.type || 'person',
            source: 'analysis'
          });
        }
      }
    }
  }

  // Source 2: memoryMentions (from memory graph)
  if (entry.memoryMentions && Array.isArray(entry.memoryMentions)) {
    for (const mention of entry.memoryMentions) {
      if (mention.name && mention.name.length > 2) {
        const key = mention.name.toLowerCase();
        if (!people.has(key)) {
          people.set(key, {
            name: mention.name,
            type: mention.entityType || 'person',
            source: 'memory'
          });
        }
      }
    }
  }

  // Source 3: Pattern matching for common groups
  for (const [groupKey, config] of Object.entries(PEOPLE_PATTERNS)) {
    for (const pattern of config.patterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        // Use group key as the entity key for aggregation
        if (!people.has(groupKey)) {
          people.set(groupKey, {
            name: config.label,
            type: config.type,
            source: 'pattern',
            isGroup: true,
            emoji: config.emoji
          });
        }
        break; // Only need one match per group
      }
    }
  }

  return people;
};

/**
 * Compute people-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} People insight objects
 */
export const computePeopleCorrelations = (entries) => {
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

  // Track entity occurrences, moods, and entry references
  const entityStats = new Map();

  for (const entry of entriesWithMood) {
    const mood = entry.analysis.mood_score;
    const people = extractPeople(entry);
    const entryId = entry.id || entry.entryId;

    for (const [key, info] of people) {
      if (!entityStats.has(key)) {
        entityStats.set(key, {
          ...info,
          moods: [],
          entryIds: [],
          mentionCount: 0
        });
      }
      const stats = entityStats.get(key);
      stats.moods.push(mood);
      if (entryId) stats.entryIds.push(entryId);
      stats.mentionCount++;
    }
  }

  // Generate insights for entities with enough mentions
  const insights = [];

  for (const [entityKey, stats] of entityStats) {
    // Need minimum mentions for statistical relevance
    if (stats.mentionCount < THRESHOLDS.MIN_MENTIONS) {
      continue;
    }

    const entityMood = average(stats.moods);
    const moodDelta = calculateMoodDelta(entityMood, baselineMood);

    // Skip if delta is below threshold
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) {
      continue;
    }

    const strength = determineStrength(moodDelta, stats.mentionCount);

    // Only include moderate or strong insights
    if (strength === 'weak') {
      continue;
    }

    const direction = moodDelta > 0 ? 'positive' : 'negative';
    const absPercent = Math.abs(moodDelta);

    // Build insight message based on entity type
    let insightText;
    const emoji = stats.emoji || (stats.type === 'pet' ? '🐾' : '👤');

    if (stats.isGroup) {
      // Generic group (family, friends, etc.)
      insightText = moodDelta > 0
        ? `${emoji} Time with ${stats.name.toLowerCase()} correlates with ${absPercent}% better mood`
        : `${emoji} ${stats.name} time correlates with ${absPercent}% lower mood`;
    } else if (stats.type === 'pet') {
      insightText = moodDelta > 0
        ? `🐾 Time with ${stats.name} boosts mood by ${absPercent}%`
        : `🐾 ${stats.name} mentions correlate with ${absPercent}% lower mood`;
    } else {
      // Specific person
      insightText = moodDelta > 0
        ? `👤 Time with ${stats.name} correlates with ${absPercent}% better mood`
        : `👤 ${stats.name} mentions correlate with ${absPercent}% lower mood`;
    }

    insights.push({
      id: generateInsightId(CATEGORIES.PEOPLE, entityKey),
      category: CATEGORIES.PEOPLE,
      insight: insightText,
      moodDelta,
      direction,
      strength,
      sampleSize: stats.mentionCount,
      baselineMood: Math.round(baselineMood * 100),
      entityMood: Math.round(entityMood * 100),
      entityKey,
      entityName: stats.name,
      entityType: stats.type,
      isGroup: stats.isGroup || false,
      recommendation: moodDelta > 0 && stats.isGroup
        ? `Prioritize ${stats.name.toLowerCase()} time when you need a boost`
        : null,
      entryIds: stats.entryIds // References to cited entries
    });
  }

  // Sort by absolute mood delta (strongest correlations first)
  // Prioritize groups over specific names for privacy/generalizability
  insights.sort((a, b) => {
    // Groups first
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    // Then by delta
    return Math.abs(b.moodDelta) - Math.abs(a.moodDelta);
  });

  // Return top insights
  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

/**
 * Get a single top people insight
 * @param {Array} entries - Journal entries
 * @returns {Object|null} Top people insight or null
 */
export const getTopPeopleInsight = (entries) => {
  const insights = computePeopleCorrelations(entries);
  return insights.length > 0 ? insights[0] : null;
};

export default {
  computePeopleCorrelations,
  getTopPeopleInsight,
  extractPeople
};
