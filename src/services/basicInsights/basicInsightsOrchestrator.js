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

import { doc, getDoc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';
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

// Entry-schema adapter (R4 Task 1 + T1b) — six correlation engines below
// (activity/people/healthExtended/category/themes/time) consume ONLY this
// normalized shape; health/environment correlations (src/services/health/,
// src/services/environment/) are a different module tree, out of this
// task's scope, and keep reading raw `entries` directly.
import { normalizeEntriesForInsights } from '../insights/entryAdapter';

// Versioned cutover (R4 Task 6, ratified decision 2) — same shared constant
// nexus/orchestrator.js's saveInsights stamps, so both generators agree on
// "current".
import { generatorVersion } from '../insights/generatorVersion';

// Feedback learning
import { filterInsightsByLearning, filterFalsePositiveCandidates } from './feedbackLearning';

// Insight Receipts (R2 Task 8) — single seam: correlation modules already
// produce `entryIds`; we wrap them into the shared receipt shape here
// rather than touching each correlations/*.js file.
import { buildReceipt, applyReceiptDefaults, sourceFromEntry, computeTimeWindow } from '../insights/receipts';

/**
 * Get Firestore document reference for basic insights
 * @param {string} userId - User ID
 * @returns {DocumentReference} Firestore document reference
 */
const getInsightsRef = (userId) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'basicInsights', 'current');
};

/**
 * Attach a receipt to a single basic insight (R2 Task 8).
 *
 * Correlation insights (activity/people/time/category/themes/extended
 * health) already carry `entryIds` — the exact entries their correlation
 * was computed over — so those get a precise receipt. The pre-existing
 * health/environment insights (from `healthCorrelations`/
 * `environmentCorrelations`) don't expose entry ids, so they (and any
 * insight whose `entryIds` end up empty after lookup) fall back to a
 * window-level receipt over the full `entries` set, via the same
 * `applyReceiptDefaults` Nexus uses — keeping the two insight surfaces'
 * receipt semantics identical.
 *
 * Basic insights are all-spaces today (no Context Space wiring here yet),
 * so `scope` is always null.
 *
 * @param {Object} insight
 * @param {Map<string, Object>} entriesById
 * @param {{start: string, end: string}} timeWindow
 * @param {Array} allEntries - full entries set, for the fallback path
 */
