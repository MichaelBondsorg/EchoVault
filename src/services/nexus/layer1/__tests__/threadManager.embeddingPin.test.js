/**
 * Embeddings v2 migration, plan task M2: threadManager.js's thread.embedding
 * store is PINNED to v1 — its embedding calls must stay on the default-v1
 * path structurally, never routed through the flag-aware
 * `generateQueryEmbeddings` helper, regardless of `model.embeddingV2Read`.
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 *
 * This test uses the REAL `generateEmbedding` (ai/embeddings.js) — only the
 * underlying Cloud Function callable and Firestore/flags plumbing are
 * mocked — so the assertion is about the real code path, not a stand-in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));

vi.mock('../../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));

vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'test-app' }));
vi.mock('../../../ai/gemini', () => ({ callGemini: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ __ref: true })),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  arrayUnion: vi.fn(),
  Timestamp: {
    now: () => ({
      toDate: () => new Date('2026-07-22T00:00:00Z'),
    }),
  },
}));

const { createThread, findSimilarThread, findEvolutionCandidates } = await import('../threadManager');

beforeEach(() => {
  mockGenerateEmbeddingFn.mockReset();
  mockGetFlag.mockReset();
  mockSetDoc.mockClear();
  mockUpdateDoc.mockClear();
});

describe('threadManager — v1 pin (embeddings v2 migration plan M2)', () => {
  it('createThread requests the callable with no `version` field even when model.embeddingV2Read is ON', async () => {
    mockGetFlag.mockReturnValue(true); // flag ON globally
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 2, 3], space: 'v1' } });

    const thread = await createThread('user1', { displayName: 'A New Thread', category: 'growth' });

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'A New Thread' });
    // Explicitly NOT called with any version field (v1 or v2) — the pin is
    // structural (a different function is called), not a version param.
    const callArgs = mockGenerateEmbeddingFn.mock.calls[0][0];
    expect(callArgs.version).toBeUndefined();
    expect(thread.embedding).toEqual([1, 2, 3]);
  });

  it('createThread stays v1-only even when the flag read errors/is unset', async () => {
    mockGetFlag.mockImplementation(() => { throw new Error('flags not initialized'); });
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [4, 5, 6], space: 'v1' } });

    const thread = await createThread('user1', { displayName: 'Another Thread', category: 'growth' });

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'Another Thread' });
    expect(thread.embedding).toEqual([4, 5, 6]);
  });

  it('findSimilarThread / findEvolutionCandidates compare against thread.embedding using plain vectors (no space metadata) — same-space v1-v1 by construction', async () => {
    const activeThreads = [
      { id: 't1', displayName: 'Existing Thread', category: 'growth', embedding: [1, 0, 0] },
    ];
    const match = await findSimilarThread('Existing Thread Variant', activeThreads, [1, 0, 0]);
    expect(match?.thread.id).toBe('t1');

    const candidates = await findEvolutionCandidates('Somewhat Related', 'growth', activeThreads, [0.9, 0.1, 0]);
    expect(Array.isArray(candidates)).toBe(true);
  });
});
