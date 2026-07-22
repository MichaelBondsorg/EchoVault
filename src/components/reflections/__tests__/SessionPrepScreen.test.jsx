/**
 * SessionPrepScreen tests (R2 Task 18).
 *
 * Covers: since-date defaulting/validation, contextSpaces-gated Space
 * picker (Task 17 review lesson — must be gated the same way everywhere),
 * embedding pre-computation threaded into `buildSessionBrief`, block
 * edit/remove/regenerate (confirm-gated only when already edited),
 * source-list scoping per block, and the confirm-gated export flow
 * (content preview shown BEFORE `composeSessionPrepPdf` is ever called).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SessionPrepScreen from '../SessionPrepScreen';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import { updateBlock, addUserBlock, removeBlock } from '../../../services/reflections/runRecipe';
import { buildSessionBrief, regenerateSection, composeSessionPrepPdf, SESSION_PREP_QUESTIONS } from '../../../services/reflections/sessionPrep';
import { generateEmbedding } from '../../../services/ai';
import { getFlag } from '../../../config/flags';

const mockFirebase = vi.hoisted(() => ({
  db: { __db: true },
  collection: vi.fn((_db, path) => ({ __col: path })),
  query: vi.fn((...args) => ({ __query: args })),
  where: vi.fn((...args) => ({ __where: args })),
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
}));
vi.mock('../../../config/firebase', () => mockFirebase);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));
vi.mock('../../../config/flags', () => ({ getFlag: vi.fn() }));

vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: vi.fn(),
}));

vi.mock('../../../services/reflections/runRecipe', () => ({
  updateBlock: vi.fn(),
  addUserBlock: vi.fn(),
  removeBlock: vi.fn(),
}));

vi.mock('../../../services/reflections/sessionPrep', () => ({
  buildSessionBrief: vi.fn(),
  regenerateSection: vi.fn(),
  composeSessionPrepPdf: vi.fn(),
  DEFAULT_SINCE_DAYS_BACK: 14,
  SESSION_PREP_QUESTIONS: [
    'What changed since my last session?',
    'Which moments do I want to bring up?',
    'What patterns came up, and what am I unsure about?',
    'What open questions do I want to ask?',
  ],
}));

vi.mock('../../../services/ai', () => ({
  generateEmbedding: vi.fn(),
}));

const UID = 'user-a';

function brief(overrides = {}) {
  return {
    id: 'brief-1',
    title: 'Session prep — July 2026',
    period: { start: '2026-07-07T00:00:00.000Z', end: '2026-07-21T00:00:00.000Z' },
    blocks: [
      { id: 'b-changes', type: 'ai', section: 'Changes since', question: SESSION_PREP_QUESTIONS[0], text: 'Things changed.', sources: ['e1'], editedByUser: false },
      { id: 'b-patterns', type: 'ai', section: 'Patterns', question: SESSION_PREP_QUESTIONS[2], text: 'Patterns text.', sources: ['e2'], editedByUser: true },
      { id: 'b-goals', type: 'user', section: 'My goals', text: '', sources: [], editedByUser: false },
    ],
    ...overrides,
  };
}

const withSpaces = (spaces) => {
  subscribeSpaces.mockImplementation((_db, _uid, cb) => {
    cb(spaces);
    return () => {};
  });
};

const withPastBriefs = (briefs) => {
  mockFirebase.getDocs.mockResolvedValue({
    forEach: (fn) => briefs.forEach((b) => {
      const { id, ...data } = b;
      fn({ id, data: () => data });
    }),
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  getFlag.mockReturnValue(true);
  withSpaces([]);
  withPastBriefs([]);
  generateEmbedding.mockImplementation(async (text) => [text.length, 0, 0]);
  buildSessionBrief.mockResolvedValue(brief());
  regenerateSection.mockResolvedValue(brief());
  composeSessionPrepPdf.mockResolvedValue({ save: vi.fn() });
});

describe('SessionPrepScreen — setup form', () => {
  it('defaults the since-date field to 14 days back', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Since');
    const expected = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(input.value).toBe(expected);
    await waitFor(() => expect(mockFirebase.getDocs).toHaveBeenCalled());
  });

  it('shows an error and does not call buildSessionBrief when the since-date is cleared', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Generate session prep'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(buildSessionBrief).not.toHaveBeenCalled();
  });

  it('shows an error and does not call buildSessionBrief when the since-date is in the future', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: future } });
    fireEvent.click(screen.getByText('Generate session prep'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(buildSessionBrief).not.toHaveBeenCalled();
  });
});

describe('SessionPrepScreen — Space picker gated behind contextSpaces (Task 17 lesson)', () => {
  it('flag off: renders no Space picker and never subscribes to spaces', async () => {
    getFlag.mockImplementation((flag) => flag !== 'contextSpaces');
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(screen.queryByText('Space')).toBeNull();
    expect(subscribeSpaces).not.toHaveBeenCalled();
    await waitFor(() => expect(mockFirebase.getDocs).toHaveBeenCalled());
  });

  it('flag on: renders the Space picker trigger defaulted to All spaces', async () => {
    getFlag.mockReturnValue(true);
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Space: All spaces')).toBeTruthy();
    await waitFor(() => expect(mockFirebase.getDocs).toHaveBeenCalled());
  });
});

describe('SessionPrepScreen — generate: embeddings + payload', () => {
  it('computes one embedding per Session-preparation question and threads the map into buildSessionBrief', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    expect(generateEmbedding).toHaveBeenCalledTimes(SESSION_PREP_QUESTIONS.length);
    const options = buildSessionBrief.mock.calls[0][2];
    expect(Object.keys(options.embeddings)).toEqual(SESSION_PREP_QUESTIONS);
  });

  it('appends topics as a 5th question when provided, trimmed', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Anything specific/), { target: { value: '  my promotion  ' } });
    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    expect(generateEmbedding).toHaveBeenCalledTimes(SESSION_PREP_QUESTIONS.length + 1);
    expect(generateEmbedding).toHaveBeenCalledWith('my promotion');
    const options = buildSessionBrief.mock.calls[0][2];
    expect(options.topics).toBe('my promotion');
  });

  it('does not append a topics question when blank/whitespace only', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Anything specific/), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    expect(generateEmbedding).toHaveBeenCalledTimes(SESSION_PREP_QUESTIONS.length);
  });

  it('passes the chosen since-date (as a Date) and scope through to buildSessionBrief', async () => {
    getFlag.mockReturnValue(true);
    withSpaces([{ id: 'space-1', name: 'Work' }]);
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByLabelText('Space: All spaces'));
    fireEvent.click(screen.getByText('Work'));
    fireEvent.click(screen.getByText('Generate session prep'));

    await waitFor(() => expect(buildSessionBrief).toHaveBeenCalledTimes(1));
    const [passedDb, passedUid, options] = buildSessionBrief.mock.calls[0];
    expect(passedDb).toEqual({ __db: true });
    expect(passedUid).toBe(UID);
    expect(options.sinceDate.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(options.scope).toEqual({ spaceId: 'space-1' });
  });

  it('opens the brief view with the returned brief\'s title on success', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    expect(await screen.findByText('Session prep — July 2026')).toBeTruthy();
  });

  it('surfaces an error and stays on setup when buildSessionBrief rejects', async () => {
    buildSessionBrief.mockRejectedValueOnce(new Error('boom'));
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Generate session prep')).toBeTruthy();
  });
});

describe('SessionPrepScreen — recent list', () => {
  it('renders past session briefs and opens one on tap without calling buildSessionBrief', async () => {
    withPastBriefs([brief({ id: 'brief-old', title: 'Session prep — June 2026' })]);
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('Session prep — June 2026'));
    expect(await screen.findByText('Changes since')).toBeTruthy();
    expect(buildSessionBrief).not.toHaveBeenCalled();
  });
});

describe('SessionPrepScreen — brief view: block display', () => {
  async function openGeneratedBrief() {
    render(<SessionPrepScreen uid={UID} entries={[{ id: 'e1' }, { id: 'e2' }]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    await screen.findByText('Session prep — July 2026');
  }

  it('labels AI blocks "AI-generated" (+ "Edited" when editedByUser) and user blocks "Your note"', async () => {
    await openGeneratedBrief();
    expect(screen.getAllByText('AI-generated').length).toBeGreaterThan(0);
    expect(screen.getByText('Your note')).toBeTruthy();
    expect(screen.getByText('Edited')).toBeTruthy();
  });

  it('edits a block and saves via updateBlock(db, uid, brief.id, blockId, {text})', async () => {
    updateBlock.mockResolvedValue(brief({ blocks: [{ id: 'b-changes', type: 'ai', section: 'Changes since', text: 'Edited text.', sources: ['e1'], editedByUser: true }] }));
    await openGeneratedBrief();

    fireEvent.click(screen.getByLabelText('Edit Changes since'));
    fireEvent.change(screen.getByLabelText('Edit Changes since'), { target: { value: 'Edited text.' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateBlock).toHaveBeenCalledWith({ __db: true }, UID, 'brief-1', 'b-changes', { text: 'Edited text.' }),
    );
  });

  it('removes a block via a confirm sheet, calling removeBlock only after confirming', async () => {
    removeBlock.mockResolvedValue(brief({ blocks: [] }));
    await openGeneratedBrief();

    fireEvent.click(screen.getByLabelText('Remove Changes since'));
    expect(removeBlock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: /Remove this section/i });
    fireEvent.click(within(dialog).getByText('Remove'));

    await waitFor(() => expect(removeBlock).toHaveBeenCalledWith({ __db: true }, UID, 'brief-1', 'b-changes'));
  });

  it('opens the source list for the tapped block only (adversarial: not another block\'s sources)', async () => {
    const customBrief = brief({
      blocks: [
        { id: 'b-changes', type: 'ai', section: 'Changes since', text: 'Things changed.', sources: ['e1', 'e2'], editedByUser: false },
        { id: 'b-patterns', type: 'ai', section: 'Patterns', text: 'Patterns text.', sources: ['e3'], editedByUser: true },
        { id: 'b-goals', type: 'user', section: 'My goals', text: '', sources: [], editedByUser: false },
      ],
    });
    buildSessionBrief.mockResolvedValue(customBrief);
    const entries = [
      { id: 'e1', createdAt: '2026-07-10T00:00:00.000Z', text: 'entry one' },
      { id: 'e2', createdAt: '2026-07-11T00:00:00.000Z', text: 'entry two' },
      { id: 'e3', createdAt: '2026-07-12T00:00:00.000Z', text: 'entry three' },
    ];
    render(<SessionPrepScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    await screen.findByText('Session prep — July 2026');

    fireEvent.click(screen.getByText('2 sources'));
    const dialog = await screen.findByRole('dialog', { name: /Sources/i });
    expect(within(dialog).getByText('entry one')).toBeTruthy();
    expect(within(dialog).getByText('entry two')).toBeTruthy();
    expect(within(dialog).queryByText('entry three')).toBeNull();
  });
});

describe('SessionPrepScreen — regenerate (confirm-gated only when edited)', () => {
  async function openGeneratedBrief() {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    await screen.findByText('Session prep — July 2026');
  }

  it('regenerates a NOT-yet-edited block immediately, without a confirm sheet, confirm:false', async () => {
    await openGeneratedBrief();
    fireEvent.click(screen.getByLabelText('Regenerate Changes since'));

    await waitFor(() => expect(regenerateSection).toHaveBeenCalledTimes(1));
    expect(regenerateSection).toHaveBeenCalledWith({ __db: true }, UID, 'brief-1', 'b-changes', expect.objectContaining({ confirm: false }));
    expect(screen.queryByText(/Overwrite your edits/)).toBeNull();
  });

  it('an already-edited block requires an explicit confirm before regenerateSection is called', async () => {
    await openGeneratedBrief();
    fireEvent.click(screen.getByLabelText('Regenerate Patterns'));

    expect(await screen.findByText(/Overwrite your edits/)).toBeTruthy();
    expect(regenerateSection).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: /Overwrite your edits/i });
    fireEvent.click(within(dialog).getByText('Regenerate'));

    await waitFor(() =>
      expect(regenerateSection).toHaveBeenCalledWith({ __db: true }, UID, 'brief-1', 'b-patterns', expect.objectContaining({ confirm: true })),
    );
  });

  it('canceling the confirm sheet never calls regenerateSection', async () => {
    await openGeneratedBrief();
    fireEvent.click(screen.getByLabelText('Regenerate Patterns'));
    const dialog = await screen.findByRole('dialog', { name: /Overwrite your edits/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(regenerateSection).not.toHaveBeenCalled();
    expect(screen.queryByText(/Overwrite your edits/)).toBeNull();
  });
});

describe('SessionPrepScreen — export (confirm-gated, foreground, explicit)', () => {
  async function openGeneratedBrief() {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    await screen.findByText('Session prep — July 2026');
  }

  it('tapping Export opens a confirmation sheet with the full content preview, WITHOUT composing the PDF yet', async () => {
    await openGeneratedBrief();
    fireEvent.click(screen.getByText('Export'));

    const dialog = await screen.findByRole('dialog', { name: /Export/i });
    expect(within(dialog).getByText('Things changed.')).toBeTruthy();
    expect(within(dialog).getByText('Patterns text.')).toBeTruthy();
    expect(composeSessionPrepPdf).not.toHaveBeenCalled();
  });

  it('canceling the export confirm sheet never composes the PDF', async () => {
    await openGeneratedBrief();
    fireEvent.click(screen.getByText('Export'));
    const dialog = await screen.findByRole('dialog', { name: /Export/i });
    fireEvent.click(within(dialog).getByText('Cancel'));

    expect(composeSessionPrepPdf).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /Export/i })).toBeNull();
  });

  it('confirming export calls composeSessionPrepPdf(brief, entriesById) then saves the returned document', async () => {
    const saveSpy = vi.fn();
    composeSessionPrepPdf.mockResolvedValue({ save: saveSpy });
    const entries = [{ id: 'e1', createdAt: '2026-07-10T00:00:00.000Z' }];
    render(<SessionPrepScreen uid={UID} entries={entries} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Generate session prep'));
    await screen.findByText('Session prep — July 2026');

    fireEvent.click(screen.getByText('Export'));
    const dialog = await screen.findByRole('dialog', { name: /Export/i });
    fireEvent.click(within(dialog).getByText('Export PDF'));

    await waitFor(() => expect(composeSessionPrepPdf).toHaveBeenCalledTimes(1));
    const [passedBrief, passedEntriesById] = composeSessionPrepPdf.mock.calls[0];
    expect(passedBrief.id).toBe('brief-1');
    expect(passedEntriesById.e1).toEqual(entries[0]);
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SessionPrepScreen — a11y', () => {
  it('exposes a single labelled aria-modal dialog when no nested overlay is open', async () => {
    render(<SessionPrepScreen uid={UID} entries={[]} onClose={vi.fn()} />);
    const modals = document.querySelectorAll('[aria-modal="true"]');
    expect(modals).toHaveLength(1);
    expect(modals[0]).toHaveAttribute('aria-labelledby', 'session-prep-title');
    await waitFor(() => expect(mockFirebase.getDocs).toHaveBeenCalled());
  });
});
