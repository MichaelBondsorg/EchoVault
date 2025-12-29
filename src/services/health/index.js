/**
 * Health Services - Main Export
 *
 * Cross-platform health data integration:
 * - iOS: HealthKit
 * - Android: Google Fit
 * - Web: Cached data + manual input
 */

// Unified health data service (use this for most cases)
export {
  getHealthSummary,
  getHealthHistory,
  requestHealthPermissions,
  checkHealthPermissions,
  getEntryHealthContext,
  saveManualHealthInput,
  getHealthDataStatus,
  refreshHealthCache
} from './healthDataService';

// Platform detection
export {
  detectPlatform,
  getHealthDataStrategy,
  cacheHealthData,
  getCachedHealthData,
  shouldShowHealthFeatures,
  PLATFORM_CAPABILITIES
} from './platformHealth';

// Health-mood correlation analysis
export {
  analyzeHealthMoodCorrelations
} from './healthMoodCorrelation';

// Platform-specific (typically don't need direct access)
export * as healthKit from './healthKit';
export * as googleFit from './googleFit';
