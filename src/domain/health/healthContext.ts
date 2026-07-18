export const HEALTH_SCHEMA_VERSION = 1 as const;

export type HealthSource = 'whoop' | 'healthkit' | 'manual' | 'device' | 'weather';

export type HealthObservation<T = unknown> = {
  field: string;
  value: T;
  unit: string;
  source: HealthSource;
  sourceRecordId?: string;
  observedStart: string;
  observedEnd: string;
  requestedLocalDate: string;
  timezone: string;
  queriedAt: string;
  freshness: 'fresh' | 'stale';
  schemaVersion: typeof HEALTH_SCHEMA_VERSION;
};

export type HealthContext = {
  schemaVersion: typeof HEALTH_SCHEMA_VERSION;
  observations: HealthObservation[];
};

type NewObservation<T> = Omit<HealthObservation<T>, 'schemaVersion'>;

const localDate = (instant: string, timezone: string): string => {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('health_date_invalid');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
};

export function createHealthObservation<T>(input: NewObservation<T>): HealthObservation<T> {
  if (!input.timezone) throw new Error('timezone_required');
  if (!input.unit) throw new Error('health_unit_required');
  if (!input.field) throw new Error('health_field_required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.requestedLocalDate)) {
    throw new Error('health_requested_date_invalid');
  }
  if (localDate(input.observedEnd, input.timezone) !== input.requestedLocalDate) {
    throw new Error('health_date_mismatch');
  }
  if (
    input.source === 'whoop' &&
    input.field === 'sleep.totalHours' &&
    (typeof input.value !== 'number' || input.value < 0 || input.value > 16)
  ) {
    throw new Error('health_value_out_of_range');
  }
  return { ...input, schemaVersion: HEALTH_SCHEMA_VERSION };
}

export function parseHealthContext(value: unknown): HealthContext {
  if (!value || typeof value !== 'object') throw new Error('health_context_invalid');
  const candidate = value as Partial<HealthContext>;
  if (candidate.schemaVersion !== HEALTH_SCHEMA_VERSION) {
    throw new Error('unsupported_health_schema');
  }
  if (!Array.isArray(candidate.observations)) throw new Error('health_observations_invalid');
  return candidate as HealthContext;
}
