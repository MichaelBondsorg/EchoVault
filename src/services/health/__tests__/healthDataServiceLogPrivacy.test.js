import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRIV-02: healthDataService.js must never console.log the full health
// summary/context object (previously JSON.stringify'd wholesale) — only
// availability/source/counts. Mocking pattern mirrors
// src/services/health/__tests__/hasWorkoutNull.test.js (whoop/healthKit/
// googleFit/platformHealth mocked at the module boundary healthDataService
// imports).
vi.mock('../whoop', () => ({
  isWhoopLinked: vi.fn(async () => false),
  getWhoopSummary: vi.fn(),
  getWhoopHistory: vi.fn(),
}));
vi.mock('../healthKit', () => ({
  getHealthKitSummary: vi.fn(),
  getHealthKitHistory: vi.fn(),
  requestHealthKitPermissions: vi.fn(),
  checkHealthKitPermissions: vi.fn(),
}));
vi.mock('../googleFit', () => ({
  getGoogleFitSummary: vi.fn(),
  getGoogleFitHistory: vi.fn(),
  requestGoogleFitPermissions: vi.fn(),
  checkGoogleFitPermissions: vi.fn(),
}));
vi.mock('../platformHealth', () => ({
  getHealthDataStrategy: vi.fn(async () => ({ strategy: 'healthkit', isAvailable: true })),
  cacheHealthData: vi.fn(async () => {}),
  getCachedHealthData: vi.fn(),
  detectPlatform: vi.fn(() => ({ platform: 'ios', isNative: true })),
}));

const { getHealthKitSummary } = await import('../healthKit');
const { getEntryHealthContext } = await import('../healthDataService');

// Distinctive, collision-unlikely sentinel numbers standing in for real
// health values that must never reach the console.
const SENTINEL_SLEEP_HOURS = 6.6543;
const SENTINEL_HRV = 777.111;
const SENTINEL_STEPS = 888222;
const SENTINEL_RESTING_HR = 654321;

beforeEach(() => {
  vi.clearAllMocks();
  getHealthKitSummary.mockResolvedValue({
    available: true,
    source: 'healthkit',
    date: '2026-07-20',
    sleep: { totalHours: SENTINEL_SLEEP_HOURS, quality: 'good', score: 88, stages: { deep: 1, core: 2, rem: 3, awake: 4 } },
    heart: { restingRate: SENTINEL_RESTING_HR, currentRate: 70, hrv: SENTINEL_HRV, hrvTrend: 'stable', stressIndicator: 'low' },
    activity: { stepsToday: SENTINEL_STEPS, totalCaloriesBurned: 2000, activeCaloriesBurned: 500, totalExerciseMinutes: 30, hasWorkout: true, workouts: [] },
  });
});

describe('healthDataService.js — no raw health values in console logs (PRIV-02)', () => {
  it('getEntryHealthContext never logs sleep/heart/activity values, only availability/source/counts', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const context = await getEntryHealthContext();

    // Sanity check: the sentinels really did flow through to the returned
    // context, so this test would catch a real regression.
    expect(context.sleep.totalHours).toBe(SENTINEL_SLEEP_HOURS);
    expect(context.heart.hrv).toBe(SENTINEL_HRV);
    expect(context.activity.stepsToday).toBe(SENTINEL_STEPS);
    expect(context.heart.restingRate).toBe(SENTINEL_RESTING_HR);

    const allLoggedText = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' | ');

    for (const sentinel of [SENTINEL_SLEEP_HOURS, SENTINEL_HRV, SENTINEL_STEPS, SENTINEL_RESTING_HR]) {
      expect(allLoggedText.includes(String(sentinel))).toBe(false);
    }

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
