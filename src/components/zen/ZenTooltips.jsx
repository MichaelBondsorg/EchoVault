import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Storage keys for tracking tooltip state
 */
const STORAGE_KEYS = {
  FAB_TOOLTIP_SHOWN: 'zen_fab_tooltip_shown',
  CUSTOMIZE_TOOLTIP_SHOWN: 'zen_customize_tooltip_shown',
  FIRST_VISIT_TIME: 'zen_first_visit_time',
  WALKTHROUGH_COMPLETED: 'zen_walkthrough_completed',
};

/**
 * FABTooltip - Pulse and tooltip for the center FAB button
 *
 * Shows on first view of the new bottom nav to explain the entry button.
 */
export const FABTooltip = ({ onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Check if already shown
    const alreadyShown = localStorage.getItem(STORAGE_KEYS.FAB_TOOLTIP_SHOWN);
    const walkthroughDone = localStorage.getItem(STORAGE_KEYS.WALKTHROUGH_COMPLETED);

    // Only show after walkthrough is done and if not already shown
    if (walkthroughDone && !alreadyShown) {
      // Delay showing to let UI settle
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.FAB_TOOLTIP_SHOWN, 'true');
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(handleDismiss, 8000);
      return () => clearTimeout(timer);
    }
  }, [visible, handleDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
        >
          {/* Tooltip card */}
          <div className="bg-warm-800 text-white px-4 py-3 rounded-2xl shadow-lg max-w-xs relative">
            <button
              onClick={handleDismiss}
              className="absolute -top-2 -right-2 w-6 h-6 bg-warm-700 rounded-full flex items-center justify-center hover:bg-warm-600"
            >
              <X size={12} />
            </button>
            <p className="text-sm font-medium mb-1">
              Tap here to speak or write
            </p>
            <p className="text-xs text-warm-300">
              Your entry bar is now hidden to give you more room to breathe.
            </p>

            {/* Arrow pointing down to FAB */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-warm-800" />
          </div>

          {/* Pulse ring around FAB position */}
          <motion.div
            className="absolute -bottom-16 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full border-2 border-primary-400"
            animate={{
              scale: [1, 1.3, 1.3],
              opacity: [0.8, 0, 0.8],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeOut',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * CustomizeTooltip - Subtle reminder to customize the dashboard
 *
 * Shows after 48 hours if user still has only the default 2 widgets.
 */
export const CustomizeTooltip = ({ widgetCount = 2, onDismiss }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const alreadyShown = localStorage.getItem(STORAGE_KEYS.CUSTOMIZE_TOOLTIP_SHOWN);
    const walkthroughDone = localStorage.getItem(STORAGE_KEYS.WALKTHROUGH_COMPLETED);

    if (alreadyShown || !walkthroughDone) return;

    // Get first visit time
    let firstVisit = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT_TIME);
    if (!firstVisit) {
      firstVisit = Date.now().toString();
      localStorage.setItem(STORAGE_KEYS.FIRST_VISIT_TIME, firstVisit);
    }

    // Check if 48 hours have passed
    const hoursSinceFirstVisit = (Date.now() - parseInt(firstVisit)) / (1000 * 60 * 60);

    // Show if: 48+ hours passed AND still only default widgets
    if (hoursSinceFirstVisit >= 48 && widgetCount <= 2) {
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [widgetCount]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.CUSTOMIZE_TOOLTIP_SHOWN, 'true');
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  // Auto-dismiss after 10 seconds
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(handleDismiss, 10000);
      return () => clearTimeout(timer);
    }
  }, [visible, handleDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-32 left-4 right-4 z-40 flex justify-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
        >
          <div className="bg-white/90 backdrop-blur-sm border border-primary-200 px-4 py-3 rounded-2xl shadow-lg max-w-sm relative">
            <button
              onClick={handleDismiss}
              className="absolute -top-2 -right-2 w-6 h-6 bg-warm-200 rounded-full flex items-center justify-center hover:bg-warm-300 text-warm-600"
            >
              <X size={12} />
            </button>
            <p className="text-sm font-medium text-warm-800 mb-1">
              Feeling like you need more data?
            </p>
            <p className="text-xs text-warm-500">
              Add your mood trends, goals, or ongoing stories to your home screen using the Customize button below.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * useZenTooltips - Hook for managing tooltip state
 */
export const useZenTooltips = () => {
  const markWalkthroughComplete = useCallback(() => {
    localStorage.setItem(STORAGE_KEYS.WALKTHROUGH_COMPLETED, 'true');
    // Set first visit time if not set
    if (!localStorage.getItem(STORAGE_KEYS.FIRST_VISIT_TIME)) {
      localStorage.setItem(STORAGE_KEYS.FIRST_VISIT_TIME, Date.now().toString());
    }
  }, []);

  const shouldShowWalkthrough = useCallback(() => {
    return !localStorage.getItem(STORAGE_KEYS.WALKTHROUGH_COMPLETED);
  }, []);

  const resetTooltips = useCallback(() => {
    // For testing - clears all tooltip state
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }, []);

  return {
    markWalkthroughComplete,
    shouldShowWalkthrough,
    resetTooltips,
    STORAGE_KEYS,
  };
};

export default {
  FABTooltip,
  CustomizeTooltip,
  useZenTooltips,
};
