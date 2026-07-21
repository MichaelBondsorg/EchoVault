/**
 * RecipesScreen — full-screen Recipes overlay (R2 Task 17), modeled on
 * `PrivacyCenter.jsx`/`SpaceManager.jsx`'s cloud-sheet layout.
 *
 * Covers: starter-seed CTA gating, list rendering, inline edit (name +
 * questions, <=5, <=200 chars enforced), archive confirm, and the run flow
 * — preview gate (no run before an explicit "Run" confirm), per-question
 * embeddings threaded into `runRecipe` exactly, and opening
 * `ReflectionDraft` on completion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RecipesScreen from '../RecipesScreen';
import { subscribeRecipes, createRecipe, updateRecipe, archiveRecipe } from '../../../services/reflections/recipeService';
import { previewRecipe, runRecipe } from '../../../services/reflections/runRecipe';
import { getExcludedEntryIds } from '../../../services/insights/sourceExclusions';
import { generateEmbedding } from '../../../services/ai';
import { STARTER_RECIPES } from '../../../services/reflections/starterRecipes';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

vi.mock('../../../services/reflections/recipeService', () => ({
  subscribeRecipes: vi.fn(),
  createRecipe: vi.fn().mockResolvedValue({ id: 'new-recipe' }),
  updateRecipe: vi.fn().mockResolvedValue({ id: 'recipe-1' }),
  archiveRecipe: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/reflections/runRecipe', () => ({
  previewRecipe: vi.fn(),
  runRecipe: vi.fn(),
}));

vi.mock('../../../services/insights/sourceExclusions', () => ({
  getExcludedEntryIds: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock('../../../services/ai', () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('../ReflectionDraft', () => ({
  default: (props) => (
    <div data-testid="reflection-draft">
      <span data-testid="reflection-draft-title">{props.reflection?.title}</span>
      <span data-testid="reflection-draft-recipe-name">{props.recipeName}</span>
    </div>
  ),
}));

const UID = 'user-a';

const withRecipes = (recipes) => {
  subscribeRecipes.mockImplementation((_db, _uid, cb) => {
    cb(recipes);
    return () => {};
  });
};

function recipe(overrides = {}) {
  return {
    id: 'recipe-1',
    name: 'Monthly review',
    questions: ['What changed for me this month?'],
    scope: null,
    timeRangeDays: 30,
    definitionVersion: 1,
    cadence: 'manual',
    state: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  withRecipes([]);
  previewRecipe.mockReturnValue({
    entryCount: 3,
    start: '2026-06-21T00:00:00.000Z',
    end: '2026-07-21T00:00:00.000Z',
    spaceName: 'All spaces',
  });
  getExcludedEntryIds.mockResolvedValue(new Set());
  generateEmbedding.mockImplementation(async (text) => [text.length, 0, 0]);
  runRecipe.mockResolvedValue({
    id: 'reflection-1',
    title: 'Monthly review — July 2026',
    blocks: [],
  });
});

describe('RecipesScreen — starter-seed CTA gating', () => {
  it('shows the starter-seed CTA when the user has zero recipes', async () => {
    withRecipes([]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(await screen.findByText('Create starter recipes')).toBeTruthy();
  });

  it('does not show the CTA once the user has any recipe', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('Monthly review');
    expect(screen.queryByText('Create starter recipes')).toBeNull();
  });

  it('does not flash the CTA before the first subscription callback fires', () => {
    subscribeRecipes.mockImplementation(() => () => {});
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(screen.queryByText('Create starter recipes')).toBeNull();
  });

  it('tapping the CTA writes every STARTER_RECIPES template via createRecipe(db, uid, template)', async () => {
    withRecipes([]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Create starter recipes'));

    await waitFor(() => expect(createRecipe).toHaveBeenCalledTimes(STARTER_RECIPES.length));
    STARTER_RECIPES.forEach((template) => {
      expect(createRecipe).toHaveBeenCalledWith({ __db: true }, UID, template);
    });
  });
});

describe('RecipesScreen — list', () => {
  it('renders each recipe name and a cadence line derived from timeRangeDays', async () => {
    withRecipes([recipe({ name: 'Goal progress', timeRangeDays: 90 })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    expect(await screen.findByText('Goal progress')).toBeTruthy();
    expect(screen.getByText(/90 days/)).toBeTruthy();
  });

  it('shows "No recipes yet." when loaded and empty is otherwise not applicable (CTA takes over)', async () => {
    // Zero recipes is fully covered by the starter-seed CTA section; this
    // just proves the "your recipes" list itself renders no phantom rows.
    withRecipes([]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(await screen.findByText('No recipes yet.')).toBeTruthy();
  });
});

describe('RecipesScreen — inline edit (name + questions)', () => {
  it('edits name and questions, saving via updateRecipe(db, uid, recipe, {name, questions})', async () => {
    const existing = recipe({ questions: ['Q1?'] });
    withRecipes([existing]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    const nameInput = screen.getByDisplayValue('Monthly review');
    fireEvent.change(nameInput, { target: { value: 'Monthly check-in' } });
    const questionInput = screen.getByDisplayValue('Q1?');
    fireEvent.change(questionInput, { target: { value: 'What mattered this month?' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        { __db: true },
        UID,
        existing,
        { name: 'Monthly check-in', questions: ['What mattered this month?'] },
      ),
    );
  });

  it('caps questions at 5: the "Add question" affordance disappears at the limit', async () => {
    withRecipes([recipe({ questions: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.queryByText('+ Add question')).toBeNull();
  });

  it('rejects a question over 200 characters on save without calling updateRecipe', async () => {
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    const questionInput = screen.getByDisplayValue('Q1?');
    fireEvent.change(questionInput, { target: { value: 'x'.repeat(201) } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(updateRecipe).not.toHaveBeenCalled();
  });

  it('rejects an empty name on save without calling updateRecipe', async () => {
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    fireEvent.change(screen.getByDisplayValue('Monthly review'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(updateRecipe).not.toHaveBeenCalled();
  });

  it('Cancel discards edits without calling updateRecipe', async () => {
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    fireEvent.change(screen.getByDisplayValue('Monthly review'), { target: { value: 'Something else' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(updateRecipe).not.toHaveBeenCalled();
    expect(screen.getByText('Monthly review')).toBeTruthy();
  });
});

describe('RecipesScreen — archive', () => {
  it('archives only after confirming in the dialog', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Archive Monthly review'));
    expect(archiveRecipe).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /Archive/i });
    fireEvent.click(within(dialog).getByText('Archive'));

    await waitFor(() => expect(archiveRecipe).toHaveBeenCalledWith({ __db: true }, UID, 'recipe-1'));
  });

  it('Cancel in the archive dialog never calls archiveRecipe', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Archive Monthly review'));
    const dialog = screen.getByRole('dialog', { name: /Archive/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(archiveRecipe).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Archive/i })).toBeNull();
  });
});

describe('RecipesScreen — run flow: preview gate before first run', () => {
  it('tapping Run only opens the preview dialog; runRecipe is not called yet', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));

    await screen.findByRole('dialog', { name: /Run "Monthly review"/i });
    expect(runRecipe).not.toHaveBeenCalled();
    expect(generateEmbedding).not.toHaveBeenCalled();
  });

  it('the preview dialog shows entry count, space, and date range from previewRecipe', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });

    expect(within(dialog).getByText(/Will use 3 entries/)).toBeTruthy();
    expect(within(dialog).getByText(/All spaces/)).toBeTruthy();
  });

  it('previews using the exclusions fetched via getExcludedEntryIds(db, uid)', async () => {
    withRecipes([recipe()]);
    const excluded = new Set(['e9']);
    getExcludedEntryIds.mockResolvedValue(excluded);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));

    await waitFor(() => expect(previewRecipe).toHaveBeenCalled());
    expect(previewRecipe.mock.calls[0][2]).toBe(excluded);
  });

  it('Cancel on the preview dialog never calls runRecipe', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(runRecipe).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Run "Monthly review"/i })).toBeNull();
  });
});

describe('RecipesScreen — run flow: embeddings + completion', () => {
  it('computes one embedding per unique question and threads the exact {question: vector} map into runRecipe', async () => {
    const entries = [{ id: 'e1' }];
    const target = recipe({ questions: ['Q1?', 'Q2?'] });
    withRecipes([target]);
    render(<RecipesScreen uid={UID} entries={entries} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });
    fireEvent.click(within(dialog).getByText('Run'));

    await waitFor(() => expect(runRecipe).toHaveBeenCalledTimes(1));
    expect(generateEmbedding).toHaveBeenCalledWith('Q1?');
    expect(generateEmbedding).toHaveBeenCalledWith('Q2?');
    expect(generateEmbedding).toHaveBeenCalledTimes(2);

    const [passedDb, passedUid, passedRecipe, options] = runRecipe.mock.calls[0];
    expect(passedDb).toEqual({ __db: true });
    expect(passedUid).toBe(UID);
    expect(passedRecipe).toBe(target);
    expect(options.entries).toBe(entries);
    expect(options.embeddings).toEqual({
      'Q1?': ['Q1?'.length, 0, 0],
      'Q2?': ['Q2?'.length, 0, 0],
    });
  });

  it('a null embedding (generation failure) still proceeds to runRecipe with null for that question', async () => {
    generateEmbedding.mockResolvedValueOnce(null);
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    fireEvent.click(await screen.findByText('Run'));

    await waitFor(() => expect(runRecipe).toHaveBeenCalledTimes(1));
    expect(runRecipe.mock.calls[0][3].embeddings).toEqual({ 'Q1?': null });
  });

  it('opens ReflectionDraft with the reflection runRecipe returns and the recipe name', async () => {
    runRecipe.mockResolvedValue({ id: 'reflection-9', title: 'Monthly review — July 2026', blocks: [] });
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    fireEvent.click(await screen.findByText('Run'));

    expect(await screen.findByTestId('reflection-draft')).toBeTruthy();
    expect(screen.getByTestId('reflection-draft-title').textContent).toBe('Monthly review — July 2026');
    expect(screen.getByTestId('reflection-draft-recipe-name').textContent).toBe('Monthly review');
  });

  it('shows a progress state while embeddings are being generated (before completion)', async () => {
    let resolveEmbedding;
    generateEmbedding.mockImplementation(() => new Promise((res) => { resolveEmbedding = res; }));
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    fireEvent.click(await screen.findByText('Run'));

    expect(await screen.findByText(/Preparing your reflection/i)).toBeTruthy();
    expect(runRecipe).not.toHaveBeenCalled();

    resolveEmbedding([1, 0, 0]);
    await waitFor(() => expect(runRecipe).toHaveBeenCalledTimes(1));
  });
});

describe('RecipesScreen — copy constraints', () => {
  it('uses neutral, non-guilt, jargon-free copy', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('Monthly review');

    expect(screen.queryByText(/you should/i)).toBeNull();
    expect(screen.queryByText(/you must/i)).toBeNull();
    expect(screen.queryByText(/token/i)).toBeNull();
  });
});

describe('RecipesScreen — a11y', () => {
  it('exposes a single labelled aria-modal dialog when no nested overlay is open', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByText('Monthly review');

    const modals = document.querySelectorAll('[aria-modal="true"]');
    expect(modals).toHaveLength(1);
    expect(modals[0]).toHaveAttribute('aria-labelledby', 'recipes-title');
  });

  it('only one aria-modal="true" node exists while the preview dialog is open', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    await screen.findByRole('dialog', { name: /Run "Monthly review"/i });

    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });
});
