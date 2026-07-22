/**
 * timeCorrelations tests (R4 Task 1b).
 *
 * Brings timeCorrelations.js under the adapter (it was missed from the R4
 * Task 1 plan's file list, but is the same engine family and the review's
 * findings apply verbatim): consumes ONLY adapter-normalized entries
 * (`mood01`/`timestampMs`, never raw `analysis.mood_score`/`createdAt`),
 * gains unique-day gating, and fixes the day-of-week sub-analysis's
 * baseline (was comparing a day against an ALL-entries average that
 * included that day's own entries — now compares against the
 * non-overlapping complement of every OTHER day).
 *
 * Local `Date(year, month, day, hour)` constructors are used throughout
 * (never ISO 'Z' strings) so day-of-week/hour classification is
 * deterministic regardless of the CI machine's timezone — `safeDate`
 * passes a `Date` instance through unchanged, and both the adapter's
 * `dateKey` and this engine's day-of-week classification run off the same
 * local Date semantics `new Date(ms).getDay()`/`.getHours()` always used.
 */
import { describe, it, expect } from 'vitest';
import { computeTimeCorrelations } from '../timeCorrelations';
import { normalizeEntryForInsights } from '../../../insights/entryAdapter';

const n = (raw) => normalizeEntryForInsights(raw);

// July 2026: Mondays = 6, 13, 20; Tue=7,14 Wed=8,15 Thu=9,16 Fri=10,17 Sat=4,11,18 Sun=5,12,19
const localDate = (day, hour = 10) => new Date(2026, 6, day, hour, 0, 0);

describe('computeTimeCorrelations', () => {
  it('consumes adapter-normalized entries (mood01/timestampMs), not raw analysis.mood_score/createdAt', () => {
    const entries = [];
    for (const day of [4, 11, 18]) { // 3 Saturdays
      entries.push(n({ id: `sat-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.9 } }));
    }
    for (const day of [6, 7, 8, 9, 13]) { // 5 weekdays
      entries.push(n({ id: `wd-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.5 } }));
    }

    const insights = computeTimeCorrelations(entries);
    expect(insights.find(ins => ins.id.includes('weekend_weekday'))).toBeTruthy();
  });

  it('day-of-week: uses the non-overlapping complement (this day vs every OTHER day), not the old all-entries-average baseline', () => {
    const entries = [];
    // 5 Mondays (determineStrength needs sampleSize>=5 to not be "weak")
    for (const day of [6, 13, 20, 27]) {
      entries.push(n({ id: `mon-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.2 } }));
    }
    entries.push(n({ id: 'mon-aug3', createdAt: new Date(2026, 7, 3, 10), analysis: { mood_score: 0.2 } }));
    for (const day of [7, 8, 9, 10, 11]) { // Tue/Wed/Thu/Fri/Sat — 5 distinct other days
      entries.push(n({ id: `other-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.6 } }));
    }

    const insights = computeTimeCorrelations(entries);
    const monday = insights.find(ins => ins.dayName === 'Monday');
    expect(monday).toBeTruthy();
    // Complement baseline: otherMood = 0.6 exactly (not diluted by
    // Monday's own 0.2 entries, which the old all-entries average would
    // have folded in) -> moodDelta = round((0.2-0.6)*100) = -40.
    expect(monday.baselineMood).toBe(60);
    expect(monday.moodDelta).toBe(-40);
    expect(monday.insight).toContain('than your other entries');
  });

  it('day-grounding: no day-of-week insight when the day spans fewer than MIN_UNIQUE_DAYS distinct calendar days', () => {
    const entries = [];
    // 3 Monday ENTRIES but all on the SAME single Monday (different hours)
    for (const hour of [8, 12, 16]) {
      entries.push(n({ id: `mon-${hour}`, createdAt: localDate(6, hour), analysis: { mood_score: 0.1 } }));
    }
    for (const day of [7, 8, 9, 10, 11, 12]) {
      entries.push(n({ id: `other-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.6 } }));
    }

    const insights = computeTimeCorrelations(entries);
    expect(insights.find(ins => ins.dayName === 'Monday')).toBeUndefined();
  });

  it('weekend/weekday complement baseline was already correct (each entry is exactly one or the other) — verified via adapter, wording is association-only', () => {
    const entries = [];
    for (const day of [4, 11, 18]) { // 3 Saturdays
      entries.push(n({ id: `sat-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.9 } }));
    }
    for (const day of [6, 7, 8, 9, 13]) { // 5 weekdays
      entries.push(n({ id: `wd-${day}`, createdAt: localDate(day), analysis: { mood_score: 0.5 } }));
    }

    const insights = computeTimeCorrelations(entries);
    const weekend = insights.find(ins => ins.id.includes('weekend_weekday'));
    expect(weekend.insight.toLowerCase()).not.toMatch(/boosts|lowers|causes/);
    expect(weekend.uniqueDayCount).toBeGreaterThanOrEqual(3);
  });

  it('time-of-day: gates each bucket on unique days before comparing best vs worst', () => {
    const entries = [];
    // "morning" bucket: 4 entries but only 1 distinct day (same-day repeats)
    for (const hour of [6, 7, 8, 9]) {
      entries.push(n({ id: `morn-${hour}`, createdAt: localDate(6, hour), analysis: { mood_score: 0.9 } }));
    }
    // "evening" bucket: 4 entries across 4 distinct days
    for (const day of [7, 8, 9, 10]) {
      entries.push(n({ id: `eve-${day}`, createdAt: localDate(day, 18), analysis: { mood_score: 0.3 } }));
    }

    const insights = computeTimeCorrelations(entries);
    // Morning fails day-grounding (1 unique day), so there's no second
    // day-grounded bucket to compare evening against -> no time_of_day insight.
    expect(insights.find(ins => ins.id.includes('time_of_day'))).toBeUndefined();
  });

  it('returns [] for fewer than MIN_ENTRIES adapter entries', () => {
    const entries = [n({ id: 'a', createdAt: localDate(6), analysis: { mood_score: 0.5 } })];
    expect(computeTimeCorrelations(entries)).toEqual([]);
  });
});
