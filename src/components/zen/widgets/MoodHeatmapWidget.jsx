import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';
import GlassCard from '../GlassCard';

/**
 * MoodHeatmapWidget - 30-day mood calendar for Bento dashboard
 *
 * Shows a compact heatmap of mood scores over the last 30 days
 */
const MoodHeatmapWidget = ({
  entries = [],
  category,
  onDayClick,
  isEditing = false,
  onDelete,
  size = '2x1',
}) => {
  // Build 30-day data
  const { days, stats } = useMemo(() => {
    const now = new Date();
    const daysArray = [];
    let totalMood = 0;
    let moodCount = 0;

    // Filter entries by category
    const categoryEntries = entries.filter(e => e.category === category);

    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const dateStr = date.toDateString();

      // Find entries for this day
      const dayEntries = categoryEntries.filter(e => {
        const entryDate = e.effectiveDate || e.createdAt;
        const d = entryDate?.toDate?.() || new Date(entryDate);
        return d.toDateString() === dateStr;
      });

      // Calculate average mood for the day
      let avgMood = null;
      if (dayEntries.length > 0) {
        const moods = dayEntries
          .filter(e => e.analysis?.mood_score !== undefined)
          .map(e => e.analysis.mood_score);
        if (moods.length > 0) {
          avgMood = moods.reduce((a, b) => a + b, 0) / moods.length;
          totalMood += avgMood;
          moodCount++;
        }
      }

      daysArray.push({
        date,
        dateStr,
        mood: avgMood,
        count: dayEntries.length,
        entries: dayEntries,
      });
    }

    return {
      days: daysArray,
      stats: {
        avgMood: moodCount > 0 ? totalMood / moodCount : null,
        daysLogged: moodCount,
      },
    };
  }, [entries, category]);

  // Get color based on mood score
  const getMoodColor = (mood) => {
    if (mood === null) return 'bg-warm-100';
    if (mood >= 0.7) return 'bg-mood-great';
    if (mood >= 0.5) return 'bg-mood-good';
    if (mood >= 0.3) return 'bg-mood-neutral';
    if (mood >= 0.15) return 'bg-mood-low';
    return 'bg-mood-struggling';
  };

  const getMoodLabel = (score) => {
    if (score === null) return 'No data';
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
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-warm-500">
            <Calendar size={14} />
            <span className="text-xs font-medium">30-Day Journey</span>
          </div>
          {stats.avgMood !== null && (
            <span className="text-xs text-warm-400">
              Avg: {getMoodLabel(stats.avgMood)}
            </span>
          )}
        </div>

        {/* Heatmap Grid - 6 rows x 5 columns */}
        <div className="flex-1 grid grid-cols-10 gap-1">
          {days.map((day, i) => (
            <motion.button
              key={day.dateStr}
              onClick={() => !isEditing && day.count > 0 && onDayClick?.(day.date, day)}
              disabled={isEditing || day.count === 0}
              className={`
                aspect-square rounded-sm
                ${getMoodColor(day.mood)}
                ${day.count > 0 ? 'cursor-pointer hover:ring-2 hover:ring-primary-400' : 'cursor-default'}
                ${day.date.toDateString() === new Date().toDateString() ? 'ring-2 ring-primary-500' : ''}
                transition-all
              `}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.01 }}
              title={`${day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${day.count} entries`}
              whileHover={day.count > 0 ? { scale: 1.2 } : {}}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
          <span className="text-xs text-warm-400">
            {stats.daysLogged} days logged
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-warm-400 mr-1">Mood:</span>
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-struggling" title="Struggling" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-low" title="Low" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-neutral" title="Okay" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-good" title="Good" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-great" title="Great" />
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default MoodHeatmapWidget;
