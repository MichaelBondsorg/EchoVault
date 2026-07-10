/**
 * Tests for per-user daily quota enforcement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock firebase-admin/firestore ---------------------------------------
// A single in-memory doc snapshot drives each test. `mockCount` is the count
// currently stored; `undefined` means the doc does not exist yet.
let mockCount;
const mockSet = vi.fn();

const mockTx = {
  get: vi.fn(async () => ({
    exists: mockCount !== undefined,
    data: () => (mockCount !== undefined ? { count: mockCount } : undefined),
  })),
  set: mockSet,
};

const mockDoc = vi.fn().mockReturnValue({ id: 'analyze-2026-07-07' });

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: mockDoc,
    runTransaction: async (fn) => fn(mockTx),
  }),
}));

// HttpsError from firebase-functions is a real class; keep it un-mocked so
// `instanceof` and `.code` behave like production.
const { enforceDailyQuota } = await import('../dailyQuota.js');

beforeEach(() => {
  mockCount = undefined;
  mockSet.mockClear();
  mockTx.get.mockClear();
  mockDoc.mockClear();
});

describe('enforceDailyQuota', () => {
  it('passes and increments when under the limit (fresh doc)', async () => {
    mockCount = undefined; // no doc yet -> count 0
    const result = await enforceDailyQuota('user-1', { key: 'analyze', limit: 200 });
    expect(result).toBe(1);
    expect(mockSet).toHaveBeenCalledTimes(1);
    const written = mockSet.mock.calls[0][1];
    expect(written.count).toBe(1);
  });

  it('passes and increments when just under the limit', async () => {
    mockCount = 199;
    const result = await enforceDailyQuota('user-1', { key: 'analyze', limit: 200 });
    expect(result).toBe(200);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('throws resource-exhausted when at the limit', async () => {
    mockCount = 200;
    await expect(
      enforceDailyQuota('user-1', { key: 'analyze', limit: 200 })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('throws resource-exhausted when over the limit', async () => {
    mockCount = 500;
    await expect(
      enforceDailyQuota('user-1', { key: 'transcribe', limit: 100 })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('rejects a missing userId', async () => {
    await expect(
      enforceDailyQuota('', { key: 'analyze', limit: 200 })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects an invalid limit', async () => {
    await expect(
      enforceDailyQuota('user-1', { key: 'analyze', limit: 0 })
    ).rejects.toMatchObject({ code: 'internal' });
  });
});
