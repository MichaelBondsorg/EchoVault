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

// Layer 3
import { generateCausalSynthesis, generateNarrativeArcInsight, INSIGHT_TYPES } from './layer3/synthesizer';
import { detectMetaPatterns, generateMetaPatternInsight } from './layer3/crossThreadDetector';
import { extractBeliefsFromEntry, refineBeliefsWithLLM, validateBeliefAgainstData, generateDissonanceInsight, saveBeliefs, getBeliefs } from './layer3/beliefDissonance';
import { identifyMissingInterventions, generateCounterfactualInsight, findGoodDayActivities } from './layer3/counterfactual';

// Layer 4
import { updateInterventionData, getInterventionData } from './layer4/interventionTracker';
import { generateRecommendations } from './layer4/recommendationEngine';

// Health data
import { getWhoopSummary, getWhoopHistory, isWhoopLinked } from '../health/whoop';

// ============================================================
// PATTERN DISPLAY HELPERS
// ============================================================

/**
 * Pattern ID to human-readable display info
 * Returns meaningful title, summary, and body for each pattern type
 */
const PATTERN_DISPLAY_MAP = {
  // Career patterns
  career_anticipation: {
    title: 'Career Anticipation Pattern',
    getContent: (mood) => ({
      summary: 'You tend to experience heightened anticipation around job opportunities',
      body: mood > 0.5
        ? `When you're in interview or application mode, your mood stays relatively positive (averaging ${Math.round(mood * 100)}%). This suggests you handle career uncertainty well.`
        : `Interview and application periods tend to affect your mood (averaging ${Math.round(mood * 100)}%). Consider building routines that help you stay grounded during these times.`
    })
  },
  career_waiting: {
    title: 'Waiting Period Pattern',
    getContent: (mood) => ({
      summary: 'Waiting for career outcomes has a noticeable impact on you',
      body: mood > 0.5
        ? `You maintain a positive outlook (${Math.round(mood * 100)}% average mood) even during uncertain waiting periods. That's a valuable coping mechanism.`
        : `Waiting for responses tends to weigh on you (${Math.round(mood * 100)}% average mood). Having activities that provide a sense of progress elsewhere can help.`
    })
  },
  career_outcome_positive: {
    title: 'Positive Career News Pattern',
    getContent: (mood) => ({
      summary: 'Good career news gives you a significant boost',
      body: `When you receive positive career updates, your mood reflects it (averaging ${Math.round(mood * 100)}%). Celebrating these wins is important for sustaining motivation.`
    })
  },
  career_outcome_negative: {
    title: 'Career Setback Pattern',
    getContent: (mood) => ({
      summary: 'Rejections have a measurable impact on your wellbeing',
      body: `Career setbacks affect your mood (averaging ${Math.round(mood * 100)}% during these periods). Remember that rejection is part of the process and doesn't reflect your worth.`
    })
  },
  // Relationship patterns
  relationship_connection: {
    title: 'Connection Pattern',
    getContent: (mood) => ({
      summary: 'Quality time with loved ones stabilizes your mood',
      body: `When you connect with people you care about, your mood averages ${Math.round(mood * 100)}%. These moments of connection appear to be valuable for your emotional wellbeing.`
    })
  },
  relationship_strain: {
    title: 'Relationship Tension Pattern',
    getContent: (mood) => ({
      summary: 'Interpersonal tensions affect your emotional state',
      body: `When there's friction in your relationships, your mood reflects it (averaging ${Math.round(mood * 100)}%). Addressing tensions directly tends to resolve them faster.`
    })
  },
  // Health patterns
  exercise_completion: {
    title: 'Exercise Pattern',
    getContent: (mood) => ({
      summary: `Working out ${mood > 0.5 ? 'boosts' : 'accompanies'} your mood`,
      body: mood > 0.5
        ? `On days when you exercise, your mood averages ${Math.round(mood * 100)}%. Physical activity appears to be a positive force in your routine.`
        : `Your mood averages ${Math.round(mood * 100)}% on workout days. This could mean you exercise when stressed, or that certain workouts are more draining than energizing.`
    })
  },
  exercise_avoidance: {
    title: 'Rest Day Pattern',
    getContent: (mood) => ({
      summary: 'How skipping workouts relates to your mood',
      body: mood > 0.5
        ? `On days you skip exercise, your mood still averages ${Math.round(mood * 100)}%. Rest days don't seem to negatively impact you.`
        : `When you skip workouts, your mood averages ${Math.round(mood * 100)}%. This could be correlation (you skip when already tired) rather than causation.`
    })
  },
  // Somatic patterns
  physical_discomfort: {
    title: 'Physical Discomfort Pattern',
    getContent: (mood) => ({
      summary: 'Body discomfort correlates with your emotional state',
      body: `When you mention pain, soreness, or tension, your mood averages ${Math.round(mood * 100)}%. Physical and emotional wellbeing are deeply connected.`
    })
  },
  fatigue: {
    title: 'Energy Pattern',
    getContent: (mood) => ({
      summary: 'Fatigue shows up in both body and mood',
      body: `On low-energy days, your mood averages ${Math.round(mood * 100)}%. Prioritizing sleep and recovery on these days could help.`
    })
  },
  // Emotional patterns
  anxiety_signal: {
    title: 'Stress Response Pattern',
    getContent: (mood) => ({
      summary: 'Anxiety and stress have a measurable presence',
      body: `When anxiety appears in your entries, your mood averages ${Math.round(mood * 100)}%. Recognizing these patterns is the first step to managing them.`
    })
  },
  positive_momentum: {
    title: 'Positive Momentum Pattern',
    getContent: (mood) => ({
      summary: 'You have a pattern of experiencing genuine positivity',
      body: `When you're feeling good, your mood shows it (averaging ${Math.round(mood * 100)}%). Take note of what contributes to these moments.`
    })
  }
};

