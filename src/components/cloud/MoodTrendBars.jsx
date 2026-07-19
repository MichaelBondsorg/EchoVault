import { motion } from 'framer-motion';
import { accentForMood } from '../../utils/moodTrend';

/**
 * Shared bar-chart renderer for mood-trend day arrays (from
 * `getMoodTrendDays` in src/utils/moodTrend.js). Bars use the
 * accent-1..4 intensity scale (today = full `--accent`, no-data days =
 * `--divider`) per CLOUD-DESIGN-SPEC.md §7 ("mood-trend bar card" /
 * Insights "trend bars, today = full accent").
 *
 * Single source for this rendering: Home's mood-trend card
 * (MoodHeatmapWidget, C2) and Insights' Week/Month trend section (C5b)
 * both render through this component instead of each keeping their own
 * copy of the bar JSX - a near-identical renderer living in two places
 * was flagged as a D1 review nit for other widgets, so this was
 * extracted up front rather than repeating it.
 *
 * Per-bar weekday labels (narrow, e.g. "M") are only shown when there
 * are few enough bars to stay legible (<=7, i.e. the Week view) - for
 * a 30-bar Month view a label under every bar would be illegible on a
 * phone width, and the mockup only specifies the 7-bar Week state, so
 * labels are simply omitted for larger windows rather than inventing an
 * unspecified sparse-label scheme.
 */
export const MoodTrendBars = ({
  days,
  todayDateStr,
  onDayClick,
  disabled = false,
  className = '',
  // Home's card (C2) keeps its original per-bar entrance animation.
  // Insights' Week/Month section (C5b) doesn't need one (spec: "bars
  // are static") so it opts out rather than inheriting Home's motion.
  animate = true,
}) => {
  const barCount = days.length;
  const showLabels = barCount <= 7;
  const tight = barCount > 14;
  const gapClass = tight ? 'gap-[2px]' : 'gap-2';
  const radiusClass = tight ? 'rounded-[2px]' : 'rounded-[5px]';
  const interactive = typeof onDayClick === 'function';

  return (
    <div className={className}>
      <div className={`flex h-16 items-end ${gapClass}`}>
        {days.map((day, i) => {
          const isToday = day.dateStr === todayDateStr;
          // Bar height: min 22% for no-data days, scaled by mood otherwise.
          const heightPercent = day.mood === null ? 22 : Math.round(22 + day.mood * 78);
          const color = isToday ? 'var(--accent)' : accentForMood(day.mood);
          const label = day.date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          const Comp = interactive ? 'button' : 'div';

          return (
            <Comp
              key={day.dateStr}
              type={interactive ? 'button' : undefined}
              disabled={interactive ? (disabled || day.count === 0) : undefined}
              onClick={interactive ? () => !disabled && day.count > 0 && onDayClick(day.date, day) : undefined}
              className={`flex h-full flex-1 flex-col items-center justify-end ${interactive ? 'disabled:cursor-default' : ''}`}
              style={interactive ? { WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation' } : undefined}
              aria-label={label}
            >
              <motion.span
                className={`w-full ${radiusClass}`}
                style={{ height: `${heightPercent}%`, background: color }}
                initial={animate ? { scaleY: 0 } : false}
                animate={{ scaleY: 1 }}
                transition={animate ? { delay: i * 0.02, duration: 0.25 } : { duration: 0 }}
              />
            </Comp>
          );
        })}
      </div>
      {showLabels && (
        <div className={`mt-1 flex ${gapClass}`}>
          {days.map(day => (
            <span
              key={day.dateStr}
              className={`flex-1 text-center text-[10px] ${day.dateStr === todayDateStr ? 'font-medium text-accent' : 'text-faint'}`}
            >
              {day.date.toLocaleDateString('en-US', { weekday: 'narrow' })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default MoodTrendBars;
