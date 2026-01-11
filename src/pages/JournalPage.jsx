import { motion } from 'framer-motion';
import { MoodHeatmap } from '../components';
import { SituationTimeline } from '../components/dashboard/shared';

/**
 * JournalPage - Timeline view with entries and situation connections
 *
 * Contains components moved from the main feed:
 * - MoodHeatmap (30-day calendar)
 * - SituationTimeline (connected multi-entry stories)
 * - Entry history list
 */
const JournalPage = ({
  entries,
  category,
  onDayClick,
  onEntryClick,
  onDelete,
  onUpdate,
}) => {
  // Filter entries by category
  const filteredEntries = entries.filter(e => e.category === category);

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
          Your Journal
        </h2>
        <p className="text-sm text-warm-500 mt-1">
          Your stories and reflections over time
        </p>
      </div>

      {/* Mood Heatmap */}
      {filteredEntries.length > 0 && (
        <MoodHeatmap
          entries={filteredEntries}
          onDayClick={onDayClick}
        />
      )}

      {/* Situation Timeline */}
      {filteredEntries.length > 0 && (
        <SituationTimeline
          entries={entries}
          category={category}
          onEntryClick={onEntryClick}
        />
      )}

      {/* Empty state */}
      {filteredEntries.length === 0 && (
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
            No entries yet
          </p>
          <p className="text-warm-400 text-sm mt-2">
            Start journaling to see your timeline here
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default JournalPage;
