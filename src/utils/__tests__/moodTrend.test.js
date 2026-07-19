/**
 * TDD (written first, RED before implementation exists) for the pure
 * mood-trend derivation helper backing Insights' Week/Month section
 * (task C5b). Covers:
 *  - accentForMood: the SAME bucket->CSS-var mapping as
 *    EntryCard.getMoodDotColor / MoodHeatmapWidget.accentForMood
 *    (C4-aligned) - centralized here so nothing invents a third mapping.
 *  - getMoodTrendDays: trailing-N-day aggregation windows, empty-entry
 *    behavior, today-highlight, and day-boundary consistency with
 *    getDateString (local calendar day, not UTC / not toDateString).
 *  - getMoodMomentum / getEntryFillMetric: the small derived stats that
 *    feed the trend-card caption and the Rising Tide stat cell.
 */
import { describe, it, expect } from 'vitest';
import {
  accentForMood,
  getMoodTrendDays,
  getMoodMomentum,
  getEntryFillMetric,
} from '../moodTrend';
import { getDateString } from '../date';

describe('accentForMood', () => {
  it('returns the divider token for missing mood data', () => {
    expect(accentForMood(null)).toBe('var(--divider)');
    expect(accentForMood(undefined)).toBe('var(--divider)');
  });

  it('buckets low moods (< 0.25) into accent-1', () => {
    expect(accentForMood(0)).toBe('var(--accent-1)');
    expect(accentForMood(0.24)).toBe('var(--accent-1)');
  });

  it('buckets 0.25-0.49 into accent-2', () => {
    expect(accentForMood(0.25)).toBe('var(--accent-2)');
    expect(accentForMood(0.49)).toBe('var(--accent-2)');
  });

  it('buckets 0.5-0.74 into accent-3', () => {
    expect(accentForMood(0.5)).toBe('var(--accent-3)');
    expect(accentForMood(0.74)).toBe('var(--accent-3)');
  });

  it('buckets 0.75+ into accent-4 (matches EntryCard.getMoodDotColor exactly)', () => {
    expect(accentForMood(0.75)).toBe('var(--accent-4)');
    expect(accentForMood(1)).toBe('var(--accent-4)');
  });
});

