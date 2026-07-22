/**
 * Generic Trigger Vocabulary (R4 T2 — DR finding 5)
 *
 * Narrative-pattern trigger phrases for Nexus layer 1 pattern detection.
 * Deliberately GENERIC: category-level triggers only, no personal names,
 * no brands, no app self-references. A per-user entity ontology (people's
 * names, specific gyms/studios, pets, etc.) is deferred to the Phase 1
 * extraction layer — see
 * docs/superpowers/plans/2026-07-22-r4-insight-integrity.md.
 *
 * This module is the ONLY source of narrative trigger data. patternDetector.js
 * imports GENERIC_TRIGGERS and defines no inline trigger arrays of its own
 * (enforced by the structural lint test in __tests__/genericTriggers.test.js).
 *
 * Matching discipline (both rules required, per pattern):
 *  1. Whole-word / whole-phrase match only, via word-boundary regex — no
 *     bare-substring matching (the old 'great' matching inside 'greater',
 *     'connected' matching inside 'disconnected', etc.).
 *  2. Minimum-context gate: the entry text must contain at least
 *     MIN_ENTRY_WORDS words before ANY narrative trigger is evaluated. A
 *     one- or two-word entry ("Great!") carries no interpretable context —
 *     it is skipped for narrative pattern detection entirely rather than
 *     scored on a bare keyword. This is deliberately simple and deterministic
 *     (a word count, not an NLP judgment call).
 *
 * Every trigger string must:
 *  - match /^[a-z ]+$/ (lowercase letters and single spaces only — no
 *    apostrophes, digits, or punctuation)
 *  - not appear in PERSONAL_TOKEN_DENYLIST
 * both enforced by __tests__/genericTriggers.test.js.
 *
 * Detection getting sparser than the old per-user literal lists is the
 * INTENDED outcome of this module (DR: 918 detections across 163 entries,
 * median 6/entry, was the overfitting bug — not a target to preserve).
 */

// ============================================================
// Matching primitives
// ============================================================

/** Minimum word count an entry must have before narrative triggers apply. */
export const MIN_ENTRY_WORDS = 5;

/** Count words in free text (whitespace-delimited, empty-safe). */
export const countWords = (text) => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

/** Does this entry text meet the minimum-context bar for trigger matching? */
export const hasMinimumContext = (text) => countWords(text) >= MIN_ENTRY_WORDS;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word/whole-phrase match of `trigger` inside `text` (case-insensitive,
 * word-boundary bounded on both ends — no bare-substring matching).
 */
