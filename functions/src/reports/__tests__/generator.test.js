/**
 * Report Generator Tests
 *
 * Covers R2 Task 9: source_exclusions filtering in readEntries(), and the
 * end-to-end assembly of entryRefs receipts + scope/model/promptVersion/
 * sourceEntryCount metadata on a generated report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/registry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getModel: vi.fn() };
});

// generatePremiumNarrative (real narrative.js, unmocked) calls callGemini —
// mock it so monthly/quarterly/annual generateReport() tests (findings 2/3)
// don't hit the network. Weekly's template path never touches this.
vi.mock('../../shared/gemini.js', () => ({
  callGemini: vi.fn(),
}));

const mockReportRefUpdate = vi.fn().mockResolvedValue({});
const mockRunTransaction = vi.fn();
const mockSendNotification = vi.fn().mockResolvedValue({});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

vi.mock('../../notifications/sender.js', () => ({
  sendNotification: mockSendNotification,
}));

// --- Fake Firestore query/collection helpers -------------------------------

function fakeSnap(docs) {
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    forEach(fn) {
      docs.forEach((d) => fn({ id: d.id, data: () => d.data }));
    },
  };
}

// A chainable query stub: where()/orderBy()/limit() all return itself;
// get() resolves to the snapshot the test configured for this path.
function makeQuery(snapshot) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    select: vi.fn(() => query),
    get: vi.fn().mockResolvedValue(snapshot),
  };
  return query;
}

// mockDb is referenced by the hoisted vi.mock('firebase-admin/firestore', ...)
// factory above; `mock`-prefixed variables are exempt from the hoisting TDZ
// restriction (see pdfExport.test.js / reportCleanup.test.js for the same
// pattern already used in this codebase).
let mockDb;

/**
 * Build a fresh fake `db` for one generateReport() run.
 * @param {object} opts
 * @param {Array<{id: string, data: object}>} opts.entries - raw entry docs
 * @param {Array<{id: string, data: object}>} opts.exclusions - source_exclusions docs
 * @param {Error} [opts.entriesError] - if set, the /entries query's get()
 *   rejects with this error instead of resolving (finding 3).
 * @param {Error} [opts.exclusionsError] - if set, the /source_exclusions
 *   query's get() rejects with this error instead of resolving (finding 3).
 * @param {object} [opts.nexusDoc] - if set, the `nexus/insights` singleton
 *   doc's get() resolves to {exists: true, data: () => nexusDoc}; if unset,
 *   {exists: false} (mirrors "user has no Nexus doc yet").
 * @param {Error} [opts.nexusError] - if set, the `nexus/insights` doc's
 *   get() rejects with this error instead of resolving.
 */
function buildFakeDb({ entries = [], exclusions = [], entriesError = null, exclusionsError = null, nexusDoc = undefined, nexusError = null } = {}) {
  const collectionRoutes = {};
  const docRoutes = {};

  const db = {
    doc: vi.fn((path) => {
      if (docRoutes[path]) return docRoutes[path];
      if (/\/reports\//.test(path)) {
        const ref = { update: mockReportRefUpdate, get: vi.fn() };
        docRoutes[path] = ref;
        return ref;
      }
      if (path.endsWith('/nexus/insights')) {
        const ref = {
          get: nexusError
            ? vi.fn().mockRejectedValue(nexusError)
            : vi.fn().mockResolvedValue(
                nexusDoc !== undefined ? { exists: true, data: () => nexusDoc } : { exists: false }
              ),
        };
        docRoutes[path] = ref;
        return ref;
      }
      // Analytics/health single-doc reads default to "not exists".
      const ref = { get: vi.fn().mockResolvedValue({ exists: false }) };
      docRoutes[path] = ref;
      return ref;
    }),
    collection: vi.fn((path) => {
      if (path.endsWith('/entries')) {
        return entriesError ? makeRejectingQuery(entriesError) : makeQuery(fakeSnap(entries));
      }
      if (path.endsWith('/source_exclusions')) {
        return exclusionsError ? makeRejectingQuery(exclusionsError) : makeQuery(fakeSnap(exclusions));
      }
      if (path.endsWith('/signal_states')) return makeQuery(fakeSnap([]));
      collectionRoutes[path] = collectionRoutes[path] || makeQuery(fakeSnap([]));
      return collectionRoutes[path];
    }),
    runTransaction: vi.fn(async (fn) => {
      const txn = {
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: vi.fn(),
      };
      return fn(txn);
    }),
  };
  mockDb = db;
  return db;
}

