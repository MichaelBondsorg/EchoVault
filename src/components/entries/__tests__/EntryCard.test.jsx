import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { deleteField } from 'firebase/firestore';

const getFlag = vi.fn();
vi.mock('../../../config/flags', () => ({ getFlag: (...a) => getFlag(...a) }));
vi.mock('../../../config/firebase', () => ({ db: { __db: true } }));
vi.mock('../../../stores', () => ({ useUser: () => ({ uid: 'user-1' }) }));

const subscribeSpaces = vi.fn();
vi.mock('../../../services/spaces/spacesService', () => ({
  subscribeSpaces: (...a) => subscribeSpaces(...a),
}));

const onSourcesChanged = vi.fn(async () => {});
vi.mock('../../../services/insights/recompute', () => ({
  onSourcesChanged: (...a) => onSourcesChanged(...a),
}));

// IntentSuggestionTray is rendered by EntryCard — stub its service so the
// real module (which imports config/firebase) is never loaded.
vi.mock('../../../services/intents/intentClient', () => ({
  subscribeSuggestedIntentsForEntry: vi.fn(() => () => {}),
  keepIntent: vi.fn(),
  dismissIntent: vi.fn(),
  setIntentUserText: vi.fn(),
}));

const { default: EntryCard } = await import('../EntryCard');

function baseEntry(overrides = {}) {
  return {
    id: 'entry-1',
    text: 'Some entry text',
    title: 'Entry title',
    category: 'personal',
    createdAt: new Date('2026-07-20T10:00:00Z'),
    effectiveDate: new Date('2026-07-20T10:00:00Z'),
    tags: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // contextSpaces on, everything else (intentExtraction/openLoops) off —
  // keeps IntentSuggestionTray a no-op so these tests stay focused.
  getFlag.mockImplementation((flag) => flag === 'contextSpaces');
  subscribeSpaces.mockReturnValue(() => {});
});

describe('EntryCard — Space chip gating (flag: contextSpaces)', () => {
  it('renders no Space chip and does not subscribe when the flag is off', () => {
    getFlag.mockImplementation(() => false);
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.queryByLabelText('Assign a space')).toBeNull();
    expect(subscribeSpaces).not.toHaveBeenCalled();
  });

  it('subscribes to active spaces (db, uid, cb) when the flag is on', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(subscribeSpaces).toHaveBeenCalledWith({ __db: true }, 'user-1', expect.any(Function));
  });
});

describe('EntryCard — Space chip display + re-scoping', () => {
  it('shows nothing but the icon when the entry is unscoped', () => {
    render(<EntryCard entry={baseEntry({ spaceId: undefined })} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText('Assign a space')).toBeTruthy();
  });

  it("resolves the entry's Space name from the subscribed spaces list", () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }, { id: 'space-2', name: 'Personal' }]);
      return () => {};
    });
    render(<EntryCard entry={baseEntry({ spaceId: 'space-2' })} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    expect(screen.getByLabelText('Space: Personal')).toBeTruthy();
  });

  it('tapping the chip opens a popover listing active spaces + "No space"', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();
    expect(screen.getByText('Work')).toBeTruthy();
  });

  it('selecting a space calls onUpdate with EXACTLY {spaceId, updatedAt}', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [entryId, payload] = onUpdate.mock.calls[0];
    expect(entryId).toBe('entry-1');
    expect(payload.spaceId).toBe('space-1');
    expect(typeof payload.updatedAt).toBe('string');
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
  });

  it('selecting a space also fans out staleness via onSourcesChanged(db, uid) (R2 Task 10)', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    expect(onSourcesChanged).toHaveBeenCalledWith({ __db: true }, 'user-1');
  });

  it('selecting "No space" clears spaceId to null via the same exact payload shape', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry({ spaceId: 'space-1' })} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Space: Work'));
    fireEvent.click(screen.getByText('No space'));

    const [, payload] = onUpdate.mock.calls[0];
    expect(payload.spaceId).toBeNull();
    expect(Object.keys(payload).sort()).toEqual(['spaceId', 'updatedAt']);
  });

  it('never includes createdAt/effectiveDate/transcription in the re-scope payload', () => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
    const onUpdate = vi.fn();
    render(
      <EntryCard
        entry={baseEntry({ transcription: { rawTranscript: 'raw' } })}
        onDelete={vi.fn()}
        onUpdate={onUpdate}
      />
    );
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.click(screen.getByText('Work'));

    const [, payload] = onUpdate.mock.calls[0];
    expect(payload).not.toHaveProperty('createdAt');
    expect(payload).not.toHaveProperty('effectiveDate');
    expect(payload).not.toHaveProperty('transcription');
  });
});

