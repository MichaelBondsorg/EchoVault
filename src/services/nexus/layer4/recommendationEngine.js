/**
 * Recommendation Engine — ideas-only (R4 Phase 3 T5)
 *
 * Generates a short list of generic, non-personalized activity ideas for
 * the user's current detected state.
 *
 * R4-P3 (P3-D1, docs/superpowers/plans/2026-07-23-r4-phase3-action-loop.md)
 * deleted `interventionTracker.js` whole — the mention-based per-activity
 * effectiveness tracking DR finding 7 condemned ("recommends without
 * personal evidence") — and with it, this file's personal-evidence scoring
 * (`scoreRecommendation`), personalized reasoning templates
 * (`generateReasoning`), and outcome prediction (`predictOutcome`). There is
 * no more effectiveness data anywhere in the app for this engine to cite, so
 * there is nothing left to gate behind the old `RISKY_CLAIMS_ENABLED` /
 * `context.riskyClaimsEnabled` seam (also deleted — see orchestrator.js's
 * tombstone comment). What survives is the honest part: a static
 * state -> idea-category map and generic, no-evidence-claimed wording.
 * `MIN_EVIDENCE_OCCURRENCES` (the "at least 3 tracked occurrences before
 * trusting a score" floor) is deleted too — it only ever fed
 * `scoreRecommendation`'s starting value, and there is no score left to
 * feed. An idea, by definition, makes no evidence claim, so there is
 * nothing for an evidence floor to gate.
 */

// ============================================================
// STATE -> IDEA MAP
// ============================================================

// Which generic activity ideas make sense for a given detected life state.
// Purely static; no personal evidence, no effectiveness tracking.
const STATE_INTERVENTION_MAP = {
  career_waiting: ['pet_walk', 'yoga', 'creative', 'social'],
  career_rejection: ['partner_time', 'acts_of_service', 'yoga', 'social'],
  low_mood: ['yoga', 'pet_walk', 'partner_time', 'acts_of_service'],
  high_strain: ['rest_day', 'yoga', 'sleep_focus'],
  recovery_mode: ['rest_day', 'walk', 'sleep_focus'],
  burnout_risk: ['rest_day', 'sleep_focus', 'social'],
  stable: ['gym', 'fitness_class', 'creative', 'social']
};

// Category label per idea, for display grouping only — no effectiveness
// data attached (interventionTracker.js's per-category tracking is gone).
const INTERVENTION_CATEGORY = {
  yoga: 'physical',
  fitness_class: 'physical',
  gym: 'physical',
  walk: 'physical',
  bike: 'physical',
  pet_walk: 'relational',
  partner_time: 'relational',
  social: 'relational',
  acts_of_service: 'behavioral',
  creative: 'behavioral',
  rest_day: 'recovery',
  sleep_focus: 'recovery'
};

// ============================================================
// IDEA GENERATION
// ============================================================

/**
 * Generate idea-to-try suggestions for the current state.
 * No personal evidence, no score, no confidence, no predicted outcome.
 */
export const generateRecommendations = async (_userId, context) => {
  console.log('[RecommendationEngine] Generating ideas...');

  const { currentState, timeOfDay } = context;

  const names = STATE_INTERVENTION_MAP[currentState?.primary] || STATE_INTERVENTION_MAP.stable;

  return names.slice(0, 3).map((name) => ({
    intervention: name,
    category: INTERVENTION_CATEGORY[name] || null,
    timing: suggestTiming(name, timeOfDay),
    reasoning: genericIdeaReasoning(name)
  }));
};

/**
 * Generic, non-personalized reasoning. Deliberately makes no claim about
 * the user's own history/data.
 */
const genericIdeaReasoning = (interventionName) => {
  const readable = interventionName.replace(/_/g, ' ');
  return `${capitalize(readable)} could be worth trying right now.`;
};

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
  return optimalTiming[intervention] ||
    (currentTimeOfDay === 'evening' ? 'Tomorrow when you have time' : 'Later today if possible');
};