// `moodScore` here is the REAL 0-1 internal scale (analysis.mood_score) —
// the field name of this helper's parameter is kept for readability, but
// it now writes to the actual field the app writes (mood_score), not the
// camelCase field the app never writes.
function entryDoc(id, { createdAt = new Date('2026-01-10T12:00:00Z'), moodScore = null, text = 'entry text', safety_flagged = false } = {}) {
  return {
    id,
    data: {
      createdAt: { toDate: () => createdAt },
      text,
      analysis: { mood_score: moodScore },
      safety_flagged,
    },
  };
}

// Builds a raw entry doc with a caller-supplied `analysis` object, for
// testing field-name edge cases directly (legacy camelCase-only docs, etc.)
// without entryDoc()'s mood_score-only shape.
function rawEntryDoc(id, analysis, { createdAt = new Date('2026-01-10T12:00:00Z'), text = 'entry text' } = {}) {
  return {
    id,
    data: {
      createdAt: { toDate: () => createdAt },
      text,
      analysis,
    },
  };
}

function exclusionDoc(id, { entryId, appliesTo = 'all' } = {}) {
  return { id, data: { entryId, appliesTo, reason: 'test', permanent: true } };
}

import { readEntries, readNexusData, generateReport } from '../generator.js';
import { getModel } from '../../models/registry.js';
import { callGemini } from '../../shared/gemini.js';

// A chainable query stub whose get() rejects — used to simulate an
// entries-read or source_exclusions-read failure independently (finding 3).
function makeRejectingQuery(err) {
  const query = {
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    select: vi.fn(() => query),
    get: vi.fn().mockRejectedValue(err),
  };
  return query;
}

const USER_BASE = 'artifacts/test-app/users/user1';
const PERIOD_START = new Date('2026-01-05T00:00:00Z');
const PERIOD_END = new Date('2026-01-11T23:59:59Z');

describe('readEntries', () => {
  it('excludes entries whose id appears in source_exclusions with appliesTo=="all"', async () => {
    const db = buildFakeDb({
      entries: [entryDoc('e1'), entryDoc('e2'), entryDoc('e3')],
      exclusions: [exclusionDoc('x1', { entryId: 'e2', appliesTo: 'all' })],
    });

    const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');

    expect(entries.map((e) => e.id)).toEqual(['e1', 'e3']);
  });

  it('does NOT exclude entries whose exclusion record has a non-"all" appliesTo (pattern-scoped)', async () => {
    const db = buildFakeDb({
      entries: [entryDoc('e1'), entryDoc('e2')],
      exclusions: [exclusionDoc('x1', { entryId: 'e2', appliesTo: 'relationship_pattern' })],
    });

    const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');

    expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('returns all entries unfiltered when there are no exclusions', async () => {
    const db = buildFakeDb({ entries: [entryDoc('e1'), entryDoc('e2')], exclusions: [] });
    const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
    expect(entries.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('reads source_exclusions exactly once per call (one extra collection read per report run)', async () => {
    const db = buildFakeDb({ entries: [entryDoc('e1')], exclusions: [] });
    await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');

    const exclusionCalls = db.collection.mock.calls.filter(([path]) => path.endsWith('/source_exclusions'));
    expect(exclusionCalls).toHaveLength(1);
  });

  describe('mood_score field (R4 Task 4)', () => {
    it('reads the real analysis.mood_score field (0-1 scale)', async () => {
      const db = buildFakeDb({ entries: [rawEntryDoc('e1', { mood_score: 0.62 })], exclusions: [] });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries[0].moodScore).toBe(0.62);
    });

    it('treats a legacy camelCase-only doc (analysis.moodScore, no mood_score) as missing, not misread', async () => {
      const db = buildFakeDb({ entries: [rawEntryDoc('e1', { moodScore: 0.62 })], exclusions: [] });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries[0].moodScore).toBeNull();
    });

    // T4 review (Important): range validation mirrors normalizeMoodTo100 —
    // out-of-range / non-finite values are INVALID → missing, never clamped
    // or passed through to an out-of-range display value.
    it.each([
      [1.2, 'above range'],
      [-0.1, 'below range'],
      [Number.NaN, 'NaN'],
      [Number.POSITIVE_INFINITY, 'Infinity'],
    ])('rejects out-of-range mood_score %p to missing (%s), never clamped', async (bad) => {
      const db = buildFakeDb({ entries: [rawEntryDoc('e1', { mood_score: bad })], exclusions: [] });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries[0].moodScore).toBeNull();
    });

    it('accepts the exact boundaries 0 and 1 as valid', async () => {
      const db = buildFakeDb({
        entries: [rawEntryDoc('e1', { mood_score: 0 }), rawEntryDoc('e2', { mood_score: 1 })],
        exclusions: [],
      });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries.map((e) => e.moodScore)).toEqual([0, 1]);
    });

    it('treats a doc with no analysis object at all as missing', async () => {
      const db = buildFakeDb({ entries: [rawEntryDoc('e1', undefined)], exclusions: [] });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries[0].moodScore).toBeNull();
    });

    it('treats mood_score: 0 as a real value, not falsy-missing', async () => {
      const db = buildFakeDb({ entries: [rawEntryDoc('e1', { mood_score: 0 })], exclusions: [] });
      const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
      expect(entries[0].moodScore).toBe(0);
    });
  });
});

