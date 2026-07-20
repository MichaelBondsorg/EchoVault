/**
 * Correction invalidation (plan task C4): server-side reaction to a client
 * entryInputVersion bump on the onEntryUpdate trigger.
 *
 * Covers the contract in the task brief:
 *  - edit bump -> exactly one re-analysis at the new version
 *  - duplicate delivery of the same version -> no-ops via the versioned marker
 *  - a later edit (new version) can still claim and re-run
 *  - stale in-flight v1 analysis publishing after a v2 edit is discarded and
 *    re-enqueued (the orchestrator's existing stale-version guard)
 *  - rawTranscript / transcription fields are never touched by the re-run
 *
 * Uses the REAL runEntryAnalysis + claimProcessingMarkerForVersion (only the
 * provider helpers, consent gate, and server flag are mocked) so this is an
 * integration-level test of the full re-analysis path, not just the gating
 * logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => '__ts__',
    delete: () => '__delete__',
  },
}));

vi.mock('../../analysis/analysisHelpers.js', () => ({
  classifyEntry: vi.fn(),
  analyzeEntry: vi.fn(),
  extractEnhancedContext: vi.fn(),
  generateInsight: vi.fn(),
}));

vi.mock('../../consent/consentGate.js', () => ({
  isAiAllowed: vi.fn(async () => true),
}));

vi.mock('../../shared/flags.js', () => ({
  getServerFlag: vi.fn(),
}));

const { maybeReanalyzeOnEntryUpdate } = await import('../entryUpdateAnalysis.js');
const helpers = await import('../../analysis/analysisHelpers.js');
const { isAiAllowed } = await import('../../consent/consentGate.js');
const { getServerFlag } = await import('../../shared/flags.js');

function noopLogStage() {}

function makeEntryRef(uid) {
  return {
    updates: [],
    async update(data) {
      this.updates.push(data);
    },
    parent: { parent: { id: uid } },
  };
}

/**
 * Fake transactional db shared by claimProcessingMarkerForVersion (tx.set,
 * merge) and the orchestrator's publishFinal (tx.update) — both mutate the
 * same `stored` object so a re-enqueue / marker claim is visible across
 * transactions, mirroring the real Firestore emulator's read-your-writes.
 */
function makeDb(stored) {
  const txUpdates = [];
  const txSets = [];
  const db = {
    txUpdates,
    txSets,
    async runTransaction(fn) {
      const tx = {
        async get() {
          return { exists: stored !== null && stored !== undefined, data: () => stored };
        },
        update(_ref, data) {
          txUpdates.push(data);
          if (stored) Object.assign(stored, data);
        },
        set(_ref, data, opts) {
          txSets.push({ data, opts });
          if (!stored) return;
          if (opts?.merge) {
            for (const [k, v] of Object.entries(data)) {
              if (stored[k] && typeof stored[k] === 'object' && v && typeof v === 'object') {
                Object.assign(stored[k], v);
              } else {
                stored[k] = v;
              }
            }
          } else {
            Object.assign(stored, data);
          }
        },
      };
      return fn(tx);
    },
  };
  return db;
}

const goodClassification = { entry_type: 'reflection', confidence: 0.9, extracted_tasks: [] };
const goodAnalysis = { title: 'Edited', tags: ['calm'], mood_score: 0.6, framework: 'act', entry_type: 'reflection' };

beforeEach(() => {
  vi.clearAllMocks();
  isAiAllowed.mockImplementation(async () => true);
  getServerFlag.mockImplementation(async (_db, _name, defaultValue) => defaultValue);
  helpers.classifyEntry.mockResolvedValue(goodClassification);
  helpers.analyzeEntry.mockResolvedValue(goodAnalysis);
  helpers.extractEnhancedContext.mockResolvedValue({
    structured_tags: [],
    topic_tags: [],
    continues_situation: null,
    goal_update: null,
    sentiment_by_entity: {},
  });
  helpers.generateInsight.mockResolvedValue({ found: false });
});

