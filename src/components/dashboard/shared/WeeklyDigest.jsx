import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronDown, Sparkles, TrendingUp, TrendingDown, Minus, Target, Zap, X } from 'lucide-react';

/**
 * WeeklyDigest - Auto-collapsing card that summarizes the past week
 *
 * Appears at the start of a new week and auto-collapses after being viewed.
 * Shows:
 * - Week's emotional arc summary
 * - Most frequent triggers/themes
 * - Goals progressed
 * - One actionable insight
 */

const WeeklyDigest = ({ entries, category, userId }) => {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  // Check if we should show the digest (start of week or first view)
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    // Show on Monday or if not seen this week
    const today = new Date();
    const dayOfWeek = today.getDay();
    const isMonday = dayOfWeek === 1;

    // Check localStorage for last view
    const lastViewKey = `weeklyDigest_${userId}_${category}`;
    const lastView = localStorage.getItem(lastViewKey);
    const lastViewDate = lastView ? new Date(lastView) : null;

    // Get start of current week (Sunday)
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    // Show if Monday-Tuesday, or if not viewed this week
    const isEarlyWeek = dayOfWeek >= 1 && dayOfWeek <= 2;
    const notViewedThisWeek = !lastViewDate || lastViewDate < startOfWeek;

    if ((isEarlyWeek || notViewedThisWeek) && entries.length >= 3) {
      setShouldShow(true);
    }
  }, [userId, category, entries.length]);

  const weekData = useMemo(() => {
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Filter to last week's entries
    const categoryEntries = entries.filter(e => e.category === category);
    const weekEntries = categoryEntries.filter(e => {
      const date = e.effectiveDate || e.createdAt;
      const entryDate = date instanceof Date ? date : date?.toDate?.() || new Date();
      return entryDate >= oneWeekAgo && entryDate <= now;
    });

    if (weekEntries.length < 2) return null;

    // Calculate mood arc
    const moodEntries = weekEntries.filter(e =>
      e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined
    );

    let moodArc = 'balanced';
    let avgMood = 0.5;

    if (moodEntries.length >= 2) {
      const sorted = [...moodEntries].sort((a, b) => {
        const dateA = (a.effectiveDate || a.createdAt);
        const dateB = (b.effectiveDate || b.createdAt);
        const timeA = dateA instanceof Date ? dateA.getTime() : dateA?.toDate?.()?.getTime() || 0;
        const timeB = dateB instanceof Date ? dateB.getTime() : dateB?.toDate?.()?.getTime() || 0;
        return timeA - timeB;
      });

      const mid = Math.floor(sorted.length / 2);
      const firstHalf = sorted.slice(0, mid);
      const secondHalf = sorted.slice(mid);

      const firstAvg = firstHalf.reduce((sum, e) => sum + e.analysis.mood_score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, e) => sum + e.analysis.mood_score, 0) / secondHalf.length;
      avgMood = moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length;

      const trend = secondAvg - firstAvg;
      if (trend > 0.15) moodArc = 'upward';
      else if (trend < -0.15) moodArc = 'downward';
      else if (avgMood > 0.65) moodArc = 'positive';
      else if (avgMood < 0.35) moodArc = 'challenging';
      else moodArc = 'balanced';
    }

    // Extract common themes/tags
    const tagCounts = {};
    weekEntries.forEach(e => {
      (e.tags || []).forEach(tag => {
        if (!tag.startsWith('@')) return; // Only structured tags
        const cleanTag = tag.replace(/^@\w+:/, '').replace(/_/g, ' ');
        tagCounts[cleanTag] = (tagCounts[cleanTag] || 0) + 1;
      });
    });

    const topThemes = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([theme]) => theme);

    // Find goals with progress (clean up any tag prefixes)
    const goalsProgressed = [];
    weekEntries.forEach(e => {
      if (e.goal_update?.status === 'progress' || e.goal_update?.status === 'achieved') {
        // Clean up tag - remove @goal:, @situation:, or any @type: prefix
        let goalName = e.goal_update.tag || '';
        goalName = goalName.replace(/^@\w+:/i, '').replace(/_/g, ' ').trim();
        if (goalName && !goalsProgressed.includes(goalName)) {
          goalsProgressed.push(goalName);
        }
      }
    });

    // Entry counts by type
    const typeCounts = {
      reflection: weekEntries.filter(e => e.entry_type === 'reflection' || !e.entry_type).length,
      vent: weekEntries.filter(e => e.entry_type === 'vent').length,
      mixed: weekEntries.filter(e => e.entry_type === 'mixed').length
    };

    // Generate insight message
    let insight = '';
    if (moodArc === 'upward') {
      insight = 'Your week ended on a higher note than it started. What helped shift things?';
    } else if (moodArc === 'downward') {
      insight = 'This week had some challenges. Consider what support you might need.';
    } else if (typeCounts.vent >= 2) {
      insight = 'You had a few venting moments this week. That release can be healthy.';
    } else if (goalsProgressed.length > 0) {
      // Title case the goal name for the message
      const goalDisplay = goalsProgressed[0].split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      insight = `You made progress on ${goalDisplay}. Keep building that momentum!`;
    } else if (avgMood > 0.65) {
      insight = 'You had a good week overall. What contributed to that?';
    } else {
      insight = 'Another week of insights captured. Every entry adds to your self-understanding.';
    }

    return {
      entryCount: weekEntries.length,
      moodArc,
      avgMood,
      topThemes,
      goalsProgressed,
      typeCounts,
      insight
    };
  }, [entries, category]);

  // Handle dismiss
  const handleDismiss = () => {
    setIsDismissed(true);
    const lastViewKey = `weeklyDigest_${userId}_${category}`;
    localStorage.setItem(lastViewKey, new Date().toISOString());
  };

  // Don't render if dismissed, shouldn't show, or no data
  if (isDismissed || !shouldShow || !weekData) return null;

  const getMoodArcIcon = () => {
    switch (weekData.moodArc) {
      case 'upward': return <TrendingUp size={14} className="text-mood-great" />;
      case 'downward': return <TrendingDown size={14} className="text-accent" />;
      case 'positive': return <Sparkles size={14} className="text-mood-great" />;
      case 'challenging': return <Zap size={14} className="text-amber-500" />;
      default: return <Minus size={14} className="text-warm-400" />;
    }
  };

  const getMoodArcLabel = () => {
    switch (weekData.moodArc) {
      case 'upward': return 'Trending up';
      case 'downward': return 'Trending down';
      case 'positive': return 'Positive week';
      case 'challenging': return 'Challenging week';
      default: return 'Balanced week';
    }
  };

  const getMoodArcColor = () => {
    switch (weekData.moodArc) {
      case 'upward':
      case 'positive':
        return 'from-green-50 to-emerald-50 border-green-200';
      case 'downward':
      case 'challenging':
        return 'from-amber-50 to-orange-50 border-amber-200';
      default:
        return 'from-honey-50 to-lavender-50 border-honey-200';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className={`bg-gradient-to-br ${getMoodArcColor()} rounded-2xl border overflow-hidden mb-4`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1"
        >
          <div className="p-1.5 rounded-lg bg-white/60">
            <Calendar size={14} className="text-honey-600" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-display font-semibold text-warm-800">
              Your Week in Review
            </h3>
            <div className="flex items-center gap-1 text-xs text-warm-600">
              {getMoodArcIcon()}
              <span>{getMoodArcLabel()}</span>
              <span className="text-warm-400">·</span>
              <span>{weekData.entryCount} entries</span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <motion.button
            onClick={() => setIsExpanded(!isExpanded)}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            className="p-1 hover:bg-white/50 rounded-lg transition-colors"
          >
            <ChevronDown size={18} className="text-warm-400" />
          </motion.button>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/50 rounded-lg transition-colors"
          >
            <X size={16} className="text-warm-400" />
          </button>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Themes */}
              {weekData.topThemes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-warm-600 mb-1.5">Common themes</p>
                  <div className="flex flex-wrap gap-1">
                    {weekData.topThemes.map((theme, i) => (
                      <span
                        key={i}
                        className="px-2 py-1 text-xs bg-white/60 rounded-full text-warm-700 capitalize"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Goals Progress */}
              {weekData.goalsProgressed.length > 0 && (
                <div className="flex items-start gap-2 p-2 bg-white/40 rounded-xl">
                  <Target size={14} className="text-honey-500 mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-warm-700">Progress made</p>
                    <p className="text-xs text-warm-600 capitalize">
                      {weekData.goalsProgressed.map(g => g.charAt(0).toUpperCase() + g.slice(1)).join(', ')}
                    </p>
                  </div>
                </div>
              )}

              {/* Insight */}
              <div className="p-3 bg-white/60 rounded-xl">
                <div className="flex items-start gap-2">
                  <Sparkles size={14} className="text-lavender-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-warm-700 font-body leading-relaxed">
                    {weekData.insight}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default WeeklyDigest;
