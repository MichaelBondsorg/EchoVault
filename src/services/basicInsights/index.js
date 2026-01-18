/**
 * Basic Insights Module
 *
 * Standalone insights system that generates simple correlation-based insights
 * without LLM calls. Fast, cheap, and predictable.
 *
 * Usage:
 * ```javascript
 * import { generateBasicInsights, getCachedBasicInsights } from './services/basicInsights';
 *
 * // Generate insights
 * const result = await generateBasicInsights(userId, entries);
 *
 * // Get cached insights
 * const cached = await getCachedBasicInsights(userId);
 * ```
 */

// Main orchestrator exports
export {
  generateBasicInsights,
  getCachedBasicInsights,
  checkDataSufficiency
} from './basicInsightsOrchestrator';

// Individual correlation modules (for direct access if needed)
export { computeActivityCorrelations, getTopActivityInsight } from './correlations/activityCorrelations';
export { computePeopleCorrelations, getTopPeopleInsight } from './correlations/peopleCorrelations';
export { computeTimeCorrelations, getTopTimeInsight } from './correlations/timeCorrelations';

// Utilities
export {
  average,
  median,
  stdDev,
  pearsonCorrelation,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
} from './utils/statisticalHelpers';

// Configuration
export {
  THRESHOLDS,
  CATEGORIES,
  ACTIVITY_PATTERNS,
  PEOPLE_PATTERNS,
  TIME_GROUPS
} from './utils/thresholds';

// Default export
export { default } from './basicInsightsOrchestrator';
