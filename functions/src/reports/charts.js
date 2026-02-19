/**
 * Chart Data Preparation
 *
 * Transforms raw analytics data into structured chart data objects
 * suitable for client-side SVG rendering.
 */

/**
 * Prepare mood trend sparkline data.
 * For large periods, downsamples to weekly averages.
 * @param {Array<{date: string, moodScore: number}>} moodEntries
 * @param {'weekly'|'monthly'|'quarterly'|'annual'} cadence
 * @returns {Array<{date: string, value: number}>}
 */
export function prepareMoodTrend(moodEntries, cadence) {
  if (!moodEntries || moodEntries.length === 0) return [];

  // For weekly/monthly, return daily points as-is
  if (cadence === 'weekly' || cadence === 'monthly') {
    return moodEntries.map(e => ({ date: e.date, value: e.moodScore }));
  }

  // For quarterly/annual, aggregate to weekly averages
  const weekBuckets = {};
  for (const entry of moodEntries) {
    const d = new Date(entry.date);
    // ISO week start (Monday)
    const dayOfWeek = d.getDay() || 7;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - dayOfWeek + 1);
    const key = weekStart.toISOString().slice(0, 10);
    if (!weekBuckets[key]) weekBuckets[key] = [];
    weekBuckets[key].push(entry.moodScore);
  }

  return Object.entries(weekBuckets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, scores]) => ({
      date,
      value: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10,
    }));
}

/**
 * Prepare category breakdown data.
 * @param {object} categoryStats - {personal: number, work: number, ...}
 * @returns {Array<{label: string, value: number, percentage: number}>}
 */
export function prepareCategoryBreakdown(categoryStats) {
  if (!categoryStats || typeof categoryStats !== 'object') return [];

  const entries = Object.entries(categoryStats).filter(([, v]) => v > 0);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return [];

  return entries
    .sort(([, a], [, b]) => b - a)
    .map(([label, value]) => ({
      label,
      value,
      percentage: Math.round((value / total) * 100),
    }));
}

/**
 * Prepare entry frequency data (entries per day or per week).
 * @param {Array<{date: string}>} entries
 * @param {'weekly'|'monthly'|'quarterly'|'annual'} cadence
 * @returns {Array<{date: string, count: number}>}
 */
export function prepareEntryFrequency(entries, cadence) {
  if (!entries || entries.length === 0) return [];

  if (cadence === 'weekly' || cadence === 'monthly') {
    // Group by day
    const dayCounts = {};
    for (const entry of entries) {
      const day = entry.date.slice(0, 10);
      dayCounts[day] = (dayCounts[day] || 0) + 1;
    }
    return Object.entries(dayCounts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }

  // For quarterly/annual, group by week
  const weekCounts = {};
  for (const entry of entries) {
    const d = new Date(entry.date);
    const dayOfWeek = d.getDay() || 7;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - dayOfWeek + 1);
    const key = weekStart.toISOString().slice(0, 10);
    weekCounts[key] = (weekCounts[key] || 0) + 1;
  }
  return Object.entries(weekCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}
