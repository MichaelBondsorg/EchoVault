import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Flame, BarChart3 } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * MiniStatsWidget - Compact stats card for Bento dashboard
 *
 * Shows 7-day mood trend, streak, and entry count
 */
const MiniStatsWidget = ({
  entries = [],
  category,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  // Calculate stats
  const stats = useMemo(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Filter entries from last 7 days
    const recentEntries = entries.filter(e => {
      const date = e.effectiveDate || e.createdAt;
      const entryDate = date?.toDate?.() || new Date(date);
      return entryDate >= sevenDaysAgo;
    });

    // Calculate average mood
    const entriesWithMood = recentEntries.filter(e => e.analysis?.mood_score !== undefined);
    const avgMood = entriesWithMood.length > 0
      ? entriesWithMood.reduce((sum, e) => sum + e.analysis.mood_score, 0) / entriesWithMood.length
      : 0.5;

    // Calculate mood trend (compare first half vs second half)
    let trend = 'neutral';
    if (entriesWithMood.length >= 4) {
      const mid = Math.floor(entriesWithMood.length / 2);
      const firstHalf = entriesWithMood.slice(mid);
      const secondHalf = entriesWithMood.slice(0, mid);

      const firstAvg = firstHalf.reduce((s, e) => s + e.analysis.mood_score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, e) => s + e.analysis.mood_score, 0) / secondHalf.length;

      if (secondAvg - firstAvg > 0.1) trend = 'up';
      else if (firstAvg - secondAvg > 0.1) trend = 'down';
    }

    // Calculate streak (consecutive days with entries)
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = checkDate.toDateString();

      const hasEntry = entries.some(e => {
        const date = e.effectiveDate || e.createdAt;
        const entryDate = date?.toDate?.() || new Date(date);
        return entryDate.toDateString() === dateStr;
      });

      if (hasEntry) {
        streak++;
      } else if (i > 0) {
        break;
      }
    }

    return {
      avgMood,
      trend,
      streak,
      entryCount: recentEntries.length,
    };
  }, [entries]);

  // DAT-002: Trend icon and color with clearer labels
  const getTrendInfo = (trend) => {
    if (trend === 'up') return { icon: TrendingUp, color: 'text-mood-great', label: 'Improving', sublabel: 'Mood Trend' };
    if (trend === 'down') return { icon: TrendingDown, color: 'text-mood-low', label: 'Declining', sublabel: 'Mood Trend' };
    return { icon: Minus, color: 'text-warm-400', label: 'Steady', sublabel: 'Mood Trend' };
  };

  const trendInfo = getTrendInfo(stats.trend);
  const TrendIcon = trendInfo.icon;

  // Mood label
  const getMoodLabel = (score) => {
    if (score >= 0.7) return 'Great';
    if (score >= 0.5) return 'Good';
    if (score >= 0.3) return 'Okay';
    return 'Low';
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
          <BarChart3 size={16} />
          <span className="text-xs font-medium">7-Day Stats</span>
        </div>

        {/* Stats Grid */}
        <div className="flex-1 grid grid-cols-3 gap-2">
          {/* Mood */}
          <motion.div
            className="flex flex-col items-center justify-center p-2 bg-white/30 rounded-xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
          >
            <span className="text-lg font-bold text-warm-700">
              {getMoodLabel(stats.avgMood)}
            </span>
            <span className="text-xs text-warm-400">Avg Mood</span>
          </motion.div>

          {/* Trend - DAT-002: Clearer labeling */}
          <motion.div
            className="flex flex-col items-center justify-center p-2 bg-white/30 rounded-xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 }}
          >
            <TrendIcon size={20} className={trendInfo.color} />
            <span className="text-xs text-warm-600 mt-1 font-medium">{trendInfo.label}</span>
            <span className="text-[10px] text-warm-400">{trendInfo.sublabel}</span>
          </motion.div>

          {/* Streak */}
          <motion.div
            className="flex flex-col items-center justify-center p-2 bg-white/30 rounded-xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
          >
            <div className="flex items-center gap-1">
              <Flame size={16} className={stats.streak > 0 ? 'text-accent' : 'text-warm-300'} />
              <span className="text-lg font-bold text-warm-700">{stats.streak}</span>
            </div>
            <span className="text-xs text-warm-400">Streak</span>
          </motion.div>
        </div>

        {/* Entry count footer */}
        <motion.div
          className="mt-2 text-center text-xs text-warm-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          {stats.entryCount} entries this week
        </motion.div>
      </div>
    </GlassCard>
  );
};

export default MiniStatsWidget;
