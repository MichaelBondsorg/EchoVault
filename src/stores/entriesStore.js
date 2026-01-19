/**
 * Entries Store
 *
 * Manages journal entries state including entries list, processing state,
 * offline queue, and entry submission context.
 * Extracted from App.jsx to reduce complexity and improve maintainability.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * @typedef {'voice' | 'text'} EntryMode
 */

const initialState = {
  // Core entries
  entries: [],

  // Processing state
  processing: false,
  processingEntryId: null,

  // Entry context
  replyContext: null,
  entryPreferredMode: 'text',

  // Offline support
  offlineQueue: [],

  // Background processing
  retrofitProgress: null
};

export const useEntriesStore = create(
  devtools(
    (set, get) => ({
      ...initialState,

      // ============================================
      // ENTRIES CRUD ACTIONS
      // ============================================

      /**
       * Set entries (usually from Firestore snapshot)
       */
      setEntries: (entries) => set({ entries }, false, 'entries/setEntries'),

      /**
       * Add a single entry
       */
      addEntry: (entry) => set(
        (state) => ({ entries: [entry, ...state.entries] }),
        false,
        'entries/addEntry'
      ),

      /**
       * Update an entry by ID
       */
      updateEntry: (entryId, updates) => set(
        (state) => ({
          entries: state.entries.map(e =>
            e.id === entryId ? { ...e, ...updates } : e
          )
        }),
        false,
        'entries/updateEntry'
      ),

      /**
       * Remove an entry by ID
       */
      removeEntry: (entryId) => set(
        (state) => ({
          entries: state.entries.filter(e => e.id !== entryId)
        }),
        false,
        'entries/removeEntry'
      ),

      /**
       * Clear all entries (used on logout)
       */
      clearEntries: () => set({ entries: [] }, false, 'entries/clearEntries'),

      // ============================================
      // PROCESSING STATE ACTIONS
      // ============================================

      /**
       * Set processing state
       */
      setProcessing: (processing, entryId = null) => set({
        processing,
        processingEntryId: processing ? entryId : null
      }, false, 'entries/setProcessing'),

      /**
       * Start processing an entry
       */
      startProcessing: (entryId = null) => set({
        processing: true,
        processingEntryId: entryId
      }, false, 'entries/startProcessing'),

      /**
       * Stop processing
       */
      stopProcessing: () => set({
        processing: false,
        processingEntryId: null
      }, false, 'entries/stopProcessing'),

      // ============================================
      // REPLY CONTEXT ACTIONS
      // ============================================

      /**
       * Set reply context (for contextual replies)
       */
      setReplyContext: (context) => set({ replyContext: context }, false, 'entries/setReplyContext'),

      /**
       * Clear reply context
       */
      clearReplyContext: () => set({ replyContext: null }, false, 'entries/clearReplyContext'),

      // ============================================
      // ENTRY MODE ACTIONS
      // ============================================

      /**
       * Set preferred entry mode (voice or text)
       */
      setEntryPreferredMode: (mode) => set({ entryPreferredMode: mode }, false, 'entries/setEntryPreferredMode'),

      /**
       * Toggle between voice and text mode
       */
      toggleEntryMode: () => set(
        (state) => ({
          entryPreferredMode: state.entryPreferredMode === 'voice' ? 'text' : 'voice'
        }),
        false,
        'entries/toggleEntryMode'
      ),

      // ============================================
      // OFFLINE QUEUE ACTIONS
      // ============================================

      /**
       * Set offline queue
       */
      setOfflineQueue: (queue) => set({ offlineQueue: queue }, false, 'entries/setOfflineQueue'),

      /**
       * Add entry to offline queue
       */
      addToOfflineQueue: (entry) => set(
        (state) => ({ offlineQueue: [...state.offlineQueue, entry] }),
        false,
        'entries/addToOfflineQueue'
      ),

      /**
       * Remove entry from offline queue
       */
      removeFromOfflineQueue: (offlineId) => set(
        (state) => ({
          offlineQueue: state.offlineQueue.filter(e => e.offlineId !== offlineId)
        }),
        false,
        'entries/removeFromOfflineQueue'
      ),

      /**
       * Clear offline queue
       */
      clearOfflineQueue: () => set({ offlineQueue: [] }, false, 'entries/clearOfflineQueue'),

      // ============================================
      // RETROFIT PROGRESS ACTIONS
      // ============================================

      /**
       * Set retrofit progress
       */
      setRetrofitProgress: (progress) => set({ retrofitProgress: progress }, false, 'entries/setRetrofitProgress'),

      /**
       * Clear retrofit progress
       */
      clearRetrofitProgress: () => set({ retrofitProgress: null }, false, 'entries/clearRetrofitProgress'),

      // ============================================
      // SELECTOR HELPERS
      // ============================================

      /**
       * Get entries count
       */
      getEntriesCount: () => get().entries.length,

      /**
       * Get recent entries
       */
      getRecentEntries: (count = 5) => get().entries.slice(0, count),

      /**
       * Get entries by category
       */
      getEntriesByCategory: (category) =>
        get().entries.filter(e => e.category === category),

      /**
       * Get entries for a date
       */
      getEntriesForDate: (dateString) =>
        get().entries.filter(e => {
          const entryDate = e.effectiveDate?.toDate?.() || e.createdAt?.toDate?.() || new Date();
          return entryDate.toISOString().split('T')[0] === dateString;
        }),

      // ============================================
      // UTILITY ACTIONS
      // ============================================

      /**
       * Reset entries state
       */
      reset: () => set(initialState, false, 'entries/reset')
    }),
    { name: 'entries-store' }
  )
);

// Selector hooks for common patterns
export const useEntries = () => useEntriesStore((state) => state.entries);
export const useProcessing = () => useEntriesStore((state) => state.processing);
export const useOfflineQueue = () => useEntriesStore((state) => state.offlineQueue);
export const useEntryPreferredMode = () => useEntriesStore((state) => state.entryPreferredMode);
