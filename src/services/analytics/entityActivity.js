/**
 * Entity Activity Service
 *
 * Pure computation functions for entity interaction frequency
 * and recency, plus read-only client for Firestore data.
 */
import { computeRecencyWeight } from './topicCoverage.js';

/**
 * Gets entity activity data for a user, sorted by recency score descending.
 * @param {string} userId
 * @returns {Promise<Array|null>} Array of entity objects or null
 */
export async function getEntityActivity(userId) {
  const { analyticsRepository } = await import('../../repositories/analytics.js');
  const data = await analyticsRepository.getAnalyticsDoc(userId, 'entity_activity');
  if (!data || !data.entities) return null;
  return Object.entries(data.entities)
    .map(([entityId, entity]) => ({ entityId, ...entity }))
    .sort((a, b) => (b.recencyScore || 0) - (a.recencyScore || 0));
}

/**
 * Computes entity activity from entry data.
 * @param {Array<{entities?: Array<{id: string, name: string, category: string}>, daysAgo: number}>} entries
 * @returns {Object} Map of entityId → { name, category, mentionCount, lastMentionDaysAgo, recencyScore }
 */
export function computeEntityActivity(entries) {
  const activity = {};

  for (const entry of entries) {
    if (!entry.entities || entry.entities.length === 0) continue;

    for (const entity of entry.entities) {
      if (!entity.id) continue;

      if (!activity[entity.id]) {
        activity[entity.id] = {
          name: entity.name,
          category: entity.category,
          mentionCount: 0,
          lastMentionDaysAgo: Infinity,
          recencyScore: 0,
        };
      }

      activity[entity.id].mentionCount++;
      activity[entity.id].lastMentionDaysAgo = Math.min(
        activity[entity.id].lastMentionDaysAgo,
        entry.daysAgo
      );
    }
  }

  // Compute recency scores based on last mention
  for (const id of Object.keys(activity)) {
    activity[id].recencyScore = computeRecencyWeight(activity[id].lastMentionDaysAgo);
  }

  return activity;
}
