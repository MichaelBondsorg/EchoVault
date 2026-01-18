/**
 * Lazy-loaded Components
 *
 * This file provides lazy-loaded versions of heavy components
 * to enable code splitting and reduce initial bundle size.
 *
 * Usage:
 *   import { LazyHealthSettingsScreen, LazyJournalScreen } from './components/lazy';
 *   <Suspense fallback={<BreathingLoader />}>
 *     <LazyHealthSettingsScreen {...props} />
 *   </Suspense>
 */

import React, { lazy, Suspense } from 'react';
import { BreathingLoader } from './ui';

// Default loading fallback
const LoadingFallback = () => (
  <div className="flex items-center justify-center min-h-[200px]">
    <BreathingLoader size="md" label="Loading..." />
  </div>
);

// ============================================
// Lazy-loaded Screens
// ============================================

export const LazyHealthSettingsScreen = lazy(() =>
  import('./screens/HealthSettingsScreen').then(module => ({
    default: module.default || module.HealthSettingsScreen
  }))
);

export const LazyJournalScreen = lazy(() =>
  import('./screens/JournalScreen').then(module => ({
    default: module.default || module.JournalScreen
  }))
);

export const LazyTherapistExportScreen = lazy(() =>
  import('./screens/TherapistExportScreen').then(module => ({
    default: module.default || module.TherapistExportScreen
  }))
);

export const LazySafetyPlanScreen = lazy(() =>
  import('./screens/SafetyPlanScreen').then(module => ({
    default: module.default || module.SafetyPlanScreen
  }))
);

export const LazyCrisisResourcesScreen = lazy(() =>
  import('./screens/CrisisResourcesScreen').then(module => ({
    default: module.default || module.CrisisResourcesScreen
  }))
);

export const LazyDecompressionScreen = lazy(() =>
  import('./screens/DecompressionScreen').then(module => ({
    default: module.default || module.DecompressionScreen
  }))
);

// ============================================
// Lazy-loaded Pages
// ============================================

export const LazyEntityManagementPage = lazy(() =>
  import('../pages/EntityManagementPage')
);

// ============================================
// Lazy-loaded Settings
// ============================================

export const LazyNexusSettings = lazy(() =>
  import('./settings/NexusSettings')
);

// ============================================
// Lazy-loaded Modals (Heavy)
// ============================================

export const LazyWeeklyReport = lazy(() =>
  import('./modals/WeeklyReport').then(module => ({
    default: module.default || module.WeeklyReport
  }))
);

export const LazyInsightsPanel = lazy(() =>
  import('./modals/InsightsPanel').then(module => ({
    default: module.default || module.InsightsPanel
  }))
);

// ============================================
// Suspense Wrapper Component
// ============================================

/**
 * Wraps a lazy-loaded component with Suspense
 * @param {React.ComponentType} LazyComponent - The lazy-loaded component
 * @param {React.ReactNode} fallback - Custom fallback (optional)
 */
export function withSuspense(LazyComponent, fallback = <LoadingFallback />) {
  return function SuspenseWrapper(props) {
    return (
      <Suspense fallback={fallback}>
        <LazyComponent {...props} />
      </Suspense>
    );
  };
}

// Pre-wrapped versions for convenience
export const HealthSettingsScreenWithSuspense = withSuspense(LazyHealthSettingsScreen);
export const JournalScreenWithSuspense = withSuspense(LazyJournalScreen);
export const TherapistExportScreenWithSuspense = withSuspense(LazyTherapistExportScreen);
export const SafetyPlanScreenWithSuspense = withSuspense(LazySafetyPlanScreen);
export const CrisisResourcesScreenWithSuspense = withSuspense(LazyCrisisResourcesScreen);
export const DecompressionScreenWithSuspense = withSuspense(LazyDecompressionScreen);
export const EntityManagementPageWithSuspense = withSuspense(LazyEntityManagementPage);
export const NexusSettingsWithSuspense = withSuspense(LazyNexusSettings);
export const WeeklyReportWithSuspense = withSuspense(LazyWeeklyReport);
export const InsightsPanelWithSuspense = withSuspense(LazyInsightsPanel);

export { LoadingFallback };
