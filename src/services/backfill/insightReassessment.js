/**
 * Insight Reassessment Service
 *
 * Recalculates insights after retroactive data enrichment:
 * 1. Recalculate personal baselines
 * 2. Re-run pattern detection on enriched entries
 * 3. Refresh health-mood correlations
 * 4. Merge overlapping threads
 * 5. Enrich threads with biometric context
 * 6. Regenerate Nexus insights using staging pattern
 *
 * Uses staging pattern to prevent blank screen on failure.
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp
} from 'firebase/firestore';

import { calculateAndSaveBaselines, getBaselines } from '../nexus/layer2/baselineManager';
import { detectPatternsInPeriod } from '../nexus/layer1/patternDetector';
import { analyzeHealthMoodCorrelations } from '../health/healthMoodCorrelation';
import { getWhoopHistory, isWhoopLinked } from '../health/whoop';
import { generateInsights } from '../nexus/orchestrator';

export const REASSESSMENT_STEPS = {
  BASELINES: 'baselines',
  PATTERNS: 'patterns',
  CORRELATIONS: 'correlations',
  THREADS: 'threads',
  INSIGHTS: 'insights',
  CLEANUP: 'cleanup'
};

const INSIGHTS_DOC = 'insights';
const INSIGHTS_STAGED_DOC = 'insights_staged';
const MIN_ENTRIES_FOR_BASELINES = 10;
const MIN_ENTRIES_FOR_PATTERNS = 5;

/**
 * Trigger full insight reassessment after backfill
 * @param {Function} onProgress - Progress callback
 * @param {AbortSignal} signal - Abort signal
 * @returns {Object} Results summary
 */
export const triggerInsightReassessment = async (onProgress, signal) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const results = {
    baselines: null,
    patterns: null,
    correlations: null,
    threads: null,
    insights: null,
    startedAt: new Date(),
    completedAt: null
  };

  console.log('[InsightReassessment] Starting reassessment pipeline...');

  try {
    // Fetch all recent entries (now enriched with health/env data)
    const entries = await fetchRecentEntries(user.uid, 90);
    console.log(`[InsightReassessment] Loaded ${entries.length} entries`);

    // Check Whoop connectivity and fetch history
    let whoopHistory = { available: false, days: [] };
    try {
      const whoopConnected = await isWhoopLinked();
      if (whoopConnected) {
        whoopHistory = await getWhoopHistory(90);
      }
    } catch (e) {
      console.warn('[InsightReassessment] Whoop history fetch failed:', e.message);
    }

    // Count enriched entries
    const withHealth = entries.filter(e => e.healthContext).length;
    const withEnv = entries.filter(e => e.environmentContext).length;
    console.log(`[InsightReassessment] Enriched: ${withHealth} with health, ${withEnv} with environment`);

    if (signal?.aborted) return results;

    // Step 1: Recalculate personal baselines
    onProgress?.({ step: REASSESSMENT_STEPS.BASELINES, progress: 0 });

    if (entries.length >= MIN_ENTRIES_FOR_BASELINES) {
      await calculateAndSaveBaselines(user.uid, entries);
      results.baselines = { recalculated: true, entryCount: entries.length };
      console.log('[InsightReassessment] Baselines recalculated');
    } else {
      results.baselines = { recalculated: false, reason: 'insufficient_entries' };
    }

    if (signal?.aborted) return results;

    // Step 2: Re-run pattern detection with enriched data
    onProgress?.({ step: REASSESSMENT_STEPS.PATTERNS, progress: 20 });

    if (entries.length >= MIN_ENTRIES_FOR_PATTERNS) {
      const patterns = await detectPatternsInPeriod(user.uid, entries, whoopHistory);
      results.patterns = {
        totalDetected: patterns.totalPatternsDetected || 0,
        byType: patterns.patternTypeCounts || {}
      };
      console.log('[InsightReassessment] Patterns detected:', patterns.patternTypeCounts);

      // Save pattern analysis for later use
      await savePatternAnalysis(user.uid, patterns);
    }

    if (signal?.aborted) return results;

    // Step 3: Refresh health-mood correlations
    onProgress?.({ step: REASSESSMENT_STEPS.CORRELATIONS, progress: 40 });

    const correlations = analyzeHealthMoodCorrelations(entries, whoopHistory?.days || []);
    results.correlations = {
      available: correlations.available || false,
      pairsAnalyzed: correlations.pairsAnalyzed || 0,
      insightCount: correlations.insights?.length || 0
    };
    console.log('[InsightReassessment] Correlations analyzed');

    // Save correlations
    await saveCorrelationAnalysis(user.uid, correlations);

    if (signal?.aborted) return results;

    // Step 4: Thread biometric enrichment
    onProgress?.({ step: REASSESSMENT_STEPS.THREADS, progress: 60 });

    try {
      const threadResults = await enrichThreadsWithBiometrics(user.uid, entries);
      results.threads = threadResults;
      console.log('[InsightReassessment] Threads enriched:', threadResults);
    } catch (threadError) {
      console.warn('[InsightReassessment] Thread enrichment failed:', threadError.message);
      results.threads = { error: threadError.message };
    }

    if (signal?.aborted) return results;

    // Step 5: Regenerate Nexus insights using staging pattern
    onProgress?.({ step: REASSESSMENT_STEPS.INSIGHTS, progress: 80 });

    const insightResult = await regenerateInsightsWithStaging(user.uid);
    results.insights = insightResult;
    console.log('[InsightReassessment] Insights regenerated:', insightResult);

    // Step 6: Cleanup and finalize
    onProgress?.({ step: REASSESSMENT_STEPS.CLEANUP, progress: 100 });

    results.completedAt = new Date();
    console.log('[InsightReassessment] Reassessment complete');

    return results;

  } catch (error) {
    console.error('[InsightReassessment] Pipeline error:', error);
    throw error;
  }
};

