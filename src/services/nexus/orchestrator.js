/**
 * Nexus Orchestrator
 *
 * Coordinates all four layers to generate insights.
 * This is the main entry point for insight generation.
 */

import { doc, getDoc, setDoc, collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { filterEntriesByScope } from '../spaces/scopeFilter';

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
// beliefDissonance.js / counterfactual.js imports deleted R4-P3 per P3-D1
// (superseded by claims+experiments; legacy Firestore belief docs may
// remain, harmless).

// Layer 4
// interventionTracker.js deleted whole R4-P3 per P3-D1 (docs/superpowers/
// plans/2026-07-23-r4-phase3-action-loop.md) — see tombstone below near
// RISKY_CLAIMS_ENABLED's old location. Legacy Firestore intervention docs
// may remain, harmless.
import { generateRecommendations } from './layer4/recommendationEngine';

// Gap detection
import { detectGaps } from './gapDetector';

// Health data
import { getWhoopSummary, getWhoopHistory, isWhoopLinked } from '../health/whoop';

// Insight Receipts (R2 Task 8)
import { buildReceipt, applyReceiptDefaults, sourceFromEntry, computeTimeWindow } from '../insights/receipts';

// Source Exclusions (R2 Task 10)
import { getExcludedEntryIds } from '../insights/sourceExclusions';

// Staleness (extracted, R2 Task 10 — see staleness.js for why)
import { markInsightsStale } from './staleness';

// Insight Dismissal Persistence (R4 Task 5, DR finding 10 — see that
// module's own doc comment for the full "why a separate file" rationale)
import { recordInsightDismissal, getDismissedKeys, dismissalKeyFor } from './insightDismissal';

// Versioned cutover (R4 Task 6, ratified decision 2) — shared with
// basicInsightsOrchestrator.js so both generators stamp the SAME current
// version. Re-exported here so existing importers of orchestrator.js (tests
// included) don't also need to know about the shared module.
import { generatorVersion } from '../insights/generatorVersion';
export { generatorVersion };

// ============================================================
// MOOD01 CONVENTION (R4 T3)
// ============================================================
// Runtime `mood`/`analysis.mood_score` is stored 0-1 (see
// docs/superpowers/plans/2026-07-22-r4-insight-integrity.md). Every
// internal comparison in this file operates on that native 0-1 scale.
// `displayMood100` is the ONLY place a raw value becomes a "N%" display
// number; mirrors `src/services/experiments/computeResult.js`'s
// `normalizeMoodTo100` domain semantics (reject out-of-[0,1]-domain,
// never clamp) without importing across the nexus/experiments boundary.
const displayMood100 = (raw) => {
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return null;
  return Math.round(raw * 100);
};

// LOW_MOOD_THRESHOLD (counterfactual candidate selection) deleted R4-P3 per
// P3-D1 along with the counterfactual block below that was its only
// consumer.

// ============================================================
// RISKY CLAIM SUPPRESSION — RETIRED (R4 Phase 3 Task 5 / P3-D1)
// ============================================================
// `RISKY_CLAIMS_ENABLED` (and the `options.riskyClaimsEnabled` override
// below) used to gate four claim types that compared native 0-1 mood
// values against 0-100-scale thresholds once the Mood01 scale bugs were
// fixed: personal counterfactuals, belief-dissonance insights, intervention
// "this worked" OUTCOME claims, and personalized recommendation reasoning.
// R4 Phase 3 deleted all four suppressed modules outright — counterfactual.js
// and beliefDissonance.js (Task 4), interventionTracker.js and
// recommendationEngine.js's personal-evidence path (Task 5, this one) — and
// replaced their intent with the evidence-railed experiments/claims loop
// (docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md, P3-D1).
// Nothing suppressible remains, so the gate itself retires with them.
// Legacy Firestore belief/intervention docs may remain, harmless.

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
  },
  // Stabilizer patterns
  pet_interaction: {
    title: 'Pet Time Pattern',
    getContent: (mood) => ({
      summary: `Time with your pets ${mood > 0.5 ? 'brightens' : 'steadies'} your day`,
      body: mood > 0.5
        ? `When you spend time with your pets, your mood averages ${Math.round(mood * 100)}%. Pet interactions are proven mood stabilizers—keep it up!`
        : `Your mood averages ${Math.round(mood * 100)}% on days you mention your pets. Pets often provide comfort during harder days.`
    })
  },
  creative_activity: {
    title: 'Creative Flow Pattern',
    getContent: (mood) => ({
      summary: 'Creative work affects your emotional state',
      body: mood > 0.5
        ? `When you're creating—whether building, painting, or coding—your mood averages ${Math.round(mood * 100)}%. Creative flow appears to energize you.`
        : `Your mood averages ${Math.round(mood * 100)}% during creative work. This could mean you create to process emotions, which is actually healthy.`
    })
  },
  social_connection: {
    title: 'Social Connection Pattern',
    getContent: (mood) => ({
      summary: `Social time ${mood > 0.5 ? 'lifts' : 'accompanies'} your mood`,
      body: mood > 0.5
        ? `When you connect with friends and loved ones, your mood averages ${Math.round(mood * 100)}%. Social connection appears to be valuable for your wellbeing.`
        : `Your mood averages ${Math.round(mood * 100)}% around social events. This could reflect pre-event anxiety or that you reach out when struggling.`
    })
  },
  caregiving_stress: {
    title: 'Caregiving Pattern',
    getContent: (mood) => ({
      summary: 'Caring for others impacts your emotional state',
      body: `When caregiving responsibilities come up, your mood averages ${Math.round(mood * 100)}%. Remember to care for yourself too—caregiver burnout is real.`
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

// Re-exported so existing/other callers that import dismissal helpers from
// the orchestrator (the module that owns `nexus/insights`, the doc these
// live under) keep working; `insightDismissal.js` is the source of truth —
// see that module's doc comment for the full seam rationale.
export { recordInsightDismissal, getDismissedKeys, dismissalKeyFor };

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
    // R4 Task 5 (+ T5b fix): dismissed-stays-dismissed across reloads AND
    // regeneration, even for insight types whose `id` churns every
    // generation (see insightDismissal.js's doc comment). Read-time filter
    // — active/history are both matched by `dismissalKeyFor`, not raw
    // `.id`, so a churned-id insight with the same content still filters.
    const dismissedKeys = await getDismissedKeys(userId);
    const active = data.active || [];
    const history = data.history || [];
    const notDismissed = (i) => !dismissedKeys.has(dismissalKeyFor(i));
    return {
      insights: dismissedKeys.size === 0 ? active : active.filter(notDismissed),
      history: dismissedKeys.size === 0 ? history : history.filter(notDismissed),
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
 *
 * @param {string} userId
 * @param {number} [days] - unused by the query itself (kept for call-site
 *   compatibility / documentation of intent); entries are capped by `limit`.
 * @param {{spaceId: string}|null} [scope] - Context Space scope, applied
 *   AFTER the Firestore fetch. null (default) is identity — Nexus stays
 *   all-spaces in R1 (every current caller passes null/omits scope); this
 *   param exists so R2 can wire a scoped Nexus without another seam change.
 * @param {Set<string>|null} [excludedIds] - Source exclusions (R2 Task 10),
 *   applied AFTER the scope filter. Entries whose id is in this set are
 *   dropped entirely — every downstream generator in `generateInsights`
 *   reads from this same filtered array, so an excluded entry never feeds
 *   patterns, correlations, synthesis, or receipts. Callers read exclusions
 *   ONCE (via `getExcludedEntryIds`) and pass the resulting Set here rather
 *   than this function re-reading them itself.
 */
export const fetchRecentEntries = async (userId, days = 30, scope = null, excludedIds = null) => {
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
    const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const scoped = filterEntriesByScope(entries, scope);
    if (!excludedIds || excludedIds.size === 0) return scoped;
    return scoped.filter((e) => !excludedIds.has(e.id));
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

// R4 Phase 3 backlog (P3-D7/review item A): `beliefDissonanceInsights` and
// `counterfactualInsights` removed — both features were deleted whole in
// R4-P3 Task 4 (P3-D1); no code anywhere reads either key anymore.
// `interventionRecommendations` is KEPT — verified still read below (the
// ideas-generation block, L615-ish) to gate `generateRecommendations`.
// `narrativeArcTracking` is KEPT too — still read (L557-ish) to gate the
// narrative-arc synthesis block, which survives per P3-D6.
const getDefaultSettings = () => ({
  features: {
    interventionRecommendations: { enabled: true },
    narrativeArcTracking: { enabled: true }
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

  // Receipts (R2 Task 8): `scope` is threaded through to `fetchRecentEntries`
  // and stamped onto every receipt built below. No current caller passes
  // `options.scope` yet (Nexus stays all-spaces until a future task wires
  // Context Spaces into Nexus itself) — this just makes that seam ready.
  const scope = options.scope || null;
  const timeWindow = computeTimeWindow(30);
  // `options.riskyClaimsEnabled` retired R4-P3 Task 5 per P3-D1 — see the
  // tombstone comment above (formerly RISKY_CLAIMS_ENABLED's location).
  // `options` itself stays (other callers use `options.scope`).

  try {
    // Source Exclusions (R2 Task 10): read ONCE here and thread the
    // resulting Set into `fetchRecentEntries` below — every generator in
    // this function reads from that same filtered `entries` array, so a
    // single read is sufficient (no per-generator re-read).
    //
    // Deliberately NOT wrapped in a try/catch that degrades to an empty
    // Set: this mirrors the fail-closed precedent set for the server-side
    // reports consumer (`functions/src/reports/generator.js`'s
    // `ExclusionsReadError`) — a failed exclusions read must never
    // silently produce insights as if no exclusions existed, since that
    // could resurface an entry the user explicitly excluded. A failure
    // here propagates to the outer try/catch below and generation reports
    // `success: false` rather than risking a leak.
    const excludedIds = await getExcludedEntryIds(db, userId);

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
      settings
    ] = await Promise.all([
      fetchRecentEntries(userId, 30, scope, excludedIds),
      getActiveThreads(userId),
      getBaselines(userId),
      whoopConnected ? getWhoopSummary().catch(() => null) : Promise.resolve(null),
      whoopConnected ? getWhoopHistory(30).catch(() => ({ available: false, days: [] })) : Promise.resolve({ available: false, days: [] }),
      // getInterventionData(userId) deleted R4-P3 per P3-D1
      // (interventionTracker.js deleted whole); getBeliefs(userId) deleted
      // R4-P3 per P3-D1 (superseded by claims+experiments). Legacy
      // Firestore belief/intervention docs may remain, harmless.
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

    // ========== GAP DETECTION (post Layer 1) ==========

    let gapResults = [];
    try {
      gapResults = await detectGaps(userId);
    } catch (error) {
      console.warn('[Orchestrator] Gap detection failed:', error.message);
    }

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
      // beliefData: beliefs deleted R4-P3 per P3-D1 (superseded by
      // claims+experiments; legacy Firestore belief docs may remain,
      // harmless).
      // interventionData: interventionTracker.js deleted whole R4-P3 per
      // P3-D1 — this context key is no longer produced at all (not just
      // withheld). `layer3/synthesizer.js`'s `buildSynthesisPrompt` still
      // accepts an `interventionData` key generically if a caller passes
      // one directly (see its own code + validationMatrix.test.js's R4
      // Matrix row (b) denylist test, which still exercises that generic
      // surface); orchestrator.js just never populates it anymore.
      blindSpots: gapResults.map(g => ({
        domain: g.domain,
        severity: g.gapScore,
        lastMentioned: g.lastMentionDate,
      })),
    };

    // Generate primary causal synthesis insight once there are enough entries.
    // Previously, if Whoop was still calibrating this required 20 entries instead
    // of 10 — so connecting a wearable IRONICALLY DELAYED the first "wow" causal
    // insight. Since synthesis already runs at 10 entries with no biometric data
    // at all (Whoop not connected), running during calibration is strictly more
    // data, not less — so we no longer gate on calibration.
    if (entries.length >= 10) {
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

    // Belief dissonance block deleted R4-P3 per P3-D1 (superseded by
    // claims+experiments; legacy Firestore belief docs may remain,
    // harmless). This removed an UNCONDITIONAL per-generation LLM call
    // (refineBeliefsWithLLM, via callGemini) that ran whenever entries.length
    // >= 10 and the beliefDissonanceInsights setting was on (the default) —
    // it ran regardless of riskyClaimsEnabled/RISKY_CLAIMS_ENABLED, so in
    // production it fired on every generateInsights() call with zero
    // downstream consumer (validateBeliefAgainstData/generateDissonanceInsight
    // were gated off, so the refined beliefs were only ever saved, never
    // read back into a surfaced insight). Real waste removed.

    // ========== LAYER 4: IDEA GENERATION ==========
    // updateInterventionData(userId, entries, whoopHistory) deleted R4-P3
    // per P3-D1 — interventionTracker.js (the mention-based effectiveness
    // tracker it fed) is deleted whole. Legacy Firestore intervention docs
    // may remain, harmless.

    // Generate idea-to-try suggestions
    if (settings.features.interventionRecommendations?.enabled !== false) {
      try {
        const recommendations = await generateRecommendations(userId, {
          currentState,
          whoopToday,
          // Mood01: was `|| 50`, a 0-100-scale fallback mixed with a
          // native 0-1 value, and never checked `.analysis?.mood_score`.
          recentMood: entries[0]?.mood ?? entries[0]?.analysis?.mood_score ?? 0.5,
          timeOfDay: getTimeOfDay()
        });

        if (recommendations.length > 0) {
          insights.push({
            id: `recommendation_${Date.now()}`,
            type: 'intervention',
            // R4-P3 per P3-D1: always the generic-idea title now — the
            // personalized "Recommended Action" title (formerly gated on
            // riskyClaimsEnabled) no longer exists; there is no
            // personalized framing left for it to distinguish.
            title: 'An Idea to Try',
            ...recommendations[0],
            priority: 1
          });
        }
      } catch (error) {
        console.warn('[Orchestrator] Recommendations failed:', error.message);
      }
    }

    // Counterfactual block deleted R4-P3 per P3-D1 (superseded by
    // claims+experiments; legacy Firestore belief docs may remain,
    // harmless). This block was already fully suppressed in production
    // (gated on riskyClaimsEnabled, false by default) so this deletion is a
    // flag-OFF no-op — no behavior change, no LLM-call waste removed here
    // (unlike the belief block above).

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

    // ========== SIMPLE PATTERN INSIGHTS ==========
    // Always generate these regardless of Whoop status - they're the "X improves mood by Y%" style insights

    if (entries.length >= 5) {
      // Get top patterns sorted by how much they deviate from neutral (50%)
      const sortedPatterns = Object.values(patterns.aggregated || {})
        .filter(p => p.mood.mean !== null && p.occurrences >= 3)
        .sort((a, b) => Math.abs(b.mood.mean - 0.5) - Math.abs(a.mood.mean - 0.5));

      // entryId -> full entry lookup, used below to turn the exact entries a
      // pattern/entity generator computed over into receipt sources (with
      // date + excerpt), without re-fetching anything.
      const entriesById = new Map(entries.map(e => [e.id, e]));

      // Add up to 2 simple pattern insights
      let patternCount = 0;
      for (const pattern of sortedPatterns) {
        if (patternCount >= 2) break;

        const patternInfo = getPatternDisplayInfo(pattern.patternId, pattern.mood.mean);
        if (patternInfo.hasContent) {
          // Receipts (R2 Task 8): the exact entries this pattern was
          // detected over live in `patterns.rawPatterns` (per-entry pattern
          // hits from Layer 1, pre-aggregation) — filter to this pattern's
          // id to get its real source set instead of falling back to the
          // window-level receipt.
          const matchingRaw = (patterns.rawPatterns || [])
            .filter(rp => rp.patternId === pattern.patternId);
          const patternSources = matchingRaw
            .map(rp => sourceFromEntry(entriesById.get(rp.entryId) || { id: rp.entryId, date: rp.entryDate }))
            .filter(Boolean);

          insights.push({
            id: `pattern_${pattern.patternId}`,
            type: 'pattern_correlation',
            title: patternInfo.title,
            summary: patternInfo.summary,
            body: patternInfo.body,
            evidence: {
              narrative: [`Detected in ${pattern.occurrences} entries`],
              statistical: {
                sampleSize: pattern.occurrences,
                averageMood: Math.round(pattern.mood.mean * 100)
              }
            },
            receipt: buildReceipt({
              sources: patternSources,
              scope,
              timeWindow,
              sampleSize: pattern.occurrences,
              generator: 'pattern_correlation'
            }),
            priority: 3  // Lower priority than deep insights but always show some
          });
          patternCount++;
        }
      }
    }

    // ========== ENTITY-SPECIFIC CORRELATION INSIGHTS ==========
    // "Time with [person/pet] correlates with X% mood", "Yoga improves mood by X%"

    if (entries.length >= 10) {
      const entityCorrelations = computeEntityMoodCorrelations(entries);

      // Add up to 2 entity correlation insights
      let entityCount = 0;
      for (const correlation of entityCorrelations) {
        if (entityCount >= 2) break;

        // Only show strong correlations (>10% deviation from average)
        if (Math.abs(correlation.moodDelta) >= 10) {
          const direction = correlation.moodDelta > 0 ? 'boosts' : 'lowers';
          const absChange = Math.abs(correlation.moodDelta);

          insights.push({
            id: `entity_${correlation.entityName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
            type: 'entity_correlation',
            title: `${correlation.entityName} Effect`,
            summary: `${correlation.entityName} ${direction} your mood by ~${absChange}%`,
            body: correlation.moodDelta > 0
              ? `On days when you mention ${correlation.entityName}, your mood averages ${correlation.averageMood}% (compared to ${correlation.baselineMood}% overall). ${correlation.entityType === 'pet' ? 'Pet interactions are known mood stabilizers!' : correlation.entityType === 'activity' ? 'This activity seems to be working for you.' : 'This connection appears valuable for your wellbeing.'}`
              : `When ${correlation.entityName} comes up in your entries, your mood tends to be lower (${correlation.averageMood}% vs ${correlation.baselineMood}% overall). This could indicate stress, or simply that you journal about ${correlation.entityName} when processing difficult emotions.`,
            evidence: {
              narrative: [`Mentioned in ${correlation.mentionCount} entries`],
              statistical: {
                sampleSize: correlation.mentionCount,
                averageMood: correlation.averageMood,
                baselineMood: correlation.baselineMood,
                moodDelta: correlation.moodDelta
              }
            },
            receipt: buildReceipt({
              sources: (correlation.matchingEntries || []).map(sourceFromEntry).filter(Boolean),
              scope,
              timeWindow,
              sampleSize: correlation.mentionCount,
              generator: 'entity_correlation'
            }),
            priority: 3
          });
          entityCount++;
        }
      }
    }

    // ========== SAVE & RETURN ==========

    // Sort by priority
    insights.sort((a, b) => a.priority - b.priority);

    // Receipts (R2 Task 8): pattern_correlation/entity_correlation insights
    // above already attached a precise receipt over their real source set.
    // Everything else (Layer 3 synthesis/meta/belief, Layer 4
    // intervention/counterfactual, calibration) falls back here to a
    // window-level receipt over the full 30-day `entries` window. This is
    // the final pass that guarantees the PRD's 100%-receipts invariant:
    // every insight that reaches `active` has a truthy `.receipt`.
    const insightsWithReceipts = insights.map(insight =>
      applyReceiptDefaults(insight, { windowEntries: entries, scope, timeWindow })
    );

    // Save insights to Firestore
    await saveInsights(userId, insightsWithReceipts);

    const duration = Date.now() - startTime;
    console.log(`[Orchestrator] Generated ${insightsWithReceipts.length} insights in ${duration}ms`);

    return {
      success: true,
      insights: insightsWithReceipts,
      gaps: gapResults,
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

    // Belief extraction ("Extract beliefs (Phase 2)") deleted R4-P3 per
    // P3-D1 (superseded by claims+experiments; legacy Firestore belief docs
    // may remain, harmless). This call site was NOT in the brief's stated
    // line ranges (~L604-648, ~L692-720) — found on a full-file read of
    // orchestrator.js: it was a second, fully unconditional
    // extractBeliefsFromEntry+saveBeliefs pair firing on every single new
    // entry via updateInsightsForNewEntry (no LLM call itself, since
    // extractBeliefsFromEntry is pure regex — but it wrote to the same
    // orphaned `nexus/beliefs` Firestore doc with zero downstream reader).

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

/**
 * Compute mood correlations for entities (people, pets, activities) mentioned in entries
 * Returns sorted list of entities with their mood impact
 */
const computeEntityMoodCorrelations = (entries) => {
  if (!entries || entries.length < 5) return [];

  // Common entities to look for (can be expanded with memory graph data).
  // These are extracted from entry text via simple keyword matching.
  // R4 T3 (DR finding 5, privacy sweep): generic role/category words only —
  // no proper nouns (names, pets). Per-user entity ontology is deferred to
  // the Phase 1 extraction layer (see genericTriggers.js's same posture in
  // layer1/patternDetector.js).
  const entityPatterns = [
    // People - relationship-role words, not names
    { pattern: /\b(mom|dad|partner|wife|husband)\b/gi, type: 'person' },
    // Pets - category words, not pet names
    { pattern: /\b(dog|cat|pet)\b/gi, type: 'pet' },
    // Activities
    { pattern: /\b(yoga|meditation|workout|exercise|gym|running|walking|hiking|swimming)\b/gi, type: 'activity' },
    { pattern: /\b(therapy|therapist|counseling)\b/gi, type: 'activity' },
    { pattern: /\b(work|meeting|project)\b/gi, type: 'activity' }
  ];

  // Also extract entities from entry analysis if available
  const extractedEntities = new Map();

  for (const entry of entries) {
    // From analysis.entities if available
    const analysisEntities = entry.analysis?.entities || [];
    for (const entity of analysisEntities) {
      if (entity.name && entity.name.length > 2) {
        const key = entity.name.toLowerCase();
        if (!extractedEntities.has(key)) {
          extractedEntities.set(key, {
            name: entity.name,
            type: entity.type || 'person',
            pattern: new RegExp(`\\b${entity.name}\\b`, 'gi')
          });
        }
      }
    }

    // From memory mentions if available
    const memoryMentions = entry.memoryMentions || [];
    for (const mention of memoryMentions) {
      if (mention.name && mention.name.length > 2) {
        const key = mention.name.toLowerCase();
        if (!extractedEntities.has(key)) {
          extractedEntities.set(key, {
            name: mention.name,
            type: mention.entityType || 'person',
            pattern: new RegExp(`\\b${mention.name}\\b`, 'gi')
          });
        }
      }
    }
  }

  // Combine static patterns with extracted entities
  const allPatterns = [
    ...entityPatterns,
    ...Array.from(extractedEntities.values()).map(e => ({
      pattern: e.pattern,
      type: e.type,
      name: e.name
    }))
  ];

  // Calculate baseline mood (average across all entries). Mood01: this
  // used to `Math.round()` the raw 0-1 average directly, collapsing every
  // baseline/entity average to 0 or 1 — the `>= 10` significance check
  // below then compared two near-identical single-digit integers and could
  // never clear 10. `displayMood100` rounds AFTER converting to the
  // display (0-100) scale, and rejects (drops, never clamps) any mood
  // value outside the declared [0,1] domain rather than silently including
  // it as if it were valid.
  const allMoods = entries
    .map(e => e.mood ?? e.analysis?.mood_score)
    .filter(m => Number.isFinite(m) && m >= 0 && m <= 1);

  if (allMoods.length === 0) return [];

  const baselineMood = displayMood100(allMoods.reduce((a, b) => a + b, 0) / allMoods.length);

  // Track entity mentions and associated moods
  const entityStats = new Map();

  for (const entry of entries) {
    const mood = entry.mood ?? entry.analysis?.mood_score;
    if (!Number.isFinite(mood) || mood < 0 || mood > 1) continue;

    const text = (entry.content || entry.text || '').toLowerCase();

    for (const { pattern, type, name } of allPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 0) {
        // Use the matched text as the entity name if not provided
        const entityName = name || matches[0].charAt(0).toUpperCase() + matches[0].slice(1).toLowerCase();
        const key = entityName.toLowerCase();

        if (!entityStats.has(key)) {
          entityStats.set(key, {
            entityName,
            entityType: type,
            moods: [],
            mentionCount: 0,
            // Receipts (R2 Task 8): the exact entries this entity was
            // matched in, deduped per entry (an entry can match the same
            // entity via more than one pattern source without being cited
            // twice).
            matchingEntries: [],
            matchedEntryIds: new Set()
          });
        }

        const stats = entityStats.get(key);
        stats.moods.push(mood);
        stats.mentionCount++;

        const entryRefId = entry.id || entry.entryId;
        if (entryRefId && !stats.matchedEntryIds.has(entryRefId)) {
          stats.matchedEntryIds.add(entryRefId);
          stats.matchingEntries.push(entry);
        }
      }
    }
  }

  // Calculate correlations
  const correlations = [];

  for (const [key, stats] of entityStats) {
    // Need at least 3 mentions for statistical relevance
    if (stats.mentionCount < 3) continue;

    const averageMood = displayMood100(stats.moods.reduce((a, b) => a + b, 0) / stats.moods.length);
    const moodDelta = averageMood - baselineMood;

    correlations.push({
      entityName: stats.entityName,
      entityType: stats.entityType,
      mentionCount: stats.mentionCount,
      averageMood,
      baselineMood,
      moodDelta,
      matchingEntries: stats.matchingEntries
    });
  }

  // Sort by absolute mood delta (strongest correlations first)
  correlations.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return correlations;
};

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

  // Versioned cutover (R4 Task 6, ratified decision 2 — "legacy artifact
  // cutover, not migration"). Every newly generated insight gets stamped
  // with the current `generatorVersion`. Separately: `active` is about to
  // be wholesale-overwritten below (pre-existing behavior) — any PREVIOUS
  // active insight that predates versioning (no `generatorVersion` field at
  // all, i.e. version 1) or was stamped by an older version would otherwise
  // simply vanish, unrecorded anywhere. Archive those into `history` with a
  // `legacyVersion: true` mark instead — nothing is ever silently deleted.
  // In steady state (every generation after the first post-R4 one) this
  // list is empty: this generation's own `active` items already carry the
  // current version, so there's nothing to archive next time.
  const legacyActive = existingActive.filter(
    (insight) => !insight.generatorVersion || insight.generatorVersion < generatorVersion
  );
  const stampedNewInsights = uniqueNewInsights.map((insight) => ({
    ...insight,
    generatorVersion
  }));

  // Merge new insights into history (dedupe by id, keep latest)
  const historyMap = new Map();

  // Add existing history
  for (const insight of existingHistory) {
    if (insight.id) {
      historyMap.set(insight.id, insight);
    }
  }

  // Archive legacy actives (cutover) — added AFTER existing history so a
  // fresher history entry with the same id (shouldn't normally happen, but
  // defensive) isn't clobbered by an older archived-active copy, and BEFORE
  // this generation's own new insights below so a genuine same-id refresh
  // in the SAME generation still wins.
  for (const insight of legacyActive) {
    if (insight.id) {
      historyMap.set(insight.id, {
        ...insight,
        legacyVersion: true,
        lastSeen: insight.lastSeen || Timestamp.now()
      });
    }
  }

  // Add/update with new unique insights
  for (const insight of stampedNewInsights) {
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
    active: stampedNewInsights,
    history: updatedHistory,
    generatedAt: Timestamp.now(),
    expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000), // 24h
    stale: false
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
 * Theme definitions for semantic deduplication
 * Insights sharing a theme are considered duplicates even with different wording
 */
const INSIGHT_THEMES = {
  trade_off_regulation: {
    label: 'Trade-off & Regulation',
    triggers: ['trade', 'trading', 'convenience', 'friction', 'regulation', 'dysregulation',
               'paradox', 'loop', 'proximity', 'routine', 'spontaneity', 'co-regulation',
               'depletion', 'agency', 'anchoring', 'reset']
  },
  social_energy: {
    label: 'Social Energy',
    triggers: ['social', 'connection', 'isolation', 'alone', 'people', 'relationship',
               'interaction', 'engagement', 'withdrawal', 'introvert', 'extrovert']
  },
  physical_mood: {
    label: 'Physical-Mood Connection',
    triggers: ['exercise', 'workout', 'yoga', 'walk', 'movement', 'physical', 'body',
               'somatic', 'tension', 'pain', 'energy', 'fatigue', 'sleep', 'rest']
  },
  career_stress: {
    label: 'Career & Stress',
    triggers: ['career', 'job', 'work', 'interview', 'waiting', 'rejection', 'uncertainty',
               'professional', 'application', 'opportunity']
  },
  routine_disruption: {
    label: 'Routine & Disruption',
    triggers: ['routine', 'schedule', 'disruption', 'change', 'stability', 'predictability',
               'structure', 'chaos', 'order', 'planning', 'spontaneous']
  },
  emotional_avoidance: {
    label: 'Emotional Patterns',
    triggers: ['avoid', 'avoidance', 'escape', 'cope', 'coping', 'suppress', 'process',
               'emotional', 'feelings', 'anxiety', 'stress', 'overwhelm']
  }
};

/**
 * Extract the primary theme from an insight based on content analysis
 */
const extractInsightTheme = (insight) => {
  if (!insight) return null;

  const text = `${insight.title || ''} ${insight.summary || ''} ${insight.body || ''}`.toLowerCase();

  let bestTheme = null;
  let bestScore = 0;

  for (const [themeId, theme] of Object.entries(INSIGHT_THEMES)) {
    const matchCount = theme.triggers.filter(trigger => text.includes(trigger)).length;
    const score = matchCount / theme.triggers.length;

    if (score > bestScore && matchCount >= 2) {  // Require at least 2 trigger matches
      bestScore = score;
      bestTheme = themeId;
    }
  }

  return bestTheme;
};

/**
 * Check if an insight is too similar to any existing insights
 * Uses three methods: title similarity, content similarity, and theme matching
 *
 * Exported (Task 12, Insight Budget) so `insightBudget.js` can reuse this
 * similarity check for 90-day near-duplicate suppression against the
 * shown-insight ledger, instead of reimplementing it.
 */
export const isDuplicateInsight = (newInsight, existingInsights, threshold = 0.6) => {
  if (!newInsight || !existingInsights?.length) return false;

  const newTitle = newInsight.title || '';
  const newSummary = newInsight.summary || '';
  const newCombined = `${newTitle} ${newSummary}`;
  const newTheme = extractInsightTheme(newInsight);

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

    // Check theme matching - if both insights share the same theme, they're duplicates
    // This catches semantically similar insights with different wording
    if (newTheme) {
      const existingTheme = extractInsightTheme(existing);
      if (existingTheme === newTheme) {
        console.log(`[Orchestrator] Duplicate insight detected (theme: ${newTheme}): "${newTitle}" ~ "${existingTitle}"`);
        return true;
      }
    }
  }

  return false;
};
