import React from 'react';
import { motion } from 'framer-motion';
import { Moon, Sparkles, CheckCircle2, ChevronDown, ChevronUp, BookOpen } from 'lucide-react';
import { HeroCard, InsightBite } from '../shared';

/**
 * EveningMirror - The "Mirror" view for evening hours
 *
 * Focus: Reflection and celebrating progress
 *
 * Primary Action: "Wrap Up" (daily summary generation)
 *
 * Content Priority:
 * - Hero: summary.one_liner displayed as quote card
 * - Wins Section: Celebrate progress (primary focus)
 * - Insight Bite: One rotating pattern/observation
 * - Action Items: Hidden unless explicitly expanded
 *
 * Props:
 * - summary: Day summary object
 * - userName: User's first name
 * - insight: Current insight to display
 * - entryCount: Number of entries today
 * - onWrapUp: () => void
 * - onPromptClick: (prompt) => void
 * - onShowInsights: () => void
 * - onDismissInsight: () => void
 */

const EveningMirror = ({
  summary,
  userName,
  insight,
  entryCount = 0,
  onWrapUp,
  onPromptClick,
  onShowInsights,
  onDismissInsight
}) => {
  const [showTasks, setShowTasks] = React.useState(false);

  const greeting = userName ? `Good evening, ${userName}` : 'Good evening';
  const hasOneLiner = summary?.one_liner;
  const wins = summary?.wins?.items || [];
  const hasWins = wins.length > 0;
  const incompleteTasks = [
    ...(summary?.action_items?.carried_forward || []),
    ...(summary?.action_items?.today || [])
  ];
  const hasTasks = incompleteTasks.length > 0;

  return (
    <motion.div
      className="space-y-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Hero Card - Quote style if we have a one-liner */}
      <HeroCard
        type="evening"
        title={hasOneLiner ? summary.one_liner : greeting}
        subtitle={hasOneLiner ? null : "Time to reflect on your day"}
        isQuote={hasOneLiner}
        action={entryCount > 0 && !summary ? {
          label: 'Generate Day Summary',
          type: 'wrap_up'
        } : null}
        onAction={onWrapUp}
      />

      {/* Wins Section - Primary focus in evening */}
      {hasWins && (
        <motion.div
          className="bg-gradient-to-br from-sage-50 to-sage-100 dark:from-sage-900/30 dark:to-sage-900/20 rounded-2xl p-4 border border-sage-200 dark:border-sage-800"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-sage-500 dark:text-sage-400" />
            <h3 className="text-sm font-display font-semibold text-sage-800 dark:text-sage-200">
              Today's Wins
            </h3>
          </div>

          <ul className="space-y-2">
            {wins.map((win, i) => (
              <motion.li
                key={i}
                className="flex items-start gap-2 text-sm text-sage-700 dark:text-sage-300"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                <CheckCircle2 size={14} className="mt-0.5 text-sage-500 dark:text-sage-400 flex-shrink-0" />
                <span className="font-body">
                  {typeof win === 'string' ? win : win.text}
                </span>
              </motion.li>
            ))}
          </ul>

          {/* Win affirmation if provided */}
          {summary?.wins?.tone && (
            <p className="mt-3 pt-3 border-t border-sage-200 dark:border-sage-800 text-xs text-sage-600 dark:text-sage-400 italic font-body">
              {summary.wins.tone === 'celebrating' && "You've earned this moment of celebration."}
              {summary.wins.tone === 'encouraging' && "Every step forward counts."}
              {summary.wins.tone === 'acknowledging' && "Progress, no matter how small."}
            </p>
          )}
        </motion.div>
      )}

      {/* Insight Bite */}
      {insight && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <InsightBite
            insight={insight}
            onDismiss={onDismissInsight}
            onShowMore={onShowInsights}
          />
        </motion.div>
      )}

      {/* Collapsible Tasks Section - Hidden by default */}
      {hasTasks && (
        <motion.div
          className="bg-white dark:bg-hearth-900 rounded-2xl border border-warm-100 dark:border-hearth-800 overflow-hidden"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <button
            onClick={() => setShowTasks(!showTasks)}
            className="w-full flex items-center justify-between p-4 hover:bg-warm-50 dark:hover:bg-hearth-850 transition-colors"
          >
            <div className="flex items-center gap-2 text-warm-600">
              <BookOpen size={16} />
              <span className="text-sm font-medium">
                {incompleteTasks.length} task{incompleteTasks.length !== 1 ? 's' : ''} to carry forward
              </span>
            </div>
            {showTasks ? (
              <ChevronUp size={16} className="text-warm-400" />
            ) : (
              <ChevronDown size={16} className="text-warm-400" />
            )}
          </button>

          {showTasks && (
            <motion.div
              className="px-4 pb-4 pt-0"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
            >
              <ul className="space-y-2">
                {incompleteTasks.map((task, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-warm-600"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-warm-300 mt-2 flex-shrink-0" />
                    <span className="font-body">
                      {typeof task === 'string' ? task : task.text}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-warm-400 mt-3 font-body">
                These will appear in tomorrow's morning view.
              </p>
            </motion.div>
          )}
        </motion.div>
      )}

      {/* Empty state - Evening reflection prompts */}
      {entryCount === 0 && (
        <motion.div
          className="space-y-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-sm text-warm-500 font-body">
            Capture the day before it slips away
          </p>
          {[
            "What's one thing you're grateful for today?",
            "What was the highlight of your day?",
            "What would you do differently tomorrow?"
          ].map((prompt, i) => (
            <motion.button
              key={i}
              onClick={() => onPromptClick?.(prompt)}
              className="w-full text-left p-3 bg-white dark:bg-hearth-900 rounded-xl border border-warm-100 dark:border-hearth-800 hover:border-lavender-200 dark:hover:border-lavender-700 hover:shadow-sm transition-all"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              <span className="text-sm text-warm-700 font-body">{prompt}</span>
            </motion.button>
          ))}
        </motion.div>
      )}

      {/* Entry count */}
      {entryCount > 0 && (
        <p className="text-xs text-warm-400 text-center font-body pt-2">
          {entryCount} {entryCount === 1 ? 'entry' : 'entries'} today
        </p>
      )}
    </motion.div>
  );
};

export default EveningMirror;
