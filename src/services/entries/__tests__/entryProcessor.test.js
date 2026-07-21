import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the native (offline-capable) code path so processEntry's
// isNative && !isOnline branch (the one that calls queueEntry) is
// exercised. The global test alias for @capacitor/core reports 'web'; this
// per-file mock overrides it to 'ios', following the pattern used in
// audioVault.test.js.
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios',
    isNativePlatform: () => true,
  },
}));

const queueEntry = vi.fn(async (ownerUid, entryData) => ({
  ...entryData,
  ownerUid,
  offlineId: 'offline-1',
  syncStatus: 'pending',
}));
const triggerSync = vi.fn(async () => {});

// Paths below are relative to this __tests__ directory (one level deeper
// than entryProcessor.js itself), but must resolve to the same modules
// entryProcessor.js imports for vi.mock's interception to take effect.
vi.mock('../../offline/offlineManager', () => ({
  queueEntry: (...args) => queueEntry(...args),
}));

vi.mock('../../sync/syncOrchestrator', () => ({
  triggerSync: (...args) => triggerSync(...args),
  isOfflineCapable: () => true,
}));

vi.mock('../../analysis/localClassifier', () => ({
  classify: () => ({ entry_type: 'reflection', confidence: 0.9, extracted_tasks: [] }),
}));

vi.mock('../../analysis/localSentiment', () => ({
  analyze: () => ({ score: 0.5, confidence: 0.8, details: {} }),
}));

const { processEntry } = await import('../entryProcessor.js');

describe('entryProcessor — spaceId passthrough into offline queue', () => {
  beforeEach(() => {
    queueEntry.mockClear();
  });

  it('forwards spaceId from entryData into the queued baseEntry when offline', async () => {
    await processEntry(
      { text: 'hello', spaceId: 'space-9' },
      { isOnline: false, ownerUid: 'owner-1' }
    );

    expect(queueEntry).toHaveBeenCalledTimes(1);
    const [, payload] = queueEntry.mock.calls[0];
    expect(payload.spaceId).toBe('space-9');
  });

  it('omits spaceId from the queued baseEntry when no space was selected', async () => {
    await processEntry(
      { text: 'hello' },
      { isOnline: false, ownerUid: 'owner-1' }
    );

    const [, payload] = queueEntry.mock.calls[0];
    expect(payload).not.toHaveProperty('spaceId');
  });

  it('omits spaceId when explicitly null', async () => {
    await processEntry(
      { text: 'hello', spaceId: null },
      { isOnline: false, ownerUid: 'owner-1' }
    );

    const [, payload] = queueEntry.mock.calls[0];
    expect(payload).not.toHaveProperty('spaceId');
  });
});
