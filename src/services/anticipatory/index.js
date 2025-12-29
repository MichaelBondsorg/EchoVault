/**
 * Anticipatory Anxiety Services - Main Export
 *
 * Services for detecting and supporting anticipatory anxiety,
 * with CBT loop closure through follow-up reflections.
 */

export {
  getUpcomingStressfulEvents,
  estimateAnxietyLevel,
  recommendGroundingTool,
  formatEventForDisplay,
  shouldShowAnticipatorySupport,
  STRESSFUL_EVENT_KEYWORDS
} from './futureEventMonitor';

export {
  saveMorningCheckIn,
  getMorningCheckIn,
  checkForPendingFollowUps,
  recordEventReflection,
  getAnxietyAccuracyPatterns
} from './eventFollowUp';
