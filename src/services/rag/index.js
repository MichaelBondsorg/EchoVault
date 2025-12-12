/**
 * Hybrid RAG Retrieval Service
 *
 * Combines multiple signals for intelligent context retrieval:
 * - Vector similarity (semantic matching)
 * - Recency decay (prefer recent entries)
 * - Entity matching (exact tag matches)
 * - Mood relevance (similar emotional context)
 *
 * Scoring formula:
 * Score = (vector_similarity × 0.4) + (recency_score × 0.3) + (entity_match × 0.2) + (mood_similarity × 0.1)
 */

import { cosineSimilarity } from '../ai/embeddings';

/**
 * Calculate recency score with exponential decay
 * Recent entries score higher, with configurable half-life
 *
 * @param {Date} entryDate - When the entry was created
 * @param {number} halfLifeDays - Days until score is halved (default: 7)
 * @returns {number} Score between 0 and 1
 */
export const calculateRecencyScore = (entryDate, halfLifeDays = 7) => {
  const now = new Date();
  const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();
  const daysAgo = (now - date) / (1000 * 60 * 60 * 24);

  // Exponential decay: score = 0.5^(daysAgo / halfLife)
  return Math.pow(0.5, daysAgo / halfLifeDays);
};

/**
 * Calculate entity match score
 * Higher score when query entities match entry entities
 *
 * @param {string[]} queryEntities - Entities from current context/query
 * @param {string[]} entryTags - Tags from the entry
 * @returns {number} Score between 0 and 1
 */
export const calculateEntityMatchScore = (queryEntities, entryTags) => {
  if (!queryEntities?.length || !entryTags?.length) return 0;

  const entryEntityTags = entryTags.filter(t => t.startsWith('@'));
  if (entryEntityTags.length === 0) return 0;

  let matchCount = 0;
  for (const queryEntity of queryEntities) {
    // Check for exact match or prefix match
    const queryPrefix = queryEntity.split(':')[0] + ':';
    const queryName = queryEntity.split(':')[1]?.toLowerCase();

    for (const entryTag of entryEntityTags) {
      if (entryTag === queryEntity) {
        matchCount += 1; // Exact match
      } else if (entryTag.startsWith(queryPrefix) && queryName) {
        const entryName = entryTag.split(':')[1]?.toLowerCase();
        if (entryName?.includes(queryName) || queryName.includes(entryName)) {
          matchCount += 0.5; // Partial name match
        }
      }
    }
  }

  return Math.min(1, matchCount / queryEntities.length);
};

/**
 * Calculate mood similarity score
 *
 * @param {number} queryMood - Current mood score (0-1)
 * @param {number} entryMood - Entry's mood score (0-1)
 * @returns {number} Score between 0 and 1
 */
export const calculateMoodSimilarity = (queryMood, entryMood) => {
  if (queryMood === null || queryMood === undefined ||
      entryMood === null || entryMood === undefined) {
    return 0.5; // Neutral if mood unknown
  }

  // 1 - absolute difference gives similarity
  return 1 - Math.abs(queryMood - entryMood);
};

/**
 * Hybrid retrieval - find relevant entries using multiple signals
 *
 * @param {Object} params
 * @param {number[]} params.queryEmbedding - Vector embedding of query/current entry
 * @param {string[]} params.queryEntities - Entities to match
 * @param {number} params.queryMood - Current mood score
 * @param {Object[]} params.entries - All entries to search
 * @param {string} params.category - Category filter
 * @param {Object} params.weights - Custom weights for each signal
 * @param {number} params.topK - Number of results to return
 * @returns {Object[]} Ranked entries with scores
 */
export const hybridRetrieve = ({
  queryEmbedding,
  queryEntities = [],
  queryMood = null,
  entries,
  category = null,
  weights = { vector: 0.4, recency: 0.3, entity: 0.2, mood: 0.1 },
  topK = 10
}) => {
  // Filter by category if specified
  let candidates = category
    ? entries.filter(e => e.category === category)
    : entries;

  // Score each entry
  const scored = candidates.map(entry => {
    // Vector similarity
    const vectorScore = queryEmbedding && entry.embedding
      ? cosineSimilarity(queryEmbedding, entry.embedding)
      : 0;

    // Recency
    const recencyScore = calculateRecencyScore(entry.createdAt || entry.effectiveDate);

    // Entity matching
    const entityScore = calculateEntityMatchScore(queryEntities, entry.tags);

    // Mood similarity
    const moodScore = calculateMoodSimilarity(queryMood, entry.analysis?.mood_score);

    // Combined weighted score
    const totalScore =
      (vectorScore * weights.vector) +
      (recencyScore * weights.recency) +
      (entityScore * weights.entity) +
      (moodScore * weights.mood);

    return {
      ...entry,
      _scores: {
        vector: vectorScore,
        recency: recencyScore,
        entity: entityScore,
        mood: moodScore,
        total: totalScore
      }
    };
  });

  // Sort by total score and return top K
  return scored
    .filter(e => e._scores.total > 0.1) // Minimum threshold
    .sort((a, b) => b._scores.total - a._scores.total)
    .slice(0, topK);
};

