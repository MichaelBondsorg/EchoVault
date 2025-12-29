/**
 * Cached Patterns Service
 *
 * Reads pre-computed patterns from Firestore (computed by Cloud Functions)
 * Falls back to on-demand computation if cache is stale or missing
 * Filters out dismissed/excluded patterns before returning
 */

import { db, doc, getDoc, collection, getDocs } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { computeActivitySentiment, computeTemporalPatterns, computeMoodTriggers } from './index';
import { getActiveExclusions } from '../signals/signalLifecycle';

// Cache staleness threshold (6 hours)
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Get cached patterns for a user
 * Returns null if cache doesn't exist or is too stale
 */
export const getCachedPatterns = async (userId) => {
  try {
    const patternsRef = collection(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'patterns'
    );

    const snapshot = await getDocs(patternsRef);

    if (snapshot.empty) {
      console.log('No cached patterns found');
      return null;
    }

    const patterns = {};
    let oldestUpdate = new Date();

    snapshot.forEach(doc => {
      const data = doc.data();
      patterns[doc.id] = data;

      // Track oldest update
      const updatedAt = data.updatedAt?.toDate?.() || new Date(0);
      if (updatedAt < oldestUpdate) {
        oldestUpdate = updatedAt;
      }
    });

    // Check if cache is too stale
    const cacheAge = Date.now() - oldestUpdate.getTime();
    if (cacheAge > CACHE_MAX_AGE_MS) {
      console.log('Cached patterns are stale, will recompute');
      patterns._stale = true;
    }

    return patterns;
  } catch (error) {
    console.error('Error fetching cached patterns:', error);
    return null;
  }
};

/**
 * Get pattern summary for dashboard display
 * Filters out excluded patterns
 */
export const getPatternSummary = async (userId) => {
  try {
    const summaryRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'patterns',
      'summary'
    );

    const snapshot = await getDoc(summaryRef);

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data();

    // Filter exclusions if data array exists
    if (data.data && Array.isArray(data.data)) {
      try {
        const exclusions = await getActiveExclusions(userId);
        data.data = filterExcludedPatterns(data.data, exclusions);
      } catch (error) {
        console.warn('Could not filter exclusions for pattern summary:', error);
      }
    }

    return data;
  } catch (error) {
    console.error('Error fetching pattern summary:', error);
    return null;
  }
};

/**
 * Get activity sentiment patterns
 * Filters out excluded patterns
 */
export const getActivityPatterns = async (userId) => {
  try {
    const patternRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'patterns',
      'activity_sentiment'
    );

    const snapshot = await getDoc(patternRef);

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data();

    // Filter exclusions if data array exists
    if (data.data && Array.isArray(data.data)) {
      try {
        const exclusions = await getActiveExclusions(userId);
        data.data = filterExcludedPatterns(data.data, exclusions);
      } catch (error) {
        console.warn('Could not filter exclusions for activity patterns:', error);
      }
    }

    return data;
  } catch (error) {
    console.error('Error fetching activity patterns:', error);
    return null;
  }
};

/**
 * Get temporal patterns
 */
export const getTemporalPatterns = async (userId) => {
  try {
    const patternRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'patterns',
      'temporal'
    );

    const snapshot = await getDoc(patternRef);

    if (!snapshot.exists()) {
      return null;
    }

    return snapshot.data();
  } catch (error) {
    console.error('Error fetching temporal patterns:', error);
    return null;
  }
};

/**
 * Get contradictions
 * Filters out excluded contradictions
 */
export const getContradictions = async (userId) => {
  try {
    const patternRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'patterns',
      'contradictions'
    );

    const snapshot = await getDoc(patternRef);

    if (!snapshot.exists()) {
      return null;
    }

    const data = snapshot.data();

    // Filter exclusions if data array exists
    if (data.data && Array.isArray(data.data)) {
      try {
        const exclusions = await getActiveExclusions(userId);
        data.data = filterExcludedPatterns(data.data, exclusions);
      } catch (error) {
        console.warn('Could not filter exclusions for contradictions:', error);
      }
    }

    return data;
  } catch (error) {
    console.error('Error fetching contradictions:', error);
    return null;
  }
};

/**
 * Check if a pattern matches any exclusion
 */
