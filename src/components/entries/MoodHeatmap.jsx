import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';

const MoodHeatmap = ({ entries, onDayClick }) => {
  const days = useMemo(() => new Array(30).fill(null).map((_, i) => {
    const d = new Date(); d.setDate(new Date().getDate() - (29 - i)); return d;
  }), []);

  const getDayData = (d) => {
    const dayEntries = entries.filter(e => {
      // Use effectiveDate if available (for backdated entries), otherwise createdAt
      const dateField = e.effectiveDate || e.createdAt;
      const entryDate = dateField instanceof Date
        ? dateField
        : dateField?.toDate?.() || new Date();
      return entryDate.getDate() === d.getDate() &&
        entryDate.getMonth() === d.getMonth() &&
        entryDate.getFullYear() === d.getFullYear();
    });
    const moodEntries = dayEntries.filter(e => e.entry_type !== 'task' && typeof e.analysis?.mood_score === 'number');
    const avgMood = moodEntries.length > 0
      ? moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length
      : null;
    const moodScores = moodEntries.map(e => e.analysis.mood_score);
    const volatility = moodScores.length > 1
      ? Math.max(...moodScores) - Math.min(...moodScores)
      : 0;
    return { entries: dayEntries, avgMood, volatility, hasEntries: dayEntries.length > 0 };
  };

  // Using the therapeutic mood colors
  const getMoodColor = (score) => {
    if (typeof score !== 'number') return 'var(--color-warm-200, #e7e5e4)';
    if (score >= 0.75) return 'var(--color-mood-great, #22c55e)';
    if (score >= 0.55) return 'var(--color-mood-good, #84cc16)';
    if (score >= 0.45) return 'var(--color-mood-neutral, #eab308)';
    if (score >= 0.25) return 'var(--color-mood-low, #3b82f6)';
    return 'var(--color-mood-struggling, #8b5cf6)';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white p-4 rounded-2xl border border-warm-100 shadow-soft mb-6"
    >
      <div className="flex items-center gap-2 mb-3 text-warm-700 font-display font-semibold text-xs uppercase tracking-wide">
        <Activity size={14} className="text-primary-500" /> Mood (30 Days)
      </div>
      <div className="flex justify-between items-end gap-1">
        {days.map((d, i) => {
          const dayData = getDayData(d);
          const { avgMood, hasEntries } = dayData;
          return (
            <motion.button
              key={i}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: i * 0.02, duration: 0.3 }}
              whileHover={hasEntries ? { scale: 1.1 } : {}}
              className={`flex-1 rounded-lg transition-all origin-bottom ${hasEntries ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
              style={{
                backgroundColor: getMoodColor(avgMood),
                height: avgMood !== null ? `${Math.max(20, avgMood * 60)}px` : '20px',
                minWidth: '8px'
              }}
              title={`${d.toLocaleDateString()}${hasEntries ? `: ${dayData.entries.length} entries${avgMood !== null ? ` - ${(avgMood * 100).toFixed(0)}%` : ''}` : ': No entry'}`}
              onClick={() => hasEntries && onDayClick && onDayClick(d, dayData)}
              disabled={!hasEntries}
            />
          );
        })}
      </div>
      <div className="mt-3 flex justify-between items-center text-xs text-warm-500 font-body">
        <span>Low</span>
        <span className="text-warm-600 font-medium">Mood Scale</span>
        <span>High</span>
      </div>
    </motion.div>
  );
};

export default MoodHeatmap;