/**
 * Get display info for a pattern
 */
const getPatternDisplayInfo = (patternId, moodMean) => {
  const patternConfig = PATTERN_DISPLAY_MAP[patternId];

  if (!patternConfig) {
    // Unknown pattern - don't show generic fallback
    return { hasContent: false };
  }

  const content = patternConfig.getContent(moodMean);

  return {
    hasContent: true,
    title: patternConfig.title,
    summary: content.summary,
    body: content.body
  };
};

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
      history: data.history || [],
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

    // Generate primary causal synthesis insight
    if (entries.length >= 10 && (!dataStatus.isCalibrating || entries.length >= 20)) {
      try {
        const synthesis = await generateCausalSynthesis(userId, synthesisContext);
        if (synthesis.success && synthesis.insight) {
          insights.push({
            ...synthesis.insight,
            priority: 1
          });
        }
      } catch (error) {
        console.warn('[Orchestrator] Causal synthesis failed:', error.message);
      }
    }

    // Generate narrative arc insight if applicable
    if (settings.features.narrativeArcTracking?.enabled !== false) {
      const longestThread = threads
        .filter(t => t.predecessorId)
        .sort((a, b) => (b.entryCount || 0) - (a.entryCount || 0))[0];

      if (longestThread) {
        try {
          const arcInsight = await generateNarrativeArcInsight(userId, longestThread.id);
          if (arcInsight) {
            insights.push({
              ...arcInsight,
              priority: 2
            });
          }
        } catch (error) {
          console.warn('[Orchestrator] Arc insight failed:', error.message);
        }
      }
    }

    // Detect and generate meta-pattern insights
    try {
      const metaPatterns = await detectMetaPatterns(userId, threads, entries);
      if (metaPatterns.length > 0) {
        const metaInsight = await generateMetaPatternInsight(
          userId,
          metaPatterns[0],
          synthesisContext
        );
        if (metaInsight) {
          insights.push({
            ...metaInsight,
            priority: 2
          });
        }
      }
    } catch (error) {
      console.warn('[Orchestrator] Meta-pattern detection failed:', error.message);
    }

    // Generate belief dissonance insight (if enabled)
    if (settings.features.beliefDissonanceInsights?.enabled !== false && entries.length >= 10) {
      try {
        // Extract new beliefs from recent entries
        for (const entry of entries.slice(0, 5)) {
          const rawBeliefs = extractBeliefsFromEntry(entry.content || entry.text || '', entry.id);
          if (rawBeliefs.length > 0) {
            const refined = await refineBeliefsWithLLM(rawBeliefs, entry.content || entry.text);
            await saveBeliefs(userId, refined);
          }
        }

        // Validate existing beliefs and generate insights
        const allBeliefs = await getBeliefs(userId);
        const recentMood = entries[0]?.mood || entries[0]?.analysis?.mood_score;

        for (const belief of allBeliefs.slice(0, 3)) {
          const validation = await validateBeliefAgainstData(belief, { entries, baselines, threads });

          if (validation.dissonanceScore > 0.5) {
            const dissonanceInsight = await generateDissonanceInsight(
              belief,
              validation,
              recentMood
            );

            if (dissonanceInsight && !dissonanceInsight.queued) {
              insights.push({
                ...dissonanceInsight,
                priority: 3
              });
              break;  // Only one dissonance insight per generation
            }
          }
        }
      } catch (error) {
        console.warn('[Orchestrator] Belief dissonance failed:', error.message);
      }
    }

    // ========== LAYER 4: INTERVENTION OPTIMIZATION ==========

    // Update intervention effectiveness data
    try {
      await updateInterventionData(userId, entries, whoopHistory);
    } catch (error) {
      console.warn('[Orchestrator] Intervention update failed:', error.message);
    }

    // Generate recommendations
    if (settings.features.interventionRecommendations?.enabled !== false) {
      try {
        const recommendations = await generateRecommendations(userId, {
          currentState,
          whoopToday,
          recentMood: entries[0]?.mood || 50,
          timeOfDay: getTimeOfDay()
        });

        if (recommendations.length > 0) {
          insights.push({
            id: `recommendation_${Date.now()}`,
            type: 'intervention',
            title: 'Recommended Action',
            ...recommendations[0],
            priority: 1
          });
        }
      } catch (error) {
        console.warn('[Orchestrator] Recommendations failed:', error.message);
      }
    }

    // Generate counterfactual insight for recent low mood days
    if (settings.features.counterfactualInsights?.enabled !== false) {
      try {
        const lowMoodEntry = entries.find(e => {
          const mood = e.mood || e.analysis?.mood_score;
          return mood && mood < 40;
        });

        if (lowMoodEntry && interventionData) {
          const goodDayActivities = findGoodDayActivities(entries);
          const activityNames = goodDayActivities.map(a => a.activity);
          const missing = identifyMissingInterventions(lowMoodEntry, interventionData, activityNames);

          if (missing.length > 0) {
            const counterfactual = await generateCounterfactualInsight(lowMoodEntry, missing, {});
            if (counterfactual) {
              insights.push({
                ...counterfactual,
                priority: 3
              });
            }
          }
        }
      } catch (error) {
        console.warn('[Orchestrator] Counterfactual insight failed:', error.message);
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
        // Get a meaningful display name and description
        const patternInfo = getPatternDisplayInfo(topPattern.patternId, topPattern.mood.mean);

        // Only add if we have a meaningful pattern (not just category)
        if (patternInfo.hasContent) {
          insights.push({
            id: `pattern_${topPattern.patternId}`,
            type: 'pattern_alert',
            title: patternInfo.title,
            summary: patternInfo.summary,
            body: patternInfo.body,
            evidence: {
              narrative: [`Detected in ${topPattern.occurrences} entries`],
              statistical: {
                sampleSize: topPattern.occurrences,
                averageMood: Math.round(topPattern.mood.mean * 100)
              }
            },
            priority: 2
          });
        }
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

  // Get existing history
  let existingHistory = [];
  let existingActive = [];
  try {
    const existingDoc = await getDoc(insightRef);
    if (existingDoc.exists()) {
      existingHistory = existingDoc.data().history || [];
      existingActive = existingDoc.data().active || [];
    }
  } catch (e) {
    console.warn('[Orchestrator] Could not read existing history:', e);
  }

  // Combine existing insights for deduplication check
  const allExisting = [...existingActive, ...existingHistory];

  // Filter new insights to remove duplicates (by semantic similarity)
  const uniqueNewInsights = [];
  for (const insight of insights) {
    // Check against both existing insights AND already-added new insights
    const allToCheck = [...allExisting, ...uniqueNewInsights];
    if (!isDuplicateInsight(insight, allToCheck)) {
      uniqueNewInsights.push(insight);
    }
  }

  console.log(`[Orchestrator] Insights: ${insights.length} generated, ${uniqueNewInsights.length} unique after dedup`);

  // Merge new insights into history (dedupe by id, keep latest)
  const historyMap = new Map();

  // Add existing history
  for (const insight of existingHistory) {
    if (insight.id) {
      historyMap.set(insight.id, insight);
    }
  }

  // Add/update with new unique insights
  for (const insight of uniqueNewInsights) {
    if (insight.id) {
      historyMap.set(insight.id, {
        ...insight,
        lastSeen: Timestamp.now()
      });
    }
  }

  // Convert back to array, sort by priority, limit to 50 most recent
  const updatedHistory = Array.from(historyMap.values())
    .sort((a, b) => {
      // Sort by lastSeen (most recent first), then by priority
      const aTime = a.lastSeen?.toMillis?.() || 0;
      const bTime = b.lastSeen?.toMillis?.() || 0;
      if (bTime !== aTime) return bTime - aTime;
      return (a.priority || 99) - (b.priority || 99);
    })
    .slice(0, 50);

  await setDoc(insightRef, {
    active: uniqueNewInsights,
    history: updatedHistory,
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

/**
 * Calculate Jaccard similarity between two strings
 * Used for deduplicating similar insights
 */
const textSimilarity = (str1, str2) => {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  if (s1 === s2) return 1;

  const words1 = new Set(s1.split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(s2.split(/\s+/).filter(w => w.length > 2));
  const intersection = [...words1].filter(w => words2.has(w));
  const union = new Set([...words1, ...words2]);

  return union.size > 0 ? intersection.length / union.size : 0;
};

/**
 * Check if an insight is too similar to any existing insights
 * Compares title and summary for semantic overlap
 */
const isDuplicateInsight = (newInsight, existingInsights, threshold = 0.6) => {
  if (!newInsight || !existingInsights?.length) return false;

  const newTitle = newInsight.title || '';
  const newSummary = newInsight.summary || '';
  const newCombined = `${newTitle} ${newSummary}`;

  for (const existing of existingInsights) {
    const existingTitle = existing.title || '';
    const existingSummary = existing.summary || '';
    const existingCombined = `${existingTitle} ${existingSummary}`;

    // Check title similarity (higher weight - titles are the main identifier)
    const titleSim = textSimilarity(newTitle, existingTitle);
    if (titleSim > 0.7) {
      console.log(`[Orchestrator] Duplicate insight detected (title): "${newTitle}" ~ "${existingTitle}" (${(titleSim * 100).toFixed(0)}%)`);
      return true;
    }

    // Check combined content similarity
    const combinedSim = textSimilarity(newCombined, existingCombined);
    if (combinedSim > threshold) {
      console.log(`[Orchestrator] Duplicate insight detected (content): "${newTitle}" ~ "${existingTitle}" (${(combinedSim * 100).toFixed(0)}%)`);
      return true;
    }
  }

  return false;
};
