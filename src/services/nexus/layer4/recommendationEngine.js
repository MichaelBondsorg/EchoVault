/**
 * Recommendation Engine
 *
 * Generates personalized, context-aware action recommendations
 * based on current state, intervention effectiveness, and timing.
 */

import { getInterventionData } from './interventionTracker';

// ============================================================
// MOOD01 CONVENTION (R4 T3)
// ============================================================
// Runtime `mood`/`analysis.mood_score` and interventionTracker's stored
// `moodDelta` are all native 0-1 (see
// docs/superpowers/plans/2026-07-22-r4-insight-integrity.md).
// `displayMoodPoints` is the ONLY place a raw DELTA becomes a "+N points"
// string; mirrors `src/services/experiments/computeResult.js`'s
// `normalizeMoodTo100` domain semantics (reject out-of-domain, never
// clamp) without importing across the nexus/experiments boundary. Domain
// here is [-1, 1] (a difference of two Mood01 values), not [0, 1].
const displayMoodPoints = (delta) => {
  if (!Number.isFinite(delta) || delta < -1 || delta > 1) return null;
  return Math.round(delta * 100);
};

// A recommendation needs at least this many tracked occurrences before its
// effectiveness score is trusted at all (R4 T3, DR finding 7 — "recommends
// without personal evidence"). Below this, `scoreRecommendation` starts
// from 0 instead of a neutral 0.5, so context boosts alone (time-of-day,
// recovery, mood) can no longer push an untested intervention over the
// recommend threshold.
const MIN_EVIDENCE_OCCURRENCES = 3;

// ============================================================
// RECOMMENDATION GENERATION
// ============================================================

/**
 * Generate recommendations for current context.
 *
 * `context.riskyClaimsEnabled` (ratified decision 4, default false):
 * personalized effectiveness framing — specific "historically boosted your
 * mood by X" claims, and a displayed confidence score derived from
 * (possibly thin) personal data — is suppressed while false. What still
 * surfaces is a generic idea: no personal-evidence wording, no fabricated
 * or score-driven numbers. Only production caller is orchestrator.js,
 * which threads its internal `RISKY_CLAIMS_ENABLED` constant through here;
 * tests may pass `riskyClaimsEnabled: true` directly to exercise the
 * scale-corrected personalized path.
 */
export const generateRecommendations = async (userId, context) => {
  console.log('[RecommendationEngine] Generating recommendations...');

  const { currentState, timeOfDay, riskyClaimsEnabled = false } = context;

  const interventionData = await getInterventionData(userId);
  if (!interventionData) return [];

  const recommendations = [];

  // Get state-specific interventions
  const stateInterventions = getInterventionsForState(
    currentState?.primary,
    interventionData
  );

  // Score and rank recommendations
  for (const intervention of stateInterventions) {
    const score = scoreRecommendation(intervention, context);

    if (score > 0.5) {
      const base = {
        intervention: intervention.name,
        category: intervention.category,
        timing: suggestTiming(intervention, timeOfDay)
      };

      if (riskyClaimsEnabled) {
        recommendations.push({
          ...base,
          score,
          reasoning: generateReasoning(intervention, currentState, context),
          expectedOutcome: predictOutcome(intervention, context)
        });
      } else {
        // Ratified decision 4: relabeled as a generic idea — no
        // personal-evidence wording, no score/confidence surfaced.
        recommendations.push({
          ...base,
          reasoning: genericIdeaReasoning(intervention)
        });
      }
    }
  }

  return recommendations
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 3);  // Top 3 recommendations
};

/**
 * Generic, non-personalized reasoning shown when `riskyClaimsEnabled` is
 * false (ratified decision 4). Deliberately makes no claim about the
 * user's own history/data.
 */
