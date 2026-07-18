import { describe, expect, it } from 'vitest';
import {
  buildWhoopQueryWindow,
  durationSeconds,
  filterRecordsForLocalDate,
  sleepDurationHours,
} from '../services/whoop/whoopTransforms.js';

describe('WHOOP date and unit contracts', () => {
  it('filters a provider response even when it contains multiple local dates', () => {
    const records = [
      { id: 1, end: '2026-07-15T14:00:00.000Z' },
      { id: 2, end: '2026-07-16T14:00:00.000Z' },
      { id: 3, end: '2026-07-17T14:00:00.000Z' },
    ];
    expect(
      filterRecordsForLocalDate(records, '2026-07-16', 'America/Los_Angeles', (r) => r.end)
    ).toEqual([records[1]]);
  });

  it('uses a deliberately wide provider window and relies on explicit filtering', () => {
    const { start, end } = buildWhoopQueryWindow('2026-07-16');
    expect(end.getTime() - start.getTime()).toBe(52 * 60 * 60 * 1000);
  });

  it('normalizes workout milliseconds to canonical seconds once', () => {
    expect(
      durationSeconds('2026-07-16T10:00:00.000Z', '2026-07-16T11:00:00.000Z')
    ).toBe(3_600);
  });

  it('rejects impossible sleep values instead of returning them', () => {
    expect(sleepDurationHours(8 * 3_600_000, 30 * 60_000)).toBe(7.5);
    expect(() => sleepDurationHours(30 * 3_600_000, 30 * 60_000)).toThrow(
      'whoop_sleep_out_of_range'
    );
  });
});
