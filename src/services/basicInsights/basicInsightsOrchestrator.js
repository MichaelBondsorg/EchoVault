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

// Feedback learning
import { filterInsightsByLearning } from './feedbackLearning';

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
  console.log('[BasicInsights] ========== GENERATION START ==========');
  console.log('[BasicInsights] Entries:', entries?.length || 0);
  console.log('[BasicInsights] Thresholds:', {
    MIN_ENTRIES: THRESHOLDS.MIN_ENTRIES,
    MIN_DATA_POINTS: THRESHOLDS.MIN_DATA_POINTS,
    MIN_MOOD_DELTA: THRESHOLDS.MIN_MOOD_DELTA,
    MAX_INSIGHTS: THRESHOLDS.MAX_INSIGHTS
  });

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
    console.log('[BasicInsights] Health:', healthInsights.length, 'insights');

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
    console.log('[BasicInsights] Environment:', envInsights.length, 'insights');

    // 3. Activity correlations (new)
    const activityInsights = computeActivityCorrelations(entries);
    allInsights.push(...activityInsights);
    console.log('[BasicInsights] Activity:', activityInsights.length, 'insights',
      activityInsights.length > 0 ? activityInsights.map(i => i.activityKey || i.id) : '(none)');

    // 4. People correlations (new)
    const peopleInsights = computePeopleCorrelations(entries);
    allInsights.push(...peopleInsights);
    console.log('[BasicInsights] People:', peopleInsights.length, 'insights',
      peopleInsights.length > 0 ? peopleInsights.map(i => i.peopleKey || i.id) : '(none)');

    // 5. Time correlations (new)
    const timeInsights = computeTimeCorrelations(entries);
    allInsights.push(...timeInsights);
    console.log('[BasicInsights] Time:', timeInsights.length, 'insights',
      timeInsights.length > 0 ? timeInsights.map(i => i.id) : '(none)');

    // 6. Extended health correlations (strain, deep sleep, REM, calories)
    const extendedHealthInsights = computeExtendedHealthCorrelations(entries);
    allInsights.push(...extendedHealthInsights);
    console.log('[BasicInsights] Extended Health:', extendedHealthInsights.length, 'insights');

    // 7. Category/type correlations (work vs personal, reflection vs vent)
    const categoryInsights = computeCategoryCorrelations(entries);
    allInsights.push(...categoryInsights);
    console.log('[BasicInsights] Category:', categoryInsights.length, 'insights');

    // 8. Themes & emotions correlations
    const themesInsights = computeThemesCorrelations(entries);
    allInsights.push(...themesInsights);
    console.log('[BasicInsights] Themes:', themesInsights.length, 'insights');

    console.log('[BasicInsights] Total raw insights:', allInsights.length);

    // 9. Apply feedback learning filter
    // This adjusts confidence and suppresses insights with poor accuracy
    const insightsWithLearning = await filterInsightsByLearning(userId, allInsights, entries.length);

    // Separate shown vs suppressed insights
    const shownInsights = insightsWithLearning.filter(i => i._showDecision?.show !== false);
    const suppressedInsights = insightsWithLearning.filter(i => i._showDecision?.show === false);

    if (suppressedInsights.length > 0) {
      console.log(`[BasicInsights] Suppressed ${suppressedInsights.length} insights due to feedback learning`);
    }

    // Adjust strength based on confidence multiplier
    for (const insight of shownInsights) {
      if (insight._showDecision?.adjustedConfidence < 1.0) {
        // If confidence is reduced, potentially downgrade strength
        const multiplier = insight._showDecision.adjustedConfidence;
        if (multiplier < 0.5 && insight.strength === 'strong') {
          insight.strength = 'moderate';
        } else if (multiplier < 0.7 && insight.strength === 'strong') {
          insight.adjustedStrength = 'moderate'; // Keep original but mark adjusted
        }
        // Attach confidence for UI display
        insight.learningConfidence = multiplier;
        insight.learningReason = insight._showDecision.reason;
      }
      // Clean up internal field
      delete insight._showDecision;
    }

    // Sort shown insights by strength and absolute mood delta
    const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
    shownInsights.sort((a, b) => {
      // First by strength
      const strengthDiff = (strengthOrder[b.strength] || 0) - (strengthOrder[a.strength] || 0);
      if (strengthDiff !== 0) return strengthDiff;
      // Then by absolute mood delta
      return Math.abs(b.moodDelta) - Math.abs(a.moodDelta);
    });

    // Limit to max insights
    const topInsights = shownInsights.slice(0, THRESHOLDS.MAX_INSIGHTS);

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
      },
      // Feedback learning stats
      learningStats: {
        totalGenerated: allInsights.length,
        suppressed: suppressedInsights.length,
        shown: shownInsights.length,
        suppressedPatterns: suppressedInsights.map(i => i.id)
      }
    };

    // Save to Firestore
    await saveBasicInsights(userId, result);

    console.log('[BasicInsights] ========== GENERATION COMPLETE ==========');
    console.log('[BasicInsights] Final insights:', topInsights.length);
    console.log('[BasicInsights] Insights:', topInsights.map(i => ({
      id: i.id,
      delta: i.moodDelta,
      strength: i.strength
    })));

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
