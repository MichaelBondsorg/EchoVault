/**
 * Causal Synthesizer
 *
 * The brain of Nexus 2.0. Uses LLM to synthesize patterns, baselines,
 * and context into meaningful insights with psychological mechanisms.
 * Integrates health (HealthKit) and environment data for holistic insights.
 */

import { callGemini } from '../../ai/gemini';
import { getBaselines, compareToBaseline } from '../layer2/baselineManager';
import { detectCurrentState, findSimilarPastStates } from '../layer2/stateDetector';
import { getActiveThreads, getThreadLineage } from '../layer1/threadManager';
import { extractHealthSignals } from '../../health/healthFormatter';
import { extractEnvironmentSignals } from '../../environment/environmentFormatter';
import { computeHealthMoodCorrelations } from '../../health/healthCorrelations';
import { computeEnvironmentMoodCorrelations } from '../../environment/environmentCorrelations';

// ============================================================
// MOOD01 CONVENTION (R4 T3)
// ============================================================
// Runtime `mood`/`analysis.mood_score` is stored 0-1 (see
// docs/superpowers/plans/2026-07-22-r4-insight-integrity.md). Per-entry
// mood was previously interpolated straight into prompt text as "N%"
// without converting, mislabeling a 0-1 score as a percentage.
// `displayMood100` is the ONLY place that conversion happens; mirrors
// `src/services/experiments/computeResult.js`'s `normalizeMoodTo100`
// domain semantics (reject out-of-[0,1]-domain, never clamp) without
// importing across the nexus/experiments boundary. (Baseline-derived mood
// stats elsewhere in this file, e.g. `stateBaseline.mood.mean`, are
// ALREADY stored 0-100 by layer2/baselineManager.js — do not re-convert
// those.)
const displayMood100 = (raw) => {
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return null;
  return Math.round(raw * 100);
};

/**
 * Data-sufficiency confidence (R4 T3, DR finding 6): synthesis used to
 * persist the MODEL's own self-reported "confidence" number verbatim —
 * meaningless, since a model can write "0.9" regardless of how much data
 * actually backs the claim. Confidence is computed here from how much data
 * fed the synthesis instead. Bands intentionally mirror the UI's existing
 * thresholds (`confidenceBand` in `src/components/insights/ReceiptSheet.jsx`:
 * >=0.75 "strong", >=0.5 "moderate", else "tentative") so a persisted value
 * bands identically wherever it's later read.
 */
const computeConfidenceFromSampleSize = (sampleSize) => {
  const n = Number.isFinite(sampleSize) ? sampleSize : 0;
  if (n >= 20) return 0.8;   // -> 'strong'
  if (n >= 10) return 0.6;   // -> 'moderate'
  if (n > 0) return 0.35;    // -> 'tentative'
  return 0;                  // no data at all
};

// ============================================================
// INSIGHT TYPES
// ============================================================

export const INSIGHT_TYPES = {
  CAUSAL_SYNTHESIS: 'causal_synthesis',
  BELIEF_DISSONANCE: 'belief_dissonance',
  NARRATIVE_ARC: 'narrative_arc',
  INTERVENTION: 'intervention',
  COUNTERFACTUAL: 'counterfactual',
  STATE_COMPARISON: 'state_comparison',
  PATTERN_ALERT: 'pattern_alert'
};

// ============================================================
// SYNTHESIS PROMPTS
// ============================================================

