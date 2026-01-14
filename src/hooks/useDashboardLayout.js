import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { APP_COLLECTION_ID } from '../config/constants';

/**
 * Widget definitions for the Bento dashboard
 * Each widget has an id, type, default size, and display info
 */
export const WIDGET_DEFINITIONS = {
  hero_card: {
    id: 'hero_card',
    type: 'hero',
    name: 'Daily Greeting',
    description: 'Time-based greeting and current status',
    defaultSize: '2x1',
    icon: 'Sun',
  },
  prompt_card: {
    id: 'prompt_card',
    type: 'prompt',
    name: 'Reflection Prompts',
    description: 'Personalized questions from your entries',
    defaultSize: '2x1',
    icon: 'Sparkles',
  },
  quick_stats: {
    id: 'quick_stats',
    type: 'stats',
    name: 'Quick Stats',
    description: '7-day mood trend, streak, distribution',
    defaultSize: '2x1',
    icon: 'BarChart3',
  },
  mood_heatmap: {
    id: 'mood_heatmap',
    type: 'heatmap',
    name: '30-Day Journey',
    description: 'Visual mood calendar over 30 days',
    defaultSize: '2x1',
    icon: 'Calendar',
  },
  ongoing_stories: {
    id: 'ongoing_stories',
    type: 'stories',
    name: 'Ongoing Stories',
    description: 'Connected multi-entry situations',
    defaultSize: '2x1',
    icon: 'GitBranch',
  },
  goals: {
    id: 'goals',
    type: 'goals',
    name: 'Goals Progress',
    description: 'Track your active goals',
    defaultSize: '2x1',
    icon: 'Target',
  },
  tasks: {
    id: 'tasks',
    type: 'tasks',
    name: 'Tasks',
    description: 'Your pending action items',
    defaultSize: '1x1',
    icon: 'CheckSquare',
  },
  nexus_insights: {
    id: 'nexus_insights',
    type: 'nexus',
    name: 'AI Insights',
    description: 'Personalized patterns and recommendations',
    defaultSize: '2x1',
    icon: 'Sparkles',
  },
};

/**
 * Default layout for new users (minimalist Zen approach)
 * Only shows Hero and Prompts cards by default
 */
export const DEFAULT_DASHBOARD_LAYOUT = [
  { id: 'hero_card', type: 'hero', size: '2x1' },
  { id: 'prompt_card', type: 'prompt', size: '2x1' },
];

/**
 * All available widgets that users can add
 */
export const ALL_AVAILABLE_WIDGETS = Object.keys(WIDGET_DEFINITIONS);

/**
 * useDashboardLayout - Hook for managing customizable Bento dashboard
 *
 * @param {string} userId - Firebase user ID
 * @returns {Object} Dashboard layout state and actions
 */
export function useDashboardLayout(userId) {
  const [layout, setLayout] = useState(DEFAULT_DASHBOARD_LAYOUT);
  const [availableWidgets, setAvailableWidgets] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [error, setError] = useState(null);

  // Calculate which widgets are available to add (not in current layout)
  useEffect(() => {
    const currentWidgetIds = layout.map(w => w.id);
    const available = ALL_AVAILABLE_WIDGETS.filter(id => !currentWidgetIds.includes(id));
    setAvailableWidgets(available);
  }, [layout]);

  // Load user's dashboard preferences from Firestore
  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    const preferencesRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'preferences',
      'dashboard'
    );

    // Real-time listener for layout changes
    const unsubscribe = onSnapshot(
      preferencesRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          if (data.layout && Array.isArray(data.layout)) {
            setLayout(data.layout);
          }
        } else {
          // New user - use default layout and save it
          setLayout(DEFAULT_DASHBOARD_LAYOUT);
          // Don't save yet - let them use the default first
        }
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[useDashboardLayout] Error loading preferences:', err);
        setError(err.message);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  /**
   * Save layout to Firestore
   */
  const saveLayout = useCallback(async (newLayout) => {
    if (!userId) return;

    const preferencesRef = doc(
      db,
      'artifacts',
      APP_COLLECTION_ID,
      'users',
      userId,
      'preferences',
      'dashboard'
    );

    try {
      await setDoc(preferencesRef, {
        layout: newLayout,
        updatedAt: new Date(),
      }, { merge: true });
      console.log('[useDashboardLayout] Layout saved');
    } catch (err) {
      console.error('[useDashboardLayout] Error saving layout:', err);
      setError(err.message);
    }
  }, [userId]);

  /**
   * Add a widget to the dashboard
   * @param {string} widgetId - Widget ID to add
   * @param {string} size - Optional size override (default from widget definition)
   */
  const addWidget = useCallback(async (widgetId, size) => {
    const widgetDef = WIDGET_DEFINITIONS[widgetId];
    if (!widgetDef) {
      console.error('[useDashboardLayout] Unknown widget:', widgetId);
      return;
    }

    // Check if already in layout
    if (layout.some(w => w.id === widgetId)) {
      console.log('[useDashboardLayout] Widget already in layout:', widgetId);
      return;
    }

    const newWidget = {
      id: widgetId,
      type: widgetDef.type,
      size: size || widgetDef.defaultSize,
    };

    const newLayout = [...layout, newWidget];
    setLayout(newLayout);
    await saveLayout(newLayout);
  }, [layout, saveLayout]);

  /**
   * Remove a widget from the dashboard
   * @param {string} widgetId - Widget ID to remove
   */
  const removeWidget = useCallback(async (widgetId) => {
    // Don't allow removing all widgets
    if (layout.length <= 1) {
      console.log('[useDashboardLayout] Cannot remove last widget');
      return;
    }

    const newLayout = layout.filter(w => w.id !== widgetId);
    setLayout(newLayout);
    await saveLayout(newLayout);
  }, [layout, saveLayout]);

  /**
   * Reorder widgets in the dashboard
   * @param {number} fromIndex - Source index
   * @param {number} toIndex - Destination index
   */
  const reorderWidgets = useCallback(async (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;

    const newLayout = [...layout];
    const [removed] = newLayout.splice(fromIndex, 1);
    newLayout.splice(toIndex, 0, removed);

    setLayout(newLayout);
    await saveLayout(newLayout);
  }, [layout, saveLayout]);

  /**
   * Update a widget's size
   * @param {string} widgetId - Widget ID to update
   * @param {string} newSize - New size ('1x1', '2x1', '2x2')
   */
  const updateWidgetSize = useCallback(async (widgetId, newSize) => {
    const newLayout = layout.map(w =>
      w.id === widgetId ? { ...w, size: newSize } : w
    );
    setLayout(newLayout);
    await saveLayout(newLayout);
  }, [layout, saveLayout]);

  /**
   * Reset to default layout
   */
  const resetLayout = useCallback(async () => {
    setLayout(DEFAULT_DASHBOARD_LAYOUT);
    await saveLayout(DEFAULT_DASHBOARD_LAYOUT);
  }, [saveLayout]);

  /**
   * Toggle edit mode
   */
  const toggleEditMode = useCallback(() => {
    setIsEditMode(prev => !prev);
  }, []);

  /**
   * Exit edit mode
   */
  const exitEditMode = useCallback(() => {
    setIsEditMode(false);
  }, []);

  return {
    // State
    layout,
    availableWidgets,
    isLoading,
    isEditMode,
    error,

    // Widget definitions
    widgetDefinitions: WIDGET_DEFINITIONS,

    // Actions
    addWidget,
    removeWidget,
    reorderWidgets,
    updateWidgetSize,
    resetLayout,
    toggleEditMode,
    exitEditMode,
  };
}

export default useDashboardLayout;
