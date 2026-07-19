import { useMemo } from 'react';
import { Card, MoodTrendBars } from '../../cloud';
import { getMoodTrendDays, getMoodMomentum } from '../../../utils/moodTrend';

/**
 * MoodHeatmapWidget - "Mood trend" bar card for the Home screen
 * (CLOUD-DESIGN-SPEC.md §7 Home: "mood-trend bar card"; bars use the
 * accent-1..4 scale, today = full accent - mirrors the Insights "Mood
 * trend" chart in the mockups).
 *
 * The day-aggregation, mood-bucket->color mapping, and bar-rendering
 * JSX all now live in shared code (`src/utils/moodTrend.js` +
 * `MoodTrendBars`) so Insights' Week/Month trend section (C5b) doesn't
 * have to duplicate any of it - this widget was the only consumer
 * before, so it was refactored onto the shared helpers rather than
 * leaving a second copy behind for C5b to diverge from. Visible output
 * is unchanged: still the most recent 7 of a 30-day aggregation, same
 * week-over-week momentum caption, same onDayClick -> Day Summary modal
 * wiring (each bucket still carries its `entries` array).
 */
const MoodHeatmapWidget = ({
  entries = [],
  category,
  onDayClick,
  isEditing = false,
  onDelete,
}) => {
  // Build 30-day data (unchanged aggregation semantics from the pre-Cloud widget)
  const { days } = useMemo(() => {
    const categoryEntries = entries.filter(e => e.category === category);
    return getMoodTrendDays(categoryEntries, { windowDays: 30 });
  }, [entries, category]);

  // Last 7 days as bars, plus a week-over-week momentum caption derived
  // from the same 30-day array (previous 7 vs. most recent 7).
  const { week, todayDateStr, momentumPercent } = useMemo(() => {
    const last14 = days.slice(-14);
    return {
      week: days.slice(-7),
      todayDateStr: days.length > 0 ? days[days.length - 1].dateStr : null,
      momentumPercent: getMoodMomentum(last14),
    };
  }, [days]);

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

      <MoodTrendBars
        days={week}
        todayDateStr={todayDateStr}
        onDayClick={!isEditing ? onDayClick : undefined}
        disabled={isEditing}
      />
    </Card>
  );
};

export default MoodHeatmapWidget;
