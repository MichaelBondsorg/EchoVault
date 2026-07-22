/**
 * `buildEmbeddingWriteFromVectors` — Step 0's independent-write decision
 * (embeddings v2 migration task M4, v1-retirement resilience). Exercises the
 * pure helper in `functions/index.js` directly so the both-null skip /
 * partial-write shape logic is unit-tested without spinning up the full
 * `onEntryCreate` Firestore trigger (goal processing, pattern recompute,
 * crisis flagging, consent gate) just to reach three lines of decision
 * logic.
 *
 * Same import-shim pattern as `generateEmbeddingCallable.test.js`: importing
 * `functions/index.js` registers module-scope triggers that need a
 * resolvable storage bucket even though this file never exercises them.
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

const PRIOR_FIREBASE_CONFIG = process.env.FIREBASE_CONFIG;
const PRIOR_GCLOUD_PROJECT = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: 'test-project',
  storageBucket: 'test-project.appspot.com',
});
process.env.GCLOUD_PROJECT = 'test-project';

afterAll(() => {
  if (PRIOR_FIREBASE_CONFIG === undefined) delete process.env.FIREBASE_CONFIG;
  else process.env.FIREBASE_CONFIG = PRIOR_FIREBASE_CONFIG;
  if (PRIOR_GCLOUD_PROJECT === undefined) delete process.env.GCLOUD_PROJECT;
  else process.env.GCLOUD_PROJECT = PRIOR_GCLOUD_PROJECT;
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
  getApps: vi.fn(() => ['already-initialized']),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({ __fakeDb: true })),
  FieldValue: { serverTimestamp: () => '__ts__' },
  Timestamp: {},
}));
vi.mock('firebase-admin/storage', () => ({ getStorage: vi.fn(() => ({})) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: vi.fn(() => ({})) }));

const { buildEmbeddingWriteFromVectors } = await import('../../../index.js');

describe('buildEmbeddingWriteFromVectors — M4 independent-write decision', () => {
  it('both vectors null -> returns null (skip the write entirely)', () => {
    expect(buildEmbeddingWriteFromVectors({ embedding: null, embeddingV2: null, embeddingMeta: null })).toBeNull();
  });

  it('both vectors undefined (not even passed) -> returns null', () => {
    expect(buildEmbeddingWriteFromVectors({})).toBeNull();
    expect(buildEmbeddingWriteFromVectors()).toBeNull();
  });

  it('v1 null, v2 ok (the expected post-retirement shape) -> writes {embeddingV2, embeddingMeta} only, no embedding key at all', () => {
    const meta = { model: 'gemini-embedding-2', dim: 3, taskType: 'RETRIEVAL_DOCUMENT', createdAt: 'now' };
    const result = buildEmbeddingWriteFromVectors({ embedding: null, embeddingV2: [1, 2, 3], embeddingMeta: meta });
    expect(result).toEqual({ embeddingV2: [1, 2, 3], embeddingMeta: meta });
    expect(Object.prototype.hasOwnProperty.call(result, 'embedding')).toBe(false);
  });

  it('v1 ok, v2 off/unavailable (pre-M4 default shape) -> writes {embedding} only, unchanged', () => {
    const result = buildEmbeddingWriteFromVectors({ embedding: [0.1, 0.2], embeddingV2: undefined, embeddingMeta: undefined });
    expect(result).toEqual({ embedding: [0.1, 0.2] });
    expect(Object.prototype.hasOwnProperty.call(result, 'embeddingV2')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'embeddingMeta')).toBe(false);
  });

  it('both ok -> writes all three fields (pre-M4 dual-write shape, unchanged)', () => {
    const meta = { model: 'gemini-embedding-2', dim: 3, taskType: 'RETRIEVAL_DOCUMENT', createdAt: 'now' };
    const result = buildEmbeddingWriteFromVectors({ embedding: [1, 0], embeddingV2: [0, 1, 0], embeddingMeta: meta });
    expect(result).toEqual({ embedding: [1, 0], embeddingV2: [0, 1, 0], embeddingMeta: meta });
  });
});
