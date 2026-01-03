/**
 * Insight Rotation Service
 *
 * Ensures users see different insights on each visit by:
 * - Tracking recently shown insights
 * - Rotating through available pool
 * - Weighting by significance and freshness
 *
 * Solves the "stale insights" problem where users always see the same top insight.
 */

// Number of recently shown insights to track (avoid repeats)
const RECENT_SHOWN_LIMIT = 5;

// How long before an insight can be reshown (in hours)
const INSIGHT_COOLDOWN_HOURS = 24;

// Storage key prefix
const STORAGE_KEY_PREFIX = 'insightRotation';

/**
 * Get rotation state from localStorage
 *
 * @param {string} userId - User ID
 * @param {string} category - Category (personal/work)
 * @returns {Object} Rotation state
 */
export const getRotationState = (userId, category = 'personal') => {
  const key = `${STORAGE_KEY_PREFIX}_${userId}_${category}`;

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return {
        recentlyShown: [],
        lastViewedAt: null,
        viewCount: 0
      };
    }
    return JSON.parse(stored);
  } catch (error) {
    console.warn('Failed to load rotation state:', error);
    return { recentlyShown: [], lastViewedAt: null, viewCount: 0 };
  }
};

/**
 * Save rotation state to localStorage
 *
 * @param {string} userId - User ID
 * @param {string} category - Category
 * @param {Object} state - State to save
 */
export const saveRotationState = (userId, category, state) => {
  const key = `${STORAGE_KEY_PREFIX}_${userId}_${category}`;

  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save rotation state:', error);
  }
};

/**
 * Generate a unique key for an insight (for tracking)
 *
 * @param {Object} insight - Insight object
 * @returns {string} Unique key
 */
export const getInsightKey = (insight) => {
  const type = insight.type || 'unknown';
  const entity = insight.entity || '';
  const message = (insight.message || insight.insight || '').slice(0, 50);
  return `${type}:${entity}:${message}`;
};

/**
 * Calculate insight score for ranking
 * Higher score = more likely to show
 *
 * @param {Object} insight - Insight object
 * @param {Object} rotationState - Current rotation state
 * @returns {number} Score
 */
const calculateInsightScore = (insight, rotationState) => {
  let score = 100; // Base score

  const key = getInsightKey(insight);
  const now = Date.now();

  // Check if recently shown
  const recentEntry = rotationState.recentlyShown.find(r => r.key === key);

  if (recentEntry) {
    const hoursSinceShown = (now - recentEntry.shownAt) / (1000 * 60 * 60);

    if (hoursSinceShown < INSIGHT_COOLDOWN_HOURS) {
      // Still in cooldown - heavily penalize
      score -= 80;
    } else {
      // Out of cooldown but was shown before - small penalty
      score -= 20;
    }
  }

  // Boost for significance
  if (insight.moodDeltaPercent) {
    score += Math.min(Math.abs(insight.moodDeltaPercent), 30);
  }

  // Boost for higher entry count (more data = more reliable)
  if (insight.entryCount) {
    score += Math.min(insight.entryCount * 2, 20);
  }

  // Boost for recency of pattern
  if (insight.lastMentioned) {
    const daysSinceLastMention = (now - new Date(insight.lastMentioned).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastMention < 7) {
      score += 15; // Recent patterns are more relevant
    }
  }

  // Boost for specific insight types that tend to be more valuable
  const highValueTypes = ['pattern_contradiction', 'absence_warning', 'compound_trigger', 'shadow_friction'];
  if (highValueTypes.includes(insight.type)) {
    score += 25;
  }

  // Slight randomization to prevent deterministic ordering
  score += Math.random() * 10;

  return score;
};

/**
 * Get the next insight to show from a pool
 * Considers rotation state to avoid showing same insights
 *
 * @param {string} userId - User ID
 * @param {string} category - Category
 * @param {Object[]} allInsights - All available insights
 * @returns {Object|null} Selected insight or null if none available
 */
export const getNextInsight = (userId, category, allInsights) => {
  if (!allInsights || allInsights.length === 0) {
    return null;
  }

  const rotationState = getRotationState(userId, category);

  // Score all insights
  const scored = allInsights.map(insight => ({
    insight,
    score: calculateInsightScore(insight, rotationState)
  }));

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Return top scored insight
  return scored[0]?.insight || null;
};

/**
 * Get multiple insights for display (e.g., in InsightsPanel)
 * Shuffles order based on rotation state
 *
 * @param {string} userId - User ID
 * @param {string} category - Category
 * @param {Object[]} allInsights - All available insights
 * @param {number} limit - Maximum number to return
 * @returns {Object[]} Ordered insights
 */
export const getRotatedInsights = (userId, category, allInsights, limit = 10) => {
  if (!allInsights || allInsights.length === 0) {
    return [];
  }

  const rotationState = getRotationState(userId, category);

  // Score all insights
  const scored = allInsights.map(insight => ({
    insight,
    score: calculateInsightScore(insight, rotationState)
  }));

  // Sort by score (highest first)
  scored.sort((a, b) => b.score - a.score);

  // Return top N insights
  return scored.slice(0, limit).map(s => s.insight);
};

/**
 * Mark an insight as shown (updates rotation state)
 *
 * @param {string} userId - User ID
 * @param {string} category - Category
 * @param {Object} insight - The insight that was shown
 */
export const markInsightShown = (userId, category, insight) => {
  const rotationState = getRotationState(userId, category);
  const key = getInsightKey(insight);
  const now = Date.now();

  // Remove any existing entry for this insight
  rotationState.recentlyShown = rotationState.recentlyShown.filter(r => r.key !== key);

  // Add to front of recently shown list
  rotationState.recentlyShown.unshift({
    key,
    shownAt: now
  });

  // Trim to limit
  rotationState.recentlyShown = rotationState.recentlyShown.slice(0, RECENT_SHOWN_LIMIT);

  // Update view tracking
  rotationState.lastViewedAt = now;
  rotationState.viewCount = (rotationState.viewCount || 0) + 1;

  // Save
  saveRotationState(userId, category, rotationState);
};

/**
 * Clear rotation state (e.g., for testing or user reset)
 *
 * @param {string} userId - User ID
 * @param {string} category - Category (optional, clears all if not provided)
 */
export const clearRotationState = (userId, category = null) => {
  if (category) {
    const key = `${STORAGE_KEY_PREFIX}_${userId}_${category}`;
    localStorage.removeItem(key);
  } else {
    // Clear all categories
    ['personal', 'work'].forEach(cat => {
      const key = `${STORAGE_KEY_PREFIX}_${userId}_${cat}`;
      localStorage.removeItem(key);
    });
  }
};

/**
 * Check if rotation state exists and is recent
 * Useful for determining if user has seen insights before
 *
 * @param {string} userId - User ID
 * @param {string} category - Category
 * @returns {boolean} True if user has rotation history
 */
export const hasRotationHistory = (userId, category) => {
  const state = getRotationState(userId, category);
  return state.recentlyShown.length > 0;
};

export default {
  getRotationState,
  saveRotationState,
  getInsightKey,
  getNextInsight,
  getRotatedInsights,
  markInsightShown,
  clearRotationState,
  hasRotationHistory
};
