/**
 * People/Entity-Mood Correlations
 *
 * Detects people and social contexts from journal entries and correlates
 * them with mood.
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`). `entities` is NEVER written by
 * the current analysis pipeline (confirmed: no writer sets it anywhere) —
 * the adapter resolves it as the UNKNOWN sentinel. Detection here is
 * multi-source and degrades gracefully per source (a source being UNKNOWN
 * just means that source contributes nothing — it does not make the whole
 * entry "unknown", since tags and text-pattern matching are independently
 * known for every entry).
 *
 * Sources:
 * - entry.tags (structured @person:/@pet: tags — always known once an
 *   entry has completed analysis, possibly known-empty)
 * - entry.entities (AI-extracted named entities — UNKNOWN today)
 * - entry.memoryMentions (memory graph mentions — UNKNOWN unless populated)
 * - Keyword matching for common groups (family, friends, etc.) in entry text
 *
 * Baseline: non-overlapping complement (entries mentioning this
 * person/group vs entries that don't — never an all-entries average).
 *
 * Day-grounding: a person/group must appear on at least
 * `THRESHOLDS.MIN_UNIQUE_DAYS` distinct calendar days.
 *
 * Wording: association only ("correlates with"), never causal
 * ("boosts") — same-entry co-occurrence is not evidence of effect.
 *
 * Example insights:
 * - "Time with family correlates with a 22% higher mood"
 * - "Friend hangouts correlate with an 18% higher mood"
 * - "Pet time correlates with a 15% higher mood"
 */

import {
  determineStrength,
  generateInsightId,
  countUniqueDays,
  computeComplementBaseline
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES,
  PEOPLE_PATTERNS
} from '../utils/thresholds';
import { isUnknown } from '../../insights/entryAdapter';

/**
 * Extract people/entities from a single adapter-normalized entry
 * @param {Object} entry - Adapter-normalized entry (see entryAdapter.js)
 * @returns {Map<string, {type: string, name: string}>} Map of entity keys to info
 */
const extractPeople = (entry) => {
  const people = new Map();
  const text = (entry.text || '').toLowerCase();

  // Source 1: Structured tags (e.g., @person:spencer, @pet:sterling).
  // UNKNOWN tags (no tags array anywhere on the entry) contribute nothing
  // from this source rather than crashing/being read as "no people".
  const tags = isUnknown(entry.tags) ? [] : entry.tags;
  for (const tag of tags) {
    const tagLower = (tag || '').toLowerCase();

    if (tagLower.startsWith('@person:')) {
      const name = tag.replace(/@person:/i, '').replace(/_/g, ' ');
      const key = name.toLowerCase();
      if (name.length > 2 && !people.has(key)) {
        const displayName = name.split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        people.set(key, {
          name: displayName,
          type: 'person',
          source: 'tags'
        });
      }
    }

    if (tagLower.startsWith('@pet:')) {
      const name = tag.replace(/@pet:/i, '').replace(/_/g, ' ');
      const key = name.toLowerCase();
      if (name.length > 2 && !people.has(key)) {
        const displayName = name.split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
        people.set(key, {
          name: displayName,
          type: 'pet',
          source: 'tags',
          emoji: '🐾'
        });
      }
    }
  }

  // Source 2: entities (AI-extracted named entities). UNKNOWN (never
  // written today) contributes nothing from this source.
  const entities = isUnknown(entry.entities) ? [] : entry.entities;
  for (const entity of entities) {
    if (entity?.name && entity.name.length > 2) {
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

  // Source 3: memoryMentions (from memory graph). UNKNOWN contributes
  // nothing from this source.
  const memoryMentions = isUnknown(entry.memoryMentions) ? [] : entry.memoryMentions;
  for (const mention of memoryMentions) {
    if (mention?.name && mention.name.length > 2) {
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

  // Source 4: Pattern matching for common groups (always known — text
  // defaults to '' when absent, a genuinely known "no text").
  for (const [groupKey, config] of Object.entries(PEOPLE_PATTERNS)) {
    for (const pattern of config.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        if (!people.has(groupKey)) {
          people.set(groupKey, {
            name: config.label,
            type: config.type,
            source: 'pattern',
            isGroup: true,
            emoji: config.emoji
          });
        }
        break;
      }
    }
  }

  return people;
};

/**
 * Compute people-mood correlations
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} People insight objects
 */
export const computePeopleCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const entriesWithMood = entries.filter(e => e.mood01 != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Detect people once per entry, and collect the set of all detected keys.
  const perEntry = entriesWithMood.map(entry => ({
    entry,
    people: extractPeople(entry)
  }));

  const allEntityKeys = new Map(); // entityKey -> info (for display metadata)
  for (const { people } of perEntry) {
    for (const [key, info] of people) {
      if (!allEntityKeys.has(key)) allEntityKeys.set(key, info);
    }
  }

  const insights = [];

  for (const [entityKey, info] of allEntityKeys) {
    const presentGroup = perEntry.filter(pe => pe.people.has(entityKey));
    const absentGroup = perEntry.filter(pe => !pe.people.has(entityKey));

    if (presentGroup.length < THRESHOLDS.MIN_MENTIONS) {
      continue;
    }

    const presentDayCount = countUniqueDays(presentGroup.map(pe => pe.entry));
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) {
      continue;
    }

    const { insufficient, moodDelta } = computeComplementBaseline({
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

    // Build insight message based on entity type — association wording
    // only, never causal ("boosts").
    let insightText;
    const emoji = info.emoji || (info.type === 'pet' ? '🐾' : '👤');

    if (info.isGroup) {
      insightText = moodDelta > 0
        ? `${emoji} Time with ${info.name.toLowerCase()} correlates with a ${absPercent}% higher mood`
        : `${emoji} ${info.name} time correlates with a ${absPercent}% lower mood`;
    } else if (info.type === 'pet') {
      insightText = moodDelta > 0
        ? `🐾 Time with ${info.name} correlates with a ${absPercent}% higher mood`
        : `🐾 ${info.name} mentions correlate with a ${absPercent}% lower mood`;
    } else {
      insightText = moodDelta > 0
        ? `👤 Time with ${info.name} correlates with a ${absPercent}% higher mood`
        : `👤 ${info.name} mentions correlate with a ${absPercent}% lower mood`;
    }

    insights.push({
      id: generateInsightId(CATEGORIES.PEOPLE, entityKey),
      category: CATEGORIES.PEOPLE,
      insight: insightText,
      moodDelta,
      direction,
      strength,
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      entityKey,
      entityName: info.name,
      entityType: info.type,
      isGroup: info.isGroup || false,
      recommendation: moodDelta > 0 && info.isGroup
        ? `Prioritize ${info.name.toLowerCase()} time when you need a boost`
        : null,
      entryIds: presentGroup.map(pe => pe.entry.id).filter(Boolean) // References to cited entries
    });
  }

  // Sort by absolute mood delta (strongest correlations first)
  // Prioritize groups over specific names for privacy/generalizability
  insights.sort((a, b) => {
    if (a.isGroup && !b.isGroup) return -1;
    if (!a.isGroup && b.isGroup) return 1;
    return Math.abs(b.moodDelta) - Math.abs(a.moodDelta);
  });

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

/**
 * Get a single top people insight
 * @param {Array} entries - Adapter-normalized entries
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
