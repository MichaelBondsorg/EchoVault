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
            className="relative w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header with gradient */}
            <div className="bg-gradient-to-br from-red-400 via-pink-500 to-amber-500 px-6 py-8 text-white relative overflow-hidden">
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
                <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Heart size={24} className="text-red-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Health-Mood Correlations</h3>
                  <p className="text-sm text-warm-600">
                    See how sleep, exercise, and recovery affect your emotional wellbeing with personalized insights.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Sun size={24} className="text-amber-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Weather & Light Tracking</h3>
                  <p className="text-sm text-warm-600">
                    Automatic weather data with each entry. Backfill past entries in Settings → Health.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <TrendingUp size={24} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Pattern Discovery</h3>
                  <p className="text-sm text-warm-600">
                    View your patterns in the Insights tab—see what helps you feel your best.
                  </p>
                </div>
              </div>

              {/* Feature 4 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <Lightbulb size={24} className="text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Smart Recommendations</h3>
                  <p className="text-sm text-warm-600">
                    Get daily suggestions based on your health data and what's worked for you before.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <button
                onClick={handleDismiss}
                className="w-full py-3 px-4 bg-gradient-to-r from-red-500 to-amber-500 text-white rounded-xl
                  hover:from-red-600 hover:to-amber-600 transition-colors font-medium
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
