import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, SectionLabel } from '../../cloud';

/**
 * MoodHeatmapWidget - "Mood trend" bar card for the Home screen
 * (CLOUD-DESIGN-SPEC.md §7 Home: "mood-trend bar card"; bars use the
 * accent-1..4 scale, today = full accent - mirrors the Insights "Mood
 * trend" chart in the mockups).
 *
 * Restyle only: the underlying 30-day per-day mood aggregation (`days`)
 * is unchanged from the pre-Cloud dot-grid widget (still backs
 * onDayClick / the Day Summary modal) - this component now renders the
 * most recent 7 of those already-computed days as bars instead of all
 * 30 as a dot grid, and adds a small derived week-over-week momentum
 * caption from the same data.
 */
const MoodHeatmapWidget = ({
  entries = [],
  category,
  onDayClick,
  isEditing = false,
  onDelete,
}) => {
  // Build 30-day data (unchanged aggregation from the pre-Cloud widget)
  const { days } = useMemo(() => {
    const now = new Date();
    const daysArray = [];

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

    return { days: daysArray };
  }, [entries, category]);

  // Last 7 days as bars, plus a week-over-week momentum caption derived
  // from the same 30-day array (previous 7 vs. most recent 7).
  const { week, momentumPercent } = useMemo(() => {
    const last7 = days.slice(-7);
    const prev7 = days.slice(-14, -7);

    const avgOf = (arr) => {
      const moods = arr.map(d => d.mood).filter(m => m !== null);
      return moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
    };

    const lastAvg = avgOf(last7);
    const prevAvg = avgOf(prev7);
    const percent = (lastAvg !== null && prevAvg !== null)
      ? Math.round((lastAvg - prevAvg) * 100)
      : null;

    return { week: last7, momentumPercent: percent };
  }, [days]);

  // Bucket a mood score (0-1) into the accent-1..4 scale used across Cloud
  const accentForMood = (mood) => {
    if (mood === null) return 'var(--divider)';
    if (mood >= 0.75) return 'var(--accent-4)';
    if (mood >= 0.5) return 'var(--accent-3)';
    if (mood >= 0.25) return 'var(--accent-2)';
    return 'var(--accent-1)';
  };

  const todayIndex = week.length - 1;

  return (
    <Card className={`w-full p-4 ${isEditing ? 'animate-shake' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-foreground">Mood trend</span>
        {momentumPercent !== null && (
          <span className="text-xs text-accent">
            {momentumPercent > 0 ? `+${momentumPercent}% ↗` : momentumPercent < 0 ? `${momentumPercent}%` : 'Steady'}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {week.map((day, i) => {
          const isToday = i === todayIndex;
          // Bar height: min 22% for no-data days, scaled by mood otherwise
          const heightPercent = day.mood === null ? 22 : Math.round(22 + day.mood * 78);
          const color = isToday ? 'var(--accent)' : accentForMood(day.mood);
          return (
            <button
              key={day.dateStr}
              type="button"
              disabled={isEditing || day.count === 0}
              onClick={() => !isEditing && day.count > 0 && onDayClick?.(day.date, day)}
              className="flex h-16 flex-col items-center justify-end disabled:cursor-default"
              style={{ WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' }}
              aria-label={day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            >
              <motion.span
                className="w-full rounded-[5px]"
                style={{ height: `${heightPercent}%`, background: color }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: i * 0.03, duration: 0.25 }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-2">
        {week.map((day, i) => (
          <span
            key={day.dateStr}
            className={`text-center text-[10px] ${i === todayIndex ? 'font-medium text-accent' : 'text-faint'}`}
          >
            {day.date.toLocaleDateString('en-US', { weekday: 'narrow' })}
          </span>
        ))}
      </div>
    </Card>
  );
};

export default MoodHeatmapWidget;
