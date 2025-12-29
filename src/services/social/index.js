/**
 * Social Services - Main Export
 *
 * Social connection tracking and nudges to support resilience.
 * Research shows that maintaining personal connections is one of
 * the strongest predictors of mental health and burnout prevention.
 */

// Main social tracking service
export {
  extractPersonMentions,
  analyzeSocialHealth,
  findNeglectedConnections,
  getSocialQuickActions,
  recordSocialAction,
  getSocialTimeline,
  SOCIAL_THRESHOLDS
} from './socialTracker';

// Relationship categorization
export {
  categorizeRelationship,
  categorizeAllRelationships,
  getUserRelationshipPreferences,
  saveRelationshipCategory,
  RELATIONSHIP_PATTERNS
} from './relationshipCategorizer';

// Connection nudges
export {
  generateConnectionNudge,
  getSocialPrompt,
  getSocialMicroActions,
  isGoodTimeForNudge,
  NUDGE_TIMING
} from './connectionNudges';
