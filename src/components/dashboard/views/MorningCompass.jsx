import React from 'react';
import { motion } from 'framer-motion';
import { Target, Sunrise, ChevronRight } from 'lucide-react';
import { HeroCard, TaskList, CurrentConditions } from '../shared';

/**
 * MorningCompass - The "Compass" view for morning hours
 *
 * Focus: Setting intentions and planning the day
 *
 * Primary Action: "Set Intention" (new entry with intention tag)
 *
 * Content Priority:
 * - Hero: Greeting + "One small win to chase today?"
 * - Action Items: Carried forward tasks from yesterday
 * - Hidden: Patterns section (too heavy for morning)
 *
 * Props:
 * - summary: Day summary object
 * - userName: User's first name
 * - carryForwardItems: Tasks from yesterday
 * - onSetIntention: () => void
 * - onTaskComplete: (task) => void
 * - onPromptClick: (prompt) => void
 */

const MorningCompass = ({
  summary,
  userName,
  carryForwardItems = [],
  onSetIntention,
  onTaskComplete,
  onPromptClick
}) => {
  const greeting = userName ? `Good morning, ${userName}` : 'Good morning';

  // Combine tasks, prioritizing carried forward
  const todayTasks = summary?.action_items?.today || [];
  const allTasks = [...carryForwardItems, ...todayTasks];

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Hero Card */}
      <HeroCard
        type="morning"
        title={greeting}
        subtitle="One small win to chase today?"
        action={{
          label: 'Set an Intention',
          type: 'intention'
        }}
        onAction={onSetIntention}
      >
        {/* Intention prompt inside hero */}
        {!summary && (
          <motion.button
            onClick={() => onPromptClick?.("What's your intention for today?")}
            className="w-full text-left p-3 bg-white/50 dark:bg-hearth-800/50 rounded-xl border border-honey-100 dark:border-honey-800 hover:bg-white/70 dark:hover:bg-hearth-800/70 transition-all group"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center gap-2 text-honey-700 dark:text-honey-300">
              <Sunrise size={16} className="text-honey-500 dark:text-honey-400" />
              <span className="text-sm font-body">What's your intention for today?</span>
              <ChevronRight size={14} className="ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
            </div>
          </motion.button>
        )}
      </HeroCard>

      {/* Current Conditions */}
      <CurrentConditions />

      {/* Action Items - Only carried forward initially */}
      {allTasks.length > 0 && (
        <motion.div
          className="bg-gradient-to-br from-lavender-50 to-lavender-100 dark:from-lavender-900/30 dark:to-lavender-900/20 rounded-2xl p-4 border border-lavender-200 dark:border-lavender-800"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-lavender-500 dark:text-lavender-400" />
            <h3 className="text-sm font-display font-semibold text-lavender-800 dark:text-lavender-200">
              {carryForwardItems.length > 0 ? "Pick up where you left off" : "Today's Focus"}
            </h3>
          </div>

          <TaskList
            tasks={todayTasks}
            carriedForward={carryForwardItems}
            onComplete={onTaskComplete}
            maxDisplay={4}
          />

          {allTasks.length > 4 && (
            <p className="text-xs text-lavender-500 dark:text-lavender-400 mt-2 text-center">
              +{allTasks.length - 4} more tasks
            </p>
          )}
        </motion.div>
      )}

      {/* Quick prompts for empty state */}
      {!summary && allTasks.length === 0 && (
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-sm text-warm-500 font-body">
            Start your day with clarity
          </p>
          {[
            "What would make today a success?",
            "What's one thing you're grateful for this morning?"
          ].map((prompt, i) => (
            <motion.button
              key={i}
              onClick={() => onPromptClick?.(prompt)}
              className="w-full text-left p-3 bg-white dark:bg-hearth-900 rounded-xl border border-warm-100 dark:border-hearth-800 hover:border-honey-200 dark:hover:border-honey-700 hover:shadow-sm transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <span className="text-sm text-warm-700 font-body">{prompt}</span>
            </motion.button>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
};

export default MorningCompass;
