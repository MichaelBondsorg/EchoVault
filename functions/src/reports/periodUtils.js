/**
 * Period Date Utilities
 *
 * Computes period start/end dates for report cadences.
 * Extracted as pure functions for testability without Firebase imports.
 */

export const THRESHOLDS = {
  weekly:    { minEntries: 2, minDays: 2 },
  monthly:   { minEntries: 5, minDays: 5 },
  quarterly: { minEntries: 15, minDays: 15 },
  annual:    { minEntries: 50, minDays: 50 },
};

/**
 * Compute period start and end dates for a cadence.
 * @param {'weekly'|'monthly'|'quarterly'|'annual'} cadence
 * @param {Date} referenceDate
 * @returns {{ periodStart: Date, periodEnd: Date }}
 */
export function computePeriod(cadence, referenceDate = new Date()) {
  const d = new Date(referenceDate);
  let periodStart, periodEnd;

  switch (cadence) {
    case 'weekly': {
      const day = d.getDay() || 7;
      periodEnd = new Date(d);
      periodEnd.setDate(d.getDate() - day);
      periodEnd.setHours(23, 59, 59, 999);
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodEnd.getDate() - 6);
      periodStart.setHours(0, 0, 0, 0);
      break;
    }
    case 'monthly': {
      periodStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      periodEnd = new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
      break;
    }
    case 'quarterly': {
      const currentQuarter = Math.floor(d.getMonth() / 3);
      const prevQuarterStart = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
      const year = currentQuarter === 0 ? d.getFullYear() - 1 : d.getFullYear();
      periodStart = new Date(year, prevQuarterStart, 1);
      periodEnd = new Date(year, prevQuarterStart + 3, 0, 23, 59, 59, 999);
      break;
    }
    case 'annual': {
      const prevYear = d.getFullYear() - 1;
      periodStart = new Date(prevYear, 0, 1);
      periodEnd = new Date(prevYear, 11, 31, 23, 59, 59, 999);
      break;
    }
    default:
      throw new Error(`Unknown cadence: ${cadence}`);
  }

  return { periodStart, periodEnd };
}

/**
 * Generate report ID in deduplication format.
 * @param {'weekly'|'monthly'|'quarterly'|'annual'} cadence
 * @param {Date} periodStart
 * @returns {string}
 */
export function generateReportId(cadence, periodStart) {
  return `${cadence}-${periodStart.toISOString().slice(0, 10)}`;
}
