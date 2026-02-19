/**
 * Chart Data Preparation Tests
 */
import { describe, it, expect } from 'vitest';
import { prepareMoodTrend, prepareCategoryBreakdown, prepareEntryFrequency } from '../charts.js';

describe('prepareMoodTrend', () => {
  it('returns empty array for null/empty input', () => {
    expect(prepareMoodTrend(null, 'weekly')).toEqual([]);
    expect(prepareMoodTrend([], 'weekly')).toEqual([]);
  });

  it('returns daily points for weekly cadence', () => {
    const data = [
      { date: '2026-02-09', moodScore: 7 },
      { date: '2026-02-10', moodScore: 5 },
      { date: '2026-02-11', moodScore: 8 },
    ];
    const result = prepareMoodTrend(data, 'weekly');
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: '2026-02-09', value: 7 });
  });

  it('aggregates to weekly averages for quarterly cadence', () => {
    // 7 entries across 2 weeks
    const data = [
      { date: '2026-01-06', moodScore: 6 },
      { date: '2026-01-07', moodScore: 8 },
      { date: '2026-01-13', moodScore: 4 },
      { date: '2026-01-14', moodScore: 6 },
    ];
    const result = prepareMoodTrend(data, 'quarterly');
    expect(result.length).toBeGreaterThanOrEqual(2);
    // Each entry should have date and value
    result.forEach(p => {
      expect(p).toHaveProperty('date');
      expect(p).toHaveProperty('value');
      expect(typeof p.value).toBe('number');
    });
  });
});

describe('prepareCategoryBreakdown', () => {
  it('returns empty array for null/empty input', () => {
    expect(prepareCategoryBreakdown(null)).toEqual([]);
    expect(prepareCategoryBreakdown({})).toEqual([]);
  });

  it('computes percentages correctly', () => {
    const stats = { personal: 50, work: 30, health: 20 };
    const result = prepareCategoryBreakdown(stats);
    expect(result).toHaveLength(3);
    expect(result[0].label).toBe('personal');
    expect(result[0].value).toBe(50);
    expect(result[0].percentage).toBe(50);
    expect(result[1].percentage).toBe(30);
    expect(result[2].percentage).toBe(20);
  });

  it('sorts by value descending', () => {
    const stats = { a: 10, b: 30, c: 20 };
    const result = prepareCategoryBreakdown(stats);
    expect(result[0].label).toBe('b');
    expect(result[1].label).toBe('c');
    expect(result[2].label).toBe('a');
  });

  it('filters out zero-value categories', () => {
    const stats = { a: 10, b: 0, c: 5 };
    const result = prepareCategoryBreakdown(stats);
    expect(result).toHaveLength(2);
  });
});

describe('prepareEntryFrequency', () => {
  it('returns empty array for null/empty input', () => {
    expect(prepareEntryFrequency(null, 'weekly')).toEqual([]);
    expect(prepareEntryFrequency([], 'weekly')).toEqual([]);
  });

  it('groups by day for weekly cadence', () => {
    const entries = [
      { date: '2026-02-09T10:00:00Z' },
      { date: '2026-02-09T14:00:00Z' },
      { date: '2026-02-10T09:00:00Z' },
    ];
    const result = prepareEntryFrequency(entries, 'weekly');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: '2026-02-09', count: 2 });
    expect(result[1]).toEqual({ date: '2026-02-10', count: 1 });
  });

  it('groups by week for annual cadence', () => {
    const entries = [
      { date: '2026-01-06T10:00:00Z' },
      { date: '2026-01-07T10:00:00Z' },
      { date: '2026-01-13T10:00:00Z' },
    ];
    const result = prepareEntryFrequency(entries, 'annual');
    expect(result.length).toBeGreaterThanOrEqual(2);
    result.forEach(p => {
      expect(p).toHaveProperty('date');
      expect(p).toHaveProperty('count');
    });
  });
});
