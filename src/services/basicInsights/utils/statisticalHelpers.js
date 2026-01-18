/**
 * Statistical Helpers for Basic Insights
 *
 * Shared statistical functions extracted from healthCorrelations.js
 * and environmentCorrelations.js for use across all correlation modules.
 */

/**
 * Calculate average of array
 * @param {number[]} arr - Array of numbers
 * @returns {number} Average value or 0 if empty
 */
export const average = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

/**
 * Calculate median of array
 * @param {number[]} arr - Array of numbers
 * @returns {number} Median value or 0 if empty
 */
export const median = (arr) => {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Calculate standard deviation
 * @param {number[]} arr - Array of numbers
 * @returns {number} Standard deviation or 0 if insufficient data
 */
export const stdDev = (arr) => {
  if (!arr || arr.length < 2) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(average(squareDiffs));
};

/**
 * Calculate Pearson correlation coefficient
 * @param {number[]} x - First array of values
 * @param {number[]} y - Second array of values
 * @returns {number} Correlation coefficient (-1 to 1) or 0 if insufficient data
 */
export const pearsonCorrelation = (x, y) => {
  if (x.length !== y.length || x.length < 3) return 0;

  const n = x.length;
  const avgX = average(x);
  const avgY = average(y);

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - avgX;
    const diffY = y[i] - avgY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }

  if (denomX === 0 || denomY === 0) return 0;
  return numerator / Math.sqrt(denomX * denomY);
};

/**
 * Calculate mood delta as a percentage
 * @param {number} groupMood - Average mood for the group being analyzed
 * @param {number} baselineMood - Baseline mood to compare against
 * @returns {number} Percentage difference (positive = better, negative = worse)
 */
export const calculateMoodDelta = (groupMood, baselineMood) => {
  if (baselineMood === 0) return 0;
  // Mood is 0-1 scale, so multiply by 100 for percentage
  return Math.round((groupMood - baselineMood) * 100);
};

/**
 * Determine insight strength based on mood delta and sample size
 * @param {number} moodDelta - Absolute percentage difference
 * @param {number} sampleSize - Number of data points
 * @returns {'strong'|'moderate'|'weak'} Strength classification
 */
export const determineStrength = (moodDelta, sampleSize) => {
  const absDelta = Math.abs(moodDelta);

  // Strong: >20% difference with decent sample, or >15% with large sample
  if ((absDelta >= 20 && sampleSize >= 5) || (absDelta >= 15 && sampleSize >= 10)) {
    return 'strong';
  }

  // Moderate: 10-20% difference, or 8%+ with large sample
  if ((absDelta >= 10 && sampleSize >= 5) || (absDelta >= 8 && sampleSize >= 10)) {
    return 'moderate';
  }

  return 'weak';
};

/**
 * Generate a unique insight ID
 * @param {string} category - Insight category (activity, people, time, etc.)
 * @param {string} factor - Specific factor being analyzed
 * @returns {string} Unique ID for deduplication
 */
export const generateInsightId = (category, factor) => {
  const normalizedFactor = factor.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return `${category}_${normalizedFactor}_mood`;
};

export default {
  average,
  median,
  stdDev,
  pearsonCorrelation,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
};
