/**
 * Stores Index
 *
 * Central export for all Zustand stores.
 * These stores manage application state extracted from App.jsx.
 */

import { useAuthStore } from './authStore';
import { useUiStore } from './uiStore';
import { useEntriesStore } from './entriesStore';
import { useSafetyStore } from './safetyStore';
import { useSignalsStore } from './signalsStore';
import { useReportsStore } from './reportsStore';

// Auth store - user authentication and login state
export {
  useAuthStore,
  useUser,
  useIsAuthenticated,
  useAuthLoading,
  useAuthError
} from './authStore';

// UI store - views, modals, and navigation
export {
  useUiStore,
  useView,
  useCategory
} from './uiStore';

// Entries store - journal entries and processing
export {
  useEntriesStore,
  useEntries,
  useProcessing,
  useOfflineQueue,
  useEntryPreferredMode
} from './entriesStore';

// Safety store - safety plans and crisis handling
export {
  useSafetyStore,
  useSafetyPlan,
  useCrisisModal,
  useIsInCrisisFlow
} from './safetyStore';

// Signals store - goal/pattern/insight detection
export {
  useSignalsStore,
  useDetectedSignals,
  useShowDetectedStrip,
  useHasPendingSignals
} from './signalsStore';

// Reports store - periodic life reports
export {
  useReportsStore,
  useReports,
  useActiveReport,
  useReportsLoading,
  useExportProgress
} from './reportsStore';

/**
 * Reset all stores (called on logout)
 */
export const resetAllStores = () => {
  useAuthStore.getState().reset();
  useUiStore.getState().reset();
  useEntriesStore.getState().reset();
  useSafetyStore.getState().reset();
  useSignalsStore.getState().reset();
  useReportsStore.getState().reset();
};
