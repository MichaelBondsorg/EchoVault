import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory Capacitor Preferences so owner-scoping is actually exercised
// (the default test mock is a no-op). Mirrors the pattern used by
// offlineStore.test.js.
const store = new Map();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store.has(key) ? store.get(key) : null }),
    set: async ({ key, value }) => { store.set(key, value); },
    remove: async ({ key }) => { store.delete(key); },
    keys: async () => ({ keys: Array.from(store.keys()) }),
  },
}));

// Mutable auth stand-in — tests flip `authState.currentUser` to simulate
// different signed-in accounts (and signed-out) without a module-level
// "current user" cache inside whoop.js itself.
const authState = { currentUser: null };
vi.mock('../../../config/firebase', () => ({
  auth: authState,
}));

vi.mock('../platformHealth', () => ({
  cacheHealthData: vi.fn(async () => {}),
}));

const { getRelayHttpUrl } = vi.hoisted(() => ({ getRelayHttpUrl: vi.fn() }));
vi.mock('../../../config/relay', () => ({ getRelayHttpUrl }));

const { requestedLocalDate } = await import('../whoopTransforms');
const {
  getWhoopSummary,
  getWhoopConnectionStatus,
  disconnectWhoop,
} = await import('../whoop.js');

const LEGACY_SUMMARY_KEY = 'whoop_cached_summary';
const LEGACY_STATUS_KEY = 'whoop_link_status';

const asUser = (uid) => {
  authState.currentUser = uid ? { uid, getIdToken: vi.fn(async () => `token-${uid}`) } : null;
};

const whoopApiResponse = (localDate, timezone) => ({
  available: true,
  source: 'whoop',
  date: localDate,
  requestedLocalDate: localDate,
  timezone,
  queriedAt: `${localDate}T12:00:00.000Z`,
  sleep: { totalHours: 7.5, quality: 'good', score: 82, inBed: 8, asleep: 7.5 },
  hrv: { average: 45, stressIndicator: 'moderate' },
  heartRate: { resting: 58 },
  recovery: { score: 70, status: 'green' },
  strain: { score: 9, calories: 600 },
  workouts: [],
});

describe('whoop.js owner-scoped cache (plan task A4)', () => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const date = new Date();
  const localDate = requestedLocalDate(date, timezone);

  beforeEach(() => {
    store.clear();
    authState.currentUser = null;
    getRelayHttpUrl.mockReset();
    getRelayHttpUrl.mockReturnValue('https://relay.test');
    global.fetch = vi.fn();
  });

  it('caches a fetched summary under the authenticated owner uid, not a global key', async () => {
    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => whoopApiResponse(localDate, timezone) });

    const summary = await getWhoopSummary(date);

    expect(summary.available).toBe(true);
    expect(store.has('whoop_cached_summary::user-a')).toBe(true);
    expect(store.has(LEGACY_SUMMARY_KEY)).toBe(false);
  });

  it('falls back to the owners own cache when the relay is unreachable', async () => {
    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => whoopApiResponse(localDate, timezone) });
    await getWhoopSummary(date);

    global.fetch.mockRejectedValueOnce(new Error('network down'));
    const summary = await getWhoopSummary(date);

    expect(summary.fromCache).toBe(true);
    expect(summary.recovery.score).toBe(70);
  });

  it('never exposes owner As cache to owner B, and quarantines legacy global data on Bs scoped miss', async () => {
    // Seed a pre-owner-scoping legacy cache, simulating data written before
    // this change shipped.
    store.set(LEGACY_SUMMARY_KEY, JSON.stringify({ legacy: true }));

    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => whoopApiResponse(localDate, timezone) });
    await getWhoopSummary(date);
    expect(store.has('whoop_cached_summary::user-a')).toBe(true);

    asUser('user-b');
    global.fetch.mockRejectedValueOnce(new Error('network down'));
    const summaryB = await getWhoopSummary(date);

    // B gets neither A's data nor the stale legacy blob.
    expect(summaryB.available).toBe(false);
    expect(summaryB.fromCache).not.toBe(true);
    expect(store.has('whoop_cached_summary::user-b')).toBe(false);
    // A's own cache is untouched by B's read.
    expect(store.has('whoop_cached_summary::user-a')).toBe(true);
    // The unowned legacy key is discarded — never adopted by B.
    expect(store.has(LEGACY_SUMMARY_KEY)).toBe(false);
  });

  it('scopes link-status cache per owner and quarantines the legacy global status key on a miss', async () => {
    store.set(LEGACY_STATUS_KEY, 'true');

    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ linked: true }) });
    await getWhoopConnectionStatus();
    expect(store.get('whoop_link_status::user-a')).toBe('true');

    asUser('user-b');
    global.fetch.mockRejectedValueOnce(new Error('network down'));
    const statusB = await getWhoopConnectionStatus();

    expect(statusB).toBe('disconnected');
    expect(store.has('whoop_link_status::user-b')).toBe(false);
    expect(store.has(LEGACY_STATUS_KEY)).toBe(false);
  });

  it('disconnectWhoop clears only the calling owners scoped cache', async () => {
    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => whoopApiResponse(localDate, timezone) });
    await getWhoopSummary(date);

    asUser('user-b');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => whoopApiResponse(localDate, timezone) });
    await getWhoopSummary(date);

    asUser('user-a');
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // DELETE /auth/whoop
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ linked: false }) }); // status write inside setLocalWhoopStatus's relay call isn't made; disconnect just writes locally
    await disconnectWhoop();

    expect(store.has('whoop_cached_summary::user-a')).toBe(false);
    expect(store.has('whoop_cached_summary::user-b')).toBe(true);
  });

  it('short-circuits without throwing when no relay endpoint is configured (e.g. bad prod build)', async () => {
    asUser('user-a');
    getRelayHttpUrl.mockReturnValue(null);

    const summary = await getWhoopSummary(date);

    expect(summary.available).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