describe('maybeReanalyzeOnEntryUpdate - gating', () => {
  it('skips when entryInputVersion did not increase', async () => {
    const stored = { entryInputVersion: 2, text: 'same' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(true);

    const res = await maybeReanalyzeOnEntryUpdate({
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 2, text: 'same' },
      after: { entryInputVersion: 2, text: 'same' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res).toEqual({ skipped: true, reason: 'no-version-increase' });
    expect(helpers.classifyEntry).not.toHaveBeenCalled();
  });

  it('skips when the server flag is off, even though the version increased', async () => {
    const stored = { entryInputVersion: 2, text: 'edited' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(false);

    const res = await maybeReanalyzeOnEntryUpdate({
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 1, text: 'original' },
      after: { entryInputVersion: 2, text: 'edited' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res).toEqual({ skipped: true, reason: 'flag-off' });
    expect(helpers.classifyEntry).not.toHaveBeenCalled();
  });
});

describe('maybeReanalyzeOnEntryUpdate - edit bump triggers exactly one re-analysis', () => {
  it('re-runs analysis exactly once for the new version', async () => {
    const stored = { entryInputVersion: 2, text: 'edited' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(true);

    const res = await maybeReanalyzeOnEntryUpdate({
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 1, text: 'original' },
      after: { entryInputVersion: 2, text: 'edited' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res).toEqual({ reanalyzed: true, outcome: 'published' });
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1);
    // marker claimed at the new version
    expect(stored.processing.analysisStartedForVersion).toBe(2);
    // published analysisMeta carries the corrected version's provenance
    const published = db.txUpdates.find((u) => u.analysisMeta);
    expect(published.analysisMeta.inputVersion).toBe(2);
  });

  it('a duplicate delivery of the SAME version no-ops (versioned marker dedup)', async () => {
    const stored = { entryInputVersion: 2, text: 'edited' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(true);

    const args = {
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 1, text: 'original' },
      after: { entryInputVersion: 2, text: 'edited' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    };

    const first = await maybeReanalyzeOnEntryUpdate(args);
    expect(first.reanalyzed).toBe(true);
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1);

    // Redelivered event for the exact same before/after pair.
    const second = await maybeReanalyzeOnEntryUpdate(args);
    expect(second).toEqual({ skipped: true, reason: 'already-processing-version' });
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1); // NOT called again
  });

  it('a later edit (a new version) can still claim and re-run after a previous version was already claimed', async () => {
    const stored = { entryInputVersion: 2, text: 'edited once', processing: { analysisStartedForVersion: 2 } };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(true);

    // Version bumps again to 3 (a second correction).
    stored.entryInputVersion = 3;
    stored.text = 'edited twice';

    const res = await maybeReanalyzeOnEntryUpdate({
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 2, text: 'edited once' },
      after: { entryInputVersion: 3, text: 'edited twice' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(res.reanalyzed).toBe(true);
    expect(helpers.classifyEntry).toHaveBeenCalledTimes(1);
    expect(stored.processing.analysisStartedForVersion).toBe(3);
  });
});

describe('maybeReanalyzeOnEntryUpdate - stale in-flight analysis discarded', () => {
  it('an in-flight v1 analysis publishing after a v2 edit is discarded and re-enqueued', async () => {
    // Simulate: v1 analysis is mid-flight (classify/analyze already resolved
    // with data captured at v1), but by the time it tries to PUBLISH, the
    // document has already moved to v2 (the user corrected the entry again).
    const stored = { entryInputVersion: 2, text: 'edited', analysisStatus: 'processing' };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');

    const { runEntryAnalysis } = await import('../../analysis/orchestrator.js');
    const stale = await runEntryAnalysis({
      db,
      entryRef,
      entry: { id: 'e1', entryInputVersion: 1, text: 'original' }, // stale v1 snapshot
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    expect(stale.outcome).toBe('discarded');
    expect(stale.reEnqueued).toBe(true);
    expect(stored.analysisStatus).toBe('pending'); // re-enqueued for the watchdog
    expect(stored.title).toBeUndefined(); // stale v1 result was NEVER published
  });
});

describe('maybeReanalyzeOnEntryUpdate - raw transcription is never touched', () => {
  it('re-analysis publish leaves rawTranscript / transcription fields untouched', async () => {
    const stored = {
      entryInputVersion: 2,
      text: 'edited',
      transcription: { rawTranscript: 'um so like I went for a run', cleanedTranscript: 'edited', schemaVersion: 1 },
    };
    const db = makeDb(stored);
    const entryRef = makeEntryRef('userA');
    getServerFlag.mockResolvedValue(true);

    await maybeReanalyzeOnEntryUpdate({
      db, entryRef, entryId: 'e1',
      before: { entryInputVersion: 1, text: 'original' },
      after: { entryInputVersion: 2, text: 'edited' },
      apiKeys: { gemini: 'g', openai: 'o' },
      logStage: noopLogStage,
    });

    // Every write the re-run performed must omit transcription fields...
    for (const update of db.txUpdates) {
      expect(update).not.toHaveProperty('transcription');
      expect(update).not.toHaveProperty('rawTranscript');
    }
    // ...and the field on the document itself must survive untouched.
    expect(stored.transcription.rawTranscript).toBe('um so like I went for a run');
  });
});
