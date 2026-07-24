import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so owner-scoping is actually exercised
// (the default test mock is a no-op). Mirrors whoop.cache.test.js's own
// established pattern for this exact family of fix.
//
// vitest.config.js aliases BOTH '@capacitor/core' AND '@capacitor/preferences'
// to the SAME underlying mock file — vi.mock() intercepts by resolved
// module id, so registering a factory for only one specifier makes it win
// for BOTH (see src/__tests__/validationMatrix.test.js's own comment on
// this exact collision). platformHealth.js needs `Capacitor.getPlatform`/
// `isNativePlatform` from the SAME resolved module `Preferences` comes
// from, so both exports are carried on this one factory rather than a
// separate vi.mock('@capacitor/core', ...) call.
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
    keys: async () => ({ keys: Array.from(store.keys()) }),
  },
  Capacitor: {
    getPlatform: () => 'web',
    isNativePlatform: () => false,
  },
}));

// Mutable auth stand-in — tests flip `authState.currentUser` to simulate
// different signed-in accounts (and signed-out) without a module-level
// "current user" cache inside platformHealth.js itself.
const authState = { currentUser: null };
vi.mock('../../../config/firebase', () => ({
  auth: authState,
}));

const {
  cacheHealthData,
  getCachedHealthData,
  setPermissionStatus,
  getPermissionStatus,
  getHealthDataStrategy,
} = await import('../platformHealth.js');

const LEGACY_CACHE_KEY = 'health_context_cache';
const LEGACY_PERMISSION_KEY = 'health_permission_status';

const asUser = (uid) => { authState.currentUser = uid ? { uid } : null; };

describe('platformHealth.js owner-scoped cache (PRIV-01)', () => {
  beforeEach(() => {
    store.clear();
    authState.currentUser = null;
  });

  it('caches health data under the authenticated owner uid, not a global key', async () => {
    asUser('user-a');
    await cacheHealthData({ available: true, sleep: { totalHours: 7 } });

    expect(store.has('health_context_cache::user-a')).toBe(true);
    expect(store.has(LEGACY_CACHE_KEY)).toBe(false);
  });

  it('never caches health data when nobody is signed in', async () => {
    asUser(null);
    await cacheHealthData({ available: true });

    expect(store.size).toBe(0);
  });

  it('never exposes owner As cache to owner B, and quarantines legacy global data on Bs scoped miss', async () => {
    store.set(LEGACY_CACHE_KEY, JSON.stringify({ legacy: true }));

    asUser('user-a');
    await cacheHealthData({ available: true, sleep: { totalHours: 7 } });
    expect(store.has('health_context_cache::user-a')).toBe(true);

    asUser('user-b');
    const cachedB = await getCachedHealthData();

    expect(cachedB).toBeNull();
    expect(store.has('health_context_cache::user-b')).toBe(false);
    // A's own cache is untouched by B's read.
    expect(store.has('health_context_cache::user-a')).toBe(true);
    // The unowned legacy key is discarded — never adopted by B.
    expect(store.has(LEGACY_CACHE_KEY)).toBe(false);
  });

  it('removes (not merely ignores) an expired owner-scoped cache on read', async () => {
    asUser('user-a');
    const staleCachedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    store.set('health_context_cache::user-a', JSON.stringify({
      available: true,
      cachedAt: staleCachedAt,
    }));

    const cached = await getCachedHealthData();

    expect(cached).toBeNull();
    // Actually removed, not just ignored.
    expect(store.has('health_context_cache::user-a')).toBe(false);
  });

  it('getHealthDataStrategy reports manual (no cache) once the owner-scoped cache has expired', async () => {
    asUser('user-a');
    const staleCachedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    store.set('health_context_cache::user-a', JSON.stringify({
      available: true,
      cachedAt: staleCachedAt,
    }));

    const strategy = await getHealthDataStrategy();

    expect(strategy.strategy).toBe('manual');
    expect(strategy.isAvailable).toBe(false);
  });

  it('scopes permission status per owner and quarantines the legacy global key on a scoped miss', async () => {
    store.set(LEGACY_PERMISSION_KEY, 'granted');

    asUser('user-a');
    await setPermissionStatus('granted');
    expect(store.get('health_permission_status::user-a')).toBe('granted');

    asUser('user-b');
    const statusB = await getPermissionStatus();

    expect(statusB).toBe('unknown');
    expect(store.has('health_permission_status::user-b')).toBe(false);
    expect(store.has(LEGACY_PERMISSION_KEY)).toBe(false);
  });

  it('never stores permission status when nobody is signed in', async () => {
    asUser(null);
    await setPermissionStatus('granted');

    expect(store.size).toBe(0);
  });
});
