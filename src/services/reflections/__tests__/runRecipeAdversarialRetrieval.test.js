/**
 * Real adversarial retrieval test for the recipe engine (R2 Task 16 review
 * follow-up).
 *
 * `runRecipe.test.js`'s "input-pipeline invariant" test mocks `askJournalAI`
 * to a fixed `{text, entryIds}` return — it can only prove what runRecipe
 * FEEDS INTO askJournalAI, not that askJournalAI/getSmartChatContext's own
 * semantic/tag retrieval actually respects scope + exclusions. A stubbed
 * askJournalAI can't catch a broken filter inside itself.
 *
 * This test runs the REAL `askJournalAI`/`getSmartChatContext`
 * (unmocked, imported straight from `../../analysis`) through the REAL
 * `runRecipe`. Only two seams are mocked: the Firebase callable boundary
 * (`askJournalAIFn` in `../../../config/firebase` — the actual network/API
 * call) and Firestore reads/writes + `getExcludedEntryIds` (same as
 * `runRecipe.test.js` and matching the pattern in
 * `src/services/analysis/__tests__/scopeFilterSeam.test.js` /
 * `returnIdsSeam.test.js`, which mock only `askJournalAIFn`).
 *
 * The corpus deliberately engineers HIGH cosine-similarity embeddings for
 * the off-scope-space entry and the excluded entry (identical embedding to
 * the question — similarity 1.0, the maximum possible) so that if scope
 * filtering or exclusion filtering were ever broken inside
 * `getSmartChatContext`'s real semantic-match branch, those entries would
 * be the FIRST candidates selected, not an incidental miss. The in-scope
 * entry gets a deliberately weak (near-orthogonal) embedding, so the only
 * way it appears in the AI's context/sources is via the tag/recency
 * fallback paths that survive scope+exclusion filtering — proving the
 * assertion isn't trivially satisfied by "nothing matched".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  updateDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'reflection-1' })),
  // Real seam under test: this is the actual network/API boundary.
  askJournalAIFn: vi.fn(),
};
vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const getExcludedEntryIds = vi.fn(async () => new Set());
vi.mock('../../insights/sourceExclusions', () => ({ getExcludedEntryIds: (...a) => getExcludedEntryIds(...a) }));

// Deliberately NOT mocking '../../analysis' — askJournalAI/getSmartChatContext
// run for real, exercising filterEntriesByScope + cosineSimilarity + the
// tag/recency fallback paths exactly as production does.
const { runRecipe } = await import('../runRecipe.js');

const db = {};
const UID = 'user-1';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-21T12:00:00Z');

function daysAgo(n) {
  return new Date(NOW.getTime() - n * DAY_MS);
}

// The question embedding used for every run below.
const QUESTION_EMBEDDING = [1, 0, 0];
// Identical to the question embedding -> cosine similarity 1.0 (the max
// possible) -- this is what "engineered for HIGH similarity" means here.
const HIGH_SIMILARITY_EMBEDDING = [1, 0, 0];
// Orthogonal to the question embedding -> similarity 0, so the in-scope
// entry can only surface via the tag/recency fallback, never semantics.
const LOW_SIMILARITY_EMBEDDING = [0, 1, 0];

function corpus() {
  return [
    {
      id: 'in-scope',
      spaceId: 'work',
      text: 'The in-scope work entry that should be retrievable.',
      tags: [],
      embedding: LOW_SIMILARITY_EMBEDDING,
      createdAt: daysAgo(1),
    },
    {
      id: 'off-scope',
      spaceId: 'personal',
      text: 'A personal-space entry engineered to look maximally relevant.',
      tags: [],
      embedding: HIGH_SIMILARITY_EMBEDDING,
      createdAt: daysAgo(1),
    },
    {
      id: 'excluded',
      spaceId: 'work',
      text: 'A work entry the user has permanently excluded from AI use.',
      tags: [],
      embedding: HIGH_SIMILARITY_EMBEDDING,
      createdAt: daysAgo(1),
    },
  ];
}

function recipe(overrides = {}) {
  return {
    id: 'recipe-1',
    name: 'Monthly review',
    questions: ['What changed for me this month?'],
    scope: { spaceId: 'work' },
    timeRangeDays: 30,
    definitionVersion: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getExcludedEntryIds.mockResolvedValue(new Set(['excluded']));
  mocks.addDoc.mockResolvedValue({ id: 'reflection-1' });
  mocks.getDoc.mockResolvedValue({ exists: () => false });
  mocks.askJournalAIFn.mockResolvedValue({ data: { response: 'a real-shaped answer' } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runRecipe adversarial retrieval (real askJournalAI/getSmartChatContext)', () => {
  it('blocks[].sources contains the in-scope entry and never the off-scope or excluded entries', async () => {
    const entries = corpus();

    const reflection = await runRecipe(db, UID, recipe(), {
      entries,
      embeddings: { 'What changed for me this month?': QUESTION_EMBEDDING },
    });

    const sources = reflection.blocks[0].sources;
    expect(sources).toContain('in-scope');
    expect(sources).not.toContain('off-scope');
    expect(sources).not.toContain('excluded');
  });

  it('the AI callable context text itself never contains the off-scope or excluded entry text', async () => {
    const entries = corpus();

    await runRecipe(db, UID, recipe(), {
      entries,
      embeddings: { 'What changed for me this month?': QUESTION_EMBEDDING },
    });

    expect(mocks.askJournalAIFn).toHaveBeenCalledTimes(1);
    const { entriesContext } = mocks.askJournalAIFn.mock.calls[0][0];
    expect(entriesContext).toContain('in-scope work entry');
    expect(entriesContext).not.toContain('maximally relevant');
    expect(entriesContext).not.toContain('permanently excluded');
  });

  it('sanity anchor: without scope+exclusion filtering the high-similarity entries WOULD be picked (proves the corpus is a real trap, not an inert fixture)', async () => {
    // Same corpus, but run unscoped with no exclusions -- this proves the
    // off-scope/excluded entries are genuinely the strongest semantic
    // matches, so the passing assertions above are actually exercising the
    // filter, not just failing to find a match by luck.
    const entries = corpus();
    getExcludedEntryIds.mockResolvedValue(new Set());

    const reflection = await runRecipe(db, UID, recipe({ scope: null }), {
      entries,
      embeddings: { 'What changed for me this month?': QUESTION_EMBEDDING },
    });

    const sources = reflection.blocks[0].sources;
    expect(sources).toContain('off-scope');
    expect(sources).toContain('excluded');
  });
});
