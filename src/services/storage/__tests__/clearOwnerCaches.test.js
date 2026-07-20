import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so clearOwnerCaches' enumeration/removal
// logic is actually exercised (the default test mock is a no-op).
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
    keys: async () => ({ keys: Array.from(store.keys()) }),
  },
}));

const { clearOwnerCaches } = await import('../clearOwnerCaches.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

describe('clearOwnerCaches', () => {
  beforeEach(() => {
    store.clear();
  });

  it('removes the callers known owner-scoped WHOOP keys', async () => {
    store.set(`whoop_cached_summary::${OWNER_A}`, JSON.stringify({ recovery: { score: 70 } }));
    store.set(`whoop_link_status::${OWNER_A}`, 'true');

    await clearOwnerCaches(OWNER_A);

    expect(store.has(`whoop_cached_summary::${OWNER_A}`)).toBe(false);
    expect(store.has(`whoop_link_status::${OWNER_A}`)).toBe(false);
  });

  it('removes any other ::uid-suffixed keys discovered via Preferences.keys()', async () => {
    // A future owner-scoped cache under a key clearOwnerCaches doesn't know
    // by name should still be swept, since it carries this owner's suffix.
    store.set(`some_future_cache::${OWNER_A}`, 'payload');

    await clearOwnerCaches(OWNER_A);

    expect(store.has(`some_future_cache::${OWNER_A}`)).toBe(false);
  });

  it('deletes legacy pre-owner-scoping global WHOOP keys', async () => {
    store.set('whoop_cached_summary', JSON.stringify({ legacy: true }));
    store.set('whoop_link_status', 'true');

    await clearOwnerCaches(OWNER_A);

    expect(store.has('whoop_cached_summary')).toBe(false);
    expect(store.has('whoop_link_status')).toBe(false);
  });

  it('leaves other owners scoped caches intact — isolation comes from key scoping, not a device-wide wipe', async () => {
    store.set(`whoop_cached_summary::${OWNER_A}`, 'a-data');
    store.set(`whoop_link_status::${OWNER_A}`, 'true');
    store.set(`whoop_cached_summary::${OWNER_B}`, 'b-data');
    store.set(`whoop_link_status::${OWNER_B}`, 'true');
    store.set(`some_other_cache::${OWNER_B}`, 'b-other');

    await clearOwnerCaches(OWNER_A);

    expect(store.has(`whoop_cached_summary::${OWNER_B}`)).toBe(true);
    expect(store.has(`whoop_link_status::${OWNER_B}`)).toBe(true);
    expect(store.has(`some_other_cache::${OWNER_B}`)).toBe(true);
  });

  it('is a no-op when called without a uid (never wipes the whole device)', async () => {
    store.set(`whoop_cached_summary::${OWNER_A}`, 'a-data');
    store.set('whoop_cached_summary', 'legacy-data');

    await clearOwnerCaches(undefined);
    await clearOwnerCaches(null);
    await clearOwnerCaches('');

    expect(store.has(`whoop_cached_summary::${OWNER_A}`)).toBe(true);
    expect(store.has('whoop_cached_summary')).toBe(true);
  });

  it('does not throw when there is nothing to clear', async () => {
    await expect(clearOwnerCaches(OWNER_A)).resolves.not.toThrow();
  });
});
