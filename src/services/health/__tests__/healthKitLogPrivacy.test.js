import { describe, it, expect, vi } from 'vitest';

// PRIV-02: healthKit.js must never log raw health values (sleep-stage
// minutes, derived sleep score, etc.) — only availability/timing. This test
// overrides the global '@capacitor/core' mock (src/test/mocks/capacitor.js,
// which reports platform 'web' and would short-circuit getHealthKitSummary
// before it ever queries anything) with an 'ios' platform + a plugin double
// that returns distinctive sentinel numeric values, then asserts none of
// those sentinels ever reach console.log/warn — while confirming (via the
// returned summary) that the sentinels really did flow through the code
// path being logged.
const SENTINEL_DEEP_MIN = 123.456;
const SENTINEL_CORE_MIN = 234.567;
const SENTINEL_REM_MIN = 45.678;
const SENTINEL_AWAKE_MIN = 12.345;
const SENTINEL_TOTAL_MIN = 421.99;
const SENTINEL_SCORE = 91.5;

let pluginMock;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
  registerPlugin: () => pluginMock,
}));

vi.mock('../platformHealth', () => ({
  setPermissionStatus: vi.fn(async () => {}),
  cacheHealthData: vi.fn(async () => {}),
}));

const inBedEnd = Date.parse('2026-07-20T07:00:00.000Z');
const inBedStart = inBedEnd - 8 * 60 * 60 * 1000;

pluginMock = {
  isHealthAvailable: vi.fn(async () => ({ available: true })),
  queryAggregated: vi.fn(async ({ dataType }) => {
    if (dataType === 'steps') return { aggregatedData: [{ value: 8842 }] };
    return { aggregatedData: [{ value: 0 }] };
  }),
  queryLatestSample: vi.fn(async ({ dataType }) => {
    if (dataType === 'sleep-stages') {
      return {
        total: SENTINEL_TOTAL_MIN,
        deep: SENTINEL_DEEP_MIN,
        core: SENTINEL_CORE_MIN,
        rem: SENTINEL_REM_MIN,
        awake: SENTINEL_AWAKE_MIN,
        awakePeriods: 3,
        inBedStart,
        inBedEnd,
      };
    }
    if (dataType === 'hrv') return { value: 55 };
    if (dataType === 'heart-rate') return { value: 60 };
    if (dataType === 'resting-heart-rate') return { value: 58 };
    return null;
  }),
  queryWorkouts: vi.fn(async () => ({ workouts: [] })),
  calculateSleepScore: vi.fn(async () => ({ score: SENTINEL_SCORE })),
};

const { getHealthKitSummary } = await import('../healthKit.js');

describe('healthKit.js — no raw health values in console logs (PRIV-02)', () => {
  it('never logs sleep-stage minutes or the derived sleep score, only availability/timing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const summary = await getHealthKitSummary(new Date('2026-07-20T12:00:00.000Z'));

    expect(summary.available).toBe(true);
    // Sanity check: the sentinel values really did flow into the summary
    // that's being logged around, so this test would actually catch a
    // regression rather than passing vacuously.
    expect(summary.sleep.stages.deep).toBeCloseTo(SENTINEL_DEEP_MIN / 60, 2);
    expect(summary.sleep.score).toBe(SENTINEL_SCORE);

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' | ');

    for (const sentinel of [
      SENTINEL_DEEP_MIN,
      SENTINEL_CORE_MIN,
      SENTINEL_REM_MIN,
      SENTINEL_AWAKE_MIN,
      SENTINEL_TOTAL_MIN,
      SENTINEL_SCORE,
    ]) {
      expect(allLoggedText.includes(String(sentinel))).toBe(false);
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
