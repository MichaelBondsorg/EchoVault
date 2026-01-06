/**
 * Advanced Pattern Detection Services
 *
 * Phase 1 Implementation: Multi-factor pattern detection, sequence mining,
 * anomaly detection, and recovery analysis.
 *
 * Modules:
 * - featureExtraction: Rich feature extraction from entries
 * - associationRules: Multi-factor correlation detection (Apriori algorithm)
 * - sequencePatterns: Mood cascade and recovery sequence detection
 * - anomalyDetection: Unusual entry identification
 * - insightGenerator: Combines all patterns into actionable insights
 */

// Feature Extraction
export {
  extractFeatures,
  extractAllFeatures,
  categorizeSleep,
  calculateBaselines,
  extractEntitiesByType,
  countEntitiesByType
} from './featureExtraction';

// Association Rules (Multi-factor patterns)
export {
  mineAssociationRules,
  getConfirmedRules,
  getPendingValidationRules,
  updateRuleWithFeedback,
  formatRulesAsInsights
} from './associationRules';

// Sequence Patterns (Mood cascades, recovery)
export {
  mineSequencePatterns,
  analyzeRecoveryPatterns,
  findMoodEvents,
  extractCopingMentions
} from './sequencePatterns';

// Anomaly Detection
export {
  detectAnomalies,
  getRecentAnomalies,
  getAnomalyStats,
  formatAnomalyForUI
} from './anomalyDetection';

// Insight Generator (Main entry point)
export {
  generateAdvancedInsights,
  formatForDashboard,
  formatForChat,
  getTopInsightForNotification,
  PRIORITY_LEVELS
} from './insightGenerator';

// Default export with main functions
export default {
  // Main entry point
  generateAdvancedInsights: async (entries, options) => {
    const { generateAdvancedInsights: generate } = await import('./insightGenerator');
    return generate(entries, options);
  },

  // Individual pattern types
  mineAssociationRules: (entries, minSupport, minConfidence) => {
    const { mineAssociationRules: mine } = require('./associationRules');
    return mine(entries, minSupport, minConfidence);
  },

  mineSequencePatterns: (entries) => {
    const { mineSequencePatterns: mine } = require('./sequencePatterns');
    return mine(entries);
  },

  analyzeRecoveryPatterns: (entries) => {
    const { analyzeRecoveryPatterns: analyze } = require('./sequencePatterns');
    return analyze(entries);
  },

  detectAnomalies: (entries) => {
    const { detectAnomalies: detect } = require('./anomalyDetection');
    return detect(entries);
  }
};
