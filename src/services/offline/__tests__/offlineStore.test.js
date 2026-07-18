import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so the offline store's persistence logic is
// actually exercised (the default test mock is a no-op).
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
  },
}));

const {
  saveOfflineEntry,
  getPendingEntries,
  markSyncing,
  resetStuckSyncing,
  getStats,
  clearAll,
} = await import('../offlineStore.js');

const OWNER_A = 'user-a';
const OWNER_B = 'user-b';

describe('offlineStore', () => {
  beforeEach(async () => {
    store.clear();
  });

  it('persists a queued entry as pending with an offlineId', async () => {
    const saved = await saveOfflineEntry(OWNER_A, { text: 'hello', platform: 'web' });
    expect(saved.offlineId).toBeTruthy();
    expect(saved.syncStatus).toBe('pending');

    const pending = await getPendingEntries(OWNER_A);
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('hello');
  });

  it('preserves safety fields through the queue', async () => {
    await saveOfflineEntry(OWNER_A, { text: 'crisis', safety_flagged: true, safety_user_response: 'support' });
    const [entry] = await getPendingEntries(OWNER_A);
    expect(entry.safety_flagged).toBe(true);
    expect(entry.safety_user_response).toBe('support');
  });

  it('resetStuckSyncing recovers entries stranded in syncing', async () => {
    const a = await saveOfflineEntry(OWNER_A, { text: 'a' });
    const b = await saveOfflineEntry(OWNER_A, { text: 'b' });

    // Simulate an app kill mid-sync: entry A is left in 'syncing'.
    await markSyncing(OWNER_A, a.offlineId);
    let stats = await getStats(OWNER_A);
    expect(stats.syncing).toBe(1);
    // A stranded 'syncing' entry is NOT returned by getPendingEntries...
    let pending = await getPendingEntries(OWNER_A);
    expect(pending.map(e => e.offlineId)).toEqual([b.offlineId]);

    // ...until recovery flips it back to pending.
    const reset = await resetStuckSyncing(OWNER_A);
    expect(reset).toBe(1);
    stats = await getStats(OWNER_A);
    expect(stats.syncing).toBe(0);
    pending = await getPendingEntries(OWNER_A);
    expect(pending.map(e => e.offlineId).sort()).toEqual([a.offlineId, b.offlineId].sort());
  });

  it('resetStuckSyncing is a no-op when nothing is stranded', async () => {
    await saveOfflineEntry(OWNER_A, { text: 'a' });
    expect(await resetStuckSyncing(OWNER_A)).toBe(0);
  });

  it('clearAll empties the store', async () => {
    await saveOfflineEntry(OWNER_A, { text: 'a' });
    await clearAll(OWNER_A);
    expect(await getPendingEntries(OWNER_A)).toHaveLength(0);
  });

  it('strictly isolates queues and owner-only clearing', async () => {
    await saveOfflineEntry(OWNER_A, { text: 'only a' });
    await saveOfflineEntry(OWNER_B, { text: 'only b' });

    expect((await getPendingEntries(OWNER_A)).map((entry) => entry.text)).toEqual(['only a']);
    expect((await getPendingEntries(OWNER_B)).map((entry) => entry.text)).toEqual(['only b']);

    await clearAll(OWNER_A);
    expect(await getPendingEntries(OWNER_A)).toHaveLength(0);
    expect((await getPendingEntries(OWNER_B)).map((entry) => entry.text)).toEqual(['only b']);
  });

  it('is idempotent when the same offline operation is queued twice', async () => {
    const operation = { offlineId: 'stable-id', text: 'once' };
    const first = await saveOfflineEntry(OWNER_A, operation);
    const second = await saveOfflineEntry(OWNER_A, operation);

    expect(second).toEqual(first);
    expect(await getPendingEntries(OWNER_A)).toHaveLength(1);
  });
});
