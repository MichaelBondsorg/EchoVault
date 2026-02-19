/**
 * Period Utility Functions
 *
 * Pure date range calculation utilities for analytics periods.
 * All operations use UTC to avoid timezone drift.
 */

export const CADENCES = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  ANNUAL: 'annual',
};

/**
 * Returns Monday 00:00:00 to Sunday 23:59:59 UTC for the ISO week containing the given date.
 */
export function getWeekRange(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  // ISO week: Monday = 1, Sunday = 0 → shift Sunday to 7
  const diff = day === 0 ? 6 : day - 1;

  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff, 0, 0, 0, 0));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6, 23, 59, 59, 999));

  return { start, end };
}

/**
 * Returns 1st 00:00:00 to last day 23:59:59 UTC for the month containing the given date.
 */
export function getMonthRange(date) {
  const d = new Date(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Returns Q start to Q end for the quarter containing the given date.
 * Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec.
 */
export function getQuarterRange(date) {
  const d = new Date(date);
  const month = d.getUTCMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;

  const start = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Returns Jan 1 to Dec 31 for the year containing the given date.
 */
export function getYearRange(date) {
  const d = new Date(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  return { start, end };
}

/**
 * Returns a period key string for deduplication, e.g. "weekly-2026-02-17".
 * The key uses the start date of the period.
 */
export function getPeriodKey(date, cadence) {
  let range;
  switch (cadence) {
    case CADENCES.WEEKLY:
      range = getWeekRange(date);
      break;
    case CADENCES.MONTHLY:
      range = getMonthRange(date);
      break;
    case CADENCES.QUARTERLY:
      range = getQuarterRange(date);
      break;
    case CADENCES.ANNUAL:
      range = getYearRange(date);
      break;
    default:
      throw new Error(`Unknown cadence: ${cadence}`);
  }
  const s = range.start;
  const yyyy = s.getUTCFullYear();
  const mm = String(s.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(s.getUTCDate()).padStart(2, '0');
  return `${cadence}-${yyyy}-${mm}-${dd}`;
}
