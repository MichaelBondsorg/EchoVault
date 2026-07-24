import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRIV-01: environmentService.js now resolves the owner uid from the live
// Firebase auth session (mirrors whoop.js's established pattern) to scope
// its location cache. Mock config/firebase directly (rather than letting
// the real module initialize) — same approach as
// src/services/health/__tests__/hasWorkoutNull.test.js /
// whoop.cache.test.js. A signed-in uid (not null) keeps this file's
// existing cache-fallback path exercised exactly as before: per the
// Preferences mock's own comment below, this suite relies on the aliased
// @capacitor/geolocation/@capacitor/preferences mocks colliding to force
// getCurrentLocation through its catch-and-fall-back-to-cache branch, which
// now requires a resolvable owner uid to read the (owner-scoped) cache key.
vi.mock('../../../config/firebase', () => ({
  auth: { currentUser: { uid: 'test-user-env-null' } },
}));

// Grant permission + return a fixed position so getCurrentLocation resolves.
vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    checkPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'granted' }),
    getCurrentPosition: vi.fn().mockResolvedValue({
      coords: { latitude: 37.77, longitude: -122.42, accuracy: 10 },
    }),
  },
}));

// Return a fresh cached location so getCurrentLocation resolves regardless of
// the (aliased) geolocation plugin — the isDay normalization is what we test.
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({
      value: JSON.stringify({ latitude: 37.77, longitude: -122.42, accuracy: 10, timestamp: Date.now() }),
    }),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// getCurrentWeather is the only knob we care about — isDay is driven by it.
const getCurrentWeather = vi.fn();
vi.mock('../apis/weather', () => ({
  getCurrentWeather: (...a) => getCurrentWeather(...a),
  getDailyWeatherHistory: vi.fn().mockResolvedValue([]),
  getWeatherIcon: vi.fn(),
}));

vi.mock('../apis/sunTimes', () => ({
  getSunTimes: vi.fn().mockResolvedValue(null),
  isAfterSunset: vi.fn().mockReturnValue(false),
  isBeforeSunrise: vi.fn().mockReturnValue(false),
  getDaylightRemaining: vi.fn().mockReturnValue(null),
}));

const { getEntryEnvironmentContext } = await import('../environmentService');

describe('environmentService isDay — never fabricated', () => {
  beforeEach(() => {
    getCurrentWeather.mockReset();
  });

  it('leaves isDay null when the weather source has no day/night reading', async () => {
    getCurrentWeather.mockResolvedValue({ condition: 'clear', temperature: 20 }); // no isDay
    const ctx = await getEntryEnvironmentContext();
    expect(ctx.isDay).toBe(null);
  });

  it('passes an explicit false through (does not coerce to true)', async () => {
    getCurrentWeather.mockResolvedValue({ condition: 'clear', temperature: 20, isDay: false });
    const ctx = await getEntryEnvironmentContext();
    expect(ctx.isDay).toBe(false);
  });

  it('passes an explicit true through', async () => {
    getCurrentWeather.mockResolvedValue({ condition: 'clear', temperature: 20, isDay: true });
    const ctx = await getEntryEnvironmentContext();
    expect(ctx.isDay).toBe(true);
  });
});
