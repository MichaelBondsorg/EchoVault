/**
 * Embeddings v2 migration, plan task M2 (review follow-up): RecipesScreen
 * is a real production caller of the per-question query-embedding seam —
 * confirm it's upgraded to `generateQueryEmbeddings` (not the legacy
 * single-vector `generateEmbedding`) with real callable-level spying.
 *
 * Unlike RecipesScreen.test.jsx (which stubs `services/ai` entirely), this
 * file keeps it REAL — only the innermost Cloud Function callable and the
 * flags doc are mocked — so the assertions are about the real production
 * code path. The deep runRecipe -> askJournalAI -> getSmartChatContext
 * v2-scoring proof lives in runRecipe.embeddingSpaces.test.js; this file
 * focuses on the caller (RecipesScreen) invoking the right seam correctly.
 *
 * See docs/superpowers/plans/2026-07-22-embeddings-v2-migration.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RecipesScreen from '../RecipesScreen';
import { subscribeRecipes } from '../../../services/reflections/recipeService';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { previewRecipe, runRecipe } from '../../../services/reflections/runRecipe';
import { getExcludedEntryIds } from '../../../services/insights/sourceExclusions';

const mockGenerateEmbeddingFn = vi.fn();
const mockGetFlag = vi.fn();

vi.mock('../../../config', () => ({
  generateEmbeddingFn: (...args) => mockGenerateEmbeddingFn(...args),
}));
vi.mock('../../../config/flags', () => ({
  getFlag: (...args) => mockGetFlag(...args),
}));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/reflections/recipeService', () => ({
  subscribeRecipes: vi.fn(),
  createRecipe: vi.fn().mockResolvedValue({ id: 'new-recipe' }),
  updateRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
  archiveRecipe: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
}));
vi.mock('../../../services/reflections/runRecipe', () => ({
  previewRecipe: vi.fn(),
  runRecipe: vi.fn(),
}));
vi.mock('../../../services/insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn().mockResolvedValue(new Set()),
}));
vi.mock('../ReflectionDraft', () => ({
  default: () => <div data-testid="reflection-draft" />,
}));

const UID = 'user-a';

function recipe(overrides = {}) {
  return {
    id: 'recipe-1',
    name: 'Monthly review',
    questions: ['Q1?', 'Q2?'],
    scope: null,
    timeRangeDays: 30,
    definitionVersion: 1,
    cadence: 'manual',
    state: 'active',
    ...overrides,
  };
}

const withRecipes = (recipes) => {
  subscribeRecipes.mockImplementation((_db, _uid, cb) => { cb(recipes); return () => {}; });
};
const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => { cb(spaces); return () => {}; });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFlag.mockReturnValue(false);
  withRecipes([recipe()]);
  withSpaces([]);
  previewRecipe.mockReturnValue({
    entryCount: 1,
    start: '2026-06-21T00:00:00.000Z',
    end: '2026-07-21T00:00:00.000Z',
    spaceName: 'All spaces',
  });
  getExcludedEntryIds.mockResolvedValue(new Set());
  runRecipe.mockResolvedValue({ id: 'reflection-1', title: 'Monthly review', blocks: [] });
});

const runTheRecipe = async () => {
  render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText('Run Monthly review'));
  const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });
  fireEvent.click(within(dialog).getByText('Run'));
  await waitFor(() => expect(runRecipe).toHaveBeenCalledTimes(1));
};

describe('RecipesScreen — generateQueryEmbeddings caller upgrade, flag OFF (byte-identical)', () => {
  it('calls the callable once per question with no version field', async () => {
    mockGenerateEmbeddingFn.mockResolvedValue({ data: { embedding: [1, 0, 0], space: 'v1' } });

    await runTheRecipe();

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(2); // one per question
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'Q1?' });
    expect(mockGenerateEmbeddingFn).toHaveBeenCalledWith({ text: 'Q2?' });

    const embeddings = runRecipe.mock.calls[0][3].embeddings;
    expect(embeddings['Q1?']).toEqual({ v1: [1, 0, 0] });
    expect(embeddings['Q2?']).toEqual({ v1: [1, 0, 0] });
  });
});

describe('RecipesScreen — generateQueryEmbeddings caller upgrade, flag ON (dual-space)', () => {
  beforeEach(() => {
    mockGetFlag.mockImplementation((name) => name === 'model.embeddingV2Read');
  });

  it('calls the callable TWICE per question (v1 + v2), threading a {v1,v2} object per question into runRecipe', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      throw new Error('unexpected call');
    });

    await runTheRecipe();

    expect(mockGenerateEmbeddingFn).toHaveBeenCalledTimes(4); // 2 questions x 2 versions
    const embeddings = runRecipe.mock.calls[0][3].embeddings;
    expect(embeddings['Q1?']).toEqual({ v1: [1, 0, 0], v2: [0, 1, 0] });
    expect(embeddings['Q2?']).toEqual({ v1: [1, 0, 0], v2: [0, 1, 0] });
  });

  it('v2 failure for one question degrades to v1-only for that question, never blocks the run', async () => {
    mockGenerateEmbeddingFn.mockImplementation(({ text, version }) => {
      if (version === 'v1') return Promise.resolve({ data: { embedding: [1, 0, 0], space: 'v1' } });
      if (version === 'v2') {
        if (text === 'Q1?') return Promise.reject(new Error('v2 down'));
        return Promise.resolve({ data: { embedding: [0, 1, 0], space: 'v2' } });
      }
      throw new Error('unexpected call');
    });

    await runTheRecipe();

    const embeddings = runRecipe.mock.calls[0][3].embeddings;
    expect(embeddings['Q1?']).toEqual({ v1: [1, 0, 0] }); // degraded, v2-less
    expect(embeddings['Q2?']).toEqual({ v1: [1, 0, 0], v2: [0, 1, 0] });
  });
});