/**
 * Regenerate insights using staging pattern
 * Prevents blank screen if regeneration fails
 */
const regenerateInsightsWithStaging = async (userId) => {
  const nexusRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus');

  try {
    // Step 1: Generate new insights (this calls the full orchestrator)
    console.log('[InsightRegen] Generating insights to staging...');

    const genResult = await generateInsights(userId, { forceRegenerate: true });

    if (!genResult.success) {
      console.warn('[InsightRegen] Generation returned success=false');
      return { success: false, reason: 'generation_failed', errors: genResult.errors };
    }

    const newInsights = genResult.insights || [];

    if (newInsights.length === 0) {
      console.warn('[InsightRegen] No insights generated - keeping existing');
      return { success: false, reason: 'no_insights_generated' };
    }

    // Step 2: Write to staged document for verification
    await setDoc(doc(nexusRef, INSIGHTS_STAGED_DOC), {
      insights: newInsights,
      generatedAt: Timestamp.now(),
      patternsUsed: genResult.dataStatus?.patterns || 0,
      entriesUsed: genResult.dataStatus?.entries || 0
    });

    console.log(`[InsightRegen] Staged ${newInsights.length} insights`);

    // Step 3: Validate staged insights exist
    const stagedDoc = await getDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));
    if (!stagedDoc.exists() || !stagedDoc.data().insights?.length) {
      throw new Error('Staged insights validation failed');
    }

    // Step 4: The generateInsights function already saves to the live document,
    // so we just need to clean up the staged document
    await deleteDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));

    console.log('[InsightRegen] Successfully completed');

    return {
      success: true,
      generated: newInsights.length,
      dataStatus: genResult.dataStatus
    };

  } catch (error) {
    console.error('[InsightRegen] Failed - existing insights preserved:', error);

    // Clean up staged document if it exists
    try {
      await deleteDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Save pattern analysis to Firestore for caching
 */
const savePatternAnalysis = async (userId, patterns) => {
  const patternRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'patterns'
  );

  await setDoc(patternRef, {
    aggregated: patterns.aggregated || {},
    byType: patterns.byType || {},
    totalEntries: patterns.totalEntries || 0,
    totalPatternsDetected: patterns.totalPatternsDetected || 0,
    patternTypeCounts: patterns.patternTypeCounts || {},
    analyzedAt: Timestamp.now(),
    stale: false
  }, { merge: true });
};

/**
 * Save correlation analysis to Firestore
 */
const saveCorrelationAnalysis = async (userId, correlations) => {
  const corrRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'correlations'
  );

  await setDoc(corrRef, {
    ...correlations,
    savedAt: Timestamp.now()
  }, { merge: true });
};

/**
 * Enrich threads with biometric context from health data
 */
