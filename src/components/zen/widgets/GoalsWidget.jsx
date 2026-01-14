import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Target, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * GoalsWidget - Active goals progress for Bento dashboard
 *
 * Shows goals extracted from entries with their current status
 */
const GoalsWidget = ({
  entries = [],
  category,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  // Extract goals from entries
  const goals = useMemo(() => {
    const goalMap = new Map();

    entries.forEach(entry => {
      if (entry.goal_update?.tag) {
        const tag = entry.goal_update.tag;
        const existing = goalMap.get(tag);

        if (!existing) {
          goalMap.set(tag, {
            tag,
            status: entry.goal_update.status || 'active',
            sentiment: entry.goal_update.sentiment || 'neutral',
            lastUpdate: entry.createdAt,
            mentions: 1,
          });
        } else {
          existing.mentions++;
          if (entry.createdAt > existing.lastUpdate) {
            existing.status = entry.goal_update.status || existing.status;
            existing.sentiment = entry.goal_update.sentiment || existing.sentiment;
            existing.lastUpdate = entry.createdAt;
          }
        }
      }
    });

    // Filter to active goals and sort by mentions
    return Array.from(goalMap.values())
      .filter(g => g.status === 'active' || g.status === 'progress')
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 3);
  }, [entries]);

  // Get sentiment icon
  const getSentimentIcon = (sentiment) => {
    if (sentiment === 'positive') return TrendingUp;
    if (sentiment === 'negative') return TrendingDown;
    return Minus;
  };

  // Get sentiment color
  const getSentimentColor = (sentiment) => {
    if (sentiment === 'positive') return 'text-mood-great';
    if (sentiment === 'negative') return 'text-mood-low';
    return 'text-warm-400';
  };

  // Format goal tag to nice display name
  // e.g. "@goal:find_new_job" -> "Find new job"
  const formatGoalName = (tag) => {
    if (!tag) return '';
    // Remove @goal: prefix if present
    let name = tag.replace(/^@goal:/i, '');
    // Replace underscores with spaces
    name = name.replace(/_/g, ' ');
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
  };

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 text-warm-500 mb-3">
          <Target size={16} />
          <span className="text-xs font-medium">Active Goals</span>
        </div>

        {/* Goals list */}
        <div className="flex-1">
          {goals.length > 0 ? (
            <ul className="space-y-2">
              {goals.map((goal, index) => {
                const SentimentIcon = getSentimentIcon(goal.sentiment);
                return (
                  <motion.li
                    key={goal.tag}
                    className="
                      flex items-center justify-between
                      p-2 bg-white/30 rounded-xl
                    "
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-warm-700 truncate">
                        {formatGoalName(goal.tag)}
                      </p>
                      <p className="text-xs text-warm-400">
                        {goal.mentions} {goal.mentions === 1 ? 'mention' : 'mentions'}
                      </p>
                    </div>
                    <SentimentIcon
                      size={18}
                      className={getSentimentColor(goal.sentiment)}
                    />
                  </motion.li>
                );
              })}
            </ul>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-xs text-warm-400">
                  No active goals yet
                </p>
                <p className="text-xs text-warm-300 mt-1">
                  Mention #goals in your entries
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default GoalsWidget;
