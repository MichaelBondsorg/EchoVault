import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCoreEntry } from '../../entries/buildCoreEntry';

// offlineManager delegates persistence to offlineStore. Mock it so these
// tests exercise only queueEntry's whitelist-building logic (what fields it
// forwards), not the Preferences-backed storage layer (covered by
// offlineStore.test.js).
const saveOfflineEntry = vi.fn(async (ownerUid, entry) => ({
  ...entry,
  ownerUid,
  offlineId: 'offline-1',
  syncStatus: 'pending',
}));

vi.mock('../offlineStore', () => ({
  saveOfflineEntry: (...args) => saveOfflineEntry(...args),
  getPendingEntries: vi.fn(async () => []),
  getFailedEntries: vi.fn(async () => []),
  markSyncing: vi.fn(async () => {}),
  markSynced: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  removeOfflineEntry: vi.fn(async () => true),
  clearSyncedEntries: vi.fn(async () => {}),
  getStats: vi.fn(async () => ({})),
}));

const { queueEntry } = await import('../offlineManager.js');

describe('offlineManager.queueEntry — spaceId passthrough', () => {
  beforeEach(() => {
    saveOfflineEntry.mockClear();
  });

  it('includes spaceId in the queued record when a Context Space was selected', async () => {
    await queueEntry('owner-1', { text: 'hello', spaceId: 'space-9' });

    expect(saveOfflineEntry).toHaveBeenCalledTimes(1);
    const [, payload] = saveOfflineEntry.mock.calls[0];
    expect(payload.spaceId).toBe('space-9');
  });

  it('omits spaceId entirely when no space was selected (never null-stuffed)', async () => {
    await queueEntry('owner-1', { text: 'hello' });

    const [, payload] = saveOfflineEntry.mock.calls[0];
    expect(payload).not.toHaveProperty('spaceId');
  });

  it('omits spaceId when explicitly null', async () => {
    await queueEntry('owner-1', { text: 'hello', spaceId: null });

    const [, payload] = saveOfflineEntry.mock.calls[0];
    expect(payload).not.toHaveProperty('spaceId');
  });

  it('still forwards the other whitelisted fields unchanged alongside spaceId', async () => {
    await queueEntry('owner-1', {
      text: 'hello',
      category: 'reflection',
      spaceId: 'space-9',
      platform: 'ios',
    });

    const [ownerArg, payload] = saveOfflineEntry.mock.calls[0];
    expect(ownerArg).toBe('owner-1');
    expect(payload.text).toBe('hello');
    expect(payload.category).toBe('reflection');
    expect(payload.platform).toBe('ios');
    expect(payload.spaceId).toBe('space-9');
  });
});

describe('offline queue -> sync integration: spaceId survives to the synced payload', () => {
  // buildCoreEntry is the codebase's single source of truth for the
  // "conditional field, no null-stuffing" contract that any Firestore write
  // built from a queued offline entry must honor (see buildCoreEntry.js:106-111
  // for the identical spaceId rule applied on the online path). This proves
  // that a spaceId surviving offlineManager.queueEntry's whitelist keeps
  // surviving all the way through that shared contract, i.e. an entry
  // captured offline with a selected Context Space does not sync unscoped.
  const captureArgs = (overrides = {}) => ({
    text: 'queued offline thought',
    user: { uid: 'owner-1' },
    consentSnapshot: { aiProcessingConsent: true },
    captureContext: { capturedAt: '2026-07-21T09:00:00.000Z', captureTimezone: 'UTC' },
    safety: { safetyFlagged: false, hasWarning: false },
    platform: 'ios',
    ...overrides,
  });

  beforeEach(() => {
    saveOfflineEntry.mockClear();
  });

  it('queue with spaceId -> synced payload contains spaceId', async () => {
    const queued = await queueEntry('owner-1', { text: 'queued offline thought', spaceId: 'space-9' });
    const synced = buildCoreEntry(captureArgs({ spaceId: queued.spaceId }));
    expect(synced.spaceId).toBe('space-9');
  });

  it('queue without spaceId -> field absent on the synced payload (never null)', async () => {
    const queued = await queueEntry('owner-1', { text: 'queued offline thought' });
    const synced = buildCoreEntry(captureArgs({ spaceId: queued.spaceId }));
    expect(synced).not.toHaveProperty('spaceId');
  });
});
