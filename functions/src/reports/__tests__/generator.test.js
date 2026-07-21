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
 */
function buildFakeDb({ entries = [], exclusions = [] } = {}) {
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
      // Analytics/health single-doc reads default to "not exists".
      const ref = { get: vi.fn().mockResolvedValue({ exists: false }) };
      docRoutes[path] = ref;
      return ref;
    }),
    collection: vi.fn((path) => {
      if (path.endsWith('/entries')) return makeQuery(fakeSnap(entries));
      if (path.endsWith('/source_exclusions')) return makeQuery(fakeSnap(exclusions));
      if (path.endsWith('/nexus')) return makeQuery(fakeSnap([]));
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

function entryDoc(id, { createdAt = new Date('2026-01-10T12:00:00Z'), moodScore = null, text = 'entry text', safety_flagged = false } = {}) {
  return {
    id,
    data: {
      createdAt: { toDate: () => createdAt },
      text,
      analysis: { moodScore },
      safety_flagged,
    },
  };
}

function exclusionDoc(id, { entryId, appliesTo = 'all' } = {}) {
  return { id, data: { entryId, appliesTo, reason: 'test', permanent: true } };
}

import { readEntries, generateReport } from '../generator.js';
import { getModel } from '../../models/registry.js';

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
});

describe('generateReport — entryRefs receipts + metadata (weekly, real narrative.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  it('populates section entryRefs, excludes source-excluded entries, and stamps scope/model/promptVersion/sourceEntryCount', async () => {
    const entries = [
      entryDoc('e1', { moodScore: 7 }),
      entryDoc('e2', { moodScore: null }), // no mood score -> absent from mood_trend entryRefs
      entryDoc('e3', { moodScore: 5 }),
      entryDoc('excluded', { moodScore: 9 }), // dropped by source_exclusions
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
    expect(metadata.model).toBe('registry-insight-model-x');
    expect(metadata.promptVersion).toBe(1);
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
});
