/**
 * Leadership Services - Main Export
 *
 * Work-scoped leadership and management support.
 * Only activates for entries with category === 'work'.
 */

export {
  LEADERSHIP_CONTEXTS,
  detectLeadershipContext,
  getContextLabel,
  getContextIcon
} from './leadershipDetector';

export {
  LEADERSHIP_DISTORTIONS,
  LEADERSHIP_VALUES,
  detectLeadershipDistortions,
  detectLeadershipValues,
  generateLeadershipInsight,
  getQuickSelfCareTip
} from './leadershipInsights';

export {
  THREAD_TYPES,
  createLeadershipThread,
  getActiveThreadsForPerson,
  getAllActiveThreads,
  linkFollowUpMention,
  completeThread,
  extractProgressIndicators,
  extractFeedbackTopics,
  calculateThreadHealth
} from './leadershipThreads';