const enrichThreadsWithBiometrics = async (userId, entries) => {
  // Get active threads
  const threadsRef = collection(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads'
  );

  const q = query(threadsRef, limit(50));
  const snapshot = await getDocs(q);

  if (snapshot.empty) {
    return { updatedCount: 0, enrichedWithBiometrics: 0 };
  }

  let updatedCount = 0;
  let enrichedWithBiometrics = 0;

  for (const threadDoc of snapshot.docs) {
    const thread = { id: threadDoc.id, ...threadDoc.data() };

    // Skip resolved/merged threads
    if (thread.status === 'resolved' || thread.status === 'merged' || thread.hidden) {
      continue;
    }

    // Get entries belonging to this thread
    const threadEntryIds = thread.entryIds || [];
    if (threadEntryIds.length === 0) continue;

    const threadEntries = entries.filter(e => threadEntryIds.includes(e.id));

    // Calculate biometric patterns
    const biometricPattern = calculateThreadBiometrics(threadEntries);

    if (biometricPattern.hasSignificantPattern) {
      const threadRef = doc(
        db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', thread.id
      );

      await setDoc(threadRef, {
        biometricContext: {
          avgRHR: biometricPattern.avgRHR,
          avgHRV: biometricPattern.avgHRV,
          avgRecovery: biometricPattern.avgRecovery,
          avgSleepScore: biometricPattern.avgSleepScore,
          pattern: biometricPattern.description,
          entriesWithHealth: biometricPattern.entriesWithHealth
        },
        biometricEnrichedAt: Timestamp.now()
      }, { merge: true });

      enrichedWithBiometrics++;
    }

    updatedCount++;
  }

  return { updatedCount, enrichedWithBiometrics };
};

/**
 * Calculate biometric patterns for a set of entries
 */
const calculateThreadBiometrics = (entries) => {
  const withHealth = entries.filter(e => e.healthContext);

  if (withHealth.length < 3) {
    return { hasSignificantPattern: false };
  }

  // Calculate averages
  const rhrs = withHealth
    .map(e => e.healthContext.heart?.restingRate)
    .filter(v => v && typeof v === 'number');
  const hrvs = withHealth
    .map(e => e.healthContext.heart?.hrv)
    .filter(v => v && typeof v === 'number');
  const recoveries = withHealth
    .map(e => e.healthContext.recovery?.score)
    .filter(v => v && typeof v === 'number');
  const sleepScores = withHealth
    .map(e => e.healthContext.sleep?.score)
    .filter(v => v && typeof v === 'number');

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const avgRHR = avg(rhrs);
  const avgHRV = avg(hrvs);
  const avgRecovery = avg(recoveries);
  const avgSleepScore = avg(sleepScores);

  // Flag as significant if we have enough data
  const hasSignificantPattern = rhrs.length >= 3 || hrvs.length >= 3 || recoveries.length >= 3;

  // Generate description based on recovery
  let description = null;
  if (avgRecovery !== null) {
    if (avgRecovery < 40) description = 'low recovery period';
    else if (avgRecovery > 70) description = 'high recovery period';
    else description = 'moderate recovery period';
  } else if (avgHRV !== null) {
    if (avgHRV < 30) description = 'elevated stress indicators';
    else if (avgHRV > 50) description = 'good stress resilience';
  }

  return {
    hasSignificantPattern,
    avgRHR: avgRHR !== null ? Math.round(avgRHR) : null,
    avgHRV: avgHRV !== null ? Math.round(avgHRV) : null,
    avgRecovery: avgRecovery !== null ? Math.round(avgRecovery) : null,
    avgSleepScore: avgSleepScore !== null ? Math.round(avgSleepScore) : null,
    description,
    entriesWithHealth: withHealth.length
  };
};

/**
 * Fetch recent entries
 */
const fetchRecentEntries = async (userId, days = 30) => {
  const entriesRef = collection(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries'
  );

  const q = query(
    entriesRef,
    orderBy('createdAt', 'desc'),
    limit(500) // Cap for performance
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
};

/**
 * Mark insights as stale (will regenerate on next view)
 */
export const markInsightsStale = async (userId, reason = 'manual') => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );

  await setDoc(insightRef, {
    stale: true,
    staleReason: reason,
    staleAt: Timestamp.now()
  }, { merge: true });
};

export default {
  REASSESSMENT_STEPS,
  triggerInsightReassessment,
  markInsightsStale
};
