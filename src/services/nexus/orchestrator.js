/**
 * Nexus Orchestrator
 *
 * Coordinates all four layers to generate insights.
 * This is the main entry point for insight generation.
 */

import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// Layer 1
import { detectPatternsInPeriod } from './layer1/patternDetector';
import { identifyThreadAssociation, getActiveThreads } from './layer1/threadManager';
import { extractSomaticSignals } from './layer1/somaticExtractor';

// Layer 2
import { detectCurrentState, updateCurrentState } from './layer2/stateDetector';
import { getBaselines, calculateAndSaveBaselines, compareToBaseline } from './layer2/baselineManager';

// Layer 3 (stubs for now)
import { generateCausalSynthesis, generateNarrativeArcInsight } from './layer3/synthesizer';
import { detectMetaPatterns, generateMetaPatternInsight } from './layer3/crossThreadDetector';
import { extractBeliefsFromEntry, saveBeliefs, getBeliefs } from './layer3/beliefDissonance';

// Layer 4 (stubs for now)
import { updateInterventionData, getInterventionData } from './layer4/interventionTracker';
import { generateRecommendations } from './layer4/recommendationEngine';

// Health data
import { getWhoopSummary, getWhoopHistory, isWhoopLinked } from '../health/whoop';

// ============================================================
// MAIN ORCHESTRATION
// ============================================================

/**
 * Get cached insights (for immediate display)
 */
export const getCachedInsights = async (userId) => {
  if (!userId) return null;

  try {
    const insightRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
    );

    const insightDoc = await getDoc(insightRef);
    if (!insightDoc.exists()) return null;

    const data = insightDoc.data();
    return {
      insights: data.active || [],
      generatedAt: data.generatedAt,
      stale: data.stale || false,
      expiresAt: data.expiresAt
    };
  } catch (error) {
    console.error('[Orchestrator] Failed to get cached insights:', error);
    return null;
  }
};

/**
 * Check if insights need regeneration
 */
const needsRegeneration = (cached) => {
  if (!cached) return true;
  if (cached.stale) return true;

  // Check expiration (24 hours)
  if (cached.expiresAt) {
    const expiresAt = cached.expiresAt.toMillis ? cached.expiresAt.toMillis() : cached.expiresAt;
    if (Date.now() > expiresAt) return true;
  }

  // Check age (older than 24h)
  if (cached.generatedAt) {
    const generatedAt = cached.generatedAt.toMillis ? cached.generatedAt.toMillis() : cached.generatedAt;
    const ageHours = (Date.now() - generatedAt) / (1000 * 60 * 60);
    if (ageHours > 24) return true;
  }

  return false;
};

/**
 * Fetch recent entries for a user
 */
const fetchRecentEntries = async (userId, days = 30) => {
  try {
    const entriesRef = collection(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries'
    );

    const q = query(
      entriesRef,
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('[Orchestrator] Failed to fetch entries:', error);
    return [];
  }
};

/**
 * Get user's Nexus settings
 */
const getUserSettings = async (userId) => {
  try {
    const settingsRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'nexus'
    );
    const settingsDoc = await getDoc(settingsRef);
    return settingsDoc.exists() ? settingsDoc.data() : getDefaultSettings();
  } catch (error) {
    console.error('[Orchestrator] Failed to get settings:', error);
    return getDefaultSettings();
  }
};

const getDefaultSettings = () => ({
  features: {
    beliefDissonanceInsights: { enabled: true },
    interventionRecommendations: { enabled: true },
    narrativeArcTracking: { enabled: true },
    counterfactualInsights: { enabled: true }
  },
  preferences: {
    insightDepth: 'comprehensive',
    recommendationStyle: 'specific',
    challengeFrequency: 'moderate',
    moodGateThreshold: 50
  }
});

/**
 * Run full insight generation pipeline
 * Called on dashboard load (if stale) or manual refresh
 */
