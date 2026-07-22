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
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import RecipesScreen from '../RecipesScreen';
import { subscribeRecipes, createRecipe, updateRecipe, archiveRecipe } from '../../../services/reflections/recipeService';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { previewRecipe, runRecipe } from '../../../services/reflections/runRecipe';
import { getExcludedEntryIds } from '../../../services/insights/sourceExclusions';
import { generateEmbedding } from '../../../services/ai';
import { getFlag } from '../../../config/flags';
import { STARTER_RECIPES } from '../../../services/reflections/starterRecipes';

vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));

// Default true: the scope-picker gating (review fix) is exercised
// explicitly in its own describe block below; every other test's edit-form
// assertions predate that gate and should keep seeing the picker.
vi.mock('../../../config/flags', () => ({ getFlag: vi.fn() }));

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

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => {
    cb(spaces);
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
  getFlag.mockReturnValue(true);
  withRecipes([]);
  withSpaces([]);
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

  it('a second rapid tap of the CTA while seeding is a no-op (double-tap guard)', async () => {
    withRecipes([]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    const cta = await screen.findByText('Create starter recipes');
    fireEvent.click(cta);
    // The CTA re-renders as disabled + "Creating…" the moment `seeding`
    // flips true (before any write resolves) — a disabled button does not
    // dispatch click handlers, so these extra taps must be no-ops.
    const stillSeeding = screen.getByText('Creating…');
    expect(stillSeeding.closest('button')).toBeDisabled();
    fireEvent.click(stillSeeding);
    fireEvent.click(stillSeeding);

    await waitFor(() => expect(createRecipe).toHaveBeenCalledTimes(STARTER_RECIPES.length));
    STARTER_RECIPES.forEach((template) => {
      expect(createRecipe).toHaveBeenCalledWith({ __db: true }, UID, template);
    });
  });
});

describe('RecipesScreen — load error (review fix)', () => {
  it('surfaces an error instead of the starter-seed CTA when subscribeRecipes reports an error', async () => {
    subscribeRecipes.mockImplementation((_db, _uid, _cb, onError) => {
      onError(new Error('offline'));
      return () => {};
    });
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Create starter recipes')).toBeNull();
  });

  it('a later successful subscription callback clears the error state', async () => {
    let deliver;
    subscribeRecipes.mockImplementation((_db, _uid, cb, onError) => {
      deliver = { cb, onError };
      onError(new Error('offline'));
      return () => {};
    });
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    await screen.findByRole('alert');

    act(() => {
      deliver.cb([]);
    });

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(await screen.findByText('Create starter recipes')).toBeTruthy();
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
  it('edits name and questions, saving via updateRecipe(db, uid, recipe, {name, questions, scope, timeRangeDays})', async () => {
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
        { name: 'Monthly check-in', questions: ['What mattered this month?'], scope: null, timeRangeDays: 30 },
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

  it('the Save/Cancel buttons keep the shared Button 44px default (no min-h override)', async () => {
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.getByText('Save').className).not.toMatch(/min-h-\[36px\]/);
    expect(screen.getByText('Cancel').className).not.toMatch(/min-h-\[36px\]/);
  });
});

describe('RecipesScreen — Space picker gated behind contextSpaces flag (review fix)', () => {
  it('flag off: renders no Space picker and never subscribes to spaces', async () => {
    getFlag.mockImplementation((flag) => flag !== 'contextSpaces');
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.queryByText('Space')).toBeNull();
    expect(screen.queryByLabelText(/Space for Monthly review/)).toBeNull();
    expect(subscribeSpaces).not.toHaveBeenCalled();
    // Time range editing is unaffected — it has no contextSpaces dependency.
    expect(screen.getByText('90 days')).toBeTruthy();
  });

  it('flag off: saving an edit leaves a previously-stored scope untouched (never stripped)', async () => {
    getFlag.mockImplementation((flag) => flag !== 'contextSpaces');
    const existing = recipe({ questions: ['Q1?'], scope: { spaceId: 'space-1' }, timeRangeDays: 30 });
    withRecipes([existing]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        { __db: true },
        UID,
        existing,
        { name: 'Monthly review', questions: ['Q1?'], scope: { spaceId: 'space-1' }, timeRangeDays: 30 },
      ),
    );
  });

  it('flag off: the run-preview never resolves a real space name (spaces list stays empty)', async () => {
    getFlag.mockImplementation((flag) => flag !== 'contextSpaces');
    withRecipes([recipe({ scope: { spaceId: 'space-1' } })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));

    await waitFor(() => expect(previewRecipe).toHaveBeenCalled());
    expect(previewRecipe.mock.calls[0][3]).toEqual([]);
  });

  it('flag on: renders the Space picker', async () => {
    getFlag.mockReturnValue(true);
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.getByLabelText('Space for Monthly review: All spaces')).toBeTruthy();
  });
});

