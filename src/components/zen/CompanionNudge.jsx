import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

/**
 * CompanionNudge - Floating glass button that opens the AI Companion
 *
 * Positioned bottom-right, above the Settings tab in the bottom nav.
 * Uses a pulsing sparkle animation to draw attention subtly.
 *
 * @param {Object} props
 * @param {function} props.onClick - Callback when nudge is clicked (opens AI Companion)
 * @param {boolean} props.hasNewInsight - Whether there's a new insight to show
 */
const CompanionNudge = ({ onClick, hasNewInsight = false }) => {
  return (
    <motion.button
      onClick={onClick}
      className="
        fixed bottom-24 right-4 z-40
        w-14 h-14
        bg-[var(--card)]
        border border-[var(--border)]
        rounded-full
        shadow-glass-md
        flex items-center justify-center
        overflow-hidden
      "
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 0.5, type: 'spring', damping: 15 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
      aria-label="Talk with Engram"
    >
      {/* Animated sparkle icon */}
      <motion.div
        className="text-[var(--accent-deep)]"
      >
        <Sparkles size={24} />
      </motion.div>

      {/* Notification dot for new insights */}
      {hasNewInsight && (
        <motion.div
          className="
            absolute top-1 right-1
            w-3 h-3
            bg-accent rounded-full
            border-2 border-white/50 dark:border-warm-800/50
          "
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 10 }}
        />
      )}

    </motion.button>
  );
};

export default CompanionNudge;