export const generateInsights = async (userId, options = {}) => {
  console.log('[Orchestrator] Starting insight generation...');

  const startTime = Date.now();
  const insights = [];
  const errors = [];

  try {
    // ========== GATHER DATA ==========

    // Check Whoop connectivity
    let whoopConnected = false;
    try {
      whoopConnected = await isWhoopLinked();
    } catch (e) {
      console.warn('[Orchestrator] Whoop check failed:', e.message);
    }

    // Fetch all required data in parallel
    const [
      entries,
      threads,
      baselines,
      whoopToday,
      whoopHistory,
      interventionData,
      beliefs,
      settings
    ] = await Promise.all([
      fetchRecentEntries(userId, 30),
      getActiveThreads(userId),
      getBaselines(userId),
      whoopConnected ? getWhoopSummary().catch(() => null) : Promise.resolve(null),
      whoopConnected ? getWhoopHistory(30).catch(() => ({ available: false, days: [] })) : Promise.resolve({ available: false, days: [] }),
      getInterventionData(userId),
      getBeliefs(userId),
      getUserSettings(userId)
    ]);

    // Check data status
    const whoopDays = whoopHistory?.days?.length || 0;
    const dataStatus = {
      entries: entries.length,
      threads: threads.length,
      whoopDays,
      whoopConnected,
      hasBaselines: !!baselines,
      isCalibrating: whoopConnected && whoopDays < 14
    };

    console.log('[Orchestrator] Data status:', dataStatus);

    // ========== LAYER 1: PATTERN DETECTION ==========

    const patterns = await detectPatternsInPeriod(userId, entries, whoopHistory);

    // ========== LAYER 2: TEMPORAL REASONING ==========

    // Detect current state
    const currentState = await detectCurrentState(userId, entries, whoopToday, threads);
    await updateCurrentState(userId, currentState);

    // Recalculate baselines if stale (older than 24h) or missing
    const baselinesStale = !baselines || isStale(baselines.calculatedAt, 24);
    if (baselinesStale && entries.length >= 10) {
      await calculateAndSaveBaselines(userId, entries);
    }

    // ========== LAYER 3: CAUSAL SYNTHESIS ==========

    // Build context for synthesis
    const synthesisContext = {
      recentEntries: entries,
      activeThreads: threads,
      currentState,
      baselines,
      whoopToday,
      whoopHistory,
      beliefData: beliefs,
      interventionData
    };

    // Generate primary causal synthesis insight (Phase 2)
    if (entries.length >= 10 && (!dataStatus.isCalibrating || entries.length >= 20)) {
      const synthesis = await generateCausalSynthesis(userId, synthesisContext);
      if (synthesis.success && synthesis.insight) {
        insights.push({
          ...synthesis.insight,
          priority: 1
        });
      }
    }

    // ========== CALIBRATION STATE ==========

    // If still calibrating, add calibration insight
    if (dataStatus.isCalibrating) {
      insights.push({
        id: 'calibration',
        type: 'calibration',
        title: 'Learning Your Baseline',
        summary: `${14 - whoopDays} days until full biometric insights`,
        body: `Your Whoop is teaching me what "normal" looks like for you. Keep logging to unlock deeper mind-body insights.`,
        progress: whoopDays / 14,
        priority: 0
      });
    }

    // If no Whoop but entries exist, show entry-only insights
    if (!dataStatus.whoopConnected && entries.length >= 5) {
      // Add patterns-based insight using mood data
      const topPattern = Object.values(patterns.aggregated || {})
        .filter(p => p.mood.mean !== null && p.occurrences >= 3)
        .sort((a, b) => Math.abs(b.mood.mean - 0.5) - Math.abs(a.mood.mean - 0.5))[0];

      if (topPattern) {
        insights.push({
          id: `pattern_${topPattern.patternId}`,
          type: 'pattern_alert',
          title: `${topPattern.category} Pattern`,
          summary: `Detected from ${topPattern.occurrences} entries`,
          body: `This pattern appears frequently in your entries with an average mood of ${Math.round(topPattern.mood.mean * 100)}%.`,
          priority: 2
        });
      }
    }

    // ========== SAVE & RETURN ==========

    // Sort by priority
    insights.sort((a, b) => a.priority - b.priority);

    // Save insights to Firestore
    await saveInsights(userId, insights);

    const duration = Date.now() - startTime;
    console.log(`[Orchestrator] Generated ${insights.length} insights in ${duration}ms`);

    return {
      success: true,
      insights,
      dataStatus,
      generatedAt: new Date().toISOString(),
      duration
    };

  } catch (error) {
    console.error('[Orchestrator] Insight generation failed:', error);
    errors.push(error.message);

    return {
      success: false,
      insights: [],
      errors,
      generatedAt: new Date().toISOString()
    };
  }
};

/**
 * Run incremental insight update after new entry
 * Lighter weight than full generation
 */
export const updateInsightsForNewEntry = async (userId, entryId, entryText, entrySentiment) => {
  console.log('[Orchestrator] Updating insights for new entry...');

  try {
    // Thread identification
    const threadResult = await identifyThreadAssociation(userId, entryId, entryText, entrySentiment);

    // Extract somatic signals
    const somaticSignals = extractSomaticSignals(entryText);

    // Extract beliefs (Phase 2)
    const rawBeliefs = extractBeliefsFromEntry(entryText, entryId);
    if (rawBeliefs.length > 0) {
      await saveBeliefs(userId, rawBeliefs);
    }

    // Mark insights as stale (will regenerate on next dashboard load)
    await markInsightsStale(userId);

    return {
      success: true,
      threadResult,
      somaticSignals
    };
  } catch (error) {
    console.error('[Orchestrator] Incremental update failed:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

const saveInsights = async (userId, insights) => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );

  await setDoc(insightRef, {
    active: insights,
    generatedAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000), // 24h
    stale: false
  }, { merge: true });
};

const markInsightsStale = async (userId) => {
  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );

  await setDoc(insightRef, {
    stale: true,
    staleAt: Timestamp.now()
  }, { merge: true });
};

const isStale = (timestamp, hours) => {
  if (!timestamp) return true;
  const ts = timestamp.toMillis ? timestamp.toMillis() : timestamp;
  const age = Date.now() - ts;
  return age > hours * 60 * 60 * 1000;
};

const getTimeOfDay = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};