const attachBasicInsightReceipt = (insight, entriesById, timeWindow, allEntries) => {
  const generator = `basic_${insight.category || insight.source || 'unknown'}`;

  if (insight.entryIds && insight.entryIds.length > 0) {
    const sources = insight.entryIds
      .map((id) => entriesById.get(id))
      .filter(Boolean)
      .map(sourceFromEntry)
      .filter(Boolean);

    return {
      ...insight,
      receipt: buildReceipt({
        sources,
        scope: null,
        timeWindow,
        sampleSize: insight.sampleSize ?? insight.entryIds.length,
        generator
      })
    };
  }

  return applyReceiptDefaults(insight, {
    windowEntries: allEntries,
    scope: null,
    timeWindow,
    generator
  });
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

    // Normalize once (R4 Task 1) — every field-location bug fix, tri-state
    // UNKNOWN handling, and day-grounding lives in the adapter; the five
    // engines below never touch raw entry shape again.
    const normalizedEntries = normalizeEntriesForInsights(entries);

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
    const activityInsights = computeActivityCorrelations(normalizedEntries);
    allInsights.push(...activityInsights);
    console.log('[BasicInsights] Activity:', activityInsights.length, 'insights',
      activityInsights.length > 0 ? activityInsights.map(i => i.activityKey || i.id) : '(none)');

    // 4. People correlations (new)
    const peopleInsights = computePeopleCorrelations(normalizedEntries);
    allInsights.push(...peopleInsights);
    console.log('[BasicInsights] People:', peopleInsights.length, 'insights',
      peopleInsights.length > 0 ? peopleInsights.map(i => i.peopleKey || i.id) : '(none)');

    // 5. Time correlations (new) — R4 T1b: now under the adapter too
    const timeInsights = computeTimeCorrelations(normalizedEntries);
    allInsights.push(...timeInsights);
    console.log('[BasicInsights] Time:', timeInsights.length, 'insights',
      timeInsights.length > 0 ? timeInsights.map(i => i.id) : '(none)');

    // 6. Extended health correlations (strain, deep sleep, REM, calories)
    const extendedHealthInsights = computeExtendedHealthCorrelations(normalizedEntries);
    allInsights.push(...extendedHealthInsights);
    console.log('[BasicInsights] Extended Health:', extendedHealthInsights.length, 'insights');

    // 7. Category/type correlations (work vs personal, reflection vs vent)
    const categoryInsights = computeCategoryCorrelations(normalizedEntries);
    allInsights.push(...categoryInsights);
    console.log('[BasicInsights] Category:', categoryInsights.length, 'insights');

    // 8. Themes & emotions correlations
    const themesInsights = computeThemesCorrelations(normalizedEntries);
    allInsights.push(...themesInsights);
    console.log('[BasicInsights] Themes:', themesInsights.length, 'insights');

    console.log('[BasicInsights] Total raw insights:', allInsights.length);

    // entryId -> raw entry lookup, built once and reused by both the
    // false-positive filter below and the receipt-attachment step after it.
    const entriesById = new Map(
      entries.filter((e) => e.id || e.entryId).map((e) => [e.id || e.entryId, e])
    );

    // 8.4. Filter candidates against recorded false-positive evidence (R4
    // Task 5, DR finding 10: "falsePositivePatterns never filter
    // generation"). PRE-scoring — before receipts are attached and before
    // the strength/moodDelta sort below — so a false-positive candidate
    // never occupies one of the MAX_INSIGHTS slots a genuine insight could
    // have filled. Distinct from the post-receipt `filterInsightsByLearning`
    // confidence/suppression pass at step 9: this only drops candidates
    // with affirmative false-positive evidence against them. No learning
    // doc at all -> no filtering -> byte-identical to pre-R4-T5 behavior.
    const falsePositiveFiltered = await filterFalsePositiveCandidates(userId, allInsights, entriesById);
    if (falsePositiveFiltered.length !== allInsights.length) {
      console.log(`[BasicInsights] Filtered ${allInsights.length - falsePositiveFiltered.length} false-positive candidates`);
    }

    // 8.5. Attach receipts (R2 Task 8). Correlation insights already carry
    // `entryIds` (the exact entries their correlation was computed over) —
    // wrap those into a real receipt; anything without entryIds (e.g. the
    // pre-existing health/environment insights) falls back to a
    // window-level receipt over the full `entries` set passed in. Single
    // seam: no correlations/*.js file needs to change.
    const basicInsightsTimeWindow = computeTimeWindow(30);
    const allInsightsWithReceipts = falsePositiveFiltered.map((insight) =>
      attachBasicInsightReceipt(insight, entriesById, basicInsightsTimeWindow, entries)
    );

    // 9. Apply feedback learning filter
    // This adjusts confidence and suppresses insights with poor accuracy
    const insightsWithLearning = await filterInsightsByLearning(userId, allInsightsWithReceipts, entries.length);

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
      generatorVersion, // R4 Task 6 — stamped on every fresh cache doc
      entriesAnalyzed: entries.length,
      entriesCount: entries.length, // Used for staleness check when new entries are added
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
 * @param {number} currentEntriesCount - Current number of entries (optional, for staleness check)
 * @returns {Object|null} Cached insights or null
 */
export const getCachedBasicInsights = async (userId, currentEntriesCount = null) => {
  try {
    const ref = getInsightsRef(userId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      console.log('[BasicInsights] No cached insights found');
      return null;
    }

    const data = snapshot.data();

    // Check if expired by TTL
    const isExpired = isInsightsExpired(data.expiresAt);

    // Check if entries count changed (new entries added = needs refresh)
    const entriesCountChanged = currentEntriesCount !== null &&
                                 data.entriesCount !== undefined &&
                                 currentEntriesCount > data.entriesCount;

    if (entriesCountChanged) {
      console.log('[BasicInsights] Entries count changed:', data.entriesCount, '->', currentEntriesCount, '(marking stale)');
    }

    // Versioned cutover (R4 Task 6, ratified decision 2): a cache doc
    // written by a pre-R4 generation has no `generatorVersion` field at
    // all; one written by an older R4 generation could in principle carry
    // an older version number. Either way it's stale — reuses this same
    // existing stale-computation seam (no separate delete/migration path)
    // so it gets regenerated exactly once, the next time this doc is read.
    // After that regeneration the doc carries the current version, so this
    // check is a no-op again until the next version bump.
    const versionStale = data.generatorVersion == null || data.generatorVersion < generatorVersion;

    return {
      ...data,
      stale: isExpired || entriesCountChanged || versionStale
    };

  } catch (error) {
    console.error('[BasicInsights] Failed to load cached insights:', error);
    return null;
  }
};

/**
 * Invalidate the cached basicInsights doc (R2 final review, Important 2b).
 *
 * This module has no "stale" boolean field to flip (unlike Nexus's
 * `nexus/insights.stale`, `src/services/nexus/staleness.js`'s
 * `markInsightsStale`) — its own staleness contract is entirely
 * existence/TTL/entriesCount-based (`getCachedBasicInsights` above: a
 * missing doc, an expired `expiresAt`, or a grown `entriesCount` are all
 * treated as stale). A hard delete is therefore the mechanism THIS module
 * already expects and handles (`!snapshot.exists()` → `null`, which
 * `useBasicInsights` treats as "no cache, regenerate"), not a new one —
 * mirrors the delete-based invalidation `invalidateDailySummary`/
 * `invalidateWeeklyDigest` (`src/services/dashboard/index.js`) already use
 * for the other two caches `recompute.js`'s `onSourcesChanged` fans out to.
 *
 * @param {string} userId - User ID
 */
export const invalidateBasicInsights = async (userId) => {
  try {
    const ref = getInsightsRef(userId);
    await deleteDoc(ref);
    console.log('[BasicInsights] Cache invalidated');
  } catch (error) {
    // Doc might not exist yet, which is fine — same treatment as
    // invalidateDailySummary/invalidateWeeklyDigest.
    console.log('[BasicInsights] No cache to invalidate');
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
  checkDataSufficiency,
  invalidateBasicInsights
};
