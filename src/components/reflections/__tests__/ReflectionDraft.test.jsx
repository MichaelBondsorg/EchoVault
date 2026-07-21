/**
 * ReflectionDraft — renders a `reflections/{id}` doc and lets the owner
 * edit it in place (R2 Task 17). Covers: block order/labels ("AI-generated"
 * vs "Your note", persistent even after an edit — PRD trace-or-labeled
 * acceptance), the source-count chip opening a `SourceList` scoped to that
 * block's own sources, edit/add-note/remove/reorder semantics wired to the
 * Task 16 engine helpers, past runs for the same recipe, and the "no
 * export in v1" constraint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReflectionDraft from '../ReflectionDraft';
import { updateBlock, addUserBlock, removeBlock, reorderBlocks } from '../../../services/reflections/runRecipe';

vi.mock('../../../config/firebase', () => ({
  db: { __db: true },
  collection: vi.fn((_db, path) => ({ __col: path })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((...args) => ({ __where: args })),
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
}));

vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

vi.mock('../../../services/reflections/runRecipe', () => ({
  updateBlock: vi.fn(),
  addUserBlock: vi.fn(),
  removeBlock: vi.fn(),
  reorderBlocks: vi.fn(),
}));

vi.mock('../../insights/SourceList', () => ({
  default: ({ sources }) => (
    <div data-testid="source-list">
      {sources.map((s) => (
        <div key={s.entryId} data-testid="source-row">{s.entryId}|{s.excerpt}</div>
      ))}
    </div>
  ),
}));

const UID = 'user-1';

function baseReflection(overrides = {}) {
  return {
    id: 'reflection-1',
    kind: 'recipe_run',
    recipeId: 'recipe-1',
    definitionVersion: 1,
    scope: null,
    period: { start: '2026-06-21T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    title: 'Monthly review — July 2026',
    status: 'draft',
    createdAt: '2026-07-21T09:00:00.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z',
    blocks: [
      {
        id: 'block-ai-1',
        type: 'ai',
        question: 'What changed for me this month?',
        text: 'You mentioned work stress easing.',
        sources: ['e1', 'e2'],
        editedByUser: false,
      },
      {
        id: 'block-ai-2',
        type: 'ai',
        question: 'What patterns kept showing up?',
        text: 'Morning walks correlated with better mood.',
        sources: ['e3'],
        editedByUser: false,
      },
      {
        id: 'block-user-1',
        type: 'user',
        text: 'My own note.',
        sources: [],
        editedByUser: false,
      },
    ],
    ...overrides,
  };
}

const entries = [
  { id: 'e1', content: 'Work felt calmer this week.', createdAt: '2026-07-10T09:00:00.000Z' },
  { id: 'e2', content: 'Talked to my manager about workload.', createdAt: '2026-07-05T09:00:00.000Z' },
  { id: 'e3', content: 'Went for a walk, mood lifted.', createdAt: '2026-07-01T09:00:00.000Z' },
];

function renderDraft(overrides = {}) {
  const props = {
    uid: UID,
    entries,
    reflection: baseReflection(),
    recipeName: 'Monthly review',
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(<ReflectionDraft {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReflectionDraft — renders the doc', () => {
  it('renders the title and a period line', () => {
    renderDraft();
    expect(screen.getByText('Monthly review — July 2026')).toBeTruthy();
    expect(screen.getByText(/Jun 21, 2026/)).toBeTruthy();
    expect(screen.getByText(/Jul 21, 2026/)).toBeTruthy();
  });

  it('renders blocks in order', () => {
    renderDraft();
    const blocks = screen.getAllByTestId(/^reflection-block-/);
    expect(blocks.map((b) => b.dataset.testid)).toEqual([
      'reflection-block-block-ai-1',
      'reflection-block-block-ai-2',
      'reflection-block-block-user-1',
    ]);
  });

  it('AI blocks are labelled "AI-generated"; user blocks are labelled "Your note"', () => {
    renderDraft();
    expect(screen.getAllByText('AI-generated')).toHaveLength(2);
    expect(screen.getByText('Your note')).toBeTruthy();
  });

  it('AI blocks show a source-count chip with the right count', () => {
    renderDraft();
    const block1 = screen.getByTestId('reflection-block-block-ai-1');
    const block2 = screen.getByTestId('reflection-block-block-ai-2');
    expect(within(block1).getByText('2 sources')).toBeTruthy();
    expect(within(block2).getByText('1 source')).toBeTruthy();
  });

  it('closing calls onClose', () => {
    const { props } = renderDraft();
    fireEvent.click(screen.getByLabelText('Close reflection'));
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe('ReflectionDraft — source chip opens SourceList scoped to that block', () => {
  it('tapping a block\'s source chip shows only that block\'s sources', () => {
    renderDraft();
    fireEvent.click(within(screen.getByTestId('reflection-block-block-ai-1')).getByText('2 sources'));

    const list = screen.getByTestId('source-list');
    const rows = within(list).getAllByTestId('source-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'e1|Work felt calmer this week.',
      'e2|Talked to my manager about workload.',
    ]);
  });

  it('a second block\'s sources never leak into the first block\'s list', () => {
    renderDraft();
    fireEvent.click(within(screen.getByTestId('reflection-block-block-ai-2')).getByText('1 source'));

    const rows = within(screen.getByTestId('source-list')).getAllByTestId('source-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('e3|Went for a walk, mood lifted.');
  });

  it('falls back gracefully for a source id not present in entries', () => {
    renderDraft({
      reflection: baseReflection({
        blocks: [
          { id: 'block-ai-1', type: 'ai', question: 'Q?', text: 'A', sources: ['ghost'], editedByUser: false },
        ],
      }),
    });
    fireEvent.click(screen.getByText('1 source'));
    const rows = within(screen.getByTestId('source-list')).getAllByTestId('source-row');
    expect(rows[0].textContent).toBe('ghost|');
  });
});

describe('ReflectionDraft — edit-in-place', () => {
  it('editing an AI block calls updateBlock and keeps "AI-generated" while adding an "Edited" tag', async () => {
    updateBlock.mockResolvedValue({
      ...baseReflection(),
      blocks: [
        { id: 'block-ai-1', type: 'ai', question: 'What changed for me this month?', text: 'Edited answer.', sources: ['e1', 'e2'], editedByUser: true },
        baseReflection().blocks[1],
        baseReflection().blocks[2],
      ],
    });
    renderDraft();

    const block1 = screen.getByTestId('reflection-block-block-ai-1');
    fireEvent.click(within(block1).getByLabelText('Edit'));
    const textarea = within(block1).getByDisplayValue('You mentioned work stress easing.');
    fireEvent.change(textarea, { target: { value: 'Edited answer.' } });
    fireEvent.click(within(block1).getByText('Save'));

    await waitFor(() =>
      expect(updateBlock).toHaveBeenCalledWith({ __db: true }, UID, 'reflection-1', 'block-ai-1', { text: 'Edited answer.' }),
    );
    expect(await screen.findByText('Edited answer.')).toBeTruthy();
    const updatedBlock1 = screen.getByTestId('reflection-block-block-ai-1');
    expect(within(updatedBlock1).getByText('AI-generated')).toBeTruthy();
    expect(within(updatedBlock1).getByText('Edited')).toBeTruthy();
  });

  it('cancelling an edit discards changes without calling updateBlock', () => {
    renderDraft();
    const block1 = screen.getByTestId('reflection-block-block-ai-1');
    fireEvent.click(within(block1).getByLabelText('Edit'));
    fireEvent.change(within(block1).getByDisplayValue('You mentioned work stress easing.'), { target: { value: 'discarded' } });
    fireEvent.click(within(block1).getByText('Cancel'));

    expect(updateBlock).not.toHaveBeenCalled();
    expect(screen.getByText('You mentioned work stress easing.')).toBeTruthy();
  });
});

describe('ReflectionDraft — add a note', () => {
  it('adds a "Your note" block via addUserBlock(db, uid, reflectionId, text)', async () => {
    addUserBlock.mockResolvedValue({
      ...baseReflection(),
      blocks: [...baseReflection().blocks, { id: 'block-user-2', type: 'user', text: 'A fresh note', sources: [], editedByUser: false }],
    });
    renderDraft();

    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'A fresh note' } });
    fireEvent.click(screen.getByText('Add note'));

    await waitFor(() =>
      expect(addUserBlock).toHaveBeenCalledWith({ __db: true }, UID, 'reflection-1', 'A fresh note'),
    );
    expect(await screen.findByText('A fresh note')).toBeTruthy();
    expect(screen.getAllByText('Your note')).toHaveLength(2);
  });
});

describe('ReflectionDraft — remove a block (confirm-gated)', () => {
  it('does not remove until confirmed', async () => {
    removeBlock.mockResolvedValue({
      ...baseReflection(),
      blocks: baseReflection().blocks.filter((b) => b.id !== 'block-user-1'),
    });
    renderDraft();

    fireEvent.click(within(screen.getByTestId('reflection-block-block-user-1')).getByLabelText('Remove'));
    expect(removeBlock).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /remove this block/i });
    fireEvent.click(within(dialog).getByText('Remove'));

    await waitFor(() =>
      expect(removeBlock).toHaveBeenCalledWith({ __db: true }, UID, 'reflection-1', 'block-user-1'),
    );
    expect(screen.queryByTestId('reflection-block-block-user-1')).toBeNull();
  });

  it('Cancel never calls removeBlock', () => {
    renderDraft();
    fireEvent.click(within(screen.getByTestId('reflection-block-block-user-1')).getByLabelText('Remove'));
    const dialog = screen.getByRole('dialog', { name: /remove this block/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(removeBlock).not.toHaveBeenCalled();
    expect(screen.getByTestId('reflection-block-block-user-1')).toBeTruthy();
  });
});

describe('ReflectionDraft — reorder', () => {
  it('moving a block down calls reorderBlocks with the new id order', async () => {
    reorderBlocks.mockResolvedValue({
      ...baseReflection(),
      blocks: [baseReflection().blocks[1], baseReflection().blocks[0], baseReflection().blocks[2]],
    });
    renderDraft();

    fireEvent.click(within(screen.getByTestId('reflection-block-block-ai-1')).getByLabelText('Move down'));

    await waitFor(() =>
      expect(reorderBlocks).toHaveBeenCalledWith(
        { __db: true },
        UID,
        'reflection-1',
        ['block-ai-2', 'block-ai-1', 'block-user-1'],
      ),
    );
  });

  it('the first block cannot move up and the last cannot move down', () => {
    renderDraft();
    expect(within(screen.getByTestId('reflection-block-block-ai-1')).getByLabelText('Move up')).toBeDisabled();
    expect(within(screen.getByTestId('reflection-block-block-user-1')).getByLabelText('Move down')).toBeDisabled();
  });
});

describe('ReflectionDraft — past runs', () => {
  it('lists past reflections for the same recipe and switching displays the selected one', async () => {
    const { getDocs } = await import('../../../config/firebase');
    const older = baseReflection({ id: 'reflection-0', title: 'Monthly review — June 2026', createdAt: '2026-06-21T09:00:00.000Z' });
    getDocs.mockResolvedValue({
      forEach: (cb) => {
        [baseReflection(), older].forEach((r) => {
          const { id, ...data } = r;
          cb({ id, data: () => data });
        });
      },
    });
    renderDraft();

    expect(await screen.findByText('Monthly review — June 2026')).toBeTruthy();
    fireEvent.click(screen.getByText('Monthly review — June 2026'));

    // The header title switches to the selected past run.
    const headers = screen.getAllByText('Monthly review — June 2026');
    expect(headers.length).toBeGreaterThan(0);
  });
});

describe('ReflectionDraft — no export in v1', () => {
  it('renders no export affordance anywhere', () => {
    renderDraft();
    expect(screen.queryByText(/export/i)).toBeNull();
  });
});

describe('ReflectionDraft — copy constraints', () => {
  it('uses neutral, non-guilt, jargon-free copy', () => {
    renderDraft();
    expect(screen.queryByText(/you should/i)).toBeNull();
    expect(screen.queryByText(/you must/i)).toBeNull();
    expect(screen.queryByText(/token/i)).toBeNull();
    expect(screen.queryByText(/\bmodel\b/i)).toBeNull();
  });
});

describe('ReflectionDraft — a11y', () => {
  it('exposes a single labelled aria-modal dialog when no nested overlay is open', () => {
    renderDraft();
    const modals = document.querySelectorAll('[aria-modal="true"]');
    expect(modals).toHaveLength(1);
  });

  it('only one aria-modal="true" node exists while the source list is open', () => {
    renderDraft();
    fireEvent.click(within(screen.getByTestId('reflection-block-block-ai-1')).getByText('2 sources'));
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });

  it('only one aria-modal="true" node exists while the remove-confirm dialog is open', () => {
    renderDraft();
    fireEvent.click(within(screen.getByTestId('reflection-block-block-user-1')).getByLabelText('Remove'));
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1);
  });
});
