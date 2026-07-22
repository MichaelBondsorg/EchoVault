/**
 * invalidateBasicInsights tests (R2 final review, Important 2b).
 *
 * `onSourcesChanged` (recompute.js) now fans out to this function so a
 * source exclusion invalidates the basicInsights cache the same way it
 * already invalidates Nexus and the dashboard daily/weekly caches. This
 * module has no "stale" flag field (unlike Nexus's `markInsightsStale`) —
 * its cache doc is deleted outright, which `getCachedBasicInsights` already
 * treats as "not cached" via its own `!snapshot.exists()` branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const mockDeleteDoc = vi.fn(async () => {});
const mockDoc = vi.fn(() => ({ __ref: true }));

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => Date.now() })),
    fromMillis: vi.fn((ms) => ({ toMillis: () => ms })),
  },
}));

const { invalidateBasicInsights, getCachedBasicInsights } = await import('../basicInsightsOrchestrator.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invalidateBasicInsights', () => {
  it('deletes the basicInsights/current doc for the given user', async () => {
    await invalidateBasicInsights('user-1');
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(), 'artifacts', 'echo-vault-v5-fresh', 'users', 'user-1', 'basicInsights', 'current'
    );
  });

  it('swallows a delete failure (doc may not exist yet) rather than throwing', async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error('not found'));
    await expect(invalidateBasicInsights('user-1')).resolves.toBeUndefined();
  });

  it('after invalidation, getCachedBasicInsights sees "no cache" (existing !exists() contract, no new staleness path)', async () => {
    // deleteDoc doesn't actually change the getDoc mock's return value in
    // this unit test (no real Firestore), but this documents + pins the
    // CONTRACT invalidateBasicInsights relies on: getCachedBasicInsights
    // already returns null on a missing doc.
    const cached = await getCachedBasicInsights('user-1');
    expect(cached).toBeNull();
  });
});
