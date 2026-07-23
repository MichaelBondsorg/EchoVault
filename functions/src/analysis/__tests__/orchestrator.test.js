/**
 * Server-owned single-pass analysis orchestrator (plan task C3).
 *
 * Covers the contract in the task brief:
 *  - classify runs exactly once per run
 *  - stale entryInputVersion at publish -> no write + re-enqueue exactly once
 *  - consent revoked between stages -> abort before the next provider call
 *  - provider failure -> analysisStatus 'failed', NO fabricated mood
 *  - duplicate trigger delivery -> processing marker no-ops the second run
 *  - analysisMeta stamped with inputVersion + modelId
 *
 * Firestore + provider helpers are mocked; no network / emulator.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    delete: () => '__delete__',
  },
}));

// Provider helpers (the exact ones the callable uses) are mocked.
vi.mock('../analysisHelpers.js', () => ({
  classifyEntry: vi.fn(),
  analyzeEntry: vi.fn(),
  extractEnhancedContext: vi.fn(),
  generateInsight: vi.fn(),
}));

// Consent gate mocked (fail-open true unless a test says otherwise).
vi.mock('../../consent/consentGate.js', () => ({
  isAiAllowed: vi.fn(async () => true),
}));

// Intent extraction mocked — the orchestrator seam is what's under test here
// (the extraction internals have their own suite). Default: no active tasks.
vi.mock('../../intents/extractIntents.js', () => ({
  runIntentExtraction: vi.fn(async () => ({ ran: true, extractedTasks: [] })),
}));

// R4 Phase 2 Task 7 (multi-channel contextual retrieval): only
// generateEmbeddingV2 is mocked (it would otherwise make a real network
// call) — cosineSimilarity/EMBEDDING_V2_QUERY_TASK_TYPE stay the real, pure
// implementations so the semantic-channel scoring logic is genuinely
// exercised.
vi.mock('../../ai/embeddingV2.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateEmbeddingV2: vi.fn() };
});

const { runEntryAnalysis } = await import('../orchestrator.js');
const helpers = await import('../analysisHelpers.js');
const { runIntentExtraction } = await import('../../intents/extractIntents.js');
const { isAiAllowed } = await import('../../consent/consentGate.js');
const { claimProcessingMarker } = await import('../../triggers/idempotency.js');
const { _clearFlagCacheForTest } = await import('../../shared/flags.js');
const { generateEmbeddingV2 } = await import('../../ai/embeddingV2.js');

const MODEL_ID = 'gemini-3-flash-preview';

function noopLogStage() {}

/**
 * Fake entry ref. `parent.parent.id` yields the owner uid; `update()` records
 * direct (non-transactional) writes such as the consent-disabled abort.
 */
function makeEntryRef(uid) {
  const ref = {
    updates: [],
    async update(data) {
      this.updates.push(data);
    },
    parent: { parent: { id: uid } },
  };
  return ref;
}

/**
 * Fake db whose transaction re-reads `stored` (mutable) so a re-enqueue write is
 * visible to the next transaction. Records every tx.update payload.
 */
function makeDb(stored, flagFields = {}) {
  const txUpdates = [];
  const db = {
    txUpdates,
    // config/flags read for model resolution (getModel -> getServerFlag).
    doc(path) {
      if (path === 'config/flags') {
        return { async get() { return { exists: true, data: () => flagFields }; } };
      }
      return { async get() { return { exists: false, data: () => ({}) }; } };
    },
    async runTransaction(fn) {
      const tx = {
        async get() {
          return {
            exists: stored !== null && stored !== undefined,
            data: () => stored,
          };
        },
        update(_ref, data) {
          txUpdates.push(data);
          if (stored) Object.assign(stored, data);
        },
      };
      return fn(tx);
    },
  };
  return db;
}

/**
 * Chainable fake `entries` collection reference for the buildRecentContext
 * scoped-query seam (Context Spaces, R1 plan task 10). Records every
 * where/orderBy/limit call into `callLog` so tests can assert the where(...)
 * clause is present ONLY when flag+spaceId both hold, and absent otherwise.
 * `.get()` applies the recorded where() (if any) against `docs`.
 */
function makeEntriesCollection(uid, docs, callLog) {
  const query = {
    parent: { id: uid },
    where(field, op, value) {
      callLog.push({ type: 'where', field, op, value });
      return query;
    },
    orderBy(field, dir) {
      callLog.push({ type: 'orderBy', field, dir });
      return query;
    },
    limit(n) {
      callLog.push({ type: 'limit', n });
      return query;
    },
    async get() {
      const whereCall = callLog.find((c) => c.type === 'where');
      const filtered = whereCall ? docs.filter((d) => d.data[whereCall.field] === whereCall.value) : docs;
      return { forEach(cb) { filtered.forEach((d) => cb({ id: d.id, data: () => d.data })); } };
    },
  };
  return query;
}