/**
 * Find entries mentioning a specific entity
 *
 * @param {Object[]} entries - All entries
 * @param {string} entityTag - Entity to find (e.g., "@activity:yoga")
 * @returns {Object[]} Entries containing the entity, sorted by date
 */
export const findByEntity = (entries, entityTag) => {
  return entries
    .filter(e => e.tags?.includes(entityTag))
    .sort((a, b) => {
      const dateA = a.effectiveDate || a.createdAt;
      const dateB = b.effectiveDate || b.createdAt;
      const timeA = dateA instanceof Date ? dateA : dateA?.toDate?.() || new Date();
      const timeB = dateB instanceof Date ? dateB : dateB?.toDate?.() || new Date();
      return timeB - timeA;
    });
};

/**
 * Get all unique entities from entries
 *
 * @param {Object[]} entries - All entries
 * @param {string} prefix - Optional prefix filter (e.g., "@activity:")
 * @returns {Object[]} Array of { tag, count, lastMentioned, avgMood }
 */
export const getEntityIndex = (entries, prefix = null) => {
  const entityMap = new Map();

  entries.forEach(entry => {
    const tags = entry.tags?.filter(t => t.startsWith('@')) || [];
    const entryDate = entry.effectiveDate || entry.createdAt;
    const date = entryDate instanceof Date ? entryDate : entryDate?.toDate?.() || new Date();
    const mood = entry.analysis?.mood_score;

    tags.forEach(tag => {
      if (prefix && !tag.startsWith(prefix)) return;

      if (!entityMap.has(tag)) {
        entityMap.set(tag, {
          tag,
          count: 0,
          lastMentioned: date,
          moods: []
        });
      }

      const entity = entityMap.get(tag);
      entity.count++;
      if (date > entity.lastMentioned) {
        entity.lastMentioned = date;
      }
      if (mood !== null && mood !== undefined) {
        entity.moods.push(mood);
      }
    });
  });

  // Calculate average mood and return
  return Array.from(entityMap.values()).map(e => ({
    tag: e.tag,
    count: e.count,
    lastMentioned: e.lastMentioned,
    avgMood: e.moods.length > 0
      ? e.moods.reduce((a, b) => a + b, 0) / e.moods.length
      : null
  })).sort((a, b) => b.count - a.count);
};

/**
 * Extract entities from text for query purposes
 * Simple pattern matching for common entity references
 *
 * @param {string} text - Text to extract entities from
 * @returns {string[]} Array of potential entity tags
 */
export const extractQueryEntities = (text) => {
  const entities = [];
  const lowerText = text.toLowerCase();

  // Activity patterns
  const activityPatterns = [
    /(?:went|doing|did|started|finished|completed)\s+(?:some\s+)?(\w+(?:ing)?)/gi,
    /(?:yoga|hiking|running|swimming|cooking|reading|gaming|meditation|workout|exercise)/gi
  ];

  // Media patterns
  const mediaPatterns = [
    /(?:watched|watching|saw|finished|started|reading)\s+(.+?)(?:\s+and|\s*[,.]|$)/gi,
    /(?:show|movie|book|series|podcast)\s+(?:called\s+)?(.+?)(?:\s+and|\s*[,.]|$)/gi
  ];

  // Person patterns (names are harder, look for common relationship words)
  const personPatterns = [
    /(?:with|met|saw|talked to|called)\s+(?:my\s+)?(\w+)/gi
  ];

  // Simple keyword extraction for entities
  const keywords = lowerText.match(/@\w+:\w+/g);
  if (keywords) {
    entities.push(...keywords);
  }

  return [...new Set(entities)];
};

export default {
  hybridRetrieve,
  calculateRecencyScore,
  calculateEntityMatchScore,
  calculateMoodSimilarity,
  findByEntity,
  getEntityIndex,
  extractQueryEntities
};
