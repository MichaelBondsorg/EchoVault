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

export const LazyStreakCelebration = lazy(() =>
  import('./screens/StreakCelebration').then(module => ({
    default: module.default || module.StreakCelebration
  }))
);

// ============================================
// Lazy-loaded Pages
// ============================================

export const LazyEntityManagementPage = lazy(() =>
  import('../pages/EntityManagementPage')
);

export const LazyReportList = lazy(() =>
  import('./reports/ReportList')
);

export const LazyReportViewer = lazy(() =>
  import('./reports/ReportViewer')
);

// PERF-01: route-level split for the /insights and /settings tabs
// (react-router routes rendered in components/zen/AppLayout.jsx). Both are
// imported directly from their source files — never through `../pages`'s
// barrel — so the barrel re-export doesn't drag InsightsPage/SettingsPage's
// weight back into whichever module eagerly imports HomePage/JournalPage.
// InsightsPage.jsx is ~2,450 lines (the review's "insights-heavy views"
// candidate) and is only reachable by navigating to the Insights tab, never
// during cold launch/capture. SettingsPage.jsx (~750 lines) is likewise a
// secondary tab, not the capture-ready path.
export const LazyInsightsPage = lazy(() =>
  import('../pages/InsightsPage')
);

export const LazySettingsPage = lazy(() =>
  import('../pages/SettingsPage')
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
// Lazy-loaded Chat (Heavy — ~1,200 lines, only shown when the AI companion opens)
// ============================================

export const LazyUnifiedConversation = lazy(() =>
  import('./chat/UnifiedConversation').then(module => ({
    default: module.default || module.UnifiedConversation
  }))
);

// ============================================
// Lazy-loaded flag-gated overlays (PERF-01)
//
// Every one of these is mounted in components/zen/AppLayout.jsx behind
// BOTH a feature flag (all default OFF per PROJECT_STATUS — see repo
// CLAUDE.md's "R2"/"R3" flag notes) AND a `showX` boolean, so today they
// render for nobody, yet their source was still being pulled into the main
// entry chunk on every cold launch as a static import. ExperimentsScreen is
// the review's explicitly named heavy candidate (~1,420 lines); the other
// three are the same shape (reflection/insight overlays gated the same
// way) and were split together for consistency and equal payoff.
// ============================================

export const LazyExperimentsScreen = lazy(() =>
  import('./experiments/ExperimentsScreen')
);

export const LazyRecipesScreen = lazy(() =>
  import('./reflections/RecipesScreen')
);

export const LazySessionPrepScreen = lazy(() =>
  import('./reflections/SessionPrepScreen')
);

export const LazyInsightControlCenter = lazy(() =>
  import('./insights/InsightControlCenter')
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
export const StreakCelebrationWithSuspense = withSuspense(LazyStreakCelebration);
export const EntityManagementPageWithSuspense = withSuspense(LazyEntityManagementPage);
export const NexusSettingsWithSuspense = withSuspense(LazyNexusSettings);
export const WeeklyReportWithSuspense = withSuspense(LazyWeeklyReport);
export const InsightsPanelWithSuspense = withSuspense(LazyInsightsPanel);
export const ReportListWithSuspense = withSuspense(LazyReportList);
export const ReportViewerWithSuspense = withSuspense(LazyReportViewer);
export const UnifiedConversationWithSuspense = withSuspense(LazyUnifiedConversation);
export const InsightsPageWithSuspense = withSuspense(LazyInsightsPage);
export const SettingsPageWithSuspense = withSuspense(LazySettingsPage);
export const ExperimentsScreenWithSuspense = withSuspense(LazyExperimentsScreen);
export const RecipesScreenWithSuspense = withSuspense(LazyRecipesScreen);
export const SessionPrepScreenWithSuspense = withSuspense(LazySessionPrepScreen);
export const InsightControlCenterWithSuspense = withSuspense(LazyInsightControlCenter);

export { LoadingFallback };