const buildSynthesisPrompt = (context) => {
  const {
    recentEntries,
    activeThreads,
    currentState,
    baselines,
    whoopToday,
    interventionData,
    healthCorrelations,
    environmentCorrelations,
    todayHealth,
    todayEnvironment
  } = context;

  // Format entries with health and environment context.
  // Sort-order contract (R4 T3): `recentEntries` is fetched DESCENDING by
  // createdAt (most recent first) — see orchestrator.js's
  // `fetchRecentEntries`. `.slice(0, 5)` takes the 5 MOST RECENT entries;
  // the previous `.slice(-5)` took the 5 OLDEST entries in the window
  // instead.
  const entrySummaries = (recentEntries || []).slice(0, 5).map(e => {
    const date = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
    const mood = e.mood ?? e.analysis?.mood_score;
    const excerpt = (e.content || e.text || '').slice(0, 300);

    // Include health and environment signals if available
    const healthInfo = e.healthContext ? extractHealthSignals(e.healthContext) : null;
    const envInfo = e.environmentContext ? extractEnvironmentSignals(e.environmentContext) : null;

    let contextLine = `[${date}] Mood: ${displayMood100(mood) ?? 'unknown'}%`;
    if (healthInfo) {
      if (healthInfo.sleepHours) contextLine += ` | Sleep: ${healthInfo.sleepHours}h`;
      if (healthInfo.recoveryScore) contextLine += ` | Recovery: ${healthInfo.recoveryScore}%`;
    }
    if (envInfo) {
      if (envInfo.sunshinePercent != null) contextLine += ` | Sunshine: ${envInfo.sunshinePercent}%`;
      if (envInfo.weatherLabel) contextLine += ` | Weather: ${envInfo.weatherLabel}`;
    }
    return `${contextLine}\n"${excerpt}..."`;
  }).join('\n\n');

  // Format threads
  const threadSummaries = (activeThreads || []).slice(0, 5).map(t => {
    return `- ${t.displayName} (${t.category}): ${t.entryCount} entries, sentiment trajectory: ${t.sentimentTrajectory}, baseline: ${Number.isFinite(t.sentimentBaseline) ? `${Math.round(t.sentimentBaseline * 100)}%` : 'unknown'}`;
  }).join('\n');

  // Format current state
  const stateInfo = currentState ?
    `Current Life State: ${currentState.primary} (${Math.round(currentState.confidence * 100)}% confidence)
Secondary states: ${currentState.secondary?.join(', ') || 'none'}
Duration in state: ${currentState.durationDays || 'unknown'} days` :
    'Current state: Unknown';

  // Format baselines
  let baselineComparisons = '';
  if (baselines?.global && whoopToday) {
    const comparisons = [];
    if (whoopToday.heartRate?.resting && baselines.global.rhr) {
      const comp = compareToBaseline(whoopToday.heartRate.resting, baselines.global, 'rhr');
      if (comp) comparisons.push(`RHR: ${comp.current} bpm (${comp.status}, ${comp.deltaPercent > 0 ? '+' : ''}${comp.deltaPercent}% from baseline)`);
    }
    if (whoopToday.hrv?.average && baselines.global.hrv) {
      const comp = compareToBaseline(whoopToday.hrv.average, baselines.global, 'hrv');
      if (comp) comparisons.push(`HRV: ${comp.current} ms (${comp.status}, ${comp.deltaPercent > 0 ? '+' : ''}${comp.deltaPercent}% from baseline)`);
    }
    if (whoopToday.recovery?.score && baselines.global.recovery) {
      const comp = compareToBaseline(whoopToday.recovery.score, baselines.global, 'recovery');
      if (comp) comparisons.push(`Recovery: ${comp.current}% (${comp.status})`);
    }
    baselineComparisons = comparisons.join('\n');
  }

  // Format contextual baselines
  let contextualInfo = '';
  if (baselines?.contextual && currentState?.primary) {
    const stateBaseline = baselines.contextual[`state:${currentState.primary}`];
    if (stateBaseline) {
      contextualInfo = `
Historical pattern for "${currentState.primary}" state:
- Typical RHR: ${stateBaseline.rhr?.mean || 'N/A'} bpm
- Typical HRV: ${stateBaseline.hrv?.mean || 'N/A'} ms
- Typical mood: ${stateBaseline.mood?.mean || 'N/A'}%
- Sample size: ${stateBaseline.sampleDays || 'N/A'} days`;
    }
  }

  // Format intervention effectiveness
  let interventionInfo = '';
  if (interventionData?.interventions) {
    const topInterventions = Object.entries(interventionData.interventions)
      .filter(([_, data]) => data.effectiveness?.global?.score > 0.7)
      .slice(0, 3)
      .map(([name, data]) => `- ${name}: effectiveness ${Math.round(data.effectiveness.global.score * 100)}%`)
      .join('\n');
    if (topInterventions) {
      interventionInfo = `\nMost effective interventions for this user:\n${topInterventions}`;
    }
  }

  // Format health-mood correlations
  let healthCorrelationInfo = '';
  if (healthCorrelations) {
    const insights = [];
    if (healthCorrelations.sleepMood?.insight) {
      insights.push(`- Sleep: ${healthCorrelations.sleepMood.insight} (${healthCorrelations.sleepMood.strength} correlation)`);
    }
    if (healthCorrelations.exerciseMood?.insight) {
      insights.push(`- Exercise: ${healthCorrelations.exerciseMood.insight} (${healthCorrelations.exerciseMood.strength} correlation)`);
    }
    if (healthCorrelations.hrvMood?.insight) {
      insights.push(`- HRV: ${healthCorrelations.hrvMood.insight} (${healthCorrelations.hrvMood.strength} correlation)`);
    }
    if (healthCorrelations.recoveryMood?.insight) {
      insights.push(`- Recovery: ${healthCorrelations.recoveryMood.insight} (${healthCorrelations.recoveryMood.strength} correlation)`);
    }
    if (insights.length > 0) {
      healthCorrelationInfo = `\n### Health-Mood Correlations (Statistical)\n${insights.join('\n')}`;
    }
  }

  // Format environment-mood correlations
  let envCorrelationInfo = '';
  if (environmentCorrelations) {
    const insights = [];
    if (environmentCorrelations.sunshineMood?.insight) {
      insights.push(`- Sunshine: ${environmentCorrelations.sunshineMood.insight} (${environmentCorrelations.sunshineMood.strength} correlation)`);
      if (environmentCorrelations.sunshineMood.recommendation) {
        insights.push(`  → Recommendation: ${environmentCorrelations.sunshineMood.recommendation}`);
      }
    }
    if (environmentCorrelations.weatherMood?.insight) {
      insights.push(`- Weather: ${environmentCorrelations.weatherMood.insight} (${environmentCorrelations.weatherMood.strength} correlation)`);
    }
    if (environmentCorrelations.daylightMood?.insight) {
      insights.push(`- Daylight Hours: ${environmentCorrelations.daylightMood.insight} (${environmentCorrelations.daylightMood.strength} correlation)`);
    }
    if (environmentCorrelations.lowSunshineWarning?.insight) {
      insights.push(`- SAD Warning: ${environmentCorrelations.lowSunshineWarning.insight}`);
    }
    if (insights.length > 0) {
      envCorrelationInfo = `\n### Environment-Mood Correlations (Statistical)\n${insights.join('\n')}`;
    }
  }

  // Format today's health context
  let todayHealthInfo = '';
  if (todayHealth) {
    const health = extractHealthSignals(todayHealth);
    const details = [];
    if (health.sleepHours) details.push(`Sleep: ${health.sleepHours}h (score: ${health.sleepScore || 'N/A'})`);
    if (health.hrv) details.push(`HRV: ${health.hrv}ms ${health.hrvTrend ? `(${health.hrvTrend})` : ''}`);
    if (health.recoveryScore != null) details.push(`Recovery: ${health.recoveryScore}%`);
    if (health.strainScore != null) details.push(`Strain: ${health.strainScore}`);
    if (health.steps) details.push(`Steps: ${health.steps}`);
    if (health.hadWorkout) details.push(`Workout: ${health.workoutType || 'Yes'}`);
    if (details.length > 0) {
      todayHealthInfo = `\n### Today's Health (HealthKit)\n${details.join(' | ')}`;
    }
  }

  // Format today's environment context
  let todayEnvInfo = '';
  if (todayEnvironment) {
    const env = extractEnvironmentSignals(todayEnvironment);
    const details = [];
    if (env.weatherLabel) details.push(`Weather: ${env.weatherLabel}`);
    if (env.temperature != null) details.push(`Temperature: ${env.temperature}°F`);
    if (env.sunshinePercent != null) details.push(`Sunshine: ${env.sunshinePercent}%`);
    if (env.daylightHours) details.push(`Daylight: ${env.daylightHours}h`);
    if (env.lightContext) details.push(`Light: ${env.lightContext}`);
    if (env.isLowSunshine) details.push(`⚠️ Low sunshine day`);
    if (details.length > 0) {
      todayEnvInfo = `\n### Today's Environment\n${details.join(' | ')}`;
    }
  }

  return `You are analyzing a user's journal, biometric, and environmental data to explain one pattern that's actually present in it.

## USER CONTEXT

### Recent Journal Entries
${entrySummaries || 'No recent entries available'}

### Active Life Threads
${threadSummaries || 'No active threads'}

### ${stateInfo}

### Today's Biometrics vs Personal Baseline
${baselineComparisons || 'Biometric data unavailable'}
${contextualInfo}
${interventionInfo}
${healthCorrelationInfo}
${envCorrelationInfo}
${todayHealthInfo}
${todayEnvInfo}

## YOUR TASK

Look at the CONTEXT above and explain ONE pattern you can actually see in
it — something connecting what the user wrote to their state, biometrics,
or environment during this window.

1. Describe the pattern plainly, in terms of what's ACTUALLY IN the
   context above (entries, threads, baselines, correlations). Do not
   invent details, quotes, or numbers that aren't given to you.
2. Only offer a mechanism/explanation when there's a reasonable, ordinary
   basis for it in the data provided — it's fine to say the mechanism is
   unclear or leave it out.
3. If you suggest an action, keep it modest and connect it directly to
   what you observed. Do not promise a specific outcome, timeline, or
   percentage improvement you can't support from the data given.
4. If the context above is too thin to support a real pattern, say so
   plainly instead of manufacturing one — a short, honest "not enough
   data yet" response is valid and preferred over invention.

## GROUNDING RULES

- Every number, quote, or biometric reading you write must come from the
  CONTEXT above — never invent one.
- Prefer plain, calm language over dramatic framing.
- If health/environment data isn't in the context above, don't reference
  it as if it were.
- Do not include a "confidence" value designed to sound persuasive — the
  app computes confidence itself from how much data actually supports this
  insight, and ignores any confidence number you write.

## RESPONSE FORMAT (JSON only)

{
  "insight": {
    "title": "Short memorable title (e.g., 'The Sterling Stabilization Loop')",
    "type": "causal_synthesis",
    "summary": "One sentence hook",
    "body": "2-3 paragraph insight with the full explanation, mechanism, and evidence",
    "mechanism": "The psychological/physiological mechanism in one sentence",
    "evidence": {
      "narrative": ["Specific quote or pattern from entries"],
      "biometric": ["Specific metric with value and comparison to baseline"],
      "statistical": {
        "correlation": 0.78,
        "sampleSize": 18,
        "confidence": 0.85
      }
    }
  },
  "recommendation": {
    "action": "Specific action to take",
    "timing": "When to do it (e.g., 'this evening before 7pm')",
    "reasoning": "Why this action specifically addresses the pattern",
    "expectedOutcome": "What improvement to expect and by when",
    "confidence": 0.85
  },
  "metadata": {
    "primaryThread": "thread_id if applicable",
    "relatedThreads": ["other_thread_ids"],
    "stateContext": "current_state_id",
    "urgency": "low" | "medium" | "high"
  }
}`;
};

