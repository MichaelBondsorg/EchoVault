/**
 * Embeddings v2 migration, plan task M2 (review follow-up): the
 * `{[question]: queryVectors}` map RecipesScreen.jsx/SessionPrepScreen.jsx
 * build with the REAL `generateQueryEmbeddings` must flow all the way
 * through `runRecipe` -> `askJournalAI` -> `getSmartChatContext` ->
 * `scoreEntryInBestSpace`, and a v2-covered entry must be scored in v2
 * space when `model.embeddingV2Read` is ON.
 *
 * Same isolation strategy as `runRecipeAdversarialRetrieval.test.js`: only
 * the Firestore/Firebase callable boundary is mocked
 * (`../../../config/firebase`, `../../insights/sourceExclusions`); `runRecipe`,
 * `askJournalAI`, and `getSmartChatContext` all run for REAL. This file
 * additionally runs the REAL `generateQueryEmbeddings`
 * (`../../ai/embeddings`), mocking only its innermost Cloud Function
 * callable (`../../../config`'s `generateEmbeddingFn`) and
 * `../../../config/flags`'s `getFlag`.
 *
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();
const mockAskJournalAIFn = vi.fn();

vi.mock('../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));
vi.mock('../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));
vi.mock('../../../config/firebase', () => ({
  db: {},
  askJournalAIFn: (...args) => mockAskJournalAIFn(...args),
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  updateDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'reflection-1' })),
}));
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const getExcludedEntryIds = vi.fn(async () => new Set());
vi.mock('../../insights/sourceExclusions', () => ({ getExcludedEntryIds: (...a) => getExcludedEntryIds(...a) }));

// Deliberately NOT mocking '../../analysis' (askJournalAI/getSmartChatContext)
// or '../../ai/embeddings' (generateQueryEmbeddings) — both run for real.
const { runRecipe } = await import('../runRecipe.js');
const { generateQueryEmbeddings } = await import('../../ai/embeddings.js');

const UID = 'user-1';
const NOW = new Date('2026-07-22T12:00:00Z');
const QUESTION = 'What changed for me this month?';

function recipe(overrides = {}) {
  return {
    id: 'recipe-1',
    name: 'Monthly review',
    questions: [QUESTION],
    scope: null,
    timeRangeDays: 90,
    definitionVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getExcludedEntryIds.mockResolvedValue(new Set());
  mockAskJournalAIFn.mockResolvedValue({ data: { response: 'a real-shaped answer' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runRecipe + real generateQueryEmbeddings — flag OFF (byte-identical)', () => {
  it('the callable is invoked exactly once per question, no version field', async () => {
    mockGetFlag.mockReturnValue(false);
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 0, 0], space: 'v1' } });

    const queryVectors = await generateQueryEmbeddings(QUESTION);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(1);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: QUESTION });

    const entries = [{ id: 'e1', text: 'an old entry', tags: [], embedding: [1, 0, 0], createdAt: new Date('2026-06-01') }];
    const reflection = await runRecipe({}, UID, recipe(), { entries, embeddings: { [QUESTION]: queryVectors } });

    expect(reflection.blocks[0].sources).toContain('e1');
  });
});

describe('runRecipe + real generateQueryEmbeddings — flag ON (dual-space, map value flows end to end)', () => {
  beforeEach(() => {
    mockGetFlag.mockImplementation((name) => name === 'model.embeddingV2Read');
  });

  it('the {[question]: queryVectors} map value is a real {v1,v2} object (two callable invocations)', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });

    const queryVectors = await generateQueryEmbeddings(QUESTION);
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2);
    expect(queryVectors).toEqual({ v1: [1, 0, 0], v2: [0, 1, 0] });
  });

  it('integration: a v2-covered entry is scored in v2 space through the full runRecipe -> askJournalAI -> getSmartChatContext chain', async () => {
    // Space-differentiated vectors: v1 and v2 queries point in different
    // directions on purpose, so this proves space-correct pairing.
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });

    const queryVectors = await generateQueryEmbeddings(QUESTION); // real {v1,v2}

    const entries = [
      {
        id: 'v2-covered',
        text: 'the-v2-only-discoverable-recipe-entry',
        tags: [],
        embedding: [0, 1, 0],   // orthogonal to v1 query -> EXCLUDED if scored in v1 space
        embeddingV2: [0, 1, 0], // identical to v2 query -> INCLUDED if scored in v2 space
        createdAt: new Date('2026-06-01'), // within the recipe's 90-day window, no tags -> only semantic matching can surface it
      },
    ];

    const reflection = await runRecipe({}, UID, recipe(), {
      entries,
      embeddings: { [QUESTION]: queryVectors },
    });

    expect(reflection.blocks[0].sources).toContain('v2-covered');
    expect(mockAskJournalAIFn).toHaveBeenCalledTimes(1);
    const { entriesContext } = mockAskJournalAIFn.mock.calls[0][0];
    expect(entriesContext).toContain('the-v2-only-discoverable-recipe-entry');
  });

  it('a null map value (BOTH v1 and v2 fail -> generateQueryEmbeddings returns null) degrades to tag/recency matching, never an error — runRecipe\'s console.warn contract still fires', async () => {
    // Embeddings migration M4 inversion: a v1-only failure with v2 OK no
    // longer nulls out the whole result (v2 carries retrieval alone now —
    // see embeddings.test.js). This test's null-degrade path therefore now
    // requires BOTH spaces to fail, not just v1.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.reject(new Error('v1 down'));
      if (version === 'v2') return Promise.reject(new Error('v2 down'));
      throw new Error('unexpected call');
    });

    const queryVectors = await generateQueryEmbeddings(QUESTION); // null: both v1 and v2 failed
    expect(queryVectors).toBeNull();

    const entries = [{ id: 'e1', text: 'a recent entry', tags: [], createdAt: NOW }];
    const reflection = await runRecipe({}, UID, recipe(), { entries, embeddings: { [QUESTION]: queryVectors } });

    // Task 16 degrade-warning fires for the whole-map-value-null case.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[runRecipe] no embedding for question'),
      expect.any(String)
    );
    // Never an error — falls through to recency/tag matching.
    expect(reflection.blocks[0].text).toBe('a real-shaped answer');
    warnSpy.mockRestore();
  });
});
