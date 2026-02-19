/**
 * Entry Statistics Service
 *
 * Pure computation functions for entry statistics and read-only
 * client for pre-computed stats from Firestore.
 */
/**
 * Gets pre-computed entry stats for a user and period.
 * @param {string} userId
 * @param {string} period - Period key like "weekly-2026-02-17"
 * @returns {Promise<Object|null>} Entry stats or null
 */
export async function getEntryStats(userId, period) {
  const { analyticsRepository } = await import('../../repositories/analytics.js');
  const data = await analyticsRepository.getAnalyticsDoc(userId, 'entry_stats');
  if (!data || !data.periods || !data.periods[period]) return null;
  const stats = data.periods[period];
  // Compute mean at read time since it can't be stored atomically
  return {
    ...stats,
    moodMean: stats.moodCount > 0 ? stats.moodSum / stats.moodCount : 0,
  };
}

/**
 * Computes entry statistics from a list of entries.
 * @param {Array<{moodScore?: number, category?: string, entryType?: string}>} entries
 * @returns {Object} Stats object with counts, mood, breakdown
 */
export function computeEntryStats(entries) {
  if (!entries || entries.length === 0) {
    return {
      entryCount: 0,
      moodMean: 0,
      moodMin: 0,
      moodMax: 0,
      moodSum: 0,
      moodCount: 0,
      categoryBreakdown: { personal: 0, work: 0 },
      entryTypeDistribution: { task: 0, mixed: 0, reflection: 0, vent: 0 },
    };
  }

  let moodSum = 0;
  let moodMin = Infinity;
  let moodMax = -Infinity;
  let moodCount = 0;
  const categoryBreakdown = { personal: 0, work: 0 };
  const entryTypeDistribution = { task: 0, mixed: 0, reflection: 0, vent: 0 };

  for (const entry of entries) {
    if (entry.moodScore != null && !isNaN(entry.moodScore)) {
      moodSum += entry.moodScore;
      moodMin = Math.min(moodMin, entry.moodScore);
      moodMax = Math.max(moodMax, entry.moodScore);
      moodCount++;
    }

    const cat = entry.category || 'personal';
    if (categoryBreakdown[cat] !== undefined) {
      categoryBreakdown[cat]++;
    }

    const type = entry.entryType || 'mixed';
    if (entryTypeDistribution[type] !== undefined) {
      entryTypeDistribution[type]++;
    }
  }

  return {
    entryCount: entries.length,
    moodMean: moodCount > 0 ? moodSum / moodCount : 0,
    moodMin: moodCount > 0 ? moodMin : 0,
    moodMax: moodCount > 0 ? moodMax : 0,
    moodSum,
    moodCount,
    categoryBreakdown,
    entryTypeDistribution,
  };
}
