/**
 * Basic Insights Orchestrator
 *
 * Main coordination point for the Basic Insights system.
 * Generates simple, statistical correlation-based insights without LLM calls.
 *
 * Features:
 * - Integrates existing health and environment correlations
 * - Adds activity, people, and time correlations
 * - Firestore caching with 12-hour TTL
 * - Fast, cheap, predictable insights
 *
 * Firestore Path: artifacts/{APP_COLLECTION_ID}/users/{userId}/basicInsights/current
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// Existing correlations
import { getTopHealthInsights } from '../health/healthCorrelations';
import { getTopEnvironmentInsights } from '../environment/environmentCorrelations';

// New correlations
import { computeActivityCorrelations } from './correlations/activityCorrelations';
import { computePeopleCorrelations } from './correlations/peopleCorrelations';
import { computeTimeCorrelations } from './correlations/timeCorrelations';
import { computeExtendedHealthCorrelations } from './correlations/healthExtendedCorrelations';
import { computeCategoryCorrelations } from './correlations/categoryCorrelations';
import { computeThemesCorrelations } from './correlations/themesCorrelations';

// Configuration
import { THRESHOLDS, CATEGORIES } from './utils/thresholds';

/**
 * Get Firestore document reference for basic insights
 * @param {string} userId - User ID
 * @returns {DocumentReference} Firestore document reference
 */
const getInsightsRef = (userId) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'basicInsights', 'current');
};

/**
 * Generate all basic insights from entries
 * @param {string} userId - User ID
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Object} Generated insights result
 */
export const generateBasicInsights = async (userId, entries) => {
  console.log('[BasicInsights] Generating insights for', entries?.length || 0, 'entries');

  // Validate minimum entries
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    console.log('[BasicInsights] Insufficient entries:', entries?.length || 0, '/', THRESHOLDS.MIN_ENTRIES);
    return {
      success: false,
      insights: [],
      insufficientData: true,
      entriesAnalyzed: entries?.length || 0,
      entriesNeeded: THRESHOLDS.MIN_ENTRIES,
      message: `Need ${THRESHOLDS.MIN_ENTRIES - (entries?.length || 0)} more entries for insights`
    };
  }

  try {
    // Collect insights from all sources
    const allInsights = [];

    // 1. Existing health correlations (reuse healthCorrelations.js)
    const healthInsights = getTopHealthInsights(entries, THRESHOLDS.MAX_PER_CATEGORY);
    for (const insight of healthInsights) {
      allInsights.push({
        id: `health_${insight.type}`,
        category: CATEGORIES.HEALTH,
        insight: insight.insight,
        moodDelta: Math.round((insight.difference || 0) * 100),
        direction: (insight.difference || 0) > 0 ? 'positive' : 'negative',
        strength: insight.strength,
        sampleSize: insight.sampleSize,
        recommendation: insight.recommendation || null,
        source: 'health'
      });
    }

    // 2. Existing environment correlations (reuse environmentCorrelations.js)
    const envInsights = getTopEnvironmentInsights(entries, THRESHOLDS.MAX_PER_CATEGORY);
    for (const insight of envInsights) {
      allInsights.push({
        id: `env_${insight.type}`,
        category: CATEGORIES.ENVIRONMENT,
        insight: insight.insight,
        moodDelta: Math.round((insight.difference || 0) * 100),
        direction: (insight.difference || 0) > 0 ? 'positive' : 'negative',
        strength: insight.strength,
        sampleSize: insight.sampleSize,
        recommendation: insight.recommendation || null,
        source: 'environment'
      });
    }

    // 3. Activity correlations (new)
    const activityInsights = computeActivityCorrelations(entries);
    allInsights.push(...activityInsights);

    // 4. People correlations (new)
    const peopleInsights = computePeopleCorrelations(entries);
    allInsights.push(...peopleInsights);

    // 5. Time correlations (new)
    const timeInsights = computeTimeCorrelations(entries);
    allInsights.push(...timeInsights);

    // 6. Extended health correlations (strain, deep sleep, REM, calories)
    const extendedHealthInsights = computeExtendedHealthCorrelations(entries);
    allInsights.push(...extendedHealthInsights);

    // 7. Category/type correlations (work vs personal, reflection vs vent)
    const categoryInsights = computeCategoryCorrelations(entries);
    allInsights.push(...categoryInsights);

    // 8. Themes & emotions correlations
    const themesInsights = computeThemesCorrelations(entries);
    allInsights.push(...themesInsights);

    // Sort all insights by strength and absolute mood delta
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    allInsights.sort((a, b) => {
      // First by strength
      const strengthDiff = (strengthOrder[b.strength] || 0) - (strengthOrder[a.strength] || 0);
      if (strengthDiff !== 0) return strengthDiff;
      // Then by absolute mood delta
      return Math.abs(b.moodDelta) - Math.abs(a.moodDelta);
    });

    // Limit to max insights
    const topInsights = allInsights.slice(0, THRESHOLDS.MAX_INSIGHTS);

    // Calculate timestamps
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(
      now.toMillis() + (THRESHOLDS.TTL_HOURS * 60 * 60 * 1000)
    );

    // Build result document
    const result = {
      insights: topInsights,
      generatedAt: now,
      expiresAt,
      entriesAnalyzed: entries.length,
      categoryCounts: {
        health: healthInsights.length,
        environment: envInsights.length,
        activity: activityInsights.length,
        people: peopleInsights.length,
        time: timeInsights.length,
        healthExtended: extendedHealthInsights.length,
        category: categoryInsights.length,
        themes: themesInsights.length
      }
    };

    // Save to Firestore
    await saveBasicInsights(userId, result);

    console.log('[BasicInsights] Generated', topInsights.length, 'insights');

    return {
      success: true,
      ...result
    };

  } catch (error) {
    console.error('[BasicInsights] Generation failed:', error);
    return {
      success: false,
      insights: [],
      error: error.message
    };
  }
};

