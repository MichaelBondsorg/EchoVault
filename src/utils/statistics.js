/**
 * Statistics Utilities
 *
 * Shared statistical functions used across correlation services.
 * Extracted from healthCorrelations.js and environmentCorrelations.js
 * to eliminate code duplication.
 */

/**
 * Calculate average of an array of numbers
 * @param {number[]} arr - Array of numbers
 * @returns {number} Average value, or 0 if array is empty/null
 */
export const average = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

/**
 * Calculate median of an array of numbers
 * @param {number[]} arr - Array of numbers
 * @returns {number} Median value, or 0 if array is empty/null
 */
export const median = (arr) => {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Calculate standard deviation of an array of numbers
 * @param {number[]} arr - Array of numbers
 * @returns {number} Standard deviation, or 0 if array has fewer than 2 elements
 */
export const stdDev = (arr) => {
  if (!arr || arr.length < 2) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(average(squareDiffs));
};

/**
 * Calculate Pearson correlation coefficient between two arrays
 * @param {number[]} x - First array of numbers
 * @param {number[]} y - Second array of numbers
 * @returns {number} Correlation coefficient (-1 to 1), or 0 if insufficient data
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

export default {
  average,
  median,
  stdDev,
  pearsonCorrelation
};
