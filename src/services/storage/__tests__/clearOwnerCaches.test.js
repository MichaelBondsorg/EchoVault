import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ownerStorageKey } from '../ownerScopedStorage';

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

// setup.js replaces window.localStorage/sessionStorage with plain vi.fn()
// no-op stubs; drive them with in-memory Maps (PRIV-01 tests below).
let localStore;
let sessionStore;
function wireStorage() {
  localStore = new Map();
  sessionStore = new Map();
  localStorage.getItem.mockImplementation((key) => (localStore.has(key) ? localStore.get(key) : null));
  localStorage.setItem.mockImplementation((key, value) => { localStore.set(key, String(value)); });
  localStorage.removeItem.mockImplementation((key) => { localStore.delete(key); });
  sessionStorage.getItem.mockImplementation((key) => (sessionStore.has(key) ? sessionStore.get(key) : null));
  sessionStorage.setItem.mockImplementation((key, value) => { sessionStore.set(key, String(value)); });
  sessionStorage.removeItem.mockImplementation((key) => { sessionStore.delete(key); });
}

const { clearOwnerCaches } = await import('../clearOwnerCaches.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

describe('clearOwnerCaches', () => {
  beforeEach(() => {
    store.clear();
    wireStorage();
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

  // PRIV-01: clearOwnerCaches is now registry-driven for every
  // ownerScope:'user' + signOutBehavior:'remove' entry in storageRegistry.js
  // — including localStorage/sessionStorage-backed ones the generic
  // Preferences suffix sweep above can never reach.
  describe('PRIV-01 registry-driven sign-out removal', () => {
    it('removes the owner-scoped voice transcript (localStorage)', async () => {
      const key = ownerStorageKey(OWNER_A, 'voice/transcript');
      localStore.set(key, JSON.stringify({ sessionId: 's1', content: 'hi', savedAt: Date.now() }));

      await clearOwnerCaches(OWNER_A);

      expect(localStore.has(key)).toBe(false);
    });

    it('removes the owner-scoped session buffer from both sessionStorage and localStorage', async () => {
      const key = ownerStorageKey(OWNER_A, 'session/buffer');
      sessionStore.set(key, JSON.stringify({ recentEntry: { id: 'e1' } }));
      localStore.set(key, JSON.stringify({ recentEntry: { id: 'e1' } }));

      await clearOwnerCaches(OWNER_A);

      expect(sessionStore.has(key)).toBe(false);
      expect(localStore.has(key)).toBe(false);
    });

    it('removes the owner-scoped health cache and location cache (Preferences)', async () => {
      store.set(`health_context_cache::${OWNER_A}`, JSON.stringify({ available: true }));
      store.set(`health_permission_status::${OWNER_A}`, 'granted');
      store.set(`env_location_cache::${OWNER_A}`, JSON.stringify({ latitude: 1 }));

      await clearOwnerCaches(OWNER_A);

      expect(store.has(`health_context_cache::${OWNER_A}`)).toBe(false);
      expect(store.has(`health_permission_status::${OWNER_A}`)).toBe(false);
      expect(store.has(`env_location_cache::${OWNER_A}`)).toBe(false);
    });

    it('never touches owner Bs registry-driven keys when clearing owner A', async () => {
      const keyA = ownerStorageKey(OWNER_A, 'voice/transcript');
      const keyB = ownerStorageKey(OWNER_B, 'voice/transcript');
      localStore.set(keyA, 'a-transcript');
      localStore.set(keyB, 'b-transcript');

      await clearOwnerCaches(OWNER_A);

      expect(localStore.has(keyA)).toBe(false);
      expect(localStore.has(keyB)).toBe(true);
    });

    it('does NOT remove the owner-scoped dismissed-prompt state — retained across sign-out', async () => {
      const key = ownerStorageKey(OWNER_A, 'prompts/dismissed/personal');
      localStore.set(key, JSON.stringify(['some dismissed question']));

      await clearOwnerCaches(OWNER_A);

      expect(localStore.has(key)).toBe(true);
    });
  });
});