function makeEntryRefWithCollection(uid, docs, callLog) {
  return {
    updates: [],
    async update(data) { this.updates.push(data); },
    parent: makeEntriesCollection(uid, docs, callLog),
  };
}

const goodClassification = { entry_type: 'reflection', confidence: 0.9, extracted_tasks: [] };
const goodAnalysis = { title: 'A day', tags: ['calm'], mood_score: 0.7, framework: 'act', entry_type: 'reflection' };

beforeEach(() => {
  vi.clearAllMocks();
  _clearFlagCacheForTest();
  isAiAllowed.mockImplementation(async () => true);
  helpers.classifyEntry.mockResolvedValue(goodClassification);
  helpers.analyzeEntry.mockResolvedValue(goodAnalysis);
  helpers.extractEnhancedContext.mockResolvedValue({
    structured_tags: ['@place:office'],
    topic_tags: ['work'],
    continues_situation: null,
    goal_update: null,
    sentiment_by_entity: {},
  });
  helpers.generateInsight.mockResolvedValue({ found: false });
});

describe('runEntryAnalysis - classify once', () => {
  it('calls classifyEntry exactly once per run', async () => {
    const stored = { entryInputVersion: 1, text: 'hello' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hello' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1);
    expect(helpers.analyzeEntry).toHaveBeenCalledTimes(1);
  });
});

describe('runEntryAnalysis - analysisMeta provenance', () => {
  it('stamps analysisMeta with inputVersion + modelId on a successful publish', async () => {
    const stored = { entryInputVersion: 3, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 3, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    const published = db.txUpdates[0];
    expect(published.analysisStatus).toBe('complete');
    expect(published.analysisMeta.inputVersion).toBe(3);
    expect(published.analysisMeta.modelId).toBe(MODEL_ID);
    expect(published.analysisMeta.promptVersion).toBe(1);
    expect(published.analysisMeta.orchestratorVersion).toBe(1);
    expect(published.analysisMeta.completedAt).toBeTruthy();
    expect(published.analysis.mood_score).toBe(0.7);
  });

  it('a config/flags model.analyze override drives BOTH the analyze call and analysisMeta.modelId', async () => {
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored, { 'model.analyze': 'gemini-2.5-flash', 'model.classify': 'classify-x' });
    const entryRef = makeEntryRef('userA');
    await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    // the analyze provider call received the overridden model...
    expect(helpers.analyzeEntry).toHaveBeenCalledWith('g', 'hi', 'reflection', null, {
      modelId: 'gemini-2.5-flash',
    });
    // ...classify used its own overridden model...
    expect(helpers.classifyEntry).toHaveBeenCalledWith('g', 'hi', { modelId: 'classify-x' });
    // ...and provenance records the model actually used for analyze (no lie).
    expect(db.txUpdates[0].analysisMeta.modelId).toBe('gemini-2.5-flash');
  });

  it('with no override, defaults are unchanged', async () => {
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(helpers.analyzeEntry).toHaveBeenCalledWith('g', 'hi', 'reflection', null, { modelId: MODEL_ID });
    expect(db.txUpdates[0].analysisMeta.modelId).toBe(MODEL_ID);
  });

  it('treats a legacy entry (no entryInputVersion) as version 0 and publishes', async () => {
    const stored = { text: 'legacy' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', text: 'legacy' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    expect(db.txUpdates[0].analysisMeta.inputVersion).toBe(0);
  });
});

describe('runEntryAnalysis - goal_update derived-data stamp (plan task C4)', () => {
  it('stamps derivedFromInputVersion onto goal_update when extractEnhancedContext finds one', async () => {
    helpers.extractEnhancedContext.mockResolvedValue({
      structured_tags: [],
      topic_tags: [],
      continues_situation: null,
      goal_update: { tag: '@goal:fitness', status: 'progress' },
      sentiment_by_entity: {},
    });
    const stored = { entryInputVersion: 5, text: 'ran again today' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 5, text: 'ran again today' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    const published = db.txUpdates[0];
    expect(published.goal_update).toEqual({
      tag: '@goal:fitness',
      status: 'progress',
      derivedFromInputVersion: 5,
    });
  });
});

describe('runEntryAnalysis - stale version guard', () => {
  it('discards + re-enqueues once when the version changed under it, and does NOT re-enqueue a second time', async () => {
    // Doc has moved to version 2 while this run started at version 1.
    const stored = { entryInputVersion: 2, text: 'edited', analysisStatus: 'processing' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');

    const first = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'original' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(first.outcome).toBe('discarded');
    expect(first.reEnqueued).toBe(true);
    expect(db.txUpdates).toHaveLength(1);
    expect(db.txUpdates[0]).toEqual({ analysisStatus: 'pending' });

    // Second stale delivery: entry is now 'pending' -> must NOT re-enqueue again.
    const second = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'original' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(second.outcome).toBe('discarded');
    expect(second.reEnqueued).toBe(false);
    expect(db.txUpdates).toHaveLength(1); // no additional write
  });
});

describe('runEntryAnalysis - consent revoked mid-flight', () => {
  it('aborts before the next provider stage and marks the entry disabled', async () => {
    // allowed before classify, revoked before the analyze/insight/context stage.
    isAiAllowed.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');

    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('disabled');
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1);
    expect(helpers.analyzeEntry).not.toHaveBeenCalled();
    expect(helpers.generateInsight).not.toHaveBeenCalled();
    expect(helpers.extractEnhancedContext).not.toHaveBeenCalled();
    expect(entryRef.updates).toContainEqual({ analysisStatus: 'disabled' });
    expect(db.txUpdates).toHaveLength(0); // nothing published
  });

  it('marks disabled without any provider call when consent is already revoked', async () => {
    isAiAllowed.mockResolvedValue(false);
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(res.outcome).toBe('disabled');
    expect(helpers.classifyEntry).not.toHaveBeenCalled();
    expect(entryRef.updates).toContainEqual({ analysisStatus: 'disabled' });
  });
});

describe('runEntryAnalysis - failure path', () => {
  it('marks failed and writes NO mood_score when analysis fails', async () => {
    helpers.analyzeEntry.mockResolvedValue({
      title: 'x',
      tags: [],
      mood_score: null,
      analysisStatus: 'failed',
      framework: 'general',
      entry_type: 'reflection',
    });
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');

    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('failed');
    const published = db.txUpdates[0];
    expect(published.analysisStatus).toBe('failed');
    expect(published.analysisError).toBeTruthy();
    expect(published).not.toHaveProperty('analysis'); // no fabricated mood
    // provenance still stamped
    expect(published.analysisMeta.modelId).toBe(MODEL_ID);
  });

  it('marks failed when the analyze provider throws', async () => {
    helpers.analyzeEntry.mockRejectedValue(new Error('gemini 503'));
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });
    expect(res.outcome).toBe('failed');
    expect(db.txUpdates[0]).not.toHaveProperty('analysis');
  });
});

describe('runEntryAnalysis - intent extraction seam (flag: intentExtraction)', () => {
  it('flag OFF (default): extraction never runs; legacy classifier tasks stand', async () => {
    helpers.classifyEntry.mockResolvedValue({ entry_type: 'task', confidence: 0.9, extracted_tasks: [{ text: 'legacy task', completed: false }] });
    helpers.analyzeEntry.mockResolvedValue({ ...goodAnalysis, entry_type: 'task' });
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored); // no flag fields -> intentExtraction false
    const res = await runEntryAnalysis({
      db, entryRef: makeEntryRef('userA'),
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' }, logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    expect(runIntentExtraction).not.toHaveBeenCalled();
    expect(db.txUpdates[0].extracted_tasks).toEqual([{ text: 'legacy task', completed: false }]);
  });

  it('flag ON: the intent system OWNS extracted_tasks (replaces the classifier list)', async () => {
    helpers.classifyEntry.mockResolvedValue({ entry_type: 'task', confidence: 0.9, extracted_tasks: [{ text: 'legacy task', completed: false }] });
    helpers.analyzeEntry.mockResolvedValue({ ...goodAnalysis, entry_type: 'task' });
    runIntentExtraction.mockResolvedValueOnce({ ran: true, extractedTasks: [{ text: 'call the dentist', completed: false, index: 0 }] });
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored, { intentExtraction: true });
    const res = await runEntryAnalysis({
      db, entryRef: makeEntryRef('userA'),
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' }, logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    expect(runIntentExtraction).toHaveBeenCalledTimes(1);
    expect(db.txUpdates[0].extracted_tasks).toEqual([{ text: 'call the dentist', completed: false, index: 0 }]);
  });

  it('flag ON + no active intents: extracted_tasks is dropped (silence is correct)', async () => {
    helpers.classifyEntry.mockResolvedValue({ entry_type: 'task', confidence: 0.9, extracted_tasks: [{ text: 'legacy task', completed: false }] });
    helpers.analyzeEntry.mockResolvedValue({ ...goodAnalysis, entry_type: 'task' });
    runIntentExtraction.mockResolvedValueOnce({ ran: true, extractedTasks: [] });
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored, { intentExtraction: true });
    const res = await runEntryAnalysis({
      db, entryRef: makeEntryRef('userA'),
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' }, logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    expect(db.txUpdates[0]).not.toHaveProperty('extracted_tasks');
  });

  it('flag ON + extraction THROWS: analysis still publishes (failure is isolated)', async () => {
    runIntentExtraction.mockRejectedValueOnce(new Error('gemini-intent-extract 503'));
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored, { intentExtraction: true });
    const res = await runEntryAnalysis({
      db, entryRef: makeEntryRef('userA'),
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' }, logStage: noopLogStage,
    });
    expect(res.outcome).toBe('published');
    expect(db.txUpdates[0].analysisStatus).toBe('complete');
  });
});

describe('runEntryAnalysis - scoped recent context (flag: contextSpaces, R1 plan task 10)', () => {
  it('flag ON + entry.spaceId set: scopes buildRecentContext with a where(spaceId) clause', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi', spaceId: 'work-space' };
    const db = makeDb(stored, { contextSpaces: true });
    const docs = [{ id: 'e0', data: { text: 'a work entry', spaceId: 'work-space' } }];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);

    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi', spaceId: 'work-space' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('published');
    expect(callLog).toContainEqual({ type: 'where', field: 'spaceId', op: '==', value: 'work-space' });
    expect(callLog).toContainEqual({ type: 'orderBy', field: 'createdAt', dir: 'desc' });
    // R4 Phase 2 Task 7: the raw candidate fetch widened to CANDIDATE_POOL_LIMIT
    // (40) so the entity/tag/semantic channels have room beyond the
    // most-recent 15 — the FINAL assembled context still caps at 15 (see the
    // multi-channel describe block below).
    expect(callLog).toContainEqual({ type: 'limit', n: 40 });
  });

  it('flag OFF: legacy query — no where clause even though entry.spaceId is set', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi', spaceId: 'work-space' };
    const db = makeDb(stored); // no flag fields -> contextSpaces false (default)
    const entryRef = makeEntryRefWithCollection('userA', [], callLog);

    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi', spaceId: 'work-space' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('published');
    expect(callLog.some((c) => c.type === 'where')).toBe(false);
    expect(callLog).toContainEqual({ type: 'orderBy', field: 'createdAt', dir: 'desc' });
  });

  it('flag ON but entry has no spaceId: legacy query — no where clause', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored, { contextSpaces: true });
    const entryRef = makeEntryRefWithCollection('userA', [], callLog);

    const res = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('published');
    expect(callLog.some((c) => c.type === 'where')).toBe(false);
  });
});