const isPatternMatchedByExclusion = (pattern, exclusions) => {
  for (const exclusion of exclusions) {
    // Check pattern type match
    const patternType = pattern.type ||
      (pattern.sentiment === 'positive' ? 'positive_activity' :
       pattern.sentiment === 'negative' ? 'negative_activity' : null);

    if (exclusion.patternType !== patternType) continue;

    // Check context match
    const exclusionContext = exclusion.context || {};
    const contextKeys = Object.keys(exclusionContext);

    if (contextKeys.length === 0) {
      // Blanket exclusion for this pattern type
      return true;
    }

    // Check each context key
    let allMatch = true;
    for (const key of contextKeys) {
      const patternValue = key === 'entity' ? pattern.entity :
                          key === 'message' ? (pattern.message || pattern.insight || '').slice(0, 100) :
                          pattern[key];

      if (exclusionContext[key] !== patternValue) {
        allMatch = false;
        break;
      }
    }

    if (allMatch) return true;
  }

  return false;
};

/**
 * Filter patterns against active exclusions
 */
const filterExcludedPatterns = (patterns, exclusions) => {
  if (!exclusions || exclusions.length === 0) return patterns;
  return patterns.filter(p => !isPatternMatchedByExclusion(p, exclusions));
};

/**
 * Get all patterns with fallback to on-demand computation
 * Filters out dismissed/excluded patterns before returning
 *
 * @param {string} userId - User ID
 * @param {Object[]} entries - Entries for fallback computation
 * @param {string} category - Category filter
 * @returns {Object} All pattern data (with exclusions filtered out)
 */
export const getAllPatterns = async (userId, entries = [], category = null) => {
  // Load active exclusions for filtering
  let exclusions = [];
  try {
    exclusions = await getActiveExclusions(userId);
  } catch (error) {
    console.warn('Could not load exclusions, showing all patterns:', error);
  }

  // Try to get cached patterns first
  const cached = await getCachedPatterns(userId);

  if (cached && !cached._stale) {
    console.log('Using cached patterns');

    // Filter out excluded patterns
    const activitySentiment = filterExcludedPatterns(
      cached.activity_sentiment?.data || [],
      exclusions
    );
    const contradictions = filterExcludedPatterns(
      cached.contradictions?.data || [],
      exclusions
    );
    const summary = filterExcludedPatterns(
      cached.summary?.data || [],
      exclusions
    );

    return {
      source: 'cache',
      activitySentiment,
      temporal: cached.temporal?.data || {},
      contradictions,
      summary,
      updatedAt: cached.summary?.updatedAt?.toDate?.() || new Date()
    };
  }

  // Fallback to on-demand computation
  if (entries.length >= 5) {
    console.log('Computing patterns on-demand');
    const filteredEntries = category
      ? entries.filter(e => e.category === category)
      : entries;

    let activitySentiment = computeActivitySentiment(filteredEntries, category);
    const temporal = computeTemporalPatterns(filteredEntries, category);
    const triggers = computeMoodTriggers(filteredEntries, category);

    // Filter out excluded patterns
    activitySentiment = filterExcludedPatterns(activitySentiment, exclusions);

    // Generate summary from computed patterns (already filtered)
    const summary = generateLocalSummary(activitySentiment, temporal);

    return {
      source: 'computed',
      activitySentiment,
      temporal,
      triggers,
      contradictions: [], // Contradictions require full analysis, skip for on-demand
      summary,
      updatedAt: new Date()
    };
  }

  // Not enough data
  return {
    source: 'insufficient',
    activitySentiment: [],
    temporal: {},
    contradictions: [],
    summary: [],
    updatedAt: null
  };
};

/**
 * Generate a local summary from computed patterns
 */
function generateLocalSummary(activityPatterns, temporalPatterns) {
  const insights = [];

  // Top positive
  const topPositive = activityPatterns.find(p => p.sentiment === 'positive' && p.insight);
  if (topPositive) {
    insights.push({
      type: 'positive_activity',
      icon: 'trending-up',
      message: topPositive.insight,
      entity: topPositive.entity
    });
  }

  // Top negative
  const topNegative = activityPatterns.find(p => p.sentiment === 'negative' && p.insight);
  if (topNegative) {
    insights.push({
      type: 'negative_activity',
      icon: 'trending-down',
      message: topNegative.insight,
      entity: topNegative.entity
    });
  }

  // Best/worst day
  if (temporalPatterns.insights?.bestDay) {
    insights.push({
      type: 'best_day',
      icon: 'sun',
      message: temporalPatterns.insights.bestDay.insight
    });
  }
  if (temporalPatterns.insights?.worstDay) {
    insights.push({
      type: 'worst_day',
      icon: 'cloud',
      message: temporalPatterns.insights.worstDay.insight
    });
  }

  return insights.slice(0, 5);
}

export default {
  getCachedPatterns,
  getPatternSummary,
  getActivityPatterns,
  getTemporalPatterns,
  getContradictions,
  getAllPatterns
};
