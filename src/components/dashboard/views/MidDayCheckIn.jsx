import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Target, MessageCircle, TrendingUp } from 'lucide-react';
import { HeroCard, TaskList, InsightBite, CurrentConditions } from '../shared';

/**
 * MidDayCheckIn - The "Check-In" view for midday hours
 *
 * Focus: Momentum & Maintenance - execution and course correction
 *
 * Content Priority:
 * 1. Next 2 Tasks (Momentum) - Don't show whole list, reduce overwhelm
 * 2. Micro-journal prompt: "How is your energy right now?"
 * 3. Proactive insight if available (e.g., "You usually hit a slump around 2pm...")
 *
 * Props:
 * - summary: Day summary object
 * - userName: User's first name
 * - insight: Current insight to display
 * - onTaskComplete: (task) => void
 * - onEnergyCheck: () => void
 * - onPromptClick: (prompt) => void
 * - onShowInsights: () => void
 * - onDismissInsight: () => void
 */

const MidDayCheckIn = ({
  summary,
  userName,
  insight,
  onTaskComplete,
  onEnergyCheck,
  onPromptClick,
  onShowInsights,
  onDismissInsight
}) => {
  const greeting = userName ? `Good afternoon, ${userName}` : 'Good afternoon';

  // Get next 2 tasks for momentum (prioritize carried forward)
  const carriedForward = summary?.action_items?.carried_forward || [];
  const todayTasks = summary?.action_items?.today || [];
  const nextTasks = [...carriedForward, ...todayTasks].slice(0, 2);

  const hasTasks = nextTasks.length > 0;
  const hasWins = summary?.wins?.items?.length > 0;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Hero Card */}
      <HeroCard
        type="midday"
        title={greeting}
        subtitle="How's your momentum?"
      >
        {/* Compact conditions + Energy check */}
        <div className="space-y-2">
          <CurrentConditions compact />
          <motion.button
            onClick={onEnergyCheck || (() => onPromptClick?.("How is your energy right now?"))}
            className="w-full text-left p-3 bg-white/50 rounded-xl border border-blue-100 hover:bg-white/70 transition-all group"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
          >
            <div className="flex items-center gap-2 text-blue-700">
              <Zap size={16} className="text-blue-500" />
              <span className="text-sm font-body">Quick energy check-in</span>
              <MessageCircle size={14} className="ml-auto opacity-50 group-hover:opacity-100 transition-opacity" />
            </div>
          </motion.button>
        </div>
      </HeroCard>

      {/* Next 2 Tasks - Momentum Focus */}
      {hasTasks && (
        <motion.div
          className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-4 border border-blue-100"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Target size={16} className="text-blue-500" />
            <h3 className="text-sm font-display font-semibold text-blue-800">
              Next Up
            </h3>
          </div>

          <TaskList
            tasks={todayTasks}
            carriedForward={carriedForward}
            onComplete={onTaskComplete}
            maxDisplay={2}
          />

          {(carriedForward.length + todayTasks.length) > 2 && (
            <p className="text-xs text-blue-500 mt-2 text-center">
              {(carriedForward.length + todayTasks.length) - 2} more in your list
            </p>
          )}
        </motion.div>
      )}

      {/* Wins so far (if any) */}
      {hasWins && (
        <motion.div
          className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-100"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-green-500" />
            <h3 className="text-sm font-display font-semibold text-green-800">
              Today so far
            </h3>
          </div>
          <ul className="space-y-1">
            {summary.wins.items.slice(0, 2).map((win, i) => (
              <li key={i} className="text-sm text-green-700 font-body">
                {typeof win === 'string' ? win : win.text}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {/* Proactive Insight */}
      {insight && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <InsightBite
            insight={insight}
            onDismiss={onDismissInsight}
            onShowMore={onShowInsights}
          />
        </motion.div>
      )}

      {/* Empty state prompts */}
      {!hasTasks && !hasWins && (
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-sm text-warm-500 font-body">
            Take a moment to check in
          </p>
          {[
            "What's been the highlight of your day so far?",
            "Anything on your mind you want to capture?"
          ].map((prompt, i) => (
            <motion.button
              key={i}
              onClick={() => onPromptClick?.(prompt)}
              className="w-full text-left p-3 bg-white rounded-xl border border-warm-100 hover:border-blue-200 hover:shadow-sm transition-all"
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

export default MidDayCheckIn;
