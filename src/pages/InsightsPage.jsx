import { motion } from 'framer-motion';
import { QuickStatsBar, GoalsProgress, WeeklyDigest } from '../components/dashboard/shared';

/**
 * InsightsPage - Analytics and patterns view
 *
 * Contains components moved from the main feed:
 * - QuickStatsBar (7-day mood trend, streak, distribution)
 * - GoalsProgress (active goals tracking)
 * - WeeklyDigest (weekly summary)
 * - Pattern insights
 */
const InsightsPage = ({
  entries,
  category,
  userId,
  onShowFullInsights,
}) => {
  return (
    <motion.div
      className="px-4 pb-8 space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Page Title */}
      <div className="pt-2">
        <h2 className="font-display font-bold text-xl text-warm-800">
          Insights
        </h2>
        <p className="text-sm text-warm-500 mt-1">
          Your patterns and progress
        </p>
      </div>

      {/* Quick Stats Bar */}
      {entries.length > 0 && (
        <QuickStatsBar
          entries={entries}
          category={category}
        />
      )}

      {/* Weekly Digest */}
      {entries.length >= 3 && (
        <WeeklyDigest
          entries={entries}
          category={category}
          userId={userId}
        />
      )}

      {/* Goals Progress */}
      {entries.length > 0 && (
        <GoalsProgress
          entries={entries}
          category={category}
          userId={userId}
        />
      )}

      {/* View Full Patterns Button */}
      {entries.length > 0 && (
        <motion.button
          onClick={onShowFullInsights}
          className="
            w-full py-3 px-4
            bg-gradient-to-r from-primary-500 to-primary-600
            text-white font-bold
            rounded-2xl
            shadow-soft
            flex items-center justify-center gap-2
          "
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          View Full Pattern Analysis
        </motion.button>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <motion.div
          className="
            p-8 text-center
            bg-white/30 backdrop-blur-sm
            border border-white/20
            rounded-3xl
          "
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="text-warm-600 font-medium">
            No insights yet
          </p>
          <p className="text-warm-400 text-sm mt-2">
            Add more entries to unlock patterns and insights
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default InsightsPage;
