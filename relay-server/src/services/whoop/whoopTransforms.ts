export const ISO_LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function localDateForInstant(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('whoop_instant_invalid');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function assertLocalDate(value: string): string {
  if (!ISO_LOCAL_DATE.test(value)) throw new Error('whoop_date_invalid');
  return value;
}

export function assertTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return value;
  } catch {
    throw new Error('whoop_timezone_invalid');
  }
}

export function buildWhoopQueryWindow(requestedLocalDate: string): {
  start: Date;
  end: Date;
} {
  assertLocalDate(requestedLocalDate);
  const anchor = new Date(`${requestedLocalDate}T00:00:00.000Z`).getTime();
  // IANA offsets span roughly UTC-12…UTC+14. Query wide, then filter every
  // returned record by the requested local date before deriving a summary.
  return {
    start: new Date(anchor - 14 * 60 * 60 * 1000),
    end: new Date(anchor + 38 * 60 * 60 * 1000),
  };
}

export function filterRecordsForLocalDate<T>(
  records: T[],
  requestedLocalDate: string,
  timezone: string,
  observedAt: (record: T) => string | null | undefined
): T[] {
  assertLocalDate(requestedLocalDate);
  assertTimezone(timezone);
  return records.filter((record) => {
    const instant = observedAt(record);
    if (!instant) return false;
    try {
      return localDateForInstant(instant, timezone) === requestedLocalDate;
    } catch {
      return false;
    }
  });
}

export function durationSeconds(start: string, end: string): number {
  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('whoop_duration_invalid');
  return Math.round(durationMs / 1000);
}

export function sleepDurationHours(inBedMs: number, awakeMs: number): number {
  const hours = (inBedMs - awakeMs) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0 || hours > 16) {
    throw new Error('whoop_sleep_out_of_range');
  }
  return hours;
}