// ============================================================
// MAIN SYNTHESIS FUNCTION
// ============================================================

/**
 * Generate the primary causal synthesis insight
 */
export const generateCausalSynthesis = async (userId, context) => {
  console.log('[Synthesizer] Generating causal synthesis...');

  const prompt = buildSynthesisPrompt(context);

  try {
    const response = await callGemini(prompt, '');

    if (!response) {
      throw new Error('No response from LLM');
    }

    // Parse response
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // R4 T3 (DR finding 6): the model's own "evidence" (narrative quotes,
    // biometric readings, a correlation number) and self-reported
    // confidence are NOT trusted/persisted anymore — they're prose the
    // model wrote, not something verified against real data. `sampleSize`
    // is the one number here WE compute from the real entries fed into
    // synthesis, so it survives; confidence is computed from it below.
    // Phase 2's verifier is what re-earns narrative/biometric evidence
    // display (see plan Phase 2).
    const sampleSize = (context?.recentEntries || []).length;
    const confidence = computeConfidenceFromSampleSize(sampleSize);

    return {
      success: true,
      insight: {
        id: `insight_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        userId,
        title: parsed.insight?.title,
        type: parsed.insight?.type || INSIGHT_TYPES.CAUSAL_SYNTHESIS,
        summary: parsed.insight?.summary,
        body: parsed.insight?.body,
        mechanism: parsed.insight?.mechanism,
        evidence: {
          statistical: { sampleSize }
        },
        confidence,
        recommendation: parsed.recommendation ? {
          action: parsed.recommendation.action,
          timing: parsed.recommendation.timing,
          reasoning: parsed.recommendation.reasoning
          // `expectedOutcome`/`confidence` intentionally dropped — a
          // predicted OUTCOME is exactly the class of unverified claim DR
          // finding 6 flags.
        } : undefined,
        metadata: {
          ...parsed.metadata,
          layers: [1, 2, 3, 4],
          generationMethod: 'llm_synthesis'
        }
      }
    };
  } catch (error) {
    console.error('[Synthesizer] Synthesis failed:', error);
    return {
      success: false,
      error: error.message,
      fallback: generateFallbackInsight(context)
    };
  }
};

/**
 * Generate fallback insight when LLM fails
 */
const generateFallbackInsight = (context) => {
  const { currentState, baselines, whoopToday } = context;

  // Simple rule-based fallback
  if (currentState?.primary === 'career_waiting' && whoopToday?.heartRate?.resting) {
    const rhrBaseline = baselines?.global?.rhr?.mean || 58;
    const rhrDelta = whoopToday.heartRate.resting - rhrBaseline;

    if (rhrDelta > 3) {
      return {
        title: "Career Anxiety Signal",
        type: INSIGHT_TYPES.PATTERN_ALERT,
        summary: "Your body is showing signs of career-related stress.",
        body: `Your resting heart rate is ${Math.round(rhrDelta)} bpm above your baseline during this waiting period. This is a common physiological response to uncertainty.`,
        recommendation: {
          action: "Take a 10-minute walk or do a breathing exercise",
          timing: "Now or within the next hour",
          reasoning: "Physical movement helps regulate the nervous system during periods of uncertainty",
          confidence: 0.6
        }
      };
    }
  }

  return {
    title: "System Learning",
    type: INSIGHT_TYPES.PATTERN_ALERT,
    summary: "Continue logging to unlock deeper insights.",
    body: "The more data you provide, the more personalized and powerful your insights become.",
    confidence: 0.3
  };
};

// ============================================================
// SPECIALIZED SYNTHESIS FUNCTIONS
// ============================================================

/**
 * Generate narrative arc insight (long-term story)
 */
export const generateNarrativeArcInsight = async (userId, threadId) => {
  console.log('[Synthesizer] Generating narrative arc insight...');

  try {
    const lineage = await getThreadLineage(userId, threadId);

    if (!lineage || lineage.length < 2) {
      return null;  // Not enough history for arc
    }

    // Build arc data
    const arcData = lineage.map(t => ({
      name: t.displayName,
      sentiment: t.sentimentBaseline,
      duration: t.entryCount,
      evolution: t.evolutionType
    }));

    const prompt = `Analyze this narrative arc from a user's life:

THREAD EVOLUTION:
${arcData.map((t, i) => `${i + 1}. "${t.name}" - Sentiment: ${Number.isFinite(t.sentiment) ? `${Math.round(t.sentiment * 100)}%` : 'unknown'}, Entries: ${t.duration}`).join('\n')}

Generate a "Resilience Arc" insight that:
1. Identifies how the user has grown through this sequence
2. Compares their emotional trajectory now vs the beginning
3. Highlights a specific strength or pattern that emerged

Response format (JSON):
{
  "title": "The [Topic] Resilience Arc",
  "summary": "One sentence describing the growth",
  "body": "2-3 paragraphs analyzing the arc",
  "growth_metric": "Specific quantified growth (e.g., 'recovery time shortened from 3 weeks to 3 days')",
  "strength_identified": "The resilience factor that emerged"
}`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return null;
    }

    const parsed = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return {
      type: INSIGHT_TYPES.NARRATIVE_ARC,
      threadId,
      ...parsed,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Synthesizer] Arc insight failed:', error);
    return null;
  }
};

/**
 * Generate state comparison insight
 */
export const generateStateComparisonInsight = async (userId, currentState, pastStates) => {
  console.log('[Synthesizer] Generating state comparison insight...');

  if (!pastStates || pastStates.length === 0) {
    return null;
  }

  try {
    const mostRecent = pastStates[pastStates.length - 1];

    const prompt = `Compare the user's current experience of "${currentState.primary}" with their previous experience:

CURRENT STATE:
- State: ${currentState.primary}
- Duration so far: ${currentState.durationDays || 0} days
- Confidence: ${Math.round(currentState.confidence * 100)}%

MOST RECENT SIMILAR STATE:
- Duration: ${mostRecent.durationDays} days
- Outcome: ${mostRecent.outcome}
- Average mood: ${mostRecent.averageMood}%

Generate an insight about how they're handling this state differently (or similarly) this time.

Response format (JSON):
{
  "title": "State Comparison Insight",
  "comparison": "How current compares to past",
  "improvement": "What's better this time (if any)",
  "concern": "What to watch for (if any)",
  "prediction": "Likely outcome based on trajectory"
}`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return null;
    }

    const parsed = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return {
      type: INSIGHT_TYPES.STATE_COMPARISON,
      currentState: currentState.primary,
      ...parsed,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Synthesizer] State comparison failed:', error);
    return null;
  }
};
