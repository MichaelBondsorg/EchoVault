/**
 * Cached Patterns Service
 *
 * Reads pre-computed patterns from Firestore (computed by Cloud Functions)
 * Falls back to on-demand computation if cache is stale or missing
 */

import { db, doc, getDoc, collection, getDocs } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { computeActivitySentiment, computeTemporalPatterns, computeMoodTriggers } from './index';

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

    return snapshot.data();
  } catch (error) {
    console.error('Error fetching pattern summary:', error);
    return null;
  }
};

/**
 * Get activity sentiment patterns
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

    return snapshot.data();
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

    return snapshot.data();
  } catch (error) {
    console.error('Error fetching contradictions:', error);
    return null;
  }
};

/**
 * Get all patterns with fallback to on-demand computation
 *
 * @param {string} userId - User ID
 * @param {Object[]} entries - Entries for fallback computation
 * @param {string} category - Category filter
 * @returns {Object} All pattern data
 */
export const getAllPatterns = async (userId, entries = [], category = null) => {
  // Try to get cached patterns first
  const cached = await getCachedPatterns(userId);

  if (cached && !cached._stale) {
    console.log('Using cached patterns');
    return {
      source: 'cache',
      activitySentiment: cached.activity_sentiment?.data || [],
      temporal: cached.temporal?.data || {},
      contradictions: cached.contradictions?.data || [],
      summary: cached.summary?.data || [],
      updatedAt: cached.summary?.updatedAt?.toDate?.() || new Date()
    };
  }

  // Fallback to on-demand computation
  if (entries.length >= 5) {
    console.log('Computing patterns on-demand');
    const filteredEntries = category
      ? entries.filter(e => e.category === category)
      : entries;

    const activitySentiment = computeActivitySentiment(filteredEntries, category);
    const temporal = computeTemporalPatterns(filteredEntries, category);
    const triggers = computeMoodTriggers(filteredEntries, category);

    // Generate summary from computed patterns
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
