import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Users, Link2, GitBranch, Sparkles, CheckCircle } from 'lucide-react';

/**
 * WhatsNewModal - Shows new features to users after an update
 *
 * Displays once per feature version, tracked via localStorage
 */

// Increment this when adding new features to show the modal again
const FEATURE_VERSION = '2.1.0';
const STORAGE_KEY = 'echovault.lastSeenVersion';

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
            <div className="bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 px-6 py-8 text-white relative overflow-hidden">
              {/* Decorative circles */}
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
              <div className="absolute -bottom-5 -left-5 w-24 h-24 bg-white/10 rounded-full" />

              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={20} />
                  <span className="text-sm font-medium text-white/80">What's New</span>
                </div>
                <h2 className="font-display text-2xl font-bold">
                  People & Relationships
                </h2>
                <p className="text-white/80 text-sm mt-1">
                  Your journal now remembers the people in your life
                </p>
              </div>
            </div>

            {/* Features */}
            <div className="p-6 space-y-4">
              {/* Feature 1 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Users size={24} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Manage People & Things</h3>
                  <p className="text-sm text-warm-600">
                    Edit names, fix transcription errors, and organize the people, pets, and places from your entries.
                  </p>
                </div>
              </div>

              {/* Feature 2 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <Link2 size={24} className="text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Connect Relationships</h3>
                  <p className="text-sm text-warm-600">
                    Link entities together—like showing Luna is Spencer's pet—so the AI companion understands your world.
                  </p>
                </div>
              </div>

              {/* Feature 3 */}
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
                  <GitBranch size={24} className="text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-warm-800">Visual Relationship Graph</h3>
                  <p className="text-sm text-warm-600">
                    See how everyone in your life is connected with an interactive graph visualization.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6">
              <button
                onClick={handleDismiss}
                className="w-full py-3 px-4 bg-primary-600 text-white rounded-xl
                  hover:bg-primary-700 transition-colors font-medium
                  flex items-center justify-center gap-2"
              >
                <CheckCircle size={18} />
                Got it!
              </button>
              <p className="text-center text-xs text-warm-400 mt-3">
                Find these features in Settings → People & Things
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WhatsNewModal;
