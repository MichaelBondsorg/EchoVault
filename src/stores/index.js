/**
 * Stores Index
 *
 * Central export for all Zustand stores.
 * These stores manage application state extracted from App.jsx.
 */

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

/**
 * Reset all stores (called on logout)
 */
export const resetAllStores = () => {
  const { useAuthStore } = require('./authStore');
  const { useUiStore } = require('./uiStore');
  const { useEntriesStore } = require('./entriesStore');
  const { useSafetyStore } = require('./safetyStore');
  const { useSignalsStore } = require('./signalsStore');

  useAuthStore.getState().reset();
  useUiStore.getState().reset();
  useEntriesStore.getState().reset();
  useSafetyStore.getState().reset();
  useSignalsStore.getState().reset();
};
