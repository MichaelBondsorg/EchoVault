import { normalizeWhoopSummary, requestedLocalDate } from '../whoopTransforms';

describe('WHOOP client contract', () => {
  const response = {
    available: true,
    source: 'whoop',
    date: '2026-07-16',
    requestedLocalDate: '2026-07-16',
    timezone: 'America/Los_Angeles',
    queriedAt: '2026-07-16T16:00:00.000Z',
    sleep: { totalHours: 7.5, quality: 'good', score: 82, inBed: 8, asleep: 7.5 },
    hrv: { average: 45, stressIndicator: 'moderate' },
    heartRate: { resting: 58 },
    recovery: { score: 72, status: 'green' },
    strain: { score: 10.2, calories: 800 },
    workouts: [{ type: 'Running', durationSeconds: 3_600, calories: 400, strain: 8 }],
  };

  it('never fabricates steps from calories and converts seconds to minutes once', () => {
    const summary = normalizeWhoopSummary(
      response,
      '2026-07-16',
      'America/Los_Angeles'
    );
    expect(summary.activity.stepsToday).toBeNull();
    expect(summary.steps).toBeNull();
    expect(summary.activity.totalExerciseMinutes).toBe(60);
  });

  it('preserves recovery, strain, and durable provenance', () => {
    const summary = normalizeWhoopSummary(
      response,
      '2026-07-16',
      'America/Los_Angeles'
    );
    expect(summary.recovery.score).toBe(72);
    expect(summary.strain.score).toBe(10.2);
    expect(summary.requestedLocalDate).toBe('2026-07-16');
    expect(summary.timezone).toBe('America/Los_Angeles');
  });

  it('rejects mismatched provider dates and physiologically impossible sleep', () => {
    expect(() =>
      normalizeWhoopSummary(response, '2026-07-15', 'America/Los_Angeles')
    ).toThrow('whoop_date_mismatch');
    expect(() =>
      normalizeWhoopSummary(
        { ...response, sleep: { ...response.sleep, totalHours: 29.1 } },
        '2026-07-16',
        'America/Los_Angeles'
      )
    ).toThrow('whoop_sleep_out_of_range');
  });

  it('derives a local requested day rather than an accidental UTC day', () => {
    expect(
      requestedLocalDate(new Date('2026-07-17T02:00:00.000Z'), 'America/Los_Angeles')
    ).toBe('2026-07-16');
  });
});
