/**
 * Safety Store
 *
 * Manages safety-related state including safety plans, crisis modals,
 * and pending entries during safety flows.
 * Extracted from App.jsx to reduce complexity and improve maintainability.
 *
 * CRITICAL: This is a mental health app. Safety features are paramount.
 * Changes to this store should be reviewed carefully.
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { DEFAULT_SAFETY_PLAN } from '../config/constants';

const initialState = {
  // Safety plan (persisted)
  safetyPlan: DEFAULT_SAFETY_PLAN,

  // Crisis state (not persisted for privacy)
  crisisModal: null,
  crisisResources: null,
  pendingEntry: null
};

export const useSafetyStore = create(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // ============================================
        // SAFETY PLAN ACTIONS
        // ============================================

        /**
         * Set safety plan
         */
        setSafetyPlan: (plan) => set({ safetyPlan: plan }, false, 'safety/setSafetyPlan'),

        /**
         * Update safety plan field
         */
        updateSafetyPlanField: (field, value) => set(
          (state) => ({
            safetyPlan: { ...state.safetyPlan, [field]: value }
          }),
          false,
          'safety/updateSafetyPlanField'
        ),

        /**
         * Reset safety plan to defaults
         */
        resetSafetyPlan: () => set({ safetyPlan: DEFAULT_SAFETY_PLAN }, false, 'safety/resetSafetyPlan'),

        // ============================================
        // WARNING SIGNS ACTIONS
        // ============================================

        /**
         * Add a warning sign
         */
        addWarningSign: (sign) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              warningSignals: [...state.safetyPlan.warningSignals, sign]
            }
          }),
          false,
          'safety/addWarningSign'
        ),

        /**
         * Remove a warning sign
         */
        removeWarningSign: (index) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              warningSignals: state.safetyPlan.warningSignals.filter((_, i) => i !== index)
            }
          }),
          false,
          'safety/removeWarningSign'
        ),

        /**
         * Toggle warning signs enabled
         */
        toggleWarningSignsEnabled: () => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              warningSignsEnabled: !state.safetyPlan.warningSignsEnabled
            }
          }),
          false,
          'safety/toggleWarningSignsEnabled'
        ),

        // ============================================
        // COPING STRATEGIES ACTIONS
        // ============================================

        /**
         * Add a coping strategy
         */
        addCopingStrategy: (strategy) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              copingStrategies: [...state.safetyPlan.copingStrategies, strategy]
            }
          }),
          false,
          'safety/addCopingStrategy'
        ),

        /**
         * Remove a coping strategy
         */
        removeCopingStrategy: (index) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              copingStrategies: state.safetyPlan.copingStrategies.filter((_, i) => i !== index)
            }
          }),
          false,
          'safety/removeCopingStrategy'
        ),

        // ============================================
        // SUPPORT CONTACTS ACTIONS
        // ============================================

        /**
         * Add a support contact
         */
        addSupportContact: (contact) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              supportContacts: [...state.safetyPlan.supportContacts, contact]
            }
          }),
          false,
          'safety/addSupportContact'
        ),

        /**
         * Update a support contact
         */
        updateSupportContact: (id, updates) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              supportContacts: state.safetyPlan.supportContacts.map(c =>
                c.id === id ? { ...c, ...updates } : c
              )
            }
          }),
          false,
          'safety/updateSupportContact'
        ),

        /**
         * Remove a support contact
         */
        removeSupportContact: (id) => set(
          (state) => ({
            safetyPlan: {
              ...state.safetyPlan,
              supportContacts: state.safetyPlan.supportContacts.filter(c => c.id !== id)
            }
          }),
          false,
          'safety/removeSupportContact'
        ),

        // ============================================
        // CRISIS MODAL ACTIONS
        // ============================================

        /**
         * Show crisis modal
         */
        showCrisisModal: (data) => set({ crisisModal: data }, false, 'safety/showCrisisModal'),

        /**
         * Hide crisis modal
         */
        hideCrisisModal: () => set({ crisisModal: null }, false, 'safety/hideCrisisModal'),

        /**
         * Show crisis resources
         */
        showCrisisResources: (resources) => set({ crisisResources: resources }, false, 'safety/showCrisisResources'),

        /**
         * Hide crisis resources
         */
        hideCrisisResources: () => set({ crisisResources: null }, false, 'safety/hideCrisisResources'),

        // ============================================
        // PENDING ENTRY ACTIONS
        // ============================================

        /**
         * Set pending entry (entry awaiting safety check completion)
         */
        setPendingEntry: (entry) => set({ pendingEntry: entry }, false, 'safety/setPendingEntry'),

        /**
         * Clear pending entry
         */
        clearPendingEntry: () => set({ pendingEntry: null }, false, 'safety/clearPendingEntry'),

        /**
         * Get pending entry and clear it
         */
        consumePendingEntry: () => {
          const entry = get().pendingEntry;
          set({ pendingEntry: null }, false, 'safety/consumePendingEntry');
          return entry;
        },

        // ============================================
        // CRISIS FLOW ACTIONS
        // ============================================

        /**
         * Start crisis flow - show modal and set pending entry
         */
        startCrisisFlow: (modalData, pendingEntry) => set({
          crisisModal: modalData,
          pendingEntry
        }, false, 'safety/startCrisisFlow'),

        /**
         * End crisis flow - clear all crisis state
         */
        endCrisisFlow: () => set({
          crisisModal: null,
          crisisResources: null,
          pendingEntry: null
        }, false, 'safety/endCrisisFlow'),

        /**
         * User chose to proceed despite warning
         */
        proceedWithEntry: () => {
          const entry = get().pendingEntry;
          set({
            crisisModal: null,
            pendingEntry: null
          }, false, 'safety/proceedWithEntry');
          return entry;
        },

        /**
         * User chose to get help
         */
        getHelp: () => set({
          crisisModal: null,
          crisisResources: true,
          // Keep pendingEntry in case they want to save it after
        }, false, 'safety/getHelp'),

        // ============================================
        // UTILITY ACTIONS
        // ============================================

        /**
         * Check if in crisis flow
         */
        isInCrisisFlow: () => {
          const state = get();
          return state.crisisModal !== null || state.crisisResources !== null;
        },

        /**
         * Reset crisis state only (not safety plan)
         */
        resetCrisisState: () => set({
          crisisModal: null,
          crisisResources: null,
          pendingEntry: null
        }, false, 'safety/resetCrisisState'),

        /**
         * Full reset
         */
        reset: () => set({
          ...initialState,
          // Preserve safety plan on logout for user convenience
          safetyPlan: get().safetyPlan
        }, false, 'safety/reset')
      }),
      {
        name: 'echovault-safety-store',
        // Only persist safety plan, not crisis state
        partialize: (state) => ({ safetyPlan: state.safetyPlan })
      }
    ),
    { name: 'safety-store' }
  )
);

// Selector hooks for common patterns
export const useSafetyPlan = () => useSafetyStore((state) => state.safetyPlan);
export const useCrisisModal = () => useSafetyStore((state) => state.crisisModal);
export const useIsInCrisisFlow = () => useSafetyStore((state) =>
  state.crisisModal !== null || state.crisisResources !== null
);