describe('getMoodTrendDays', () => {
  const referenceDate = new Date(2026, 6, 18, 15, 0, 0); // Sat 2026-07-18, 3pm local

  it('returns exactly windowDays buckets, all empty, for no entries', () => {
    const { days } = getMoodTrendDays([], { windowDays: 7, referenceDate });
    expect(days).toHaveLength(7);
    days.forEach(day => {
      expect(day.mood).toBeNull();
      expect(day.count).toBe(0);
    });
  });

  it('supports a 30-day (Month) window', () => {
    const { days } = getMoodTrendDays([], { windowDays: 30, referenceDate });
    expect(days).toHaveLength(30);
  });

  it('highlights today as the last bucket in the window', () => {
    const { days, todayDateStr } = getMoodTrendDays([], { windowDays: 7, referenceDate });
    expect(todayDateStr).toBe(getDateString(referenceDate));
    expect(days[days.length - 1].dateStr).toBe(getDateString(referenceDate));
  });

  it('orders buckets oldest to newest', () => {
    const { days } = getMoodTrendDays([], { windowDays: 7, referenceDate });
    for (let i = 1; i < days.length; i++) {
      expect(new Date(days[i].date) > new Date(days[i - 1].date)).toBe(true);
    }
  });

  it('aggregates a single entry into the matching day, leaving other days null', () => {
    const entries = [
      { effectiveDate: new Date(2026, 6, 17, 9, 0, 0), analysis: { mood_score: 0.8 } },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const yesterday = days.find(d => d.dateStr === '2026-07-17');
    const today = days.find(d => d.dateStr === '2026-07-18');
    expect(yesterday.mood).toBe(0.8);
    expect(yesterday.count).toBe(1);
    expect(today.mood).toBeNull();
    expect(today.count).toBe(0);
  });

  it('averages multiple entries on the same day', () => {
    const entries = [
      { effectiveDate: new Date(2026, 6, 18, 8, 0, 0), analysis: { mood_score: 0.4 } },
      { effectiveDate: new Date(2026, 6, 18, 20, 0, 0), analysis: { mood_score: 0.8 } },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const today = days.find(d => d.dateStr === '2026-07-18');
    expect(today.mood).toBeCloseTo(0.6);
    expect(today.count).toBe(2);
  });

  it('drops entries that fall outside the requested window', () => {
    const entries = [
      // 10 days before referenceDate - outside a 7-day window
      { effectiveDate: new Date(2026, 6, 8, 12, 0, 0), analysis: { mood_score: 0.9 } },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const total = days.reduce((sum, d) => sum + d.count, 0);
    expect(total).toBe(0);
  });

  it('keeps day boundaries consistent with getDateString (local calendar day, not a UTC split)', () => {
    // One entry just before local midnight on 07-17, one just after local
    // midnight on 07-18 - they must land in *different* buckets even
    // though they're less than 2 minutes apart in wall-clock time.
    const entries = [
      { effectiveDate: new Date(2026, 6, 17, 23, 59, 0), analysis: { mood_score: 0.2 } },
      { effectiveDate: new Date(2026, 6, 18, 0, 1, 0), analysis: { mood_score: 0.9 } },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const day17 = days.find(d => d.dateStr === getDateString(new Date(2026, 6, 17, 23, 59, 0)));
    const day18 = days.find(d => d.dateStr === getDateString(new Date(2026, 6, 18, 0, 1, 0)));
    expect(day17.dateStr).toBe('2026-07-17');
    expect(day18.dateStr).toBe('2026-07-18');
    expect(day17.mood).toBe(0.2);
    expect(day18.mood).toBe(0.9);
  });

  it('falls back to createdAt when effectiveDate is absent', () => {
    const entries = [
      { createdAt: new Date(2026, 6, 18, 12, 0, 0), analysis: { mood_score: 0.6 } },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const today = days.find(d => d.dateStr === '2026-07-18');
    expect(today.mood).toBe(0.6);
  });

  it('handles Firestore Timestamp-like objects (.toDate())', () => {
    const entries = [
      {
        effectiveDate: { toDate: () => new Date(2026, 6, 18, 12, 0, 0) },
        analysis: { mood_score: 0.5 },
      },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const today = days.find(d => d.dateStr === '2026-07-18');
    expect(today.mood).toBe(0.5);
  });

  it('skips entries with missing/invalid dates without throwing', () => {
    const entries = [
      { analysis: { mood_score: 0.5 } },
      { effectiveDate: 'not-a-date', analysis: { mood_score: 0.5 } },
    ];
    expect(() => getMoodTrendDays(entries, { windowDays: 7, referenceDate })).not.toThrow();
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(0);
  });

  it('ignores entries with no mood_score for averaging but still counts them', () => {
    const entries = [
      { effectiveDate: new Date(2026, 6, 18, 9, 0, 0), analysis: {} },
    ];
    const { days } = getMoodTrendDays(entries, { windowDays: 7, referenceDate });
    const today = days.find(d => d.dateStr === '2026-07-18');
    expect(today.count).toBe(1);
    expect(today.mood).toBeNull();
  });
});

describe('getMoodMomentum', () => {
  it('returns null with fewer than 2 days', () => {
    expect(getMoodMomentum([{ mood: 0.5 }])).toBeNull();
    expect(getMoodMomentum([])).toBeNull();
  });

  it('returns null when either half has no mood data', () => {
    const days = [{ mood: null }, { mood: null }, { mood: 0.8 }, { mood: 0.6 }];
    expect(getMoodMomentum(days)).toBeNull();
  });

  it('computes the rounded percent delta between the later and earlier half', () => {
    // earlier half avg 0.4, later half avg 0.7 -> +30
    const days = [{ mood: 0.4 }, { mood: 0.4 }, { mood: 0.7 }, { mood: 0.7 }];
    expect(getMoodMomentum(days)).toBe(30);
  });

  it('returns 0 (not null) when the halves are identical', () => {
    const days = [{ mood: 0.5 }, { mood: 0.5 }, { mood: 0.5 }, { mood: 0.5 }];
    expect(getMoodMomentum(days)).toBe(0);
  });

  it('returns a negative delta when mood declines', () => {
    const days = [{ mood: 0.8 }, { mood: 0.8 }, { mood: 0.5 }, { mood: 0.5 }];
    expect(getMoodMomentum(days)).toBe(-30);
  });
});

describe('getEntryFillMetric', () => {
  it('returns zeros for an empty window', () => {
    expect(getEntryFillMetric([])).toEqual({ filledDays: 0, totalDays: 0, fillPercent: 0 });
  });

  it('returns 100% when every day has at least one entry', () => {
    const days = [{ count: 1 }, { count: 2 }, { count: 1 }];
    expect(getEntryFillMetric(days)).toEqual({ filledDays: 3, totalDays: 3, fillPercent: 100 });
  });

  it('computes a rounded partial fill percentage', () => {
    // 2 of 7 days filled -> 28.57...% -> rounds to 29
    const days = [
      { count: 1 }, { count: 0 }, { count: 0 }, { count: 0 },
      { count: 1 }, { count: 0 }, { count: 0 },
    ];
    expect(getEntryFillMetric(days)).toEqual({ filledDays: 2, totalDays: 7, fillPercent: 29 });
  });
});
