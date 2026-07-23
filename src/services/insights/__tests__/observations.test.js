import { describe, it, expect } from 'vitest';
import {
  OBSERVATION_SCHEMA_VERSION, buildDailyObservations,
  observationSeriesFor, moodSeriesFor, enumerateExposures,
} from '../observations';
import { UNKNOWN } from '../entryAdapter';

const entry = (id, iso, over = {}) => ({
  id, createdAt: iso, text: 'sample text for the day',
  analysis: { mood_score: 0.6 }, tags: ['gym'], entry_type: 'reflection',
  ...over,
});

describe('buildDailyObservations', () => {
  it('groups entries by local dateKey with mean mood on the 0-100 scale', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { analysis: { mood_score: 0.4 } }),
      entry('b', '2026-07-01T20:00:00Z', { analysis: { mood_score: 0.8 } }),
      entry('c', '2026-07-02T09:00:00Z', { analysis: { mood_score: 0.5 } }),
    ], { timeZone: 'UTC' });
    expect(obs).toHaveLength(2);
    expect(obs[0]).toMatchObject({ dateKey: '2026-07-01', mood100: 60 });
    expect(obs[0].entryIds).toEqual(['a', 'b']);
    expect(obs[1].mood100).toBe(50);
  });

  it('mood100 is null (not 0) when no entry that day has a valid mood', () => {
    const obs = buildDailyObservations(
      [entry('a', '2026-07-01T09:00:00Z', { analysis: {} })], { timeZone: 'UTC' });
    expect(obs[0].mood100).toBeNull();
  });

  // NOTE: fixture adjusted from the plan's draft — the draft's entry 'b'
  // override (`{ tags: ['run'] }`) fully replaces the factory's default
  // `tags: ['gym']` (shallow spread), so it never actually produced a
  // 'gym'+'run' union as the draft's assertion claimed. Giving entry 'b'
  // both tags directly still exercises the real contract: entry 'a''s
  // UNKNOWN tags are dropped (not treated as absence) while entry 'b''s
  // known tags survive into the day-level union, and day 2 (all entries
  // UNKNOWN) stays UNKNOWN rather than collapsing to [].
  it('day tags are UNKNOWN only when EVERY entry that day has UNKNOWN tags; union otherwise', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { tags: undefined, analysis: { mood_score: 0.5 } }),
      entry('b', '2026-07-01T12:00:00Z', { tags: ['gym', 'run'] }),
      entry('c', '2026-07-02T09:00:00Z', { tags: undefined, analysis: { mood_score: 0.5 } }),
    ], { timeZone: 'UTC' });
    expect(obs[0].tags).toEqual(['gym', 'run'].sort());
    expect(obs[1].tags).toBe(UNKNOWN);
  });

  it('flags a day sensitive when any entry is safety_flagged or has_warning_indicators', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { safety_flagged: true }),
      entry('b', '2026-07-02T09:00:00Z'),
    ], { timeZone: 'UTC' });
    expect(obs[0].sensitive).toBe(true);
    expect(obs[1].sensitive).toBe(false);
  });

  it('entry with only entryId (no id) and safety_flagged still marks day sensitive', () => {
    const obs = buildDailyObservations([
      {
        entryId: 'uuid-123',
        createdAt: '2026-07-01T09:00:00Z',
        text: 'unsafe text',
        analysis: { mood_score: 0.5 },
        tags: ['gym'],
        entry_type: 'reflection',
        safety_flagged: true,
      },
    ], { timeZone: 'UTC' });
    expect(obs).toHaveLength(1);
    expect(obs[0].sensitive).toBe(true);
  });

  it('buildDailyObservations is order-independent (same entries shuffled produce identical results)', () => {
    const entries = [
      entry('a', '2026-07-01T14:30:00Z', { tags: ['run'] }),
      entry('b', '2026-07-01T09:15:00Z', { tags: ['gym'] }),
      entry('c', '2026-07-02T10:00:00Z', { tags: ['swim'] }),
    ];

    const obs1 = buildDailyObservations(entries, { timeZone: 'UTC' });
    const obs2 = buildDailyObservations([entries[2], entries[0], entries[1]], { timeZone: 'UTC' });

    expect(obs1).toEqual(obs2);
    expect(obs1[0].entryIds).toEqual(obs2[0].entryIds);
    expect(obs1[0].category).toBe(obs2[0].category);
  });

  it('day tags merge (union) across multiple entries on same day', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { tags: ['gym'] }),
      entry('b', '2026-07-01T14:00:00Z', { tags: ['run'] }),
    ], { timeZone: 'UTC' });

    expect(obs).toHaveLength(1);
    expect(obs[0].tags).toEqual(['gym', 'run']);
  });
});

