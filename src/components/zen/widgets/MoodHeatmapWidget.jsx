import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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

  // Tooltip state for desktop hover
  const [hoveredDay, setHoveredDay] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (e, day) => {
    if (isEditing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setHoveredDay(day);
  };

  const handleMouseLeave = () => {
    setHoveredDay(null);
  };

  // Get theme summary for a day
  const getDayTheme = (day) => {
    if (day.count === 0) return null;
    const themes = [];
    day.entries?.forEach(entry => {
      if (entry.contextualInsight?.briefSummary) {
        themes.push(entry.contextualInsight.briefSummary);
      } else if (entry.analysis?.themes?.[0]) {
        themes.push(entry.analysis.themes[0]);
      }
    });
    return themes[0] || null;
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

        {/* DAT-004: Date labels for timeline context */}
        <div className="flex justify-between text-[10px] text-warm-400 mb-1 px-0.5">
          <span>{days[0]?.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          <span>Today</span>
        </div>

        {/* Heatmap Grid - 3 rows x 10 columns */}
        <div className="flex-1 grid grid-cols-10 gap-1 relative">
          {days.map((day, i) => (
            <motion.button
              key={day.dateStr}
              onClick={() => !isEditing && day.count > 0 && onDayClick?.(day.date, day)}
              onMouseEnter={(e) => handleMouseEnter(e, day)}
              onMouseLeave={handleMouseLeave}
              onTouchStart={() => {}} // Prevent hover on touch
              disabled={isEditing || day.count === 0}
              className={`
                aspect-square rounded-sm
                ${getMoodColor(day.mood)}
                ${day.count > 0 ? 'cursor-pointer hover:ring-2 hover:ring-primary-400' : 'cursor-default'}
                ${day.date.toDateString() === new Date().toDateString() ? 'ring-2 ring-primary-500' : ''}
                transition-all
              `}
              style={{
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.01 }}
              whileHover={day.count > 0 ? { scale: 1.3, zIndex: 10 } : {}}
            />
          ))}

          {/* Hover Tooltip (desktop only) */}
          <AnimatePresence>
            {hoveredDay && (
              <motion.div
                className="
                  fixed z-[100] px-3 py-2
                  bg-warm-800 text-white text-xs
                  rounded-lg shadow-lg
                  pointer-events-none
                  max-w-[200px]
                "
                style={{
                  left: tooltipPos.x,
                  top: tooltipPos.y - 8,
                  transform: 'translate(-50%, -100%)',
                }}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
              >
                <div className="font-medium">
                  {hoveredDay.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
                <div className="text-warm-300">
                  {hoveredDay.count} {hoveredDay.count === 1 ? 'entry' : 'entries'}
                  {hoveredDay.mood !== null && ` - ${getMoodLabel(hoveredDay.mood)}`}
                </div>
                {getDayTheme(hoveredDay) && (
                  <div className="text-warm-400 mt-1 line-clamp-2">
                    {getDayTheme(hoveredDay)}
                  </div>
                )}
                {hoveredDay.count > 0 && (
                  <div className="text-primary-300 mt-1 text-[10px]">
                    Click to view details
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* DAT-003: Legend with visible text labels for accessibility */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
          <span className="text-xs text-warm-400">
            {stats.daysLogged} days logged
          </span>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-warm-400 mr-1">Low</span>
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-struggling" title="Struggling" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-low" title="Low" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-neutral" title="Okay" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-good" title="Good" />
            <div className="w-2.5 h-2.5 rounded-sm bg-mood-great" title="Great" />
            <span className="text-[10px] text-warm-400 ml-1">Great</span>
          </div>
        </div>
      </div>
    </GlassCard>
  );
};

export default MoodHeatmapWidget;
