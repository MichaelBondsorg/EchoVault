import { describe, it, expect, vi, beforeEach } from 'vitest';

// hasWorkout must stay null (unknown) rather than being fabricated to
// `false` when the upstream source didn't report it — consistent with the
// null-not-fabricated fix already applied elsewhere (see healthDataService.js
// lines 311/346 and src/services/health/__tests__/workoutNull.test.js, which
// covers the correlation-consumer side of this contract).

// healthBackfill.js imports config/firebase (auth/db) and firebase/firestore
// for its Firestore-querying exports; mocked here (same pattern as
// entryHealthEnrichment.test.js) since fetchWhoopForDate/fetchHealthKitForDate
// never touch either.
vi.mock('../../../config/firebase', () => ({
  auth: { currentUser: null },
  db: {},
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(),
  doc: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('../whoop', () => ({
  getWhoopSummary: vi.fn(),
  isWhoopLinked: vi.fn(),
}));
vi.mock('../healthKit', () => ({
  getHealthKitSummary: vi.fn(),
  checkHealthKitPermissions: vi.fn(),
}));
vi.mock('../platformHealth', () => ({
  getHealthDataStrategy: vi.fn(),
  cacheHealthData: vi.fn(async () => {}),
  getCachedHealthData: vi.fn(),
  detectPlatform: vi.fn(),
}));
vi.mock('../googleFit', () => ({
  getGoogleFitSummary: vi.fn(),
  getGoogleFitHistory: vi.fn(),
  requestGoogleFitPermissions: vi.fn(),
  checkGoogleFitPermissions: vi.fn(),
}));

const { fetchWhoopForDate, fetchHealthKitForDate } = await import('../healthBackfill');
const { getWhoopSummary } = await import('../whoop');
const { getHealthKitSummary } = await import('../healthKit');
const { cacheHealthData } = await import('../platformHealth');
const { saveManualHealthInput } = await import('../healthDataService');

const baseWhoopSummary = (overrides = {}) => ({
  available: true,
  requestedLocalDate: '2026-07-20',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  sleep: { totalHours: 7.5 },
  recovery: { score: 80 },
  heart: { restingRate: 55 },
  activity: {},
  ...overrides,
});

const baseHealthKitSummary = (overrides = {}) => ({
  available: true,
  sleep: { totalHours: 7.5 },
  activity: {},
  heart: { restingRate: 55 },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchWhoopForDate — hasWorkout null-not-fabricated', () => {
  it('stays null when Whoop did not report activity.hasWorkout', async () => {
    getWhoopSummary.mockResolvedValue(baseWhoopSummary());
    const result = await fetchWhoopForDate(new Date('2026-07-20T12:00:00.000Z'));
    expect(result).not.toBeNull();
    expect(result.activity.hasWorkout).toBeNull();
  });

  it('preserves an explicit true/false from Whoop (not overwritten by the null default)', async () => {
    getWhoopSummary.mockResolvedValue(baseWhoopSummary({ activity: { hasWorkout: true } }));
    const result = await fetchWhoopForDate(new Date('2026-07-20T12:00:00.000Z'));
    expect(result.activity.hasWorkout).toBe(true);

    getWhoopSummary.mockResolvedValue(baseWhoopSummary({ activity: { hasWorkout: false } }));
    const result2 = await fetchWhoopForDate(new Date('2026-07-20T12:00:00.000Z'));
    expect(result2.activity.hasWorkout).toBe(false);
  });
});

describe('fetchHealthKitForDate — hasWorkout null-not-fabricated', () => {
  it('stays null when HealthKit did not report activity.hasWorkout', async () => {
    getHealthKitSummary.mockResolvedValue(baseHealthKitSummary());
    const result = await fetchHealthKitForDate(new Date('2026-07-20T12:00:00.000Z'));
    expect(result).not.toBeNull();
    expect(result.activity.hasWorkout).toBeNull();
  });

  it('preserves an explicit true/false from HealthKit', async () => {
    getHealthKitSummary.mockResolvedValue(baseHealthKitSummary({ activity: { hasWorkout: true } }));
    const result = await fetchHealthKitForDate(new Date('2026-07-20T12:00:00.000Z'));
    expect(result.activity.hasWorkout).toBe(true);
  });
});

describe('saveManualHealthInput — hasWorkout null-not-fabricated', () => {
  it('stays null when hadWorkout was not supplied on the manual form input', async () => {
    const saved = await saveManualHealthInput({ sleepHours: 7 });
    expect(saved.hasWorkout).toBeNull();
    expect(cacheHealthData).toHaveBeenCalledWith(expect.objectContaining({ hasWorkout: null }));
  });

  it('preserves an explicit true/false from the manual form input', async () => {
    const saved = await saveManualHealthInput({ sleepHours: 7, hadWorkout: true });
    expect(saved.hasWorkout).toBe(true);

    const saved2 = await saveManualHealthInput({ sleepHours: 7, hadWorkout: false });
    expect(saved2.hasWorkout).toBe(false);
  });
});
