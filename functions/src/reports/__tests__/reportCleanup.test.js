/**
 * Report Cleanup Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDoc = (data = {}) => ({
  data: () => data,
  ref: { update: mockUpdate },
});

const mockCollectionGroup = vi.fn();
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collectionGroup: mockCollectionGroup,
  }),
}));

// Mock the onSchedule wrapper (we test the core logic, not the Cloud Functions trigger)
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (config, handler) => handler,
}));

import { cleanupStuckReports } from '../reportCleanup.js';

describe('cleanupStuckReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when no stuck reports found', async () => {
    mockCollectionGroup.mockReturnValue({
      where: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
        }),
      }),
    });

    const result = await cleanupStuckReports();
    expect(result).toEqual({ cleaned: 0, retried: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('marks stuck report with retryCount=0 as failed and increments retry', async () => {
    const doc = mockDoc({ status: 'generating', retryCount: 0 });
    mockCollectionGroup.mockReturnValue({
      where: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            empty: false,
            size: 1,
            docs: [doc],
          }),
        }),
      }),
    });

    const result = await cleanupStuckReports();
    expect(result).toEqual({ cleaned: 0, retried: 1 });
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'failed', retryCount: 1 });
  });

  it('marks stuck report with retryCount>=1 as permanently failed', async () => {
    const doc = mockDoc({ status: 'generating', retryCount: 1 });
    mockCollectionGroup.mockReturnValue({
      where: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            empty: false,
            size: 1,
            docs: [doc],
          }),
        }),
      }),
    });

    const result = await cleanupStuckReports();
    expect(result).toEqual({ cleaned: 1, retried: 0 });
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'failed' });
  });

  it('handles multiple stuck reports with different retry counts', async () => {
    const doc1 = mockDoc({ status: 'generating', retryCount: 0 });
    const doc2 = mockDoc({ status: 'generating', retryCount: 2 });
    mockCollectionGroup.mockReturnValue({
      where: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            empty: false,
            size: 2,
            docs: [doc1, doc2],
          }),
        }),
      }),
    });

    const result = await cleanupStuckReports();
    expect(result).toEqual({ cleaned: 1, retried: 1 });
  });
});
