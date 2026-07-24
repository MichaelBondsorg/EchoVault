import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so owner-scoping is actually exercised,
// plus a Geolocation stand-in (permission denied, so getCurrentLocation
// always falls through to the cache path this suite is testing).
//
// vitest.config.js aliases '@capacitor/preferences' AND
// '@capacitor/geolocation' to the SAME underlying mock file — vi.mock()
// intercepts by resolved module id, so two separate factory registrations
// here would collide (the later one silently wins for BOTH specifiers,
// dropping the other's exports — see
// src/__tests__/validationMatrix.test.js's own comment on this exact
// collision, and platformHealth.ownerScope.test.js's identical note for
// the Preferences/Capacitor pairing). `vi.mock()` factories are hoisted
// above module-level `const`s (TDZ), so a shared factory variable can't be
// referenced from either call — duplicated verbatim under both specifiers
// instead, same as validationMatrix.test.js's own established workaround.
// `store` itself is safe to reference (factories run lazily at
// import-resolution time, by which point it's initialized).
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
    keys: async () => ({ keys: Array.from(store.keys()) }),
  },
  Geolocation: {
    checkPermissions: vi.fn().mockResolvedValue({ location: 'denied' }),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'denied' }),
    getCurrentPosition: vi.fn(),
  },
}));
vi.mock('@capacitor/geolocation', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
    keys: async () => ({ keys: Array.from(store.keys()) }),
  },
  Geolocation: {
    checkPermissions: vi.fn().mockResolvedValue({ location: 'denied' }),
    requestPermissions: vi.fn().mockResolvedValue({ location: 'denied' }),
    getCurrentPosition: vi.fn(),
  },
}));

const authState = { currentUser: null };
vi.mock('../../../config/firebase', () => ({
  auth: authState,
}));

const { getCurrentLocation } = await import('../environmentService.js');

const LEGACY_LOCATION_KEY = 'env_location_cache';

const asUser = (uid) => { authState.currentUser = uid ? { uid } : null; };

const freshLocation = (overrides = {}) => ({
  latitude: 37.77,
  longitude: -122.42,
  accuracy: 10,
  timestamp: Date.now(),
  ...overrides,
});

describe('environmentService.js owner-scoped location cache (PRIV-01)', () => {
  beforeEach(() => {
    store.clear();
    authState.currentUser = null;
  });

  it('reads only the authenticated owners own cached location, never a global or other-owner value', async () => {
    store.set('env_location_cache::user-a', JSON.stringify(freshLocation()));
    store.set('env_location_cache::user-b', JSON.stringify(freshLocation({ latitude: 1, longitude: 2 })));

    asUser('user-a');
    const locationA = await getCurrentLocation();
    expect(locationA.latitude).toBe(37.77);
    expect(locationA.cached).toBe(true);

    asUser('user-b');
    const locationB = await getCurrentLocation();
    expect(locationB.latitude).toBe(1);
  });

  it('quarantines a pre-migration legacy global cache on a scoped miss — never adopted by the next signed-in owner', async () => {
    store.set(LEGACY_LOCATION_KEY, JSON.stringify(freshLocation()));

    asUser('user-a');
    const location = await getCurrentLocation();

    // No cache to fall back to (this owner never cached, permission denied,
    // no live fix) — never the legacy value.
    expect(location).toBeNull();
    expect(store.has(LEGACY_LOCATION_KEY)).toBe(false);
    expect(store.has('env_location_cache::user-a')).toBe(false);
  });

  it('quarantines the legacy global cache and returns nothing usable when nobody is signed in', async () => {
    store.set(LEGACY_LOCATION_KEY, JSON.stringify(freshLocation()));

    asUser(null);
    const location = await getCurrentLocation();

    expect(location).toBeNull();
    expect(store.has(LEGACY_LOCATION_KEY)).toBe(false);
  });

  it('removes (not merely ignores) an expired owner-scoped location cache on read', async () => {
    asUser('user-a');
    store.set('env_location_cache::user-a', JSON.stringify(freshLocation({
      timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25h ago
    })));

    const location = await getCurrentLocation();

    expect(location).toBeNull();
    // Actually removed, not just ignored.
    expect(store.has('env_location_cache::user-a')).toBe(false);
  });
});
