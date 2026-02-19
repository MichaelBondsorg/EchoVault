import { describe, it, expect } from 'vitest';
import {
  getWeekRange, getMonthRange, getQuarterRange, getYearRange,
  getPeriodKey, CADENCES
} from '../periodUtils.js';

describe('periodUtils', () => {
  describe('getWeekRange', () => {
    it('returns Monday-Sunday for given date', () => {
      // Wednesday Feb 19, 2026
      const { start, end } = getWeekRange(new Date('2026-02-19T12:00:00Z'));
      expect(start.getUTCDay()).toBe(1); // Monday
      expect(start.getUTCDate()).toBe(16);
      expect(end.getUTCDay()).toBe(0); // Sunday
      expect(end.getUTCDate()).toBe(22);
    });

    it('handles Monday input correctly', () => {
      const { start, end } = getWeekRange(new Date('2026-02-16T00:00:00Z'));
      expect(start.getUTCDate()).toBe(16);
      expect(end.getUTCDate()).toBe(22);
    });

    it('handles Sunday input correctly', () => {
      const { start, end } = getWeekRange(new Date('2026-02-22T23:59:59Z'));
      expect(start.getUTCDate()).toBe(16);
      expect(end.getUTCDate()).toBe(22);
    });

    it('start is 00:00:00.000 and end is 23:59:59.999', () => {
      const { start, end } = getWeekRange(new Date('2026-02-19T12:00:00Z'));
      expect(start.getUTCHours()).toBe(0);
      expect(start.getUTCMinutes()).toBe(0);
      expect(start.getUTCSeconds()).toBe(0);
      expect(end.getUTCHours()).toBe(23);
      expect(end.getUTCMinutes()).toBe(59);
      expect(end.getUTCSeconds()).toBe(59);
    });
  });

  describe('getMonthRange', () => {
    it('returns 1st to last day', () => {
      const { start, end } = getMonthRange(new Date('2026-02-15T12:00:00Z'));
      expect(start.getUTCDate()).toBe(1);
      expect(start.getUTCMonth()).toBe(1); // Feb
      expect(end.getUTCDate()).toBe(28); // Feb 2026 is not a leap year
      expect(end.getUTCMonth()).toBe(1);
    });

    it('handles months with 31 days', () => {
      const { end } = getMonthRange(new Date('2026-01-15T00:00:00Z'));
      expect(end.getUTCDate()).toBe(31);
    });

    it('handles leap year February', () => {
      const { end } = getMonthRange(new Date('2028-02-15T00:00:00Z'));
      expect(end.getUTCDate()).toBe(29);
    });
  });

  describe('getQuarterRange', () => {
    it('returns correct 3-month window for Q1', () => {
      const { start, end } = getQuarterRange(new Date('2026-02-15T00:00:00Z'));
      expect(start.getUTCMonth()).toBe(0); // Jan
      expect(start.getUTCDate()).toBe(1);
      expect(end.getUTCMonth()).toBe(2); // Mar
      expect(end.getUTCDate()).toBe(31);
    });

    it('returns correct 3-month window for Q4', () => {
      const { start, end } = getQuarterRange(new Date('2026-12-01T00:00:00Z'));
      expect(start.getUTCMonth()).toBe(9); // Oct
      expect(end.getUTCMonth()).toBe(11); // Dec
      expect(end.getUTCDate()).toBe(31);
    });

    it('handles year boundary correctly (Dec 31 to Jan 1)', () => {
      const dec31 = getQuarterRange(new Date('2025-12-31T23:59:59Z'));
      expect(dec31.start.getUTCFullYear()).toBe(2025);
      expect(dec31.start.getUTCMonth()).toBe(9); // Oct 2025

      const jan1 = getQuarterRange(new Date('2026-01-01T00:00:00Z'));
      expect(jan1.start.getUTCFullYear()).toBe(2026);
      expect(jan1.start.getUTCMonth()).toBe(0); // Jan 2026
    });
  });

  describe('getYearRange', () => {
    it('returns Jan 1 to Dec 31', () => {
      const { start, end } = getYearRange(new Date('2026-06-15T00:00:00Z'));
      expect(start.getUTCMonth()).toBe(0);
      expect(start.getUTCDate()).toBe(1);
      expect(end.getUTCMonth()).toBe(11);
      expect(end.getUTCDate()).toBe(31);
    });
  });

  describe('getPeriodKey', () => {
    it('generates weekly key with Monday start date', () => {
      const key = getPeriodKey(new Date('2026-02-19T12:00:00Z'), CADENCES.WEEKLY);
      expect(key).toBe('weekly-2026-02-16');
    });

    it('generates monthly key with 1st of month', () => {
      const key = getPeriodKey(new Date('2026-02-19T12:00:00Z'), CADENCES.MONTHLY);
      expect(key).toBe('monthly-2026-02-01');
    });

    it('generates quarterly key with quarter start', () => {
      const key = getPeriodKey(new Date('2026-05-15T00:00:00Z'), CADENCES.QUARTERLY);
      expect(key).toBe('quarterly-2026-04-01');
    });

    it('generates annual key', () => {
      const key = getPeriodKey(new Date('2026-06-15T00:00:00Z'), CADENCES.ANNUAL);
      expect(key).toBe('annual-2026-01-01');
    });

    it('throws on unknown cadence', () => {
      expect(() => getPeriodKey(new Date(), 'biweekly')).toThrow('Unknown cadence');
    });
  });

  describe('timezone edge cases', () => {
    it('handles UTC midnight correctly', () => {
      const { start } = getWeekRange(new Date('2026-02-16T00:00:00Z'));
      expect(start.getUTCDate()).toBe(16);
    });

    it('handles UTC end of day correctly', () => {
      const { start } = getWeekRange(new Date('2026-02-16T23:59:59Z'));
      expect(start.getUTCDate()).toBe(16);
    });
  });
});