describe('readNexusData — singleton doc (R4 Task 4)', () => {
  it('reads active[] from the nexus/insights singleton doc, not a by-type collection query', async () => {
    const receipt = {
      sources: [{ entryId: 'e1', date: '2026-01-05T00:00:00.000Z', excerpt: 'text' }],
      scope: null,
      timeWindow: { start: '2025-12-06T00:00:00.000Z', end: '2026-01-05T00:00:00.000Z' },
      sampleSize: 3,
      missingness: null,
      versions: { generator: 'pattern_correlation', computationVersion: 1, generatedAt: '2026-01-05T00:00:00.000Z', model: null, promptVersion: null },
    };
    const nexusDoc = {
      active: [
        { id: 'pattern_x', type: 'pattern_correlation', title: 'X Effect', summary: 'X boosts mood', body: 'longer body', receipt },
      ],
      history: [],
      generatedAt: { toDate: () => new Date('2026-01-05') },
      expiresAt: { toDate: () => new Date('2026-01-06') },
      stale: false,
    };
    const db = buildFakeDb({ nexusDoc });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].id).toBe('pattern_x');
    expect(result.insights[0].receipt).toBe(receipt);
    expect(result.patterns).toEqual(result.insights);

    // The old by-type collection query must never be issued.
    const nexusCollectionCalls = db.collection.mock.calls.filter(([path]) => path.endsWith('/nexus'));
    expect(nexusCollectionCalls).toHaveLength(0);
    expect(db.doc).toHaveBeenCalledWith(`${USER_BASE}/nexus/insights`);
  });

  it('returns empty insights/patterns when the singleton doc does not exist', async () => {
    const db = buildFakeDb({});
    const result = await readNexusData(db, USER_BASE);
    expect(result).toEqual({ insights: [], patterns: [] });
  });

  it('degrades to empty insights/patterns (does not throw) when the read fails', async () => {
    const db = buildFakeDb({ nexusError: new Error('nexus boom') });
    const result = await readNexusData(db, USER_BASE);
    expect(result).toEqual({ insights: [], patterns: [] });
  });

  it('includes active insights that are missing a receipt unfiltered, but logs loudly (assert, do not silently drop)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nexusDoc = {
      active: [{ id: 'no_receipt_insight', type: 'calibration', title: 'Learning your baseline' }],
      history: [],
    };
    const db = buildFakeDb({ nexusDoc });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights).toHaveLength(1);
    expect(result.insights[0].id).toBe('no_receipt_insight');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('generateReport — entryRefs receipts + metadata (weekly, real narrative.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  it('populates section entryRefs, excludes source-excluded entries, and stamps scope/model/promptVersion/sourceEntryCount', async () => {
    const entries = [
      entryDoc('e1', { moodScore: 0.7 }),
      entryDoc('e2', { moodScore: null }), // no mood score -> absent from mood_trend entryRefs
      entryDoc('e3', { moodScore: 0.5 }),
      entryDoc('excluded', { moodScore: 0.9 }), // dropped by source_exclusions
    ];
    const exclusions = [exclusionDoc('x1', { entryId: 'excluded', appliesTo: 'all' })];
    const db = buildFakeDb({ entries, exclusions });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    expect(mockReportRefUpdate).toHaveBeenCalled();
    // Find the call that transitions the report to 'ready' (carries sections/metadata).
    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    const { sections, metadata } = readyCall[0];

    const summary = sections.find((s) => s.id === 'summary');
    const insight = sections.find((s) => s.id === 'insight');
    const moodTrend = sections.find((s) => s.id === 'mood_trend');

    // Excluded entry never appears anywhere.
    for (const section of sections) {
      expect(section.entryRefs).not.toContain('excluded');
    }
    expect(summary.entryRefs).toEqual(['e1', 'e2', 'e3']);
    expect(insight.entryRefs).toEqual(['e1', 'e2', 'e3']);
    expect(moodTrend.entryRefs).toEqual(['e1', 'e3']);

    expect(metadata.scope).toBe('all_spaces');
    // Weekly is template-only (zero LLM calls) — model/promptVersion must
    // be null, not the registry-resolved insight model (finding 2: stamping
    // a model id here would claim an LLM ran when it didn't).
    expect(metadata.model).toBeNull();
    expect(metadata.promptVersion).toBeNull();
    // Union of all entryRefs across sections = {e1, e2, e3} = 3, even though
    // mood_trend alone only cites 2.
    expect(metadata.sourceEntryCount).toBe(3);
    expect(metadata.entryCount).toBe(3); // 'excluded' entry never counted
  });

  it('produces empty entryRefs (not undefined) when the period has no entries', async () => {
    const db = buildFakeDb({ entries: [], exclusions: [] });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    const { sections, metadata } = readyCall[0];
    for (const section of sections) {
      expect(section.entryRefs).toEqual([]);
    }
    expect(metadata.sourceEntryCount).toBe(0);
  });

  it('converts 0-1 internal mood_score to the 0-100 display scale in mood_trend chartData (R4 Task 4)', async () => {
    const entries = [
      entryDoc('e1', { moodScore: 0.62 }),
      entryDoc('e2', { moodScore: null }), // missing — must NOT become a displayed 0
      entryDoc('e3', { moodScore: 0.5 }),
    ];
    const db = buildFakeDb({ entries, exclusions: [] });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    const { sections } = readyCall[0];
    const moodSection = sections.find((s) => s.id === 'mood_trend');

    expect(moodSection.chartData.data.map((p) => p.value)).toEqual([62, 50]);
    // The null-mood entry never appears in the chart data at all — not as a
    // displayed 0 (guards the "filter before multiply" ordering).
    expect(moodSection.chartData.data.map((p) => p.value)).not.toContain(0);
  });
});

