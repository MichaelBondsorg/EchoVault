/**
 * Report Scheduler Tests
 *
 * Tests period computation and threshold logic.
 * Uses periodUtils.js (pure functions, no Firebase imports).
 */
import { describe, it, expect } from 'vitest';
import { computePeriod, generateReportId, THRESHOLDS } from '../periodUtils.js';

function toLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('computePeriod', () => {
  describe('weekly', () => {
    it('computes previous Monday-Sunday for a Monday reference', () => {
      // Monday Feb 17, 2026
      const ref = new Date(2026, 1, 17, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('weekly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-02-09');
      expect(toLocalDate(periodEnd)).toBe('2026-02-15');
    });

    it('computes correct range for a Wednesday reference', () => {
      // Wednesday Feb 19, 2026
      const ref = new Date(2026, 1, 19, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('weekly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-02-09');
      expect(toLocalDate(periodEnd)).toBe('2026-02-15');
    });

    it('handles Sunday reference date', () => {
      // Sunday Feb 15, 2026
      const ref = new Date(2026, 1, 15, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('weekly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-02-02');
      expect(toLocalDate(periodEnd)).toBe('2026-02-08');
    });
  });

  describe('monthly', () => {
    it('computes previous month for Feb 1 reference', () => {
      const ref = new Date(2026, 1, 1, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('monthly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-01-01');
      expect(toLocalDate(periodEnd)).toBe('2026-01-31');
    });

    it('handles month with 28 days (Feb)', () => {
      const ref = new Date(2026, 2, 1, 10, 0, 0); // March 1
      const { periodStart, periodEnd } = computePeriod('monthly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-02-01');
      expect(toLocalDate(periodEnd)).toBe('2026-02-28');
    });
  });

  describe('quarterly', () => {
    it('computes Q4 of prev year for Q1 reference', () => {
      const ref = new Date(2026, 0, 15, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('quarterly', ref);
      expect(toLocalDate(periodStart)).toBe('2025-10-01');
      expect(toLocalDate(periodEnd)).toBe('2025-12-31');
    });

    it('computes Q1 for Q2 reference', () => {
      const ref = new Date(2026, 3, 1, 10, 0, 0); // April 1
      const { periodStart, periodEnd } = computePeriod('quarterly', ref);
      expect(toLocalDate(periodStart)).toBe('2026-01-01');
      expect(toLocalDate(periodEnd)).toBe('2026-03-31');
    });
  });

  describe('annual', () => {
    it('computes previous year', () => {
      const ref = new Date(2026, 0, 2, 10, 0, 0);
      const { periodStart, periodEnd } = computePeriod('annual', ref);
      expect(toLocalDate(periodStart)).toBe('2025-01-01');
      expect(toLocalDate(periodEnd)).toBe('2025-12-31');
    });
  });

  it('throws for unknown cadence', () => {
    expect(() => computePeriod('biweekly')).toThrow('Unknown cadence');
  });
});

describe('generateReportId', () => {
  it('generates weekly report ID', () => {
    const start = new Date('2026-02-09T00:00:00Z');
    expect(generateReportId('weekly', start)).toBe('weekly-2026-02-09');
  });

  it('generates monthly report ID', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(generateReportId('monthly', start)).toBe('monthly-2026-01-01');
  });
});

describe('THRESHOLDS', () => {
  it('has correct weekly thresholds', () => {
    expect(THRESHOLDS.weekly).toEqual({ minEntries: 2, minDays: 2 });
  });

  it('has correct annual thresholds', () => {
    expect(THRESHOLDS.annual).toEqual({ minEntries: 50, minDays: 50 });
  });
});