describe('runEntryAnalysis - multi-channel contextual retrieval (R4 Phase 2 Task 7)', () => {
  it('recent-only fallback: no tag/entity/semantic signal -> merged context is exactly the recent window, same order', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const docs = [
      { id: 'r0', data: { text: 'newest entry' } },
      { id: 'r1', data: { text: 'second newest' } },
      { id: 'r2', data: { text: 'third newest' } },
    ];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);

    await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(generateEmbeddingV2).not.toHaveBeenCalled();
    const recentContext = helpers.generateInsight.mock.calls[0][2];
    expect(recentContext).toBe('[recent] newest entry\n\n[recent] second newest\n\n[recent] third newest');
  });

  it('entity-overlap finds a match OUTSIDE the top-15 recency window and merges it in, dedupes, and respects the RECENT_CONTEXT_LIMIT cap', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'thinking about mom again' };
    const db = makeDb(stored);

    // 15 generic recent docs fill the recent-window channel completely...
    const recentDocs = Array.from({ length: 15 }, (_, i) => ({
      id: `recent-${i}`,
      data: { text: `generic recent entry number ${i}` },
    }));
    // ...plus one older doc, OUTSIDE that window, sharing an @person: tag
    // with the new entry — only reachable via the entity-overlap channel.
    const entityDoc = { id: 'entity-old', data: { text: 'MOM_GARDEN_MATCH', tags: ['@person:mom'] } };
    const docs = [...recentDocs, entityDoc];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);

    await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'thinking about mom again', tags: ['@person:mom'] },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    const recentContext = helpers.generateInsight.mock.calls[0][2];
    // Entity match present (found beyond the recent-15 window)...
    expect(recentContext).toContain('MOM_GARDEN_MATCH');
    // ...cap respected: entity match (1) + 14 of the 15 recent docs = 15 lines total.
    const lines = recentContext.split('\n\n');
    expect(lines).toHaveLength(15);
    // ...and the LAST (oldest) recent doc was the one pushed out to make room.
    expect(recentContext).not.toContain('generic recent entry number 14');
    expect(recentContext).toContain('generic recent entry number 0');
  });

  it('sensitive entries (safety_flagged / has_warning_indicators) are never in the assembled context text', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const docs = [
      { id: 'safe-1', data: { text: 'an ordinary entry' } },
      { id: 'flagged-1', data: { text: 'SENSITIVE_SAFETY_FLAGGED', safety_flagged: true } },
      { id: 'flagged-2', data: { text: 'SENSITIVE_WARNING_INDICATORS', has_warning_indicators: true } },
    ];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);

    await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    const recentContext = helpers.generateInsight.mock.calls[0][2];
    expect(recentContext).toContain('an ordinary entry');
    expect(recentContext).not.toContain('SENSITIVE_SAFETY_FLAGGED');
    expect(recentContext).not.toContain('SENSITIVE_WARNING_INDICATORS');
  });

  it('semantic channel is skipped silently (no embedding call) when no candidate has a stored embeddingV2 vector', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const docs = [
      { id: 'r0', data: { text: 'no vectors here', tags: ['@goal:fitness'] } },
    ];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);

    const res = await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi', tags: [] },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('published');
    expect(generateEmbeddingV2).not.toHaveBeenCalled();
  });

  it('semantic channel finds a cosine match OUTSIDE the top-15 recency window via stored embeddingV2 vectors', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'a calm morning walk' };
    const db = makeDb(stored);
    // 15 generic recent docs fill the recent-window channel completely (none
    // of them carry a vector, so they can't be mistaken for the semantic
    // match)...
    const recentDocs = Array.from({ length: 15 }, (_, i) => ({
      id: `recent-${i}`,
      data: { text: `generic recent entry number ${i}` },
    }));
    // ...plus one older doc, OUTSIDE that window, with a matching vector —
    // only reachable via the semantic channel.
    const semDoc = { id: 'sem-match', data: { text: 'SEMANTIC_MATCH', embeddingV2: [1, 0, 0] } };
    const docs = [...recentDocs, semDoc];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);
    generateEmbeddingV2.mockResolvedValueOnce({ embedding: [1, 0, 0], dim: 3 });

    await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'a calm morning walk', tags: [] },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(generateEmbeddingV2).toHaveBeenCalledTimes(1);
    const recentContext = helpers.generateInsight.mock.calls[0][2];
    expect(recentContext).toContain('SEMANTIC_MATCH');
  });

  it('semantic channel failure (embedding call throws) degrades to recent-only, never throws', async () => {
    const callLog = [];
    const stored = { entryInputVersion: 1, text: 'hi' };
    const db = makeDb(stored);
    const docs = [
      { id: 'r0', data: { text: 'has a vector', embeddingV2: [1, 0, 0] } },
    ];
    const entryRef = makeEntryRefWithCollection('userA', docs, callLog);
    generateEmbeddingV2.mockRejectedValueOnce(new Error('embedding API down'));

    const res = await runEntryAnalysis({
      db, entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'hi', tags: [] },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.outcome).toBe('published');
    const recentContext = helpers.generateInsight.mock.calls[0][2];
    expect(recentContext).toContain('has a vector'); // still present via the recent-window fallback
  });
});

describe('processing marker - duplicate trigger delivery', () => {
  it('the second delivery no-ops on processing.analysisStartedAt', async () => {
    // First delivery: marker absent -> claim wins.
    let stored = { text: 'hi' };
    const db1 = {
      async runTransaction(fn) {
        return fn({
          async get() {
            return { exists: true, data: () => stored };
          },
          set(_ref, data) {
            stored = { ...stored, ...data };
          },
        });
      },
    };
    const first = await claimProcessingMarker(db1, {}, 'processing.analysisStartedAt');
    expect(first).toBe(true);

    // Second delivery: marker now present -> claim refused.
    const db2 = {
      async runTransaction(fn) {
        return fn({
          async get() {
            return { exists: true, data: () => stored };
          },
          set() {
            throw new Error('should not set on duplicate');
          },
        });
      },
    };
    const second = await claimProcessingMarker(db2, {}, 'processing.analysisStartedAt');
    expect(second).toBe(false);
  });
});