/**
 * Save basic insights to Firestore
 * @param {string} userId - User ID
 * @param {Object} data - Insights data to save
 */
const saveBasicInsights = async (userId, data) => {
  try {
    const ref = getInsightsRef(userId);
    await setDoc(ref, data, { merge: false });
    console.log('[BasicInsights] Saved to Firestore');
  } catch (error) {
    console.error('[BasicInsights] Failed to save:', error);
    throw error;
  }
};

/**
 * Get cached basic insights from Firestore
 * @param {string} userId - User ID
 * @returns {Object|null} Cached insights or null
 */
export const getCachedBasicInsights = async (userId) => {
  try {
    const ref = getInsightsRef(userId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      console.log('[BasicInsights] No cached insights found');
      return null;
    }

    const data = snapshot.data();

    // Check if expired
    const isExpired = isInsightsExpired(data.expiresAt);

    return {
      ...data,
      stale: isExpired
    };

  } catch (error) {
    console.error('[BasicInsights] Failed to load cached insights:', error);
    return null;
  }
};

/**
 * Check if insights are expired
 * @param {Timestamp} expiresAt - Expiration timestamp
 * @returns {boolean} True if expired
 */
const isInsightsExpired = (expiresAt) => {
  if (!expiresAt) return true;
  const expiry = expiresAt.toMillis ? expiresAt.toMillis() : expiresAt;
  return Date.now() > expiry;
};

/**
 * Check data sufficiency for insights
 * @param {Array} entries - Journal entries
 * @returns {Object} Sufficiency status
 */
export const checkDataSufficiency = (entries) => {
  const withMood = entries?.filter(e => e.analysis?.mood_score != null) || [];

  if (withMood.length < THRESHOLDS.MIN_ENTRIES) {
    return {
      hasEnoughData: false,
      dataPoints: withMood.length,
      needed: THRESHOLDS.MIN_ENTRIES,
      message: `Need ${THRESHOLDS.MIN_ENTRIES - withMood.length} more entries with mood data`
    };
  }

  return {
    hasEnoughData: true,
    dataPoints: withMood.length,
    message: 'Sufficient data for basic insights'
  };
};

export default {
  generateBasicInsights,
  getCachedBasicInsights,
  checkDataSufficiency
};
