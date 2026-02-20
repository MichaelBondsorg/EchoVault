import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, Flame, BookOpen, MessageSquare, CheckSquare, Wind } from 'lucide-react';

/**
 * QuickStatsBar - Compact stats strip showing mood trend, streak, and entry distribution
 *
 * Displays key metrics at a glance without overwhelming the user:
 * - 7-day mood trend (improving/stable/declining)
 * - Journaling streak
 * - Entry type distribution as small pills
 */

const QuickStatsBar = ({ entries, category }) => {
  const stats = useMemo(() => {
    // Filter to category
    const categoryEntries = entries.filter(e => e.category === category);

    // Calculate 7-day mood trend
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentEntries = categoryEntries
      .filter(e => {
        const date = e.effectiveDate || e.createdAt;
        const entryDate = date instanceof Date ? date : date?.toDate?.() || new Date();
        return entryDate >= sevenDaysAgo;
      })
      .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined);

    let trend = 'stable';
    let trendValue = 0;

    if (recentEntries.length >= 2) {
      // Sort by date ascending
      const sorted = [...recentEntries].sort((a, b) => {
        const dateA = (a.effectiveDate || a.createdAt);
        const dateB = (b.effectiveDate || b.createdAt);
        const timeA = dateA instanceof Date ? dateA.getTime() : dateA?.toDate?.()?.getTime() || 0;
        const timeB = dateB instanceof Date ? dateB.getTime() : dateB?.toDate?.()?.getTime() || 0;
        return timeA - timeB;
      });

      // Compare first half avg to second half avg
      const mid = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, mid);
      const secondHalf = sorted.slice(mid);

      const firstAvg = firstHalf.reduce((sum, e) => sum + e.analysis.mood_score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, e) => sum + e.analysis.mood_score, 0) / secondHalf.length;

      trendValue = secondAvg - firstAvg;

      if (trendValue > 0.1) trend = 'improving';
      else if (trendValue < -0.1) trend = 'declining';
      else trend = 'stable';
    }

    // Calculate journaling streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);

      const hasEntry = categoryEntries.some(e => {
        const date = e.effectiveDate || e.createdAt;
        const entryDate = date instanceof Date ? date : date?.toDate?.() || new Date();
        return entryDate.toDateString() === checkDate.toDateString();
      });

      if (hasEntry) {
        streak++;
      } else if (i > 0) {
        // Don't break on today if no entry yet
        break;
      }
    }

    // Entry type distribution (last 30 days)
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentAllEntries = categoryEntries.filter(e => {
      const date = e.effectiveDate || e.createdAt;
      const entryDate = date instanceof Date ? date : date?.toDate?.() || new Date();
      return entryDate >= thirtyDaysAgo;
    });

    const distribution = {
      reflection: recentAllEntries.filter(e => e.entry_type === 'reflection' || !e.entry_type).length,
      vent: recentAllEntries.filter(e => e.entry_type === 'vent').length,
      task: recentAllEntries.filter(e => e.entry_type === 'task').length,
      mixed: recentAllEntries.filter(e => e.entry_type === 'mixed').length
    };

    const avgMood = recentEntries.length > 0
      ? recentEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / recentEntries.length
      : null;

    return {
      trend,
      trendValue,
      streak,
      distribution,
      avgMood,
      totalRecent: recentAllEntries.length
    };
  }, [entries, category]);

  // Don't show if no entries
  if (stats.totalRecent === 0) return null;

  const getTrendIcon = () => {
    switch (stats.trend) {
      case 'improving': return <TrendingUp size={14} className="text-mood-great" />;
      case 'declining': return <TrendingDown size={14} className="text-accent" />;
      default: return <Minus size={14} className="text-warm-400" />;
    }
  };

  const getTrendLabel = () => {
    switch (stats.trend) {
      case 'improving': return 'Improving';
      case 'declining': return 'Declining';
      default: return 'Stable';
    }
  };

  const getTrendColor = () => {
    switch (stats.trend) {
      case 'improving': return 'text-mood-great';
      case 'declining': return 'text-accent';
      default: return 'text-warm-500';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white/80 dark:bg-hearth-900/80 backdrop-blur-sm rounded-2xl p-3 border border-warm-100 dark:border-warm-800 shadow-soft mb-4"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Mood Trend */}
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-warm-50">
            {getTrendIcon()}
          </div>
          <div>
            <p className={`text-xs font-semibold ${getTrendColor()}`}>{getTrendLabel()}</p>
            <p className="text-[10px] text-warm-400">7-day mood</p>
          </div>
        </div>

        {/* Journaling Streak */}
        {stats.streak > 0 && (
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-honey-50 dark:bg-honey-900/30">
              <Flame size={14} className="text-honey-500 dark:text-honey-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-honey-600 dark:text-honey-400">{stats.streak} day{stats.streak !== 1 ? 's' : ''}</p>
              <p className="text-[10px] text-warm-400">streak</p>
            </div>
          </div>
        )}

        {/* Entry Distribution Pills */}
        <div className="flex items-center gap-1">
          {stats.distribution.reflection > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-honey-50 text-honey-600">
              <BookOpen size={10} />
              <span className="text-[10px] font-medium">{stats.distribution.reflection}</span>
            </div>
          )}
          {stats.distribution.vent > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-terra-50 dark:bg-terra-900/30 text-terra-600 dark:text-terra-400">
              <Wind size={10} />
              <span className="text-[10px] font-medium">{stats.distribution.vent}</span>
            </div>
          )}
          {stats.distribution.mixed > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-sage-50 dark:bg-sage-900/30 text-sage-600 dark:text-sage-400">
              <CheckSquare size={10} />
              <span className="text-[10px] font-medium">{stats.distribution.mixed}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default QuickStatsBar;
