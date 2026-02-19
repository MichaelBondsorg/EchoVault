/**
 * UI Store
 *
 * Manages UI state including views, modals, and panels.
 * Extracted from App.jsx to reduce complexity and improve maintainability.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * @typedef {'feed' | 'dashboard' | 'insights' | 'settings' | 'reports' | 'report-detail'} ViewType
 */

const initialState = {
  // Navigation
  view: 'feed',
  category: 'personal',

  // Modal states
  showDecompression: false,
  showSafetyPlan: false,
  showExport: false,
  showInsights: false,
  showJournal: false,
  showHealthSettings: false,
  showNexusSettings: false,
  showEntityManagement: false,
  showQuickLog: false,

  // Complex modal data
  dailySummaryModal: null,
  entryInsightsPopup: null
};

export const useUiStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      // ============================================
      // NAVIGATION ACTIONS
      // ============================================

      /**
       * Set the current view
       */
      setView: (view) => set({ view }, false, 'ui/setView'),

      /**
       * Set the category filter
       */
      setCategory: (category) => set({ category }, false, 'ui/setCategory'),

      /**
       * Navigate to feed view
       */
      goToFeed: () => set({ view: 'feed' }, false, 'ui/goToFeed'),

      /**
       * Navigate to dashboard view
       */
      goToDashboard: () => set({ view: 'dashboard' }, false, 'ui/goToDashboard'),

      // ============================================
      // SIMPLE MODAL TOGGLES
      // ============================================

      // Decompression
      showDecompressionModal: () => set({ showDecompression: true }, false, 'ui/showDecompression'),
      hideDecompressionModal: () => set({ showDecompression: false }, false, 'ui/hideDecompression'),
      toggleDecompression: () => set(
        (state) => ({ showDecompression: !state.showDecompression }),
        false,
        'ui/toggleDecompression'
      ),

      // Safety Plan
      showSafetyPlanModal: () => set({ showSafetyPlan: true }, false, 'ui/showSafetyPlan'),
      hideSafetyPlanModal: () => set({ showSafetyPlan: false }, false, 'ui/hideSafetyPlan'),
      toggleSafetyPlan: () => set(
        (state) => ({ showSafetyPlan: !state.showSafetyPlan }),
        false,
        'ui/toggleSafetyPlan'
      ),

      // Export
      showExportModal: () => set({ showExport: true }, false, 'ui/showExport'),
      hideExportModal: () => set({ showExport: false }, false, 'ui/hideExport'),
      toggleExport: () => set(
        (state) => ({ showExport: !state.showExport }),
        false,
        'ui/toggleExport'
      ),

      // Insights Panel
      showInsightsPanel: () => set({ showInsights: true }, false, 'ui/showInsights'),
      hideInsightsPanel: () => set({ showInsights: false }, false, 'ui/hideInsights'),
      toggleInsights: () => set(
        (state) => ({ showInsights: !state.showInsights }),
        false,
        'ui/toggleInsights'
      ),

      // Journal Screen
      showJournalScreen: () => set({ showJournal: true }, false, 'ui/showJournal'),
      hideJournalScreen: () => set({ showJournal: false }, false, 'ui/hideJournal'),
      toggleJournal: () => set(
        (state) => ({ showJournal: !state.showJournal }),
        false,
        'ui/toggleJournal'
      ),

      // Health Settings
      showHealthSettingsScreen: () => set({ showHealthSettings: true }, false, 'ui/showHealthSettings'),
      hideHealthSettingsScreen: () => set({ showHealthSettings: false }, false, 'ui/hideHealthSettings'),
      toggleHealthSettings: () => set(
        (state) => ({ showHealthSettings: !state.showHealthSettings }),
        false,
        'ui/toggleHealthSettings'
      ),

      // Nexus Settings
      showNexusSettingsScreen: () => set({ showNexusSettings: true }, false, 'ui/showNexusSettings'),
      hideNexusSettingsScreen: () => set({ showNexusSettings: false }, false, 'ui/hideNexusSettings'),
      toggleNexusSettings: () => set(
        (state) => ({ showNexusSettings: !state.showNexusSettings }),
        false,
        'ui/toggleNexusSettings'
      ),

      // Entity Management
      showEntityManagementScreen: () => set({ showEntityManagement: true }, false, 'ui/showEntityManagement'),
      hideEntityManagementScreen: () => set({ showEntityManagement: false }, false, 'ui/hideEntityManagement'),
      toggleEntityManagement: () => set(
        (state) => ({ showEntityManagement: !state.showEntityManagement }),
        false,
        'ui/toggleEntityManagement'
      ),

      // Quick Log
      showQuickLogModal: () => set({ showQuickLog: true }, false, 'ui/showQuickLog'),
      hideQuickLogModal: () => set({ showQuickLog: false }, false, 'ui/hideQuickLog'),
      toggleQuickLog: () => set(
        (state) => ({ showQuickLog: !state.showQuickLog }),
        false,
        'ui/toggleQuickLog'
      ),

      // ============================================
      // COMPLEX MODAL DATA ACTIONS
      // ============================================

      /**
       * Show daily summary modal with date
       */
      openDailySummary: (data) => set({ dailySummaryModal: data }, false, 'ui/openDailySummary'),
      closeDailySummary: () => set({ dailySummaryModal: null }, false, 'ui/closeDailySummary'),

      /**
       * Show entry insights popup
       */
      openEntryInsights: (data) => set({ entryInsightsPopup: data }, false, 'ui/openEntryInsights'),
      closeEntryInsights: () => set({ entryInsightsPopup: null }, false, 'ui/closeEntryInsights'),

      // ============================================
      // UTILITY ACTIONS
      // ============================================

      /**
       * Close all modals
       */
      closeAllModals: () => set({
        showDecompression: false,
        showSafetyPlan: false,
        showExport: false,
        showInsights: false,
        showJournal: false,
        showHealthSettings: false,
        showNexusSettings: false,
        showEntityManagement: false,
        showQuickLog: false,
        dailySummaryModal: null,
        entryInsightsPopup: null
      }, false, 'ui/closeAllModals'),

      /**
       * Check if any modal is open
       */
      isAnyModalOpen: () => {
        const state = get();
        return state.showDecompression ||
          state.showSafetyPlan ||
          state.showExport ||
          state.showInsights ||
          state.showJournal ||
          state.showHealthSettings ||
          state.showNexusSettings ||
          state.showEntityManagement ||
          state.showQuickLog ||
          state.dailySummaryModal !== null ||
          state.entryInsightsPopup !== null;
      },

      /**
       * Reset UI state
       */
      reset: () => set(initialState, false, 'ui/reset')
    }),
    { name: 'ui-store' }
  )
);

// Selector hooks for common patterns
export const useView = () => useUiStore((state) => state.view);
export const useCategory = () => useUiStore((state) => state.category);
