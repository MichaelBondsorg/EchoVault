/**
 * Session Prep service tests (R2 Task 18).
 *
 * Covers: since-date/scope stored exactly (never inferred), sections
 * generated with sources + fixed headers, missingness auto-added only to
 * Patterns, regenerate-section isolation (only the target block changes,
 * confirm-gating for already-edited blocks), and export safety (never
 * leaks safety markers/labels/excluded content into the composed PDF;
 * removing a block before export removes its citations).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  addDoc: vi.fn(async () => ({ id: 'brief-1' })),
};
vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const runQuestions = vi.fn();
const loadReflection = vi.fn();
const writeBlocks = vi.fn();
function reflectionsPath(uid) {
  return `artifacts/echo-vault-v5-fresh/users/${uid}/reflections`;
}
vi.mock('../runRecipe', () => ({
  runQuestions: (...a) => runQuestions(...a),
  loadReflection: (...a) => loadReflection(...a),
  writeBlocks: (...a) => writeBlocks(...a),
  reflectionsPath: (...a) => reflectionsPath(...a),
}));

const loadJsPDF = vi.fn();
vi.mock('../../../utils/pdf', () => ({ loadJsPDF: (...a) => loadJsPDF(...a) }));

const {
  buildSessionBrief,
  regenerateSection,
  composeSessionPrepPdf,
  DEFAULT_SINCE_DAYS_BACK,
} = await import('../sessionPrep.js');
const { STARTER_RECIPES } = await import('../starterRecipes.js');

const SESSION_PREP_QUESTIONS = STARTER_RECIPES.find((r) => r.name === 'Session preparation').questions;

const db = {};
const UID = 'user-1';
const REFLECTIONS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/reflections';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-21T12:00:00Z');

function daysAgo(n) {
  return new Date(NOW.getTime() - n * DAY_MS);
}

function entry(id, daysBack) {
  return { id, createdAt: daysAgo(daysBack).toISOString(), text: 'text' };
}

function aiBlocksFor(questions, { textPrefix = 'answer for', sources = [] } = {}) {
  return questions.map((q, i) => ({
    id: `ai-${i}`,
    type: 'ai',
    question: q,
    text: `${textPrefix} ${q}`,
    sources,
    editedByUser: false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.addDoc.mockResolvedValue({ id: 'brief-1' });
  runQuestions.mockImplementation(async (_db, _uid, { questions }) => ({
    blocks: aiBlocksFor(questions),
    filteredEntries: [entry('e1', 3), entry('e2', 8)],
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DEFAULT_SINCE_DAYS_BACK', () => {
  it('is 14 (UI default, never used internally to infer a date)', () => {
    expect(DEFAULT_SINCE_DAYS_BACK).toBe(14);
  });
});

describe('buildSessionBrief — since-date/scope validation', () => {
  it('throws when sinceDate is missing', async () => {
    await expect(buildSessionBrief(db, UID, {})).rejects.toThrow(/sinceDate/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('throws when sinceDate is unparsable', async () => {
    await expect(buildSessionBrief(db, UID, { sinceDate: 'not-a-date' })).rejects.toThrow(/sinceDate/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('throws when sinceDate is in the future', async () => {
    const future = new Date(NOW.getTime() + DAY_MS).toISOString();
    await expect(buildSessionBrief(db, UID, { sinceDate: future })).rejects.toThrow(/future/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});

describe('buildSessionBrief — since-date/scope stored exactly (never inferred)', () => {
  it('stores period.start as the EXACT sinceDate given, not a recomputed day-count range', async () => {
    const sinceDate = daysAgo(14).toISOString();
    const reflection = await buildSessionBrief(db, UID, { sinceDate });
    expect(reflection.period.start).toBe(sinceDate);
  });

  it('stores period.end as now', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    expect(reflection.period.end).toBe(NOW.toISOString());
  });

  it('accepts a Date object for sinceDate and stores its ISO form', async () => {
    const sinceDate = daysAgo(20);
    const reflection = await buildSessionBrief(db, UID, { sinceDate });
    expect(reflection.period.start).toBe(sinceDate.toISOString());
  });

  it('stores the given scope', async () => {
    const scope = { spaceId: 'work' };
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString(), scope });
    expect(reflection.scope).toEqual(scope);
  });

  it('defaults scope to null (All spaces) when omitted', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    expect(reflection.scope).toBeNull();
  });

  it('passes the exact sinceDate/now and scope through to runQuestions as start/end/scope', async () => {
    const sinceDate = daysAgo(14).toISOString();
    const scope = { spaceId: 'work' };
    await buildSessionBrief(db, UID, { sinceDate, scope });
    const call = runQuestions.mock.calls[0][2];
    expect(call.start.toISOString()).toBe(sinceDate);
    expect(call.end.toISOString()).toBe(NOW.toISOString());
    expect(call.scope).toEqual(scope);
  });
});

describe('buildSessionBrief — sections generated with sources', () => {
  it('builds one AI block per Session-preparation starter question, in order', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    const aiBlocks = reflection.blocks.filter((b) => b.type === 'ai' && b.sectionKey !== 'topics');
    expect(aiBlocks.map((b) => b.question)).toEqual(SESSION_PREP_QUESTIONS);
  });

  it('labels sections with the fixed headers Changes since / Moments to bring up / Patterns / Open questions', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    const titles = reflection.blocks.filter((b) => b.sectionKey && SESSION_PREP_QUESTIONS.includes(b.question)).map((b) => b.section);
    expect(titles).toEqual(['Changes since', 'Moments to bring up', 'Patterns', 'Open questions']);
  });

  it('carries the real sources runQuestions returned onto each block', async () => {
    runQuestions.mockImplementation(async (_db, _uid, { questions }) => ({
      blocks: aiBlocksFor(questions, { sources: ['e1', 'e2'] }),
      filteredEntries: [entry('e1', 3), entry('e2', 8)],
    }));
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    const changesBlock = reflection.blocks.find((b) => b.sectionKey === 'changes_since');
    expect(changesBlock.sources).toEqual(['e1', 'e2']);
  });

  it('appends topics as a 5th question/block with section "Topics" when topics is provided', async () => {
    const reflection = await buildSessionBrief(db, UID, {
      sinceDate: daysAgo(14).toISOString(),
      topics: 'my promotion',
    });
    const call = runQuestions.mock.calls[0][2];
    expect(call.questions).toEqual([...SESSION_PREP_QUESTIONS, 'my promotion']);
    const topicsBlock = reflection.blocks.find((b) => b.sectionKey === 'topics');
    expect(topicsBlock).toBeTruthy();
    expect(topicsBlock.section).toBe('Topics');
    expect(topicsBlock.question).toBe('my promotion');
  });

  it('does not add a Topics block when topics is omitted', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    expect(reflection.blocks.some((b) => b.sectionKey === 'topics')).toBe(false);
  });

  it('does not add a Topics block when topics is blank/whitespace', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString(), topics: '   ' });
    const call = runQuestions.mock.calls[0][2];
    expect(call.questions).toEqual(SESSION_PREP_QUESTIONS);
    expect(reflection.blocks.some((b) => b.sectionKey === 'topics')).toBe(false);
  });

  it('adds an empty "My goals" user block last: type user, sources [], editedByUser false', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    const last = reflection.blocks[reflection.blocks.length - 1];
    expect(last).toMatchObject({ type: 'user', section: 'My goals', sectionKey: 'goals', text: '', sources: [], editedByUser: false });
  });

  it('auto-adds a missingness line to the Patterns block only', async () => {
    const reflection = await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    const patterns = reflection.blocks.find((b) => b.sectionKey === 'patterns');
    const others = reflection.blocks.filter((b) => b.sectionKey && b.sectionKey !== 'patterns' && b.sectionKey !== 'goals');
    expect(patterns.text).toMatch(/\d+ of \d+ days have entries/);
    others.forEach((b) => {
      expect(b.text).not.toMatch(/days have entries/);
    });
  });

  it('threads the pre-computed embeddings map through to runQuestions unchanged', async () => {
    const embeddings = { [SESSION_PREP_QUESTIONS[0]]: [1, 0, 0] };
    await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString(), embeddings });
    expect(runQuestions.mock.calls[0][2].embeddings).toBe(embeddings);
  });

  it('writes reflections/{id} with kind:session_brief, status draft, and no recipe-only fields', async () => {
    await buildSessionBrief(db, UID, { sinceDate: daysAgo(14).toISOString() });
    expect(mocks.collection).toHaveBeenCalledWith(db, REFLECTIONS_PATH);
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.kind).toBe('session_brief');
    expect(payload.status).toBe('draft');
    expect(payload).not.toHaveProperty('recipeId');
    expect(payload).not.toHaveProperty('definitionVersion');
    expect(Object.keys(payload).sort()).toEqual(
      ['blocks', 'createdAt', 'kind', 'period', 'scope', 'status', 'title', 'updatedAt'].sort(),
    );
  });
});

function existingBrief(overrides = {}) {
  return {
    id: 'brief-1',
    kind: 'session_brief',
    scope: null,
    period: { start: daysAgo(14).toISOString(), end: NOW.toISOString() },
    title: 'Session prep — July 2026',
    status: 'draft',
    createdAt: 'c',
    updatedAt: 'c',
    blocks: [
      { id: 'b-changes', type: 'ai', section: 'Changes since', sectionKey: 'changes_since', question: SESSION_PREP_QUESTIONS[0], text: 'original changes', sources: ['e1'], editedByUser: false },
      { id: 'b-patterns', type: 'ai', section: 'Patterns', sectionKey: 'patterns', question: SESSION_PREP_QUESTIONS[2], text: 'original patterns', sources: ['e2'], editedByUser: false },
      { id: 'b-edited', type: 'ai', section: 'Open questions', sectionKey: 'open_questions', question: SESSION_PREP_QUESTIONS[3], text: 'edited by user already', sources: ['e3'], editedByUser: true },
      { id: 'b-goals', type: 'user', section: 'My goals', sectionKey: 'goals', text: 'my goal', sources: [], editedByUser: false },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  loadReflection.mockImplementation(async () => existingBrief());
  writeBlocks.mockImplementation(async (_db, _uid, _id, blocks) => ({ blocks, updatedAt: 'updated-now' }));
});

describe('regenerateSection — isolation', () => {
  it('re-runs only the target block\'s question against runQuestions', async () => {
    await regenerateSection(db, UID, 'brief-1', 'b-changes');
    expect(runQuestions).toHaveBeenCalledTimes(1);
    expect(runQuestions.mock.calls[0][2].questions).toEqual([SESSION_PREP_QUESTIONS[0]]);
  });

  it('uses the brief\'s stored period (start/end) as the date range, not a fresh computation', async () => {
    const brief = existingBrief();
    loadReflection.mockResolvedValue(brief);
    await regenerateSection(db, UID, 'brief-1', 'b-changes');
    const call = runQuestions.mock.calls[0][2];
    expect(call.start.toISOString()).toBe(brief.period.start);
    expect(call.end.toISOString()).toBe(brief.period.end);
  });

  it('leaves every other block byte-identical in the written payload', async () => {
    await regenerateSection(db, UID, 'brief-1', 'b-changes');
    const writtenBlocks = writeBlocks.mock.calls[0][3];
    const original = existingBrief();
    expect(writtenBlocks.find((b) => b.id === 'b-patterns')).toEqual(original.blocks.find((b) => b.id === 'b-patterns'));
    expect(writtenBlocks.find((b) => b.id === 'b-goals')).toEqual(original.blocks.find((b) => b.id === 'b-goals'));
  });

  it('only the target block\'s id appears changed in the diff', async () => {
    const before = existingBrief().blocks;
    await regenerateSection(db, UID, 'brief-1', 'b-changes');
    const after = writeBlocks.mock.calls[0][3];
    const changedIds = after.filter((b, i) => JSON.stringify(b) !== JSON.stringify(before[i])).map((b) => b.id);
    expect(changedIds).toEqual(['b-changes']);
  });

  it('replaces the block text with the fresh runQuestions answer, keeps the block id/section/sectionKey', async () => {
    runQuestions.mockResolvedValueOnce({
      blocks: [{ id: 'new-ai-id', type: 'ai', question: SESSION_PREP_QUESTIONS[0], text: 'fresh answer', sources: ['e9'], editedByUser: false }],
      filteredEntries: [],
    });
    const updated = await regenerateSection(db, UID, 'brief-1', 'b-changes');
    const changed = updated.blocks.find((b) => b.id === 'b-changes');
    expect(changed.text).toBe('fresh answer');
    expect(changed.sources).toEqual(['e9']);
    expect(changed.section).toBe('Changes since');
    expect(changed.sectionKey).toBe('changes_since');
  });

  it('resets editedByUser to false on the regenerated block even when it was true (with confirm)', async () => {
    const updated = await regenerateSection(db, UID, 'brief-1', 'b-edited', { confirm: true });
    const changed = updated.blocks.find((b) => b.id === 'b-edited');
    expect(changed.editedByUser).toBe(false);
  });

  it('re-applies the missingness line when regenerating the Patterns block', async () => {
    runQuestions.mockResolvedValueOnce({
      blocks: [{ id: 'x', type: 'ai', question: SESSION_PREP_QUESTIONS[2], text: 'fresh patterns', sources: [], editedByUser: false }],
      filteredEntries: [entry('e1', 2), entry('e2', 5)],
    });
    const updated = await regenerateSection(db, UID, 'brief-1', 'b-patterns');
    const patterns = updated.blocks.find((b) => b.id === 'b-patterns');
    expect(patterns.text).toMatch(/days have entries/);
  });

  it('does not add a missingness line when regenerating a non-Patterns block', async () => {
    const updated = await regenerateSection(db, UID, 'brief-1', 'b-changes');
    const changed = updated.blocks.find((b) => b.id === 'b-changes');
    expect(changed.text).not.toMatch(/days have entries/);
  });

  it('throws and does NOT write when the target block is editedByUser and confirm is not passed', async () => {
    await expect(regenerateSection(db, UID, 'brief-1', 'b-edited')).rejects.toThrow(/confirm/);
    expect(writeBlocks).not.toHaveBeenCalled();
    expect(runQuestions).not.toHaveBeenCalled();
  });

  it('regenerates successfully when editedByUser and confirm:true is passed', async () => {
    await expect(regenerateSection(db, UID, 'brief-1', 'b-edited', { confirm: true })).resolves.toBeTruthy();
    expect(writeBlocks).toHaveBeenCalledTimes(1);
  });

  it('throws for an unknown blockId without writing', async () => {
    await expect(regenerateSection(db, UID, 'brief-1', 'ghost')).rejects.toThrow();
    expect(writeBlocks).not.toHaveBeenCalled();
  });

  it('throws when targeting the "My goals" user block (not AI) without writing', async () => {
    await expect(regenerateSection(db, UID, 'brief-1', 'b-goals')).rejects.toThrow();
    expect(writeBlocks).not.toHaveBeenCalled();
    expect(runQuestions).not.toHaveBeenCalled();
  });
});

// --- composeSessionPrepPdf --------------------------------------------

class FakeJsPDF {
  constructor() {
    this.textCalls = [];
    this.pages = 1;
  }
  setFontSize() {}
  setFont() {}
  splitTextToSize(text) {
    return [text];
  }
  text(str) {
    this.textCalls.push(String(str));
  }
  addPage() {
    this.pages += 1;
  }
  save() {}
}

function pdfBrief(overrides = {}) {
  return {
    title: 'Session prep — July 2026',
    period: { start: daysAgo(14).toISOString(), end: NOW.toISOString() },
    blocks: [
      { id: 'b1', type: 'ai', section: 'Changes since', question: SESSION_PREP_QUESTIONS[0], text: 'Things changed.', sources: ['safe-1'], editedByUser: false },
      { id: 'b2', type: 'user', section: 'My goals', text: 'My own goal text.', sources: [], editedByUser: false },
    ],
    ...overrides,
  };
}

const SAFE_ENTRY = { id: 'safe-1', createdAt: daysAgo(3).toISOString(), text: 'safe entry text should never appear' };
const FLAGGED_ENTRY = { id: 'flagged-1', createdAt: daysAgo(4).toISOString(), text: 'crisis content should never appear', safety_flagged: true };
const WARNING_ENTRY = { id: 'warn-1', createdAt: daysAgo(5).toISOString(), text: 'warning content should never appear', has_warning_indicators: true };

beforeEach(() => {
  loadJsPDF.mockResolvedValue(FakeJsPDF);
});

describe('composeSessionPrepPdf — export safety', () => {
  it('returns the composed jsPDF document instance without saving/downloading', async () => {
    const saveSpy = vi.spyOn(FakeJsPDF.prototype, 'save');
    const doc = await composeSessionPrepPdf(pdfBrief(), { 'safe-1': SAFE_ENTRY });
    expect(doc).toBeInstanceOf(FakeJsPDF);
    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });

  it('never includes the literal field names safety_flagged / has_warning_indicators anywhere in the PDF text', async () => {
    const brief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Some claim.', sources: ['flagged-1', 'warn-1'], editedByUser: false },
      ],
    });
    const doc = await composeSessionPrepPdf(brief, { 'flagged-1': FLAGGED_ENTRY, 'warn-1': WARNING_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).not.toMatch(/safety_flagged/i);
    expect(all).not.toMatch(/has_warning_indicators/i);
    expect(all).not.toMatch(/flagged/i);
    expect(all).not.toMatch(/warning/i);
  });

  it('drops the citation date for a safety_flagged source entry, without crashing', async () => {
    const brief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Some claim.', sources: ['flagged-1'], editedByUser: false },
      ],
    });
    await expect(composeSessionPrepPdf(brief, { 'flagged-1': FLAGGED_ENTRY })).resolves.toBeTruthy();
    const doc = await composeSessionPrepPdf(brief, { 'flagged-1': FLAGGED_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).not.toContain('Sources:');
  });

  it('drops the citation date for a has_warning_indicators source entry, without crashing', async () => {
    const brief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Some claim.', sources: ['warn-1'], editedByUser: false },
      ],
    });
    const doc = await composeSessionPrepPdf(brief, { 'warn-1': WARNING_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).not.toContain('Sources:');
  });

  it('never leaks the flagged/warning entry\'s own text content into the PDF', async () => {
    const brief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Some claim.', sources: ['flagged-1', 'warn-1'], editedByUser: false },
      ],
    });
    const doc = await composeSessionPrepPdf(brief, { 'flagged-1': FLAGGED_ENTRY, 'warn-1': WARNING_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).not.toContain('crisis content should never appear');
    expect(all).not.toContain('warning content should never appear');
  });

  it('drops citations for source ids missing from entriesById (already-excluded entries), without crashing', async () => {
    const brief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Some claim.', sources: ['excluded-ghost'], editedByUser: false },
      ],
    });
    await expect(composeSessionPrepPdf(brief, {})).resolves.toBeTruthy();
  });

  it('cites a safe source\'s date, but never its excerpt/text', async () => {
    const doc = await composeSessionPrepPdf(pdfBrief(), { 'safe-1': SAFE_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).toContain('Sources:');
    expect(all).not.toContain('safe entry text should never appear');
  });

  it('preserves "AI-generated" / "Your note" labels for each block', async () => {
    const doc = await composeSessionPrepPdf(pdfBrief(), { 'safe-1': SAFE_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).toContain('AI-generated');
    expect(all).toContain('Your note');
  });

  it('includes a metadata footer line', async () => {
    const doc = await composeSessionPrepPdf(pdfBrief(), { 'safe-1': SAFE_ENTRY });
    const all = doc.textCalls.join('\n');
    expect(all).toMatch(/Exported from Engram/);
  });

  it('removing a block before export removes its citations (and body text)', async () => {
    const fullBrief = pdfBrief({
      blocks: [
        { id: 'b1', type: 'ai', section: 'Changes since', text: 'Kept claim.', sources: ['safe-1'], editedByUser: false },
        { id: 'b2', type: 'ai', section: 'Moments to bring up', text: 'Removed claim body.', sources: ['safe-2'], editedByUser: false },
      ],
    });
    const safeEntry2 = { id: 'safe-2', createdAt: daysAgo(6).toISOString(), text: 'irrelevant' };

    const beforeRemoval = await composeSessionPrepPdf(fullBrief, { 'safe-1': SAFE_ENTRY, 'safe-2': safeEntry2 });
    const beforeText = beforeRemoval.textCalls.join('\n');
    expect(beforeText).toContain('Removed claim body.');

    const afterRemovalBrief = { ...fullBrief, blocks: fullBrief.blocks.filter((b) => b.id !== 'b2') };
    const afterRemoval = await composeSessionPrepPdf(afterRemovalBrief, { 'safe-1': SAFE_ENTRY, 'safe-2': safeEntry2 });
    const afterText = afterRemoval.textCalls.join('\n');
    expect(afterText).not.toContain('Removed claim body.');
    expect(afterText).not.toContain(formatDateForTest(safeEntry2.createdAt));
  });
});

function formatDateForTest(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
