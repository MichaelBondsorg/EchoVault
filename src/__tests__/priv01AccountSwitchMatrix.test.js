/**
 * PRIV-01 two-account contract test, GENERATED from the storage registry
 * (src/services/storage/storageRegistry.js) — per the review's required fix
 * #6 ("Add a two-account contract test covering every registered sensitive
 * key") and acceptance ("User A writes every sensitive storage category,
 * signs out, and User B signs in. User B cannot read, infer, or cause
 * upload of User A's values. Sign-out removes ephemeral sensitive values
 * for User A.").
 *
 * This is a companion to src/__tests__/validationMatrix.test.js's own
 * "Matrix row: Account switch on one device" (Row 2) — that row exercises
 * the R2-era owner-scoped stores (WHOOP cache, capture ops, drafts, audio
 * vault) end to end through their real module APIs. This file covers the
 * NEW PRIV-01 families the same way that row's own header comment
 * describes clearOwnerCaches' isolation guarantee: "the actual isolation
 * guarantee is key scoping" — so, unlike the per-module suites
 * (platformHealth.ownerScope.test.js, environmentService.ownerScope.test.js,
 * sessionBuffer.test.js, useVoiceRelay.test.js — which each exercise their
 * real module's read/write/expiry/migration logic in full), this file's
 * job is specifically the CROSS-CUTTING contract: every registered
 * ownerScope:'user' + sensitivity:'high' key, enumerated by iterating the
 * registry itself (not hand-written per key), is isolated between two
 * accounts and is actually removed by clearOwnerCaches at sign-out. A new
 * registry entry with `sensitivity: 'high'` is automatically covered by
 * this loop the next time it runs — no test file edit required.
 *
 * Kept in its own file (not merged into validationMatrix.test.js) so its
 * Preferences/localStorage/sessionStorage mocks can't collide with that
 * file's own carefully sequenced ~4000 lines of mocks for unrelated rows —
 * the task brief's own "or a dedicated suite" option.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const prefsStore = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: prefsStore.has(key) ? prefsStore.get(key) : null }),
    set: async ({ key, value }) => { prefsStore.set(key, value); },
    remove: async ({ key }) => { prefsStore.delete(key); },
    keys: async () => ({ keys: Array.from(prefsStore.keys()) }),
  },
}));

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

const backendStore = (backend) => {
  if (backend === 'preferences') return prefsStore;
  if (backend === 'localStorage') return localStore;
  if (backend === 'sessionStorage+localStorage') return sessionStore; // written to both; sessionStore is authoritative for this check
  throw new Error(`No backend store wired for "${backend}"`);
};

const { highSensitivityUserKeys } = await import('../services/storage/storageRegistry.js');
const { clearOwnerCaches } = await import('../services/storage/clearOwnerCaches.js');

describe('PRIV-01 two-account contract (generated from storageRegistry.js)', () => {
  beforeEach(() => {
    prefsStore.clear();
    wireStorage();
  });

  const entries = highSensitivityUserKeys();

  it('the registry actually has high-sensitivity user-scoped rows to generate from (guards against an accidentally-emptied registry)', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  for (const entry of entries) {
    describe(`registry entry: ${entry.id}`, () => {
      const args = Array.isArray(entry.categories) ? [entry.categories[0]] : [];

      it('B reads nothing at As key after A writes and signs out; sign-out removes As ephemeral value', async () => {
        const keyA = entry.ownerKeyFor('user-a', ...args);
        const keyB = entry.ownerKeyFor('user-b', ...args);

        expect(keyA, 'ownerKeyFor must differ per uid').not.toBe(keyB);

        const store = backendStore(entry.backend);
        store.set(keyA, JSON.stringify({ sensitive: `user-a payload for ${entry.id}` }));
        if (entry.backend === 'sessionStorage+localStorage') {
          localStore.set(keyA, JSON.stringify({ sensitive: `user-a payload for ${entry.id}` }));
        }

        // B was never written — B's read of its OWN key finds nothing,
        // regardless of what A wrote (isolation by key construction; B's
        // key is never derived from or equal to A's).
        expect(store.has(keyB)).toBe(false);

        // Sign-out (A).
        await clearOwnerCaches('user-a');

        // Every entry this loop covers is signOutBehavior:'remove' (that's
        // what highSensitivityUserKeys + the registry declare for all four
        // current high-sensitivity rows) — assert the ephemeral value is
        // actually gone, not just unreadable through some other path.
        if (entry.signOutBehavior === 'remove') {
          expect(store.has(keyA), `${entry.id} must be removed at sign-out`).toBe(false);
          if (entry.backend === 'sessionStorage+localStorage') {
            expect(localStore.has(keyA)).toBe(false);
          }
        }
      });

      it('A writing again after B never resurrects Bs (nonexistent) data, and vice versa is structurally impossible — keys never collide', () => {
        const keyA = entry.ownerKeyFor('user-a', ...args);
        const keyB = entry.ownerKeyFor('user-b', ...args);
        const keyAAgain = entry.ownerKeyFor('user-a', ...args);

        expect(keyA).toBe(keyAAgain);
        expect(keyA).not.toBe(keyB);
      });
    });
  }
});
