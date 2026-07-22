/**
 * Embeddings v2 migration, plan task M5 (thread-vector repair — see
 * docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md and this
 * task's report at .superpowers/sdd/task-m5-report.md): threadManager.js's
 * thread vector store moved from the M2 v1 pin to v2 space, because v1
 * (text-embedding-004) was retired upstream and the v1 pin left thread
 * dedup silently dead in prod (every embedding call failed).
 *
 * This file used to pin the OLD v1 behavior (M2). It now pins the NEW v2
 * behavior: thread paths request v2 ALWAYS — unconditionally, not gated by
 * `model.embeddingV2Read` (that flag governs a rollback-capable rollout;
 * thread vectors have no working v1 fallback to roll back to, so gating
 * them would just mean "sometimes broken" instead of "always broken" — see
 * threadManager.js's file-level doc comment). Same-space discipline is
 * adversarially covered: a legacy v1-only thread (`thread.embedding`, no
 * `thread.embeddingV2`) must NEVER score against a new v2 query vector, even
 * under an equal-length coincidence.
 *
 * This test uses the REAL `generateEmbeddingV2` (ai/embeddings.js) — only
 * the underlying Cloud Function callable and Firestore/flags plumbing are
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

describe('threadManager — v2 pin (embeddings v2 migration plan M5)', () => {
  it('createThread requests the callable with version:"v2" even when model.embeddingV2Read is OFF/unset — thread vectors are not flag-gated', async () => {
    mockGetFlag.mockReturnValue(false); // flag OFF globally — must not matter
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 2, 3], space: 'v2' } });

    const thread = await createThread('user1', { displayName: 'A New Thread', category: 'growth' });

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'A New Thread', version: 'v2' });
    // getFlag must never even be consulted for thread vectors (structural,
    // not runtime-gated — see design constraint 4).
    expect(mockGetFlag).not.toHaveBeenCalled();
  });

  it('createThread stores the vector under embeddingV2, and never fabricates a legacy `embedding` field', async () => {
    mockGetFlag.mockReturnValue(true);
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 2, 3], space: 'v2' } });

    const thread = await createThread('user1', { displayName: 'A New Thread', category: 'growth' });

    expect(thread.embeddingV2).toEqual([1, 2, 3]);
    expect('embedding' in thread).toBe(false);

    // Also assert the persisted Firestore payload, not just the returned object.
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mockSetDoc.mock.calls[0];
    expect(payload.embeddingV2).toEqual([1, 2, 3]);
    expect('embedding' in payload).toBe(false);
  });

  it('createThread stays graceful (null embeddingV2, no throw) when v2 generation fails', async () => {
    mockGenerateEmbeddingFn.mockRejectedValue(new Error('v2 down'));

    const thread = await createThread('user1', { displayName: 'Another Thread', category: 'growth' });

    expect(thread.embeddingV2).toBeNull();
    expect('embedding' in thread).toBe(false);
  });

  it('findSimilarThread compares v2-vs-v2 only: matches a thread that has embeddingV2', async () => {
    const activeThreads = [
      { id: 't1', displayName: 'Existing Thread', category: 'growth', embeddingV2: [1, 0, 0] },
    ];
    const match = await findSimilarThread('Existing Thread Variant', activeThreads, [1, 0, 0]);
    expect(match?.thread.id).toBe('t1');
    expect(match?.matchType).toBe('semantic');
  });

  it('adversarial: a legacy v1-only thread (embedding, no embeddingV2) NEVER scores against a v2 query vector, even at equal dimensionality (no cross-space, no length-luck)', async () => {
    const activeThreads = [
      // Legacy v1-only thread: same dimensionality as the v2 query vector on
      // purpose — proves the exclusion is structural (field-name-based), not
      // a length mismatch that would coincidentally return 0 anyway.
      { id: 'legacy-v1', displayName: 'Legacy Thread', category: 'growth', embedding: [1, 0, 0] },
    ];

    const match = await findSimilarThread('Legacy Thread Variant', activeThreads, [1, 0, 0]);
    // No semantic match possible (legacy thread has no comparable vector) —
    // falls through to name-similarity, which also isn't a >=0.95 match, so
    // null (pinned policy: legacy v1-only thread = no comparable vector,
    // same as today's "entry has no embedding" exclusion).
    expect(match).toBeNull();

    const candidates = await findEvolutionCandidates('Legacy Thread', 'growth', activeThreads, [1, 0, 0]);
    expect(candidates).toEqual([]);
  });

  it('findEvolutionCandidates compares v2-vs-v2 only, same adversarial guarantee', async () => {
    // cosineSimilarity([1,0], [0.6,0.8]) === 0.6 — inside the evolution band
    // (EVOLUTION_SIMILARITY_THRESHOLD 0.50 <= sim < SEMANTIC_SIMILARITY_THRESHOLD 0.75).
    const activeThreads = [
      { id: 't1', displayName: 'Related Thread', category: 'growth', embeddingV2: [0.6, 0.8] },
      { id: 'legacy', displayName: 'Legacy Thread', category: 'growth', embedding: [0.6, 0.8] },
    ];
    const candidates = await findEvolutionCandidates('Somewhat Related', 'growth', activeThreads, [1, 0]);
    expect(candidates.map(c => c.thread.id)).toEqual(['t1']);
  });
});