describe('observationSeriesFor', () => {
  const obs = buildDailyObservations([
    entry('a', '2026-07-01T09:00:00Z', { tags: ['gym'] }),
    entry('b', '2026-07-02T09:00:00Z', { tags: [] }),
    entry('c', '2026-07-03T09:00:00Z', { tags: undefined }),
  ], { timeZone: 'UTC' });

  it('binary tag exposure: present=1, known-absent=0, UNKNOWN day OMITTED (never 0)', () => {
    const series = observationSeriesFor(obs, { key: 'tag:gym', kind: 'tag', label: 'gym', splitMode: 'binary' });
    expect(series).toEqual([
      { dateKey: '2026-07-01', value: 1 },
      { dateKey: '2026-07-02', value: 0 },
    ]); // 07-03 omitted: tags UNKNOWN
  });

  // NOTE: fixture key aligned to the REAL adapter shape — extractHealthSignals()
  // (src/services/health/healthFormatter.js) reads healthContext.sleep.totalHours
  // and emits it as `sleepHours` (camelCase), not `sleep.hoursSlept` / `sleep_hours`
  // as originally drafted in the plan. See HEALTH_EXPOSURE_FIELDS in observations.js.
  it('health exposure: numeric value per day, days without the field omitted', () => {
    const withHealth = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { healthContext: { sleep: { totalHours: 7.5 } } }),
      entry('b', '2026-07-02T09:00:00Z'),
    ], { timeZone: 'UTC' });
    const spec = { key: 'health:sleepHours', kind: 'health', field: 'sleepHours', label: 'sleep hours', splitMode: 'median' };
    const series = observationSeriesFor(withHealth, spec);
    expect(series).toHaveLength(1);
    expect(series[0].dateKey).toBe('2026-07-01');
    expect(series[0].value).toBeCloseTo(7.5);
  });
});

describe('moodSeriesFor', () => {
  it('emits only days with a valid mood, 0-100', () => {
    const obs = buildDailyObservations([
      entry('a', '2026-07-01T09:00:00Z', { analysis: { mood_score: 0.7 } }),
      entry('b', '2026-07-02T09:00:00Z', { analysis: {} }),
    ], { timeZone: 'UTC' });
    expect(moodSeriesFor(obs)).toEqual([{ dateKey: '2026-07-01', value: 70 }]);
  });
});

describe('enumerateExposures', () => {
  it('emits a tag spec only at >= minPresentDays present-days; health at >= minHealthDays observed days', () => {
    const entries = [];
    for (let d = 1; d <= 6; d += 1) {
      entries.push(entry(`t${d}`, `2026-07-0${d}T09:00:00Z`, {
        tags: d <= 3 ? ['gym'] : ['other'],
        healthContext: d <= 5 ? { sleep: { totalHours: 6 + d } } : undefined,
      }));
    }
    const specs = enumerateExposures(buildDailyObservations(entries, { timeZone: 'UTC' }));
    const keys = specs.map((s) => s.key);
    expect(keys).toContain('tag:gym');       // 3 present days
    expect(keys).toContain('tag:other');     // 3 present days
    expect(keys).toContain('health:sleepHours'); // 5 observed days
  });

  it('exposure keys are stable and lowercase (candidate identity across runs)', () => {
    const specs = enumerateExposures(buildDailyObservations(
      [entry('a', '2026-07-01T09:00:00Z', { tags: ['Gym'] }),
       entry('b', '2026-07-02T09:00:00Z', { tags: ['gym'] }),
       entry('c', '2026-07-03T09:00:00Z', { tags: ['GYM'] })], { timeZone: 'UTC' }), { minPresentDays: 3 });
    expect(specs.filter((s) => s.kind === 'tag').map((s) => s.key)).toEqual(['tag:gym']);
  });
});

describe('OBSERVATION_SCHEMA_VERSION', () => {
  it('is exported as 1', () => {
    expect(OBSERVATION_SCHEMA_VERSION).toBe(1);
  });
});
