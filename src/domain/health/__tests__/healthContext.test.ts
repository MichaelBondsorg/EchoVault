import { createHealthObservation, parseHealthContext } from '../healthContext';

describe('health context contract', () => {
  const validObservation = {
    field: 'sleep.totalHours',
    value: 8.2,
    unit: 'hours',
    source: 'whoop' as const,
    observedStart: '2026-07-17T06:00:00.000Z',
    observedEnd: '2026-07-17T14:12:00.000Z',
    requestedLocalDate: '2026-07-17',
    timezone: 'America/Los_Angeles',
    queriedAt: '2026-07-18T12:00:00.000Z',
    freshness: 'fresh' as const,
  };

  it('requires source, unit, timezone, dates, and a supported schema version', () => {
    expect(createHealthObservation(validObservation)).toMatchObject({ schemaVersion: 1 });
    expect(() => createHealthObservation({ ...validObservation, timezone: '' })).toThrow(
      'timezone_required'
    );
    expect(() => parseHealthContext({ schemaVersion: 99, observations: [] })).toThrow(
      'unsupported_health_schema'
    );
  });

  it('rejects an observation whose source day differs from the requested day', () => {
    expect(() =>
      createHealthObservation({
        ...validObservation,
        requestedLocalDate: '2026-07-16',
      })
    ).toThrow('health_date_mismatch');
  });

  it('rejects impossible WHOOP sleep totals instead of persisting them', () => {
    expect(() => createHealthObservation({ ...validObservation, value: 29.1 })).toThrow(
      'health_value_out_of_range'
    );
  });
});
