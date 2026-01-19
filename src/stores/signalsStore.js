/**
 * Signals Store
 *
 * Manages signal detection state for goals, patterns, and insights.
 * Handles the detected signals strip that appears after entry submission.
 * Extracted from App.jsx to reduce complexity and improve maintainability.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const initialState = {
  // Detected signals from recent entry
  detectedSignals: [],

  // UI state
  showDetectedStrip: false,

  // Context
  signalExtractionEntryId: null
};

export const useSignalsStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      // ============================================
      // DETECTED SIGNALS ACTIONS
      // ============================================

      /**
       * Set detected signals from entry analysis
       */
      setDetectedSignals: (signals) => set({ detectedSignals: signals }, false, 'signals/setDetectedSignals'),

      /**
       * Add detected signals (append to existing)
       */
      addDetectedSignals: (signals) => set(
        (state) => ({
          detectedSignals: [...state.detectedSignals, ...signals]
        }),
        false,
        'signals/addDetectedSignals'
      ),

      /**
       * Clear detected signals
       */
      clearDetectedSignals: () => set({
        detectedSignals: [],
        signalExtractionEntryId: null
      }, false, 'signals/clearDetectedSignals'),

      /**
       * Remove a specific signal by index
       */
      removeSignal: (index) => set(
        (state) => ({
          detectedSignals: state.detectedSignals.filter((_, i) => i !== index)
        }),
        false,
        'signals/removeSignal'
      ),

      /**
       * Remove a specific signal by ID
       */
      removeSignalById: (signalId) => set(
        (state) => ({
          detectedSignals: state.detectedSignals.filter(s => s.id !== signalId)
        }),
        false,
        'signals/removeSignalById'
      ),

      // ============================================
      // STRIP VISIBILITY ACTIONS
      // ============================================

      /**
       * Show the detected signals strip
       */
      showStrip: () => set({ showDetectedStrip: true }, false, 'signals/showStrip'),

      /**
       * Hide the detected signals strip
       */
      hideStrip: () => set({ showDetectedStrip: false }, false, 'signals/hideStrip'),

      /**
       * Toggle strip visibility
       */
      toggleStrip: () => set(
        (state) => ({ showDetectedStrip: !state.showDetectedStrip }),
        false,
        'signals/toggleStrip'
      ),

      // ============================================
      // ENTRY CONTEXT ACTIONS
      // ============================================

      /**
       * Set the entry ID that triggered signal extraction
       */
      setSignalExtractionEntryId: (entryId) => set(
        { signalExtractionEntryId: entryId },
        false,
        'signals/setSignalExtractionEntryId'
      ),

      /**
       * Clear entry context
       */
      clearSignalExtractionEntryId: () => set(
        { signalExtractionEntryId: null },
        false,
        'signals/clearSignalExtractionEntryId'
      ),

      // ============================================
      // COMPOSITE ACTIONS
      // ============================================

      /**
       * Handle new signal detection from entry submission
       */
      handleSignalDetection: (signals, entryId) => set({
        detectedSignals: signals,
        showDetectedStrip: signals.length > 0,
        signalExtractionEntryId: entryId
      }, false, 'signals/handleSignalDetection'),

      /**
       * Dismiss the signal detection strip
       */
      dismissStrip: () => set({
        showDetectedStrip: false
        // Keep detectedSignals in case user wants to see them again
      }, false, 'signals/dismissStrip'),

      /**
       * Complete signal handling (user confirmed/dismissed all)
       */
      completeSignalHandling: () => set({
        detectedSignals: [],
        showDetectedStrip: false,
        signalExtractionEntryId: null
      }, false, 'signals/completeSignalHandling'),

      // ============================================
      // SIGNAL STATUS UPDATE
      // ============================================

      /**
       * Update a signal's status (e.g., after user confirms a goal)
       */
      updateSignalStatus: (signalId, status) => set(
        (state) => ({
          detectedSignals: state.detectedSignals.map(s =>
            s.id === signalId ? { ...s, status } : s
          )
        }),
        false,
        'signals/updateSignalStatus'
      ),

      // ============================================
      // SELECTORS
      // ============================================

      /**
       * Get signals by type
       */
      getSignalsByType: (type) => get().detectedSignals.filter(s => s.type === type),

      /**
       * Get goals from detected signals
       */
      getDetectedGoals: () => get().detectedSignals.filter(s => s.type === 'goal'),

      /**
       * Get patterns from detected signals
       */
      getDetectedPatterns: () => get().detectedSignals.filter(s => s.type === 'pattern'),

      /**
       * Get insights from detected signals
       */
      getDetectedInsights: () => get().detectedSignals.filter(s => s.type === 'insight'),

      /**
       * Check if there are pending signals to show
       */
      hasPendingSignals: () => get().detectedSignals.length > 0,

      // ============================================
      // UTILITY ACTIONS
      // ============================================

      /**
       * Reset signals state
       */
      reset: () => set(initialState, false, 'signals/reset')
    }),
    { name: 'signals-store' }
  )
);

// Selector hooks for common patterns
export const useDetectedSignals = () => useSignalsStore((state) => state.detectedSignals);
export const useShowDetectedStrip = () => useSignalsStore((state) => state.showDetectedStrip);
export const useHasPendingSignals = () => useSignalsStore((state) => state.detectedSignals.length > 0);