export const matchesGenericTrigger = (text, trigger) => {
  if (!text || !trigger) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(trigger)}\\b`, 'i');
  return pattern.test(text);
};

// ============================================================
// Denylist — known personal tokens that must never appear as triggers
// ============================================================

/**
 * Names, brands, and app self-references previously hardcoded into this
 * engine's trigger lists (DR finding 5). Kept here as the enforcement
 * source of truth for the "no personal literals" lint test — new triggers
 * are checked against this list, not the other way around.
 */
export const PERSONAL_TOKEN_DENYLIST = [
  'spencer',
  'sterling',
  'luna',
  'kobe',
  'barrys',
  'barry',
  'engram',
  'echovault',
  'echo vault',
  'firefly',
  'databricks',
  'anthropic',
];

// ============================================================
// GENERIC_TRIGGERS — the vocabulary
// ============================================================

/**
 * Category-keyed generic narrative patterns. Structurally mirrors the old
 * NARRATIVE_PATTERNS shape ({ id, category, triggers, biometricSignature })
 * so patternDetector.js's detection loop is otherwise unchanged.
 */
export const GENERIC_TRIGGERS = {
  // Career & Work
  CAREER_ANTICIPATION: {
    id: 'career_anticipation',
    triggers: ['interview', 'job offer', 'application', 'recruiter', 'hiring process'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed' },
  },
  CAREER_WAITING: {
    id: 'career_waiting',
    triggers: ['still waiting', 'no response yet', 'following up', 'pending decision'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', strain: 'normal' },
  },
  CAREER_OUTCOME_POSITIVE: {
    id: 'career_outcome_positive',
    triggers: ['got the job', 'offer accepted', 'moving forward', 'next round'],
    category: 'career',
    biometricSignature: { mood: 'elevated', hrv: 'improved' },
  },
  CAREER_OUTCOME_NEGATIVE: {
    id: 'career_outcome_negative',
    triggers: ['got rejected', 'did not get the job', 'passed on', 'not moving forward'],
    category: 'career',
    biometricSignature: { mood: 'depressed', rhr: 'elevated', sleep: 'disrupted' },
  },

  // Relationships (generic — no names; per-user entity ontology is Phase 1)
  RELATIONSHIP_CONNECTION: {
    id: 'relationship_connection',
    triggers: ['quality time together', 'felt connected', 'meaningful conversation', 'deep conversation'],
    category: 'relationship',
    biometricSignature: { hrv: 'improved', mood: 'stabilized' },
  },
  RELATIONSHIP_STRAIN: {
    id: 'relationship_strain',
    triggers: ['had an argument', 'felt frustrated with', 'felt annoyed', 'tension between us'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', mood: 'volatile' },
  },
  CAREGIVING_CONCERN: {
    id: 'caregiving_concern',
    triggers: ['worried about them', 'checking on them', 'taking care of', 'looking after'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', mood: 'anxious' },
  },

  // Physical Activity
  EXERCISE_COMPLETION: {
    id: 'exercise_completion',
    triggers: ['went to the gym', 'did yoga', 'did pilates', 'lifted weights', 'completed a workout'],
    category: 'health',
    biometricSignature: { strain: 'elevated', nextDayRecovery: 'variable' },
  },
  EXERCISE_AVOIDANCE: {
    id: 'exercise_avoidance',
    triggers: ['skipped the workout', 'did not go', 'too tired to exercise', 'took a rest day'],
    category: 'health',
    biometricSignature: { strain: 'low', mood: 'variable' },
  },

  // Somatic Signals
  PHYSICAL_DISCOMFORT: {
    id: 'physical_discomfort',
    triggers: ['in pain', 'felt sore', 'felt tight', 'minor injury', 'body ache'],
    category: 'somatic',
    biometricSignature: { strain: 'elevated', sleep: 'disrupted' },
  },
  FATIGUE: {
    id: 'fatigue',
    triggers: ['felt tired', 'felt exhausted', 'felt drained', 'no energy', 'felt groggy'],
    category: 'somatic',
    biometricSignature: { recovery: 'low', hrv: 'depressed' },
  },

  // Emotional States
  ANXIETY_SIGNAL: {
    id: 'anxiety_signal',
    triggers: ['felt anxious', 'felt worried', 'felt nervous', 'felt stressed', 'felt overwhelmed'],
    category: 'emotional',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', sleep: 'disrupted' },
  },
  POSITIVE_MOMENTUM: {
    id: 'positive_momentum',
    triggers: ['felt happy', 'felt excited', 'felt amazing', 'felt fantastic', 'felt proud'],
    category: 'emotional',
    biometricSignature: { hrv: 'improved', recovery: 'elevated' },
  },

  // Stabilizers (generic — no pet names, no brand names)
  PET_CARE: {
    id: 'pet_care',
    triggers: ['walked the dog', 'played with the dog', 'played with the cat', 'pet grooming'],
    category: 'stabilizer',
    biometricSignature: { hrv: 'recovery', mood: 'stabilized' },
  },
  CREATIVE_ACTIVITY: {
    id: 'creative_activity',
    triggers: ['worked on a painting', 'worked on a drawing', 'started a project', 'creative project'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'stable' },
  },
  SOCIAL_CONNECTION: {
    id: 'social_connection',
    triggers: ['dinner with friends', 'hung out with friends', 'met up with friends', 'spent time with friends'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'improved' },
  },
};
