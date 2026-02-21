import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Heart, Sun, TrendingUp, Sparkles, CheckCircle, Lightbulb } from 'lucide-react';

/**
 * WhatsNewModal - Shows new features to users after an update
 *
 * Displays once per feature version, tracked via localStorage
 */

// Increment this when adding new features to show the modal again
const FEATURE_VERSION = '2.2.0';
const STORAGE_KEY = 'engram.lastSeenVersion';

const WhatsNewModal = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Check if user has seen this version
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== FEATURE_VERSION) {
      // Small delay so it doesn't appear immediately on load
      const timer = setTimeout(() => setIsOpen(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, FEATURE_VERSION);
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleDismiss}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-md bg-white dark:bg-hearth-900 rounded-3xl overflow-hidden shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header with gradient */}
            <div className="bg-gradient-to-br from-terra-400 via-honey-400 to-honey-500 dark:from-terra-700/60 dark:via-honey-700/60 dark:to-honey-800/60 px-6 py-8 text-white relative overflow-hidden">
              {/* Decorative circles */}
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
              <div className="absolute -bottom-5 -left-5 w-24 h-24 bg-white/10 rounded-full" />

              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={20} />
                  <span className="text-sm font-medium text-white/80">What's New</span>
                </div>
                <h2 className="font-display text-2xl font-bold">
                  Health & Environment Insights
                </h2>
                <p className="text-white/80 text-sm mt-1">
                  Discover how your body and surroundings affect your mood
                </p>
              </div>
            </div>

            {/* Features */}
            <div className="p-6 space-y-4">
              {/* Feature 1 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <Heart size={24} className="text-red-500 dark:text-red-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800 dark:text-warm-200">Health-Mood Correlations</h3>
                  <p className="text-sm text-warm-600 dark:text-warm-400">
                    See how sleep, exercise, and recovery affect your emotional wellbeing with personalized insights.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-honey-100 dark:bg-honey-900/30 flex items-center justify-center flex-shrink-0">
                  <Sun size={24} className="text-honey-600 dark:text-honey-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800 dark:text-warm-200">Weather & Light Tracking</h3>
                  <p className="text-sm text-warm-600 dark:text-warm-400">
                    Automatic weather data with each entry. Backfill past entries in Settings → Health.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-lavender-100 dark:bg-lavender-900/30 flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={24} className="text-lavender-600 dark:text-lavender-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800 dark:text-warm-200">Pattern Discovery</h3>
                  <p className="text-sm text-warm-600 dark:text-warm-400">
                    View your patterns in the Insights tab—see what helps you feel your best.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-sage-100 dark:bg-sage-900/30 flex items-center justify-center flex-shrink-0">
                  <Lightbulb size={24} className="text-sage-600 dark:text-sage-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800 dark:text-warm-200">Smart Recommendations</h3>
                  <p className="text-sm text-warm-600 dark:text-warm-400">
                    Get daily suggestions based on your health data and what's worked for you before.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <button
                onClick={handleDismiss}
                className="w-full py-3 px-4 bg-gradient-to-r from-terra-500 to-honey-500 dark:from-terra-600 dark:to-honey-600 text-white rounded-xl
                  hover:from-terra-600 hover:to-honey-600 dark:hover:from-terra-500 dark:hover:to-honey-500 transition-colors font-medium
                  flex items-center justify-center gap-2"
              >
                <CheckCircle size={18} />
                Got it!
              </button>
              <p className="text-center text-xs text-warm-400 mt-3">
                Connect health data in Settings → Health
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WhatsNewModal;