const genericIdeaReasoning = (intervention) => {
  const interventionName = intervention.name.replace(/_/g, ' ');
  return `${capitalize(interventionName)} could be worth trying right now.`;
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Get interventions that work well for a given state
 */
const getInterventionsForState = (state, interventionData) => {
  const stateInterventionMap = {
    'career_waiting': ['pet_walk', 'yoga', 'creative', 'social'],
    'career_rejection': ['partner_time', 'acts_of_service', 'yoga', 'social'],
    'low_mood': ['yoga', 'pet_walk', 'partner_time', 'acts_of_service'],
    'high_strain': ['rest_day', 'yoga', 'sleep_focus'],
    'recovery_mode': ['rest_day', 'walk', 'sleep_focus'],
    'burnout_risk': ['rest_day', 'sleep_focus', 'social'],
    'stable': ['gym', 'fitness_class', 'creative', 'social']
  };

  const relevantInterventions = stateInterventionMap[state] || stateInterventionMap['stable'];

  return relevantInterventions
    .map(name => ({
      name,
      ...(interventionData.interventions?.[name] || {})
    }))
    .filter(i => i.effectiveness || i.category);
};

/**
 * Score a recommendation based on context
 */
const scoreRecommendation = (intervention, context) => {
  const { currentState, whoopToday, recentMood, timeOfDay } = context;

  // R4 T3 (DR finding 7 — "recommends without personal evidence"):
  // previously started at a neutral 0.5 even for an intervention tracked
  // ONCE ever, so the boosts below alone (up to ~0.45) could push it past
  // the `> 0.5` recommend threshold with zero real evidence behind it.
  // Below MIN_EVIDENCE_OCCURRENCES there IS no personal evidence yet —
  // start at 0, not neutral.
  const occurrences = intervention.totalOccurrences || 0;
  let score = occurrences >= MIN_EVIDENCE_OCCURRENCES
    ? (intervention.effectiveness?.global?.score ?? 0.5)
    : 0;

  // Boost for context-specific effectiveness
  if (intervention.effectiveness?.contextual?.[`during:${currentState?.primary}`]) {
    const contextScore = intervention.effectiveness.contextual[`during:${currentState.primary}`].score;
    score = Math.max(score, contextScore);
  }

  // Adjust for time of day
  const timeBoost = getTimeBoost(intervention.name, timeOfDay);
  score += timeBoost;

  // Adjust for current recovery
  if (whoopToday?.recovery?.score) {
    if (whoopToday.recovery.score < 40 && intervention.category === 'physical') {
      score -= 0.2;  // Reduce physical recommendations on low recovery
    }
    if (whoopToday.recovery.score < 40 && intervention.category === 'recovery') {
      score += 0.2;  // Boost recovery recommendations
    }
  }

  // Adjust for recent mood. Mood01: `recentMood` is native 0-1 — was
  // compared against `40`, which a 0-1 value can never be below except by
  // being negative, so this branch effectively never fired.
  if (Number.isFinite(recentMood) && recentMood < 0.40 && intervention.name === 'acts_of_service') {
    score += 0.15;  // This user's pattern shows acts of service help during low mood
  }

  return Math.max(0, Math.min(1, score));
};

/**
 * Get time-of-day boost for intervention
 */
const getTimeBoost = (intervention, timeOfDay) => {
  const optimalTimes = {
    yoga: ['morning', 'afternoon'],
    fitness_class: ['morning'],
    pet_walk: ['morning', 'evening'],
    gym: ['morning', 'afternoon'],
    rest_day: ['any'],
    social: ['evening'],
    creative: ['afternoon', 'evening']
  };

  const optimal = optimalTimes[intervention] || ['any'];
  if (optimal.includes('any') || optimal.includes(timeOfDay)) {
    return 0.1;
  }
  return -0.05;
};

/**
 * Per-state/intervention narrative templates. Only ever called when
 * `riskyClaimsEnabled` is true (the orchestrator-level gate).
 *
 * R4 T3 / ratified decision 4: the numeric templates below used to fall
 * back to INVENTED numbers (`|| 12`ms, `|| 15`pts) whenever real
 * effectiveness data was thin or absent — deleted outright, not gated
 * (decision 4 is explicit that fabricated fallback reasoning must not
 * exist at all, even once the risky-claims gate is flipped on). Each
 * function returns `null` when it can't cite a real number, so the caller
 * falls through to the data-driven generic path below instead.
 */
const STATE_INTERVENTION_REASONING = {
  career_waiting: {
    pet_walk: (intervention) => {
      const hrvDelta = intervention.effectiveness?.global?.hrvDelta?.mean;
      if (!Number.isFinite(hrvDelta)) return null;
      return `You're in a waiting period with elevated stress markers. Walks with your pet have historically recovered your HRV by ${Math.round(hrvDelta)}ms within 24 hours.`;
    },
    yoga: () => `During career uncertainty, yoga has been your most effective physical reset. On days you do yoga, your mood tends to improve.`,
    creative: () => `Working on creative projects provides a sense of agency when career outcomes feel out of your control.`
  },
  low_mood: {
    acts_of_service: (intervention) => {
      const moodDeltaPoints = displayMoodPoints(intervention.effectiveness?.global?.moodDelta?.mean);
      if (!Number.isFinite(moodDeltaPoints)) return null;
      return `When your mood is low, doing something for someone else has historically boosted your mood by ${moodDeltaPoints} points.`;
    },
    partner_time: () => `Time with your partner has a stabilizing effect on your mood.`
  }
};

/**
 * Generate reasoning for recommendation
 */
const generateReasoning = (intervention, currentState, context) => {
  const templateFn = STATE_INTERVENTION_REASONING[currentState?.primary]?.[intervention.name];
  const templated = templateFn ? templateFn(intervention) : null;
  if (templated) return templated;

  // Generate a meaningful fallback based on what data we have. Mood01: the
  // moodDelta stored by interventionTracker is a native 0-1 delta —
  // `displayMoodPoints` converts it for the "N points" claim below.
  const score = intervention.effectiveness?.global?.score;
  const moodDeltaPoints = displayMoodPoints(intervention.effectiveness?.global?.moodDelta?.mean);
  const hrvDelta = intervention.effectiveness?.global?.hrvDelta?.mean;
  const interventionName = intervention.name.replace(/_/g, ' ');

  // If we have mood delta data, explain in terms of mood improvement
  if (Number.isFinite(moodDeltaPoints) && Math.abs(moodDeltaPoints) > 5) {
    const direction = moodDeltaPoints > 0 ? 'improved' : 'lower';
    return `On days you do ${interventionName}, your mood is typically ${Math.abs(moodDeltaPoints)} points ${direction} than average.`;
  }

  // If we have HRV data, explain in terms of recovery
  if (Number.isFinite(hrvDelta) && Math.abs(hrvDelta) > 3) {
    return `${capitalize(interventionName)} tends to ${hrvDelta > 0 ? 'improve' : 'affect'} your HRV recovery the next day.`;
  }

  // If we have an effectiveness score with enough data
  if (Number.isFinite(score) && score !== 0.5) {
    const percentage = Math.round(score * 100);
    if (percentage >= 70) {
      return `${capitalize(interventionName)} has been consistently helpful for your mood and energy.`;
    } else if (percentage >= 55) {
      return `${capitalize(interventionName)} sometimes helps with mood, depending on the day.`;
    }
  }

  // Generic fallback - but be honest about limited data
  return `${capitalize(interventionName)} is worth trying. We're still learning what works best for you.`;
};

/**
 * Suggest optimal timing
 */
const suggestTiming = (intervention, currentTimeOfDay) => {
  const optimalTiming = {
    yoga: 'This morning if possible, or early afternoon',
    pet_walk: 'Before 7pm for optimal HRV recovery',
    fitness_class: 'Morning classes tend to set a better tone for your day',
    rest_day: 'Today and tomorrow if needed',
    social: 'This evening',
    creative: 'When you have 30+ uninterrupted minutes',
    gym: currentTimeOfDay === 'morning' ? 'This morning' : 'Before the end of the day',
    pilates: 'Morning or early afternoon',
    walk: 'Anytime - even a short walk helps',
    partner_time: 'This evening when you both have downtime',
    acts_of_service: 'When you notice an opportunity'
  };

  // Return specific timing or a contextual fallback
  return optimalTiming[intervention.name] ||
    (currentTimeOfDay === 'evening' ? 'Tomorrow when you have time' : 'Later today if possible');
};

/**
 * Predict outcome if recommendation is followed. Only ever called when
 * `riskyClaimsEnabled` is true.
 *
 * R4 T3 / decision 4: no fabricated defaults (was `|| 10` mood points,
 * `|| 0.7` confidence) — with no real data, there's no outcome prediction,
 * not an invented one.
 */
const predictOutcome = (intervention, context) => {
  const moodDeltaPoints = displayMoodPoints(intervention.effectiveness?.global?.moodDelta?.mean);
  const hrvDelta = intervention.effectiveness?.global?.hrvDelta?.mean;

  if (!Number.isFinite(moodDeltaPoints) && !Number.isFinite(hrvDelta)) {
    return null;
  }

  let prediction = Number.isFinite(moodDeltaPoints)
    ? `Expected mood improvement: +${moodDeltaPoints} points`
    : 'Expected impact: not enough data yet to predict mood change';

  if (Number.isFinite(hrvDelta)) {
    prediction += `. HRV recovery: +${Math.round(hrvDelta)}ms within 24 hours`;
  }

  return {
    description: prediction,
    confidence: intervention.effectiveness?.global?.score ?? null,
    timeframe: '24-48 hours'
  };
};
