import { getDateString } from './date';

/**
 * Mood-trend derivation helpers backing Insights' Week/Month section
 * (task C5b, CLOUD-DESIGN-SPEC.md §7 Insights). Pure functions only -
 * no Firestore/React deps - so InsightsPage (and any future consumer)
 * can derive everything from the `entries` array it already has via
 * useMemo, with no new reads/services/props.
 *
 * `accentForMood` is the single source of truth for the mood
 * bucket->CSS-var mapping already established in EntryCard's
 * getMoodDotColor / MoodHeatmapWidget's (pre-C5b) local accentForMood
 * (both C4-aligned). Those two call sites were refactored to import
 * this instead of keeping their own copies, so there is exactly one
 * mapping in the codebase, not three.
 */
export const accentForMood = (mood) => {
  if (mood === null || mood === undefined) return 'var(--divider)';
  if (mood >= 0.75) return 'var(--accent-4)';
  if (mood >= 0.5) return 'var(--accent-3)';
  if (mood >= 0.25) return 'var(--accent-2)';
  return 'var(--accent-1)';
};

/**
 * Resolve an entry's effective date to a JS Date, or null if it has no
 * usable date. Accepts Firestore Timestamp-like objects (`.toDate()`),
 * Date instances, and date strings/numbers.
 */
const resolveEntryDate = (entry) => {
  const raw = entry?.effectiveDate || entry?.createdAt;
  if (!raw) return null;
  const d = typeof raw?.toDate === 'function' ? raw.toDate() : new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Build a trailing `windowDays`-day array of per-day mood aggregates
 * ending on (and including) `referenceDate`, oldest first. Day
 * boundaries use `getDateString` (local calendar day, the same
 * boundary `calculateStreak` uses) - NOT `toDateString()` and NOT a
 * UTC split - so an entry at 11:59pm and one at 12:01am the same night
 * land in different, correct buckets regardless of timezone.
 *
 * Each bucket also carries its raw `entries` array (that day's journal
 * entries) so consumers that drill into a single day - e.g. Home's
 * "open Day Summary modal" click-through - have what they need without
 * a second pass over the full entries list.
 *
 * @returns {{ days: Array<{date: Date, dateStr: string, mood: number|null, count: number, entries: Array}>, todayDateStr: string }}
 */
export const getMoodTrendDays = (entries = [], { windowDays = 7, referenceDate = new Date() } = {}) => {
  const todayDateStr = getDateString(referenceDate);

  const days = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - i);
    days.push({ date, dateStr: getDateString(date), mood: null, count: 0, entries: [], _moods: [] });
  }

  const byDateStr = new Map(days.map(d => [d.dateStr, d]));

  for (const entry of entries || []) {
    const d = resolveEntryDate(entry);
    if (!d) continue;
    const bucket = byDateStr.get(getDateString(d));
    if (!bucket) continue; // outside the requested window
    bucket.count += 1;
    bucket.entries.push(entry);
    const mood = entry.analysis?.mood_score;
    if (mood !== undefined && mood !== null) {
      bucket._moods.push(mood);
    }
  }

  for (const day of days) {
    day.mood = day._moods.length > 0
      ? day._moods.reduce((a, b) => a + b, 0) / day._moods.length
      : null;
    delete day._moods;
  }

  return { days, todayDateStr };
};

/**
 * Momentum caption for the trend card ("+12% ↗"): splits the given day
 * array in half and compares the later half's average mood to the
 * earlier half's. Returns null (render nothing) when there isn't
 * enough data on both sides to compare - never a misleading 0-from-
 * missing-data ambiguity, since a *real* zero delta is also returned
 * as `0`.
 */
export const getMoodMomentum = (days) => {
  if (!days || days.length < 2) return null;
  const mid = Math.floor(days.length / 2);
  const earlier = days.slice(0, mid);
  const later = days.slice(mid);

  const avgOf = (arr) => {
    const moods = arr.map(d => d.mood).filter(m => m !== null && m !== undefined);
    return moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null;
  };

  const earlierAvg = avgOf(earlier);
  const laterAvg = avgOf(later);
  if (earlierAvg === null || laterAvg === null) return null;
  return Math.round((laterAvg - earlierAvg) * 100);
};

/**
 * Entries-per-period "fill" metric feeding the Rising Tide stat cell:
 * what fraction of the days in the window actually have a journal
 * entry logged.
 */
export const getEntryFillMetric = (days) => {
  const totalDays = days?.length || 0;
  const filledDays = (days || []).filter(d => d.count > 0).length;
  const fillPercent = totalDays > 0 ? Math.round((filledDays / totalDays) * 100) : 0;
  return { filledDays, totalDays, fillPercent };
};
