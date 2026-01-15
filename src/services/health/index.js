/**
 * Health Services - Main Export
 *
 * Cross-platform health data integration:
 * - Whoop: Cloud-to-cloud (all platforms)
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

// Whoop integration (cloud-to-cloud, works on all platforms)
export {
  isWhoopLinked,
  initiateWhoopOAuth,
  disconnectWhoop,
  handleWhoopOAuthSuccess,
  getWhoopSummary,
  getWhoopHistory,
  getWhoopRecoveryInsight,
  getWhoopStrainInsight
} from './whoop';

// Health data backfill (retroactive health context for old entries)
export {
  getEntriesWithoutHealth,
  backfillHealthData,
  getBackfillCount
} from './healthBackfill';

// Platform-specific (typically don't need direct access)
export * as healthKit from './healthKit';
export * as googleFit from './googleFit';
export * as whoop from './whoop';
