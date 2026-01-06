/**
 * Guided Services
 *
 * Structured journaling sessions and mindfulness exercises
 * for the AI Companion interface.
 *
 * Modules:
 * - sessions: Guided journaling sessions (morning check-in, evening reflection, etc.)
 * - mindfulness: Breathing exercises, grounding techniques, meditation
 */

// Guided Sessions
export {
  GUIDED_SESSIONS,
  PROMPT_TYPES,
  getSessionsForTimeOfDay,
  getRecommendedSessions,
  getSessionById,
  formatSessionAsEntry,
  generateDynamicPrompt
} from './sessions';

// Mindfulness Exercises
export {
  MINDFULNESS_EXERCISES,
  EXERCISE_TYPES,
  getExercisesByTag,
  getExercisesByType,
  getExercisesByDifficulty,
  getExerciseById,
  getRecommendedExercises,
  getAllExercises,
  calculateExerciseDuration,
  personalizeLovingKindness
} from './mindfulness';

// Default export
export default {
  // Sessions
  GUIDED_SESSIONS: require('./sessions').GUIDED_SESSIONS,
  PROMPT_TYPES: require('./sessions').PROMPT_TYPES,
  getSessionsForTimeOfDay: require('./sessions').getSessionsForTimeOfDay,
  getRecommendedSessions: require('./sessions').getRecommendedSessions,
  getSessionById: require('./sessions').getSessionById,
  formatSessionAsEntry: require('./sessions').formatSessionAsEntry,

  // Mindfulness
  MINDFULNESS_EXERCISES: require('./mindfulness').MINDFULNESS_EXERCISES,
  EXERCISE_TYPES: require('./mindfulness').EXERCISE_TYPES,
  getExercisesByTag: require('./mindfulness').getExercisesByTag,
  getExerciseById: require('./mindfulness').getExerciseById,
  getRecommendedExercises: require('./mindfulness').getRecommendedExercises,
  getAllExercises: require('./mindfulness').getAllExercises,
  personalizeLovingKindness: require('./mindfulness').personalizeLovingKindness
};