describe('generateReport — metadata.model / promptVersion honesty (finding 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
    callGemini.mockResolvedValue('Generated narrative text.');
  });

  it('weekly (template-only, zero LLM calls) stamps model:null, promptVersion:null and never resolves a model', async () => {
    buildFakeDb({ entries: [entryDoc('e1')], exclusions: [] });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    expect(readyCall[0].metadata.model).toBeNull();
    expect(readyCall[0].metadata.promptVersion).toBeNull();
    expect(getModel).not.toHaveBeenCalled();
  });

  it('monthly (LLM-generated narrative) stamps the registry-resolved model and promptVersion 1', async () => {
    buildFakeDb({ entries: [entryDoc('e1')], exclusions: [] });

    await generateReport('user1', 'monthly', PERIOD_START, PERIOD_END, 'fake-api-key');

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    expect(readyCall[0].metadata.model).toBe('registry-insight-model-x');
    expect(readyCall[0].metadata.promptVersion).toBe(1);
    expect(getModel).toHaveBeenCalledWith(mockDb, 'insight');
  });
});

describe('readEntries — separated failure semantics (finding 3)', () => {
  it('entries-read failure still degrades to [] (unchanged behavior)', async () => {
    const db = buildFakeDb({ exclusions: [], entriesError: new Error('entries boom') });
    const entries = await readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly');
    expect(entries).toEqual([]);
  });

  it('exclusions-read failure throws (fails closed) instead of degrading to []', async () => {
    const db = buildFakeDb({ entries: [entryDoc('e1')], exclusionsError: new Error('exclusions boom') });
    await expect(
      readEntries(db, USER_BASE, PERIOD_START, PERIOD_END, 'weekly')
    ).rejects.toThrow(/source_exclusions/);
  });
});

describe('generateReport — exclusions-read failure fails closed (finding 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  it('marks the report doc status:"failed" (not "ready" with an under-filtered entries set) when source_exclusions read rejects', async () => {
    buildFakeDb({ entries: [entryDoc('e1')], exclusionsError: new Error('exclusions boom') });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeUndefined();
    const failedCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'failed');
    expect(failedCall).toBeTruthy();
  });

  it('entries-read failure (unchanged) still reaches status:"ready" with degraded/empty entries', async () => {
    buildFakeDb({ exclusions: [], entriesError: new Error('entries boom') });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    expect(readyCall[0].metadata.entryCount).toBe(0);
  });
});
