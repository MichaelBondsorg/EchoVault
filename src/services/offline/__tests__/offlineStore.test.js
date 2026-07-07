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

describe('offlineStore', () => {
  beforeEach(async () => {
    store.clear();
  });

  it('persists a queued entry as pending with an offlineId', async () => {
    const saved = await saveOfflineEntry({ text: 'hello', platform: 'web' });
    expect(saved.offlineId).toBeTruthy();
    expect(saved.syncStatus).toBe('pending');

    const pending = await getPendingEntries();
    expect(pending).toHaveLength(1);
    expect(pending[0].text).toBe('hello');
  });

  it('preserves safety fields through the queue', async () => {
    await saveOfflineEntry({ text: 'crisis', safety_flagged: true, safety_user_response: 'support' });
    const [entry] = await getPendingEntries();
    expect(entry.safety_flagged).toBe(true);
    expect(entry.safety_user_response).toBe('support');
  });

  it('resetStuckSyncing recovers entries stranded in syncing', async () => {
    const a = await saveOfflineEntry({ text: 'a' });
    const b = await saveOfflineEntry({ text: 'b' });

    // Simulate an app kill mid-sync: entry A is left in 'syncing'.
    await markSyncing(a.offlineId);
    let stats = await getStats();
    expect(stats.syncing).toBe(1);
    // A stranded 'syncing' entry is NOT returned by getPendingEntries...
    let pending = await getPendingEntries();
    expect(pending.map(e => e.offlineId)).toEqual([b.offlineId]);

    // ...until recovery flips it back to pending.
    const reset = await resetStuckSyncing();
    expect(reset).toBe(1);
    stats = await getStats();
    expect(stats.syncing).toBe(0);
    pending = await getPendingEntries();
    expect(pending.map(e => e.offlineId).sort()).toEqual([a.offlineId, b.offlineId].sort());
  });

  it('resetStuckSyncing is a no-op when nothing is stranded', async () => {
    await saveOfflineEntry({ text: 'a' });
    expect(await resetStuckSyncing()).toBe(0);
  });

  it('clearAll empties the store', async () => {
    await saveOfflineEntry({ text: 'a' });
    await clearAll();
    expect(await getPendingEntries()).toHaveLength(0);
  });
});
