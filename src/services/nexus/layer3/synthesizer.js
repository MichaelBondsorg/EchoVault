/**
 * Causal Synthesizer
 *
 * The brain of Nexus 2.0. Uses LLM to synthesize patterns, baselines,
 * and context into meaningful insights with psychological mechanisms.
 */

import { callGemini } from '../../ai/gemini';
import { getBaselines, compareToBaseline } from '../layer2/baselineManager';
import { detectCurrentState, findSimilarPastStates } from '../layer2/stateDetector';
import { getActiveThreads, getThreadLineage } from '../layer1/threadManager';

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
    interventionData
  } = context;

  // Format entries
  const entrySummaries = (recentEntries || []).slice(-5).map(e => {
    const date = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
    const mood = e.mood || e.analysis?.mood_score;
    const excerpt = (e.content || e.text || '').slice(0, 300);
    return `[${date}] Mood: ${mood}% - "${excerpt}..."`;
  }).join('\n');

  // Format threads
  const threadSummaries = (activeThreads || []).slice(0, 5).map(t => {
    return `- ${t.displayName} (${t.category}): ${t.entryCount} entries, sentiment trajectory: ${t.sentimentTrajectory}, baseline: ${Math.round((t.sentimentBaseline || 0.5) * 100)}%`;
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

  return `You are an expert behavioral psychologist and health coach analyzing a user's journal and biometric data. Your task is to generate a single, powerful insight that reveals a non-obvious pattern and its psychological mechanism.

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

## YOUR TASK

Generate ONE profound insight that:
1. Identifies a HIDDEN PATTERN the user likely hasn't noticed
2. Explains the PSYCHOLOGICAL MECHANISM behind it
3. Connects NARRATIVE (what they're saying) with BIOMETRICS (what their body is doing)
4. Provides a SPECIFIC, ACTIONABLE recommendation
5. Predicts the likely OUTCOME if the recommendation is followed

## QUALITY CRITERIA

- The insight should make the user think "holy shit, I didn't realize that"
- Avoid generic advice like "get more sleep" - be specific to THIS user
- Reference specific entities (people, pets, places) when relevant
- Quantify when possible ("your HRV recovers 12ms faster when...")
- The mechanism should be psychologically sound (attachment theory, nervous system regulation, etc.)

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

    return {
      success: true,
      insight: {
        id: `insight_${Date.now()}`,
        generatedAt: new Date().toISOString(),
        userId,
        ...parsed.insight,
        recommendation: parsed.recommendation,
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
${arcData.map((t, i) => `${i + 1}. "${t.name}" - Sentiment: ${Math.round((t.sentiment || 0.5) * 100)}%, Entries: ${t.duration}`).join('\n')}

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
