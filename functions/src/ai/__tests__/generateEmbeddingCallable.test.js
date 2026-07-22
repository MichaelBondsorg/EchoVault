/**
 * `generateEmbedding` callable — versioned query embeddings (embeddings
 * migration task M1). Exercises the callable's `.run()` escape hatch
 * (`firebase-functions` v2 attaches `.run = handler` for direct invocation,
 * bypassing the HTTP/CORS layer) so the version-routing wiring in
 * functions/index.js is unit-tested without a live Firebase project.
 *
 * Firebase Admin + all collaborator modules the callable touches are mocked
 * so no real network/Firestore call is ever made; only the routing/shaping
 * logic added in index.js is under test here (the collaborators themselves —
 * generateEmbeddingV2, the cache keyspaces — are unit-tested directly in
 * embeddingV2.test.js / embeddingCache.test.js).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// functions/index.js registers an onObjectFinalized storage trigger at
// module scope, which needs a resolvable bucket name even though this test
// never exercises that trigger. Provide a fake one before importing index.js.
// Restored in afterAll — vitest workers can be reused across files, and a
// future test that cares about these vars being unset must not inherit
// this file's fakes by load order (M1 review, Important).
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

vi.mock('../../consent/consentGate.js', () => ({
  assertAiConsent: vi.fn().mockResolvedValue({ allowed: true, source: 'settings', checkedAt: 'now' }),
  isAiAllowed: vi.fn(),
  grantConsent: vi.fn(),
  revokeConsent: vi.fn(),
}));

vi.mock('../../models/registry.js', async () => {
  const actual = await vi.importActual('../../models/registry.js');
  return {
    ...actual,
    getModel: vi.fn(async (_db, key) => (key === 'embeddingV2' ? 'gemini-embedding-2' : 'text-embedding-004')),
    getModelFlag: vi.fn(async () => false), // dual-write v2 off — out of M1 scope
  };
});

vi.mock('../embeddingV2.js', async () => {
  const actual = await vi.importActual('../embeddingV2.js');
  return {
    ...actual,
    generateEmbeddingV2: vi.fn(),
  };
});

vi.mock('../embeddingCache.js', () => ({
  getCachedEmbedding: vi.fn(),
  setCachedEmbedding: vi.fn(),
  getCachedEmbeddingV2: vi.fn(),
  setCachedEmbeddingV2: vi.fn(),
  getCachedEmbeddingV2Query: vi.fn(),
  setCachedEmbeddingV2Query: vi.fn(),
}));

const { assertAiConsent } = await import('../../consent/consentGate.js');
const { getModel, getModelFlag } = await import('../../models/registry.js');
const { generateEmbeddingV2, EMBEDDING_V2_TASK_TYPE, EMBEDDING_V2_QUERY_TASK_TYPE } = await import('../embeddingV2.js');
const {
  getCachedEmbedding,
  getCachedEmbeddingV2Query,
  setCachedEmbeddingV2Query,
} = await import('../embeddingCache.js');
const { HttpsError } = await import('firebase-functions/v2/https');
const { generateEmbedding } = await import('../../../index.js');

function req(data, uid = 'user-1') {
  return { auth: uid ? { uid } : null, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  assertAiConsent.mockResolvedValue({ allowed: true, source: 'settings', checkedAt: 'now' });
  getModelFlag.mockResolvedValue(false);
  getModel.mockImplementation(async (_db, key) => (key === 'embeddingV2' ? 'gemini-embedding-2' : 'text-embedding-004'));
  getCachedEmbedding.mockResolvedValue([0.1, 0.2, 0.3]); // v1 cache hit — no real fetch needed
  getCachedEmbeddingV2Query.mockResolvedValue(null);
});

describe('generateEmbedding — version routing', () => {
  it('version omitted defaults to v1 and returns the legacy shape plus additive space', async () => {
    const result = await generateEmbedding.run(req({ text: 'hello' }));
    expect(Object.keys(result).sort()).toEqual(['cached', 'embedding', 'space']);
    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], cached: false, space: 'v1' });
    expect(generateEmbeddingV2).not.toHaveBeenCalled();
  });

  it("explicit version:'v1' is byte-identical to omitted", async () => {
    const omitted = await generateEmbedding.run(req({ text: 'hello' }));
    const explicit = await generateEmbedding.run(req({ text: 'hello', version: 'v1' }));
    expect(explicit).toEqual(omitted);
  });

  it("an unrecognized version string falls back to v1 (default), never silently to v2", async () => {
    const result = await generateEmbedding.run(req({ text: 'hello', version: 'v3-typo' }));
    expect(result.space).toBe('v1');
    expect(generateEmbeddingV2).not.toHaveBeenCalled();
  });

  it("version:'v2' routes to the v2 query path and returns {embedding, space:'v2', model, dim, cached}", async () => {
    generateEmbeddingV2.mockResolvedValue({ embedding: [0.9, 0.8, 0.7], dim: 3 });
    const result = await generateEmbedding.run(req({ text: 'what did I say about work?', version: 'v2' }));
    expect(result).toEqual({
      embedding: [0.9, 0.8, 0.7],
      space: 'v2',
      model: 'gemini-embedding-2',
      dim: 3,
      cached: false,
    });
    // v1 path must NOT have been touched for a v2 request.
    expect(getCachedEmbedding).not.toHaveBeenCalled();
  });

  it("v2 request on a query cache HIT returns cached:true without calling generateEmbeddingV2", async () => {
    getCachedEmbeddingV2Query.mockResolvedValue({
      embedding: [1, 2, 3],
      embeddingMeta: { model: 'gemini-embedding-2', dim: 3, taskType: 'RETRIEVAL_QUERY' },
    });
    const result = await generateEmbedding.run(req({ text: 'cached query', version: 'v2' }));
    expect(result).toEqual({ embedding: [1, 2, 3], space: 'v2', model: 'gemini-embedding-2', dim: 3, cached: true });
    expect(generateEmbeddingV2).not.toHaveBeenCalled();
  });
});

describe('generateEmbedding — v2 task-type assertion (asymmetric retrieval pairing)', () => {
  it('a v2 query request is embedded with RETRIEVAL_QUERY, never RETRIEVAL_DOCUMENT', async () => {
    expect(EMBEDDING_V2_QUERY_TASK_TYPE).toBe('RETRIEVAL_QUERY');
    expect(EMBEDDING_V2_TASK_TYPE).toBe('RETRIEVAL_DOCUMENT');

    generateEmbeddingV2.mockResolvedValue({ embedding: [0.1, 0.1], dim: 2 });
    await generateEmbedding.run(req({ text: 'a query', version: 'v2' }));

    expect(generateEmbeddingV2).toHaveBeenCalledTimes(1);
    const [, , opts] = generateEmbeddingV2.mock.calls[0];
    expect(opts.taskType).toBe('RETRIEVAL_QUERY');
    expect(opts.taskType).not.toBe(EMBEDDING_V2_TASK_TYPE);
  });

  it('the resulting query vector is cached under the query keyspace, not silently reused for documents', async () => {
    generateEmbeddingV2.mockResolvedValue({ embedding: [0.4, 0.5], dim: 2 });
    await generateEmbedding.run(req({ text: 'a query', version: 'v2' }));
    expect(setCachedEmbeddingV2Query).toHaveBeenCalledTimes(1);
    const [, , , embedding, meta] = setCachedEmbeddingV2Query.mock.calls[0];
    expect(embedding).toEqual([0.4, 0.5]);
    expect(meta.taskType).toBe('RETRIEVAL_QUERY');
  });
});

describe('generateEmbedding — consent gate applies to BOTH paths', () => {
  it('denies a v1 request when consent is revoked, before any embedding work', async () => {
    assertAiConsent.mockRejectedValue(new HttpsError('failed-precondition', 'ai-consent-revoked'));
    await expect(generateEmbedding.run(req({ text: 'hello', version: 'v1' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(getCachedEmbedding).not.toHaveBeenCalled();
  });

  it('denies a v2 request when consent is revoked, before any embedding work — v2 cannot bypass the gate', async () => {
    assertAiConsent.mockRejectedValue(new HttpsError('failed-precondition', 'ai-consent-revoked'));
    await expect(generateEmbedding.run(req({ text: 'hello', version: 'v2' }))).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(generateEmbeddingV2).not.toHaveBeenCalled();
  });
});

describe('generateEmbedding — v2 failure is loud, never silently falls back to v1', () => {
  it('throws internal when generateEmbeddingV2 fail-opens to null, and never returns a v1 vector', async () => {
    generateEmbeddingV2.mockResolvedValue(null);
    await expect(generateEmbedding.run(req({ text: 'hello', version: 'v2' }))).rejects.toMatchObject({
      code: 'internal',
    });
    // Space integrity: the v1 path must never have been consulted as a fallback.
    expect(getCachedEmbedding).not.toHaveBeenCalled();
  });
});

describe('generateEmbedding — auth requirement (unchanged)', () => {
  it('rejects unauthenticated requests for both versions', async () => {
    await expect(generateEmbedding.run(req({ text: 'hello', version: 'v1' }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(generateEmbedding.run(req({ text: 'hello', version: 'v2' }, null))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});
