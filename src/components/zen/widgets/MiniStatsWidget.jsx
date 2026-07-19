import { useMemo } from 'react';
import { Card, RisingTide } from '../../cloud';
import { calculateStreak } from '../../../services/dashboard';

/**
 * MiniStatsWidget - 3 stat cells for the Home screen (CLOUD-DESIGN-SPEC.md
 * §7 Home: "3 stat cells (Avg mood / Streak / Rising tide)", §6.2 for the
 * Rising tide widget). Restyle only — the underlying 7-day mood
 * aggregation below is unchanged from the pre-Cloud widget; the only
 * addition is exposing the already-computed first/second-half averages as
 * a momentum percentage for the Rising tide cell.
 *
 * D4b follow-up: the Streak cell used to run its own inline day-by-day walk
 * capped at 30 days, which disagreed with StreakCelebration's uncapped
 * `calculateStreak()` (services/dashboard/index.js) at streak >= 31 (Home
 * would show 30 while the celebration showed the real, larger number). Both
 * used equivalent local-calendar-day boundary logic (`toDateString()` here
 * vs. `calculateStreak`'s `getDateString()`/`formatDateForInput`, both
 * local getFullYear/Month/Date — no timezone/UTC discrepancy), so the cap
 * was the only semantic difference. Swapped to the same single-source-of-
 * truth `calculateStreak()` StreakCelebration already uses; the cell's
 * displayed shape/format is unchanged.
 */
const MiniStatsWidget = ({
  entries = [],
  isEditing = false,
  onDelete,
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

    // Calculate mood momentum (compare first half vs second half of the week)
    let momentumPercent = 0;
    if (entriesWithMood.length >= 4) {
      const mid = Math.floor(entriesWithMood.length / 2);
      const firstHalf = entriesWithMood.slice(mid);
      const secondHalf = entriesWithMood.slice(0, mid);

      const firstAvg = firstHalf.reduce((s, e) => s + e.analysis.mood_score, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((s, e) => s + e.analysis.mood_score, 0) / secondHalf.length;

      momentumPercent = Math.round((secondAvg - firstAvg) * 100);
    }

    // Calculate streak (consecutive days with entries) — single source of
    // truth via calculateStreak() (services/dashboard/index.js), the same
    // helper StreakCelebration (D4b) reads from, so this cell and the
    // celebration never disagree.
    const streak = calculateStreak(entries).currentStreak;

    return {
      avgMood,
      momentumPercent,
      streak,
    };
  }, [entries]);

  const isRising = stats.momentumPercent > 0;

  return (
    <div className={`grid w-full grid-cols-3 gap-2 ${isEditing ? 'animate-shake' : ''}`}>
      {/* Avg mood (0-10 scale, matches Insights' formatting) */}
      <Card className="p-3 text-center">
        <div className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">
          {(stats.avgMood * 10).toFixed(1)}
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">Avg mood</div>
      </Card>

      {/* Streak */}
      <Card className="p-3 text-center">
        <div className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">
          {stats.streak}
          <span className="text-xs font-normal text-muted-foreground"> days</span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-muted-foreground">Streak</div>
      </Card>

      {/* Rising tide momentum widget (§6.2) */}
      <RisingTide className="p-3 text-center">
        <div className="text-[19px] font-semibold tracking-[-0.02em] text-foreground">
          {isRising ? `+${stats.momentumPercent}%` : stats.momentumPercent === 0 ? '—' : `${stats.momentumPercent}%`}
        </div>
        <div className="mt-0.5 text-[11.5px] text-accent-deep">
          {isRising ? 'Rising' : 'Steady'}
        </div>
      </RisingTide>
    </div>
  );
};

export default MiniStatsWidget;