describe('EntryCard — Space chip popover dismissal (review fix)', () => {
  beforeEach(() => {
    subscribeSpaces.mockImplementation((_db, _uid, cb) => {
      cb([{ id: 'space-1', name: 'Work' }]);
      return () => {};
    });
  });

  it('an outside pointerdown closes the open popover', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('Escape closes the open popover', () => {
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    expect(screen.getByText('No space')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('No space')).toBeNull();
  });

  it('a click inside the popover does not get treated as outside (selection still applies)', () => {
    const onUpdate = vi.fn();
    render(<EntryCard entry={baseEntry()} onDelete={vi.fn()} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByLabelText('Assign a space'));
    fireEvent.pointerDown(screen.getByText('Work'));
    fireEvent.click(screen.getByText('Work'));

    expect(onUpdate).toHaveBeenCalledWith('entry-1', expect.objectContaining({ spaceId: 'space-1' }));
  });
});

describe('EntryCard — Voice Chapters (flag: voiceChapters)', () => {
  // Chapter text built with indexOf against the actual fixture text (same
  // technique as buildCoreEntry's own offset walk) so charStart/charEnd are
  // always correct rather than hand-counted.
  const CHAPTER_TEXT = 'Morning notes here.\n\nAfternoon notes here.\n\nEvening notes here.';

  function makeChapters(text) {
    const c0 = 'Morning notes here.';
    const c1 = 'Afternoon notes here.';
    const c2 = 'Evening notes here.';
    const s0 = text.indexOf(c0);
    const e0 = s0 + c0.length;
    const s1 = text.indexOf(c1, e0);
    const e1 = s1 + c1.length;
    const s2 = text.indexOf(c2, e1);
    const e2 = s2 + c2.length;
    return [
      { id: 'ch_0', index: 0, startMs: 0, title: 'Morning', charStart: s0, charEnd: e0 },
      { id: 'ch_1', index: 1, startMs: 65000, title: 'Afternoon', charStart: s1, charEnd: e1 },
      { id: 'ch_2', index: 2, startMs: 130000, title: 'Evening', charStart: s2, charEnd: e2 },
    ];
  }

  function chapteredEntry(overrides = {}) {
    return baseEntry({ text: CHAPTER_TEXT, transcription: { chapters: makeChapters(CHAPTER_TEXT) }, ...overrides });
  }

  describe('legacy render (flag off / no chapters) is byte-identical', () => {
    it('renders the original flat paragraph markup when the flag is off, even with chapters present', () => {
      getFlag.mockImplementation(() => false);
      const { container } = render(<EntryCard entry={chapteredEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);

      const bodyDiv = container.querySelector('.max-w-prose');
      expect(bodyDiv.className).toBe(
        'text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3'
      );
      expect(bodyDiv.querySelectorAll('p')).toHaveLength(3);
      expect(screen.queryByLabelText('Chapter actions')).toBeNull();
      expect(screen.queryByText('Chapters no longer match edited text')).toBeNull();
    });

    it('renders the original flat paragraph markup when chapters are absent, even with the flag on', () => {
      getFlag.mockImplementation((flag) => flag === 'voiceChapters');
      const { container } = render(
        <EntryCard entry={baseEntry({ text: 'Some entry text' })} onDelete={vi.fn()} onUpdate={vi.fn()} />
      );

      const bodyDiv = container.querySelector('.max-w-prose');
      expect(bodyDiv.className).toBe(
        'text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3'
      );
      expect(screen.queryByLabelText('Chapter actions')).toBeNull();
    });

    it('renders the original flat paragraph markup when the chapters array is empty', () => {
      getFlag.mockImplementation((flag) => flag === 'voiceChapters');
      const { container } = render(
        <EntryCard
          entry={baseEntry({ text: 'Some entry text', transcription: { chapters: [] } })}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
      );
      expect(container.querySelector('.max-w-prose').className).toBe(
        'text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3'
      );
    });
  });

  describe('chaptered render (flag on, valid chapters)', () => {
    beforeEach(() => {
      getFlag.mockImplementation((flag) => flag === 'voiceChapters');
    });

    it('renders one ChapterHeader (mm:ss + title) per chapter, above its exact text slice', () => {
      render(<EntryCard entry={chapteredEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);

      expect(screen.getByText('0:00')).toBeTruthy();
      expect(screen.getByText('Morning')).toBeTruthy();
      expect(screen.getByText('1:05')).toBeTruthy();
      expect(screen.getByText('Afternoon')).toBeTruthy();
      expect(screen.getByText('2:10')).toBeTruthy();
      expect(screen.getByText('Evening')).toBeTruthy();

      expect(screen.getByText('Morning notes here.')).toBeTruthy();
      expect(screen.getByText('Afternoon notes here.')).toBeTruthy();
      expect(screen.getByText('Evening notes here.')).toBeTruthy();

      expect(screen.getAllByLabelText('Chapter actions')).toHaveLength(3);
    });

    it('splits paragraphs WITHIN a chapter on blank lines, same as the legacy body', () => {
      const text = 'First para.\n\nSecond para.';
      const chapters = [{ id: 'ch_0', index: 0, startMs: 0, title: 'One', charStart: 0, charEnd: text.length }];
      const { container } = render(
        <EntryCard entry={baseEntry({ text, transcription: { chapters } })} onDelete={vi.fn()} onUpdate={vi.fn()} />
      );

      const bodyDiv = container.querySelector('.max-w-prose');
      // First <p> is the ChapterHeader's SectionLabel (mm:ss + title); the
      // rest are the chapter's own paragraph-split text.
      const paragraphs = Array.from(bodyDiv.querySelectorAll('p')).slice(1);
      expect(paragraphs).toHaveLength(2);
      expect(paragraphs[0].textContent).toBe('First para.');
      expect(paragraphs[1].textContent).toBe('Second para.');
    });

    it('does not offer "Merge with previous" on the first chapter, but does offer it on later ones', () => {
      render(<EntryCard entry={chapteredEntry()} onDelete={vi.fn()} onUpdate={vi.fn()} />);
      const menus = screen.getAllByLabelText('Chapter actions');

      fireEvent.click(menus[0]);
      expect(screen.queryByText('Merge with previous')).toBeNull();
      expect(screen.getByText('Remove marker')).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });

      fireEvent.click(menus[1]);
      expect(screen.getByText('Merge with previous')).toBeTruthy();
    });
  });

  describe('chapter action payload exactness', () => {
    beforeEach(() => {
      getFlag.mockImplementation((flag) => flag === 'voiceChapters');
    });

    it('Rename calls onUpdate with EXACTLY {"transcription.chapters": next}, only the title changed', () => {
      const entry = chapteredEntry();
      const onUpdate = vi.fn();
      render(<EntryCard entry={entry} onDelete={vi.fn()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getAllByLabelText('Chapter actions')[1]);
      fireEvent.click(screen.getByText('Rename'));
      const input = screen.getByLabelText('Chapter title');
      fireEvent.change(input, { target: { value: 'Lunch break' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [entryId, payload] = onUpdate.mock.calls[0];
      expect(entryId).toBe('entry-1');
      expect(Object.keys(payload)).toEqual(['transcription.chapters']);
      expect(payload).not.toHaveProperty('text');
      expect(payload).not.toHaveProperty('rawTranscript');
      expect(payload).not.toHaveProperty('createdAt');

      const next = payload['transcription.chapters'];
      const original = entry.transcription.chapters;
      expect(next).toEqual([original[0], { ...original[1], title: 'Lunch break' }, original[2]]);
    });

    it('Merge with previous absorbs the chapter into its predecessor and reindexes the rest', () => {
      const entry = chapteredEntry();
      const original = entry.transcription.chapters;
      const onUpdate = vi.fn();
      render(<EntryCard entry={entry} onDelete={vi.fn()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getAllByLabelText('Chapter actions')[1]);
      fireEvent.click(screen.getByText('Merge with previous'));

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [, payload] = onUpdate.mock.calls[0];
      expect(Object.keys(payload)).toEqual(['transcription.chapters']);
      const next = payload['transcription.chapters'];
      expect(next).toEqual([
        { ...original[0], charEnd: original[1].charEnd },
        { ...original[2], id: 'ch_1', index: 1 },
      ]);
    });

    it('Remove marker on an interior/last chapter behaves exactly like merge-with-previous', () => {
      const entry = chapteredEntry();
      const original = entry.transcription.chapters;
      const onUpdate = vi.fn();
      render(<EntryCard entry={entry} onDelete={vi.fn()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getAllByLabelText('Chapter actions')[2]);
      fireEvent.click(screen.getByText('Remove marker'));

      const next = onUpdate.mock.calls[0][1]['transcription.chapters'];
      expect(next).toEqual([
        original[0],
        { ...original[1], charEnd: original[2].charEnd },
      ]);
    });

    it('Remove marker on the first chapter (of several) drops its header and folds forward, keeping the next title', () => {
      const entry = chapteredEntry();
      const original = entry.transcription.chapters;
      const onUpdate = vi.fn();
      render(<EntryCard entry={entry} onDelete={vi.fn()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getAllByLabelText('Chapter actions')[0]);
      fireEvent.click(screen.getByText('Remove marker'));

      const next = onUpdate.mock.calls[0][1]['transcription.chapters'];
      expect(next).toEqual([
        { ...original[1], id: 'ch_0', index: 0, charStart: original[0].charStart },
        { ...original[2], id: 'ch_1', index: 1 },
      ]);
    });

    it('Remove marker on the only remaining chapter removes transcription.chapters entirely (deleteField, no empty-array stuffing)', () => {
      const text = 'Only chapter text.';
      const entry = baseEntry({
        text,
        transcription: {
          chapters: [{ id: 'ch_0', index: 0, startMs: 0, title: 'Only', charStart: 0, charEnd: text.length }],
        },
      });
      const onUpdate = vi.fn();
      render(<EntryCard entry={entry} onDelete={vi.fn()} onUpdate={onUpdate} />);

      fireEvent.click(screen.getByLabelText('Chapter actions'));
      fireEvent.click(screen.getByText('Remove marker'));

      expect(onUpdate).toHaveBeenCalledTimes(1);
      const [entryId, payload] = onUpdate.mock.calls[0];
      expect(entryId).toBe('entry-1');
      expect(Object.keys(payload)).toEqual(['transcription.chapters']);
      expect(payload['transcription.chapters']).toEqual(deleteField());
    });
  });

  describe('degraded fallback after the text was edited', () => {
    beforeEach(() => {
      getFlag.mockImplementation((flag) => flag === 'voiceChapters');
    });

    it('falls back to the legacy render + a quiet mismatch line when a chapter charEnd exceeds the (shortened) text', () => {
      const chapters = makeChapters(CHAPTER_TEXT);
      const editedText = 'Morning notes here.'; // entry text edited/shortened after chaptering
      const { container } = render(
        <EntryCard
          entry={baseEntry({ text: editedText, transcription: { chapters } })}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Chapters no longer match edited text')).toBeTruthy();
      expect(screen.queryByLabelText('Chapter actions')).toBeNull();
      const bodyDiv = container.querySelector('.max-w-prose');
      expect(bodyDiv.className).toBe(
        'text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3'
      );
      expect(bodyDiv.textContent).toContain('Morning notes here.');
    });

    it('also falls back when chapter offsets overlap/regress, even though every charEnd is in-bounds', () => {
      const chapters = makeChapters(CHAPTER_TEXT);
      const corrupted = [chapters[0], { ...chapters[1], charStart: chapters[0].charStart }, chapters[2]];
      render(
        <EntryCard
          entry={baseEntry({ text: CHAPTER_TEXT, transcription: { chapters: corrupted } })}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Chapters no longer match edited text')).toBeTruthy();
      expect(screen.queryByLabelText('Chapter actions')).toBeNull();
    });

    it('falls back when a chapter charStart is NaN (would silently slice wrong content via typeof check)', () => {
      const chapters = makeChapters(CHAPTER_TEXT);
      const corrupted = [{ ...chapters[0], charStart: NaN }, chapters[1], chapters[2]];
      const { container } = render(
        <EntryCard
          entry={baseEntry({ text: CHAPTER_TEXT, transcription: { chapters: corrupted } })}
          onDelete={vi.fn()}
          onUpdate={vi.fn()}
        />
      );

      expect(screen.getByText('Chapters no longer match edited text')).toBeTruthy();
      expect(screen.queryByLabelText('Chapter actions')).toBeNull();
      const bodyDiv = container.querySelector('.max-w-prose');
      expect(bodyDiv.className).toBe(
        'text-secondary-foreground text-sm whitespace-pre-wrap leading-7 font-body max-w-prose [&>*]:mb-3'
      );
    });

    it('does not crash when entry.text is shorter than the chapters expect', () => {
      const chapters = makeChapters(CHAPTER_TEXT);
      expect(() =>
        render(
          <EntryCard
            entry={baseEntry({ text: 'short', transcription: { chapters } })}
            onDelete={vi.fn()}
            onUpdate={vi.fn()}
          />
        )
      ).not.toThrow();
    });
  });
});
