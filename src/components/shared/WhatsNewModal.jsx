import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, CheckCircle } from 'lucide-react';
import { Button } from '../cloud';
import { getFlag } from '../../config/flags';
import {
  getUnseenAnnouncements,
  markAnnouncementsSeen,
} from './featureAnnouncements';

/**
 * WhatsNewModal - flag-aware "What's New" popup.
 *
 * Shows only entries from FEATURE_ANNOUNCEMENTS (featureAnnouncements.js)
 * whose flag is currently on AND that this owner (`uid`) hasn't dismissed
 * yet. Dismissing marks exactly the entries that were DISPLAYED as seen
 * (per-feature, owner-scoped keys — see featureAnnouncements.js), so
 * flipping a new flag later resurfaces the modal with only the new entry,
 * never re-showing ones already acknowledged.
 *
 * This retires the old single FEATURE_VERSION/lastSeenVersion mechanism
 * (previously `echovault.lastSeenVersion`, bumped by hand per release) in
 * favor of the per-feature logic above: the two would otherwise fight over
 * when to show the modal, and every user who saw the old hardcoded feature
 * list already dismissed it, so there was nothing left to migrate. Going
 * forward, featureAnnouncements.js is the single source of truth — no
 * version constant to remember to bump.
 *
 * `uid` is required to show anything: without it, dismissal can't be
 * tracked durably, so the modal simply stays closed (see
 * `getUnseenAnnouncements`). The one real mount site (App.jsx) always has
 * one — it renders past the `if (!user) return` auth gate.
 */
const WhatsNewModal = ({ uid }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleEntries, setVisibleEntries] = useState([]);

  useEffect(() => {
    const unseen = getUnseenAnnouncements(uid, getFlag);
    if (unseen.length === 0) return undefined;

    // Small delay so it doesn't appear immediately on load.
    const timer = setTimeout(() => {
      setVisibleEntries(unseen);
      setIsOpen(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, [uid]);

  const handleDismiss = () => {
    markAnnouncementsSeen(uid, visibleEntries.map((entry) => entry.id));
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && visibleEntries.length > 0 && (
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="whats-new-title"
            className="relative w-full max-w-md max-h-[85vh] flex flex-col bg-white dark:bg-hearth-900 rounded-3xl overflow-hidden shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header with gradient */}
            <div className="shrink-0 bg-gradient-to-br from-terra-400 via-honey-400 to-honey-500 dark:from-terra-700/60 dark:via-honey-700/60 dark:to-honey-800/60 px-6 py-8 text-white relative overflow-hidden">
              {/* Decorative circles */}
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full" />
              <div className="absolute -bottom-5 -left-5 w-24 h-24 bg-white/10 rounded-full" />

              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles size={20} />
                  <span className="text-sm font-medium text-white/80">What's New</span>
                </div>
                <h2 id="whats-new-title" className="font-display text-2xl font-bold">
                  What's new in Engram
                </h2>
              </div>
            </div>

            {/* Features */}
            <div className="p-6 space-y-4 overflow-y-auto">
              {visibleEntries.map((entry) => (
                <div key={entry.id} className="flex gap-4">
                  <div className="w-12 h-12 rounded-xl bg-accent-wash flex items-center justify-center flex-shrink-0">
                    <Sparkles size={22} className="text-accent-deep" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-warm-800 dark:text-warm-200">{entry.title}</h3>
                    <p className="text-sm text-warm-600 dark:text-warm-400">{entry.blurb}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-6 pb-6">
              <Button onClick={handleDismiss} className="w-full">
                <CheckCircle size={18} />
                Got it
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WhatsNewModal;
