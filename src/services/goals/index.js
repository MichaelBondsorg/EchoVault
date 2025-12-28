/**
 * Goals Service
 *
 * Re-exports goal lifecycle functionality for easier imports.
 */

export {
  processEntryForGoals,
  detectsTerminationLanguage,
  detectsAchievementLanguage,
  detectsProgressLanguage,
  proposeNewGoal,
  confirmGoal,
  achieveGoal,
  terminateGoal,
  pauseGoal,
  resumeGoal,
  recordGoalProgress,
  getAllGoalsWithState,
  getProposedGoals,
  getInactiveGoals
} from './goalLifecycle';

export { default } from './goalLifecycle';
