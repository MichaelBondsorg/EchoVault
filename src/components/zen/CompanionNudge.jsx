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
        bg-white/30 dark:bg-warm-800/30 backdrop-blur-xl
        border border-white/30 dark:border-warm-700/30
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
      aria-label="Open AI Companion"
    >
      {/* Animated sparkle icon */}
      <motion.div
        className="text-honey-600 dark:text-honey-400"
        animate={{
          scale: [1, 1.1, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
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

      {/* Pulse ring animation */}
      <motion.div
        className="
          absolute inset-0
          rounded-full
          border-2 border-honey-400/30 dark:border-honey-500/20
        "
        animate={{
          scale: [1, 1.3],
          opacity: [0.5, 0],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeOut',
        }}
      />
    </motion.button>
  );
};

export default CompanionNudge;