describe('RecipesScreen — inline edit (scope + time range, PRD §5.6)', () => {
  it('defaults the edit form to the recipe\'s current scope (All spaces) and timeRangeDays', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    withRecipes([recipe({ questions: ['Q1?'], scope: null, timeRangeDays: 30 })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.getByLabelText('Space for Monthly review: All spaces')).toBeTruthy();
    expect(screen.getByText('30 days').getAttribute('aria-pressed')).toBe('true');
  });

  it('picking a specific space via the shared SpacePicker writes scope: {spaceId} on save', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    const existing = recipe({ questions: ['Q1?'], scope: null, timeRangeDays: 30 });
    withRecipes([existing]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    fireEvent.click(screen.getByLabelText('Space for Monthly review: All spaces'));
    fireEvent.click(screen.getByRole('option', { name: 'Work' }));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        { __db: true },
        UID,
        existing,
        { name: 'Monthly review', questions: ['Q1?'], scope: { spaceId: 'space-1' }, timeRangeDays: 30 },
      ),
    );
  });

  it('picking "All spaces" from a previously-scoped recipe writes scope: null on save (never omitted, never undefined)', async () => {
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    const existing = recipe({ questions: ['Q1?'], scope: { spaceId: 'space-1' }, timeRangeDays: 30 });
    withRecipes([existing]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    expect(screen.getByLabelText('Space for Monthly review: Work')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Space for Monthly review: Work'));
    fireEvent.click(screen.getByRole('option', { name: 'All spaces' }));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        { __db: true },
        UID,
        existing,
        { name: 'Monthly review', questions: ['Q1?'], scope: null, timeRangeDays: 30 },
      ),
    );
    expect(updateRecipe.mock.calls[0][3]).toHaveProperty('scope', null);
  });

  it('picking a time range option writes timeRangeDays on save', async () => {
    const existing = recipe({ questions: ['Q1?'], timeRangeDays: 30 });
    withRecipes([existing]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    fireEvent.click(screen.getByText('90 days'));
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateRecipe).toHaveBeenCalledWith(
        { __db: true },
        UID,
        existing,
        { name: 'Monthly review', questions: ['Q1?'], scope: null, timeRangeDays: 90 },
      ),
    );
  });

  it('offers exactly the 7/30/90/365 day options', async () => {
    withRecipes([recipe({ questions: ['Q1?'] })]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Edit Monthly review'));
    ['7 days', '30 days', '90 days', '365 days'].forEach((label) => {
      expect(screen.getByText(label)).toBeTruthy();
    });
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

  it('restores focus to the trigger button when the archive dialog is cancelled (SpaceManager.jsx precedent)', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    const trigger = await screen.findByLabelText('Archive Monthly review');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: /Archive/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger button after a confirmed archive', async () => {
    withRecipes([recipe()]);
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    const trigger = await screen.findByLabelText('Archive Monthly review');
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: /Archive/i });
    fireEvent.click(within(dialog).getByText('Archive'));

    await waitFor(() => expect(archiveRecipe).toHaveBeenCalled());
    expect(document.activeElement).toBe(trigger);
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

  it('passes the subscribed spaces list into previewRecipe so a scoped recipe resolves its real space name', async () => {
    const spaces = [{ id: 'space-1', name: 'Work' }];
    withSpaces(spaces);
    withRecipes([recipe({ scope: { spaceId: 'space-1' } })]);
    previewRecipe.mockReturnValue({
      entryCount: 3,
      start: '2026-06-21T00:00:00.000Z',
      end: '2026-07-21T00:00:00.000Z',
      spaceName: 'Work',
    });
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });

    await waitFor(() => expect(previewRecipe).toHaveBeenCalled());
    expect(previewRecipe.mock.calls[0][3]).toBe(spaces);
    expect(within(dialog).getByText(/Work/)).toBeTruthy();
  });

  it('the preview dialog shows "Will use 0 entries" when previewRecipe reports an empty pool', async () => {
    withRecipes([recipe()]);
    previewRecipe.mockReturnValue({
      entryCount: 0,
      start: '2026-06-21T00:00:00.000Z',
      end: '2026-07-21T00:00:00.000Z',
      spaceName: 'All spaces',
    });
    render(<RecipesScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText('Run Monthly review'));
    const dialog = await screen.findByRole('dialog', { name: /Run "Monthly review"/i });

    expect(within(dialog).getByText(/Will use 0 entries/)).toBeTruthy();
    // The Run confirm stays enabled even at zero entries — an empty result
    // is a valid (if uninteresting) preview, not an error state.
    expect(within(dialog).getByText('Run')).not.toBeDisabled();
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
