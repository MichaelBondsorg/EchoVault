/**
 * Health Trends Service
 *
 * Read-only client for pre-computed health data aggregations from Firestore.
 */
import { analyticsRepository } from '../../repositories/analytics.js';

/**
 * Gets health trend data for a user and period.
 * @param {string} userId
 * @param {string} period - Period key like "weekly-2026-02-17"
 * @returns {Promise<Object|null>} Health trends or null if not available
 */
export async function getHealthTrends(userId, period) {
  const data = await analyticsRepository.getAnalyticsDoc(userId, 'health_trends');
  if (!data || !data.periods || !data.periods[period]) return null;
  return data.periods[period];
}
