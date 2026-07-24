import { describe, it, expect, vi } from 'vitest';

// PRIV-02: environmentBackfill.js's cache-hit path used to log its
// coordinate-derived cache key (rounded to ~10km, but still coordinates)
// straight to the console. This drives two entries through the same
// date/location bucket so the cache-hit branch actually fires, then asserts
// no coordinate digits — full precision or rounded — ever reach
// console.log. State referenced by vi.mock() factories is declared and
// initialized BEFORE the vi.mock() calls themselves, matching the
// established workaround in
// src/services/environment/__tests__/environmentService.ownerScope.test.js
// (vi.mock factories are hoisted above module-level consts/TDZ).
const FULL_LAT = 37.774929;
const FULL_LNG = -122.419415;
const entryDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const dateStr = entryDate.toISOString().split('T')[0];

const makeDocSnap = (id) => ({
  id,
  data: () => ({
    createdAt: { toDate: () => entryDate },
    text: 'a private journal entry about something',
    location: { latitude: FULL_LAT, longitude: FULL_LNG },
  }),
});

const snapshot = {
  forEach: (cb) => {
    cb(makeDocSnap('entry-1'));
    cb(makeDocSnap('entry-2'));
  },
};

const dailyHistory = [
  {
    date: dateStr,
    condition: 'clear',
    conditionLabel: 'Clear',
    tempMax: 70,
    tempMin: 55,
    sunshineDuration: 300,
    sunshinePercent: 80,
    isLowLight: false,
    daylightHours: 10,
  },
];

vi.mock('../../../config/firebase', () => ({
  auth: { currentUser: { uid: 'user-1' } },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(async () => snapshot),
  doc: vi.fn(),
  writeBatch: vi.fn(() => ({ update: vi.fn(), commit: vi.fn(async () => {}) })),
}));

vi.mock('../apis/weather', () => ({
  getDailyWeatherHistory: vi.fn(async () => dailyHistory),
}));

const { backfillEnvironmentData } = await import('../environmentBackfill.js');

describe('environmentBackfill.js — no coordinates in console logs, even on a cache hit (PRIV-02)', () => {
  it('processes two same-location entries (forcing a cache hit) without ever logging latitude/longitude', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const results = await backfillEnvironmentData();

    // Sanity: both entries were actually processed through the cache-miss
    // then cache-hit path this test targets.
    expect(results.updated).toBe(2);
    expect(results.skipped).toBe(0);

    const allLoggedText = logSpy.mock.calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' | ');

    // No full-precision coordinate digits...
    expect(allLoggedText).not.toContain('774929');
    expect(allLoggedText).not.toContain('419415');
    // ...and no rounded ~10km cache-bucket coordinates either (37.8 / -122.4).
    expect(allLoggedText).not.toMatch(/37\.8/);
    expect(allLoggedText).not.toMatch(/-122\.4\b/);

    logSpy.mockRestore();
  });
});
