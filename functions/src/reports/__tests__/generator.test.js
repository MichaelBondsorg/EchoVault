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
 * @param {Array<{id: string, data: object}>} [opts.engagement] - docs in the
 *   `nexus/insights/insight_engagement` subcollection (R4 P0-closure
 *   Important 3 — dismissal records); defaults to empty (no dismissals).
 * @param {Error} [opts.engagementError] - if set, the insight_engagement
 *   collection's get() rejects with this error instead of resolving.
 * @param {Array<{id: string, data: object}>} [opts.claims] - docs in the
 *   `insight_claims` collection (R4 Phase 2 Task 8); defaults to empty (no
 *   verified claims).
 * @param {Error} [opts.claimsError] - if set, the insight_claims
 *   collection's get() rejects with this error instead of resolving.
 */
function buildFakeDb({ entries = [], exclusions = [], entriesError = null, exclusionsError = null, nexusDoc = undefined, nexusError = null, engagement = [], engagementError = null, claims = [], claimsError = null } = {}) {
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
      if (path.endsWith('/insight_engagement')) {
        return engagementError ? makeRejectingQuery(engagementError) : makeQuery(fakeSnap(engagement));
      }
      if (path.endsWith('/insight_claims')) {
        return claimsError ? makeRejectingQuery(claimsError) : makeQuery(fakeSnap(claims));
      }
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
//
// `category` (REP-01): when set, writes the top-level `category` field
// readEntries reads (`d.classification?.category || d.category ||
// 'uncategorized'`) — undefined by default so existing fixtures that never
// cared about category keep defaulting to 'uncategorized' unchanged.
function entryDoc(id, { createdAt = new Date('2026-01-10T12:00:00Z'), moodScore = null, text = 'entry text', safety_flagged = false, category } = {}) {
  return {
    id,
    data: {
      createdAt: { toDate: () => createdAt },
      text,
      analysis: { mood_score: moodScore },
      safety_flagged,
      ...(category !== undefined ? { category } : {}),
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

// R4 P0-closure Important 3 — a dismissal doc as written by the CLIENT's
// `recordInsightDismissal` (src/services/nexus/insightDismissal.js).
function engagementDoc(id, { dismissalKey, dismissed = true } = {}) {
  return { id, data: { dismissed, dismissalKey: dismissalKey ?? id, dismissedAt: { toDate: () => new Date('2026-01-01') }, insightId: null } };
}

// R4 Phase 2 Task 8 — a minimal verified-claim doc as written by the
// client's claims pipeline (src/services/insights/claims/claimSchema.js's
// buildClaim). Only the fields readVerifiedClaims/narrative.js's
// formatClaimLine actually read are populated; the full buildClaim shape
// (analysisPlan, receipt, etc.) is a client-pipeline concern out of scope
// for this server-side read/rank test.
//
// `receipt.timeWindow` (REP-01) defaults to fully containing the file's
// standard PERIOD_START..PERIOD_END fixture window (2026-01-05..01-11) —
// i.e. a plain `claimDoc()` overlaps the period and is eligible for
// "held_up" via `splitClaimsByPeriodOverlap`, matching every pre-REP-01
// test's assumption that a claim fixture applies to the period under test.
// Tests exercising the overlap split itself override `receipt.timeWindow`
// explicitly (see the "cross-period fixture" describe block below).
function claimDoc(id, overrides = {}) {
  return {
    id,
    data: {
      claimType: 'pattern_to_watch',
      status: 'verified',
      supersededByClaimId: null,
      wording: `Claim wording for ${id}.`,
      limitations: [`Limitation for ${id}.`],
      evidence: {
        exposedDayCount: 9,
        comparisonDayCount: 15,
        effectMoodPoints: 5,
        sourceEntryIds: [`${id}-e1`],
      },
      receipt: {
        sources: [],
        scope: null,
        timeWindow: { start: '2026-01-01T00:00:00.000Z', end: '2026-01-15T00:00:00.000Z' },
        sampleSize: 1,
        missingness: null,
        versions: { generator: 'test', computationVersion: 1, generatedAt: '2026-01-05T00:00:00.000Z', model: null, promptVersion: null },
      },
      createdAt: '2026-01-05T00:00:00.000Z',
      ...overrides,
    },
  };
}

import {
  readEntries, readNexusData, readVerifiedClaims, generateReport,
  derivePeriodStats, claimOverlapsPeriod, splitClaimsByPeriodOverlap,
} from '../generator.js';
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

describe('readNexusData — dismissal filtering (R4 P0-closure Important 3)', () => {
  it('a dismissed-by-key insight (stable id, e.g. pattern_*) is absent from the report inputs', async () => {
    const nexusDoc = {
      active: [
        { id: 'pattern_exercise_completion', type: 'pattern_correlation', title: 'Exercise Pattern', summary: 'x', body: 'y' },
        { id: 'pattern_fatigue', type: 'pattern_correlation', title: 'Energy Pattern', summary: 'x', body: 'y' },
      ],
      history: [],
    };
    const db = buildFakeDb({
      nexusDoc,
      engagement: [engagementDoc('pattern_exercise_completion', { dismissalKey: 'pattern_exercise_completion' })],
    });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights.map((i) => i.id)).toEqual(['pattern_fatigue']);
    expect(result.patterns).toEqual(result.insights);
  });

  it('a same-content insight with a churned id (e.g. causal synthesis, insight_<timestamp>) is still filtered via the content-derived key', async () => {
    const nexusDoc = {
      active: [
        { id: 'insight_1737400000000', type: 'causal_synthesis', title: 'The Evening Walk Effect', summary: 'A walk helps' },
        { id: 'insight_1737400000000_other', type: 'causal_synthesis', title: 'A Totally Different Insight', summary: 'unrelated' },
      ],
      history: [],
    };
    const db = buildFakeDb({
      nexusDoc,
      // Dismissal was recorded against an EARLIER generation with a
      // DIFFERENT numeric id but the SAME title -> same dismissalKeyFor
      // output (`synthesis:the evening walk effect`).
      engagement: [engagementDoc('synthesis-key-doc', { dismissalKey: 'synthesis:the evening walk effect' })],
    });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights.map((i) => i.title)).toEqual(['A Totally Different Insight']);
  });

  it('a dismissal-read failure proceeds UNFILTERED (all active insights included) and logs a warning, without failing the whole read', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nexusDoc = {
      active: [{ id: 'pattern_fatigue', type: 'pattern_correlation', title: 'Energy Pattern', summary: 'x', body: 'y' }],
      history: [],
    };
    const db = buildFakeDb({ nexusDoc, engagementError: new Error('engagement read boom') });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights.map((i) => i.id)).toEqual(['pattern_fatigue']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read insight dismissals'),
      'engagement read boom'
    );
    warnSpy.mockRestore();
  });

  it('a dismissed doc with dismissed:false (or missing) does not filter anything', async () => {
    const nexusDoc = {
      active: [{ id: 'pattern_fatigue', type: 'pattern_correlation', title: 'Energy Pattern', summary: 'x', body: 'y' }],
      history: [],
    };
    const db = buildFakeDb({
      nexusDoc,
      engagement: [engagementDoc('pattern_fatigue', { dismissed: false })],
    });

    const result = await readNexusData(db, USER_BASE);

    expect(result.insights.map((i) => i.id)).toEqual(['pattern_fatigue']);
  });
});

describe('readVerifiedClaims (R4 Phase 2 Task 8)', () => {
  it('returns [] when the insight_claims collection is empty', async () => {
    const db = buildFakeDb({ claims: [] });
    const result = await readVerifiedClaims(db, USER_BASE);
    expect(result).toEqual([]);
  });

  it('includes only status:"verified" AND supersededByClaimId:null claims', async () => {
    const db = buildFakeDb({
      claims: [
        claimDoc('c_verified', { status: 'verified', supersededByClaimId: null }),
        claimDoc('c_candidate', { status: 'candidate', supersededByClaimId: null }),
        claimDoc('c_suppressed', { status: 'suppressed', supersededByClaimId: null }),
        claimDoc('c_expired', { status: 'expired', supersededByClaimId: null }),
        claimDoc('c_superseded', { status: 'verified', supersededByClaimId: 'c_verified_v2' }),
      ],
    });

    const result = await readVerifiedClaims(db, USER_BASE);

    expect(result.map((c) => c.id)).toEqual(['c_verified']);
  });

  it('ranks by claimType weight (experiment_result > pattern_to_watch > observation) first', async () => {
    const db = buildFakeDb({
      claims: [
        claimDoc('c_observation', { claimType: 'observation', evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 50, sourceEntryIds: [] } }),
        claimDoc('c_pattern', { claimType: 'pattern_to_watch', evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 1, sourceEntryIds: [] } }),
        claimDoc('c_experiment', { claimType: 'experiment_result', evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 0.1, sourceEntryIds: [] } }),
      ],
    });

    const result = await readVerifiedClaims(db, USER_BASE);

    // Highest claimType weight wins regardless of effect size.
    expect(result.map((c) => c.id)).toEqual(['c_experiment', 'c_pattern', 'c_observation']);
  });

  it('within the same claimType, ranks by |effectMoodPoints| descending', async () => {
    const db = buildFakeDb({
      claims: [
        claimDoc('c_small', { claimType: 'pattern_to_watch', evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: -2, sourceEntryIds: [] } }),
        claimDoc('c_large', { claimType: 'pattern_to_watch', evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: 8, sourceEntryIds: [] } }),
      ],
    });

    const result = await readVerifiedClaims(db, USER_BASE);

    expect(result.map((c) => c.id)).toEqual(['c_large', 'c_small']);
  });

  it('within the same type and effect size, ranks by createdAt descending (most recent first)', async () => {
    const db = buildFakeDb({
      claims: [
        claimDoc('c_old', { createdAt: '2026-01-01T00:00:00.000Z' }),
        claimDoc('c_new', { createdAt: '2026-01-10T00:00:00.000Z' }),
      ],
    });

    const result = await readVerifiedClaims(db, USER_BASE);

    expect(result.map((c) => c.id)).toEqual(['c_new', 'c_old']);
  });

  it('caps the result at 5 claims', async () => {
    const claims = Array.from({ length: 8 }, (_, i) => claimDoc(`c${i}`, {
      evidence: { exposedDayCount: 9, comparisonDayCount: 15, effectMoodPoints: i, sourceEntryIds: [] },
    }));
    const db = buildFakeDb({ claims });

    const result = await readVerifiedClaims(db, USER_BASE);

    expect(result).toHaveLength(5);
  });

  it('degrades to [] (does not throw) and logs a warning when the read fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = buildFakeDb({ claimsError: new Error('claims boom') });

    const result = await readVerifiedClaims(db, USER_BASE);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to read verified claims'),
      'claims boom'
    );
    warnSpy.mockRestore();
  });
});

describe('derivePeriodStats (REP-01 fix #1 — period stats derived from entries, not global analytics)', () => {
  it('returns null moodAvg, empty categoryStats, null topTheme, [] topThemes for an empty entry set', () => {
    expect(derivePeriodStats([])).toEqual({
      moodAvg: null,
      categoryStats: {},
      topTheme: null,
      topThemes: [],
    });
  });

  it('same for undefined/non-array input (defensive default)', () => {
    expect(derivePeriodStats(undefined)).toEqual({
      moodAvg: null,
      categoryStats: {},
      topTheme: null,
      topThemes: [],
    });
  });

  it('moodAvg averages only entries with a non-null moodScore, on the 0-10 display scale (0-1 internal * 10)', () => {
    const entries = [
      { category: 'personal', moodScore: 0.8 },
      { category: 'personal', moodScore: 0.4 },
      { category: 'personal', moodScore: null }, // excluded, not treated as 0
    ];
    const stats = derivePeriodStats(entries);
    // (0.8 + 0.4) / 2 * 10 = 6
    expect(stats.moodAvg).toBeCloseTo(6, 5);
  });

  it('moodAvg is null (not 0) when zero entries have a mood score', () => {
    const entries = [{ category: 'personal', moodScore: null }, { category: 'work', moodScore: undefined }];
    expect(derivePeriodStats(entries).moodAvg).toBeNull();
  });

  it('treats moodScore: 0 as a real value (not falsy-missing)', () => {
    const entries = [{ category: 'personal', moodScore: 0 }, { category: 'personal', moodScore: 1 }];
    // (0 + 1) / 2 * 10 = 5
    expect(derivePeriodStats(entries).moodAvg).toBeCloseTo(5, 5);
  });

  it('categoryStats counts entries per category, defaulting missing category to "uncategorized"', () => {
    const entries = [
      { category: 'work', moodScore: null },
      { category: 'work', moodScore: null },
      { category: 'personal', moodScore: null },
      { category: undefined, moodScore: null },
    ];
    expect(derivePeriodStats(entries).categoryStats).toEqual({
      work: 2,
      personal: 1,
      uncategorized: 1,
    });
  });

  it('topTheme is the single most-frequent category; topThemes is up to 5 ordered by frequency descending', () => {
    const entries = [
      { category: 'work', moodScore: null },
      { category: 'work', moodScore: null },
      { category: 'work', moodScore: null },
      { category: 'personal', moodScore: null },
      { category: 'personal', moodScore: null },
      { category: 'health', moodScore: null },
    ];
    const stats = derivePeriodStats(entries);
    expect(stats.topTheme).toBe('work');
    expect(stats.topThemes).toEqual(['work', 'personal', 'health']);
  });
});

describe('claimOverlapsPeriod / splitClaimsByPeriodOverlap (REP-01 fix #2 — overlap rule)', () => {
  const PERIOD_A_START = new Date('2026-02-01T00:00:00Z');
  const PERIOD_A_END = new Date('2026-02-28T23:59:59Z');

  function claimWithWindow(id, start, end) {
    return { id, receipt: { timeWindow: { start, end } } };
  }

  it('overlaps when the claim window is fully inside the period', () => {
    const claim = claimWithWindow('c1', '2026-02-10T00:00:00.000Z', '2026-02-15T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(true);
  });

  it('overlaps when the claim window fully contains the period', () => {
    const claim = claimWithWindow('c1', '2026-01-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(true);
  });

  it('overlaps when the claim window partially overlaps the start of the period', () => {
    const claim = claimWithWindow('c1', '2026-01-25T00:00:00.000Z', '2026-02-05T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(true);
  });

  it('overlaps when the claim window only TOUCHES a period boundary (inclusive endpoints, documented "any overlap" threshold)', () => {
    const claim = claimWithWindow('c1', '2026-01-15T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(true);
  });

  it('does NOT overlap a claim window entirely before the period (January vs. February)', () => {
    const claim = claimWithWindow('c1', '2026-01-01T00:00:00.000Z', '2026-01-31T23:59:59.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(false);
  });

  it('does NOT overlap a claim window entirely after the period', () => {
    const claim = claimWithWindow('c1', '2026-03-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(false);
  });

  it('fails CLOSED (does not overlap) when receipt.timeWindow is missing entirely', () => {
    expect(claimOverlapsPeriod({ id: 'c1' }, PERIOD_A_START, PERIOD_A_END)).toBe(false);
    expect(claimOverlapsPeriod({ id: 'c1', receipt: {} }, PERIOD_A_START, PERIOD_A_END)).toBe(false);
    expect(claimOverlapsPeriod({ id: 'c1', receipt: { timeWindow: {} } }, PERIOD_A_START, PERIOD_A_END)).toBe(false);
  });

  it('fails CLOSED when receipt.timeWindow has an unparsable date string', () => {
    const claim = claimWithWindow('c1', 'not-a-date', '2026-02-15T00:00:00.000Z');
    expect(claimOverlapsPeriod(claim, PERIOD_A_START, PERIOD_A_END)).toBe(false);
  });

  it('splitClaimsByPeriodOverlap partitions into periodClaims/currentClaims, preserving relative order', () => {
    const overlapping1 = claimWithWindow('overlap1', '2026-02-01T00:00:00.000Z', '2026-02-05T00:00:00.000Z');
    const stale = claimWithWindow('stale', '2026-01-01T00:00:00.000Z', '2026-01-31T00:00:00.000Z');
    const overlapping2 = claimWithWindow('overlap2', '2026-02-20T00:00:00.000Z', '2026-02-25T00:00:00.000Z');

    const { periodClaims, currentClaims } = splitClaimsByPeriodOverlap(
      [overlapping1, stale, overlapping2], PERIOD_A_START, PERIOD_A_END
    );

    expect(periodClaims.map((c) => c.id)).toEqual(['overlap1', 'overlap2']);
    expect(currentClaims.map((c) => c.id)).toEqual(['stale']);
  });

  it('splitClaimsByPeriodOverlap returns empty arrays for empty/undefined input', () => {
    expect(splitClaimsByPeriodOverlap([], PERIOD_A_START, PERIOD_A_END)).toEqual({ periodClaims: [], currentClaims: [] });
    expect(splitClaimsByPeriodOverlap(undefined, PERIOD_A_START, PERIOD_A_END)).toEqual({ periodClaims: [], currentClaims: [] });
  });
});

describe('generateReport — verified claims feed the held_up section (R4 Phase 2 Task 8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  it('weekly report\'s held_up section renders from a verified claim fixture, not nexus prose', async () => {
    const nexusDoc = {
      active: [{ id: 'pattern_x', type: 'pattern_correlation', title: 'Nexus Pattern', summary: 'NEXUS-PROSE-SHOULD-NOT-APPEAR', body: 'y' }],
      history: [],
    };
    const db = buildFakeDb({
      entries: [entryDoc('e1')],
      nexusDoc,
      claims: [claimDoc('c1', { wording: 'Verified claim wording.' })],
    });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    const { sections } = readyCall[0];
    const heldUp = sections.find((s) => s.id === 'held_up');
    expect(heldUp.narrative).toContain('Verified claim wording.');
    expect(heldUp.narrative).not.toContain('NEXUS-PROSE-SHOULD-NOT-APPEAR');
  });

  it('weekly report\'s held_up section shows the explicit no-verified-patterns copy when there are zero claims', async () => {
    const db = buildFakeDb({ entries: [entryDoc('e1')], claims: [] });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    const { sections } = readyCall[0];
    const heldUp = sections.find((s) => s.id === 'held_up');
    expect(heldUp.narrative).toContain('No verified patterns');
  });

  it('a claims-read failure still generates the report (status "ready") with the empty-state held_up section', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = buildFakeDb({ entries: [entryDoc('e1')], claimsError: new Error('claims boom') });

    await generateReport('user1', 'weekly', PERIOD_START, PERIOD_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    const { sections } = readyCall[0];
    const heldUp = sections.find((s) => s.id === 'held_up');
    expect(heldUp.narrative).toContain('No verified patterns');
    warnSpy.mockRestore();
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
    const heldUp = sections.find((s) => s.id === 'held_up');
    const moodTrend = sections.find((s) => s.id === 'mood_trend');

    // Excluded entry never appears anywhere.
    for (const section of sections) {
      expect(section.entryRefs).not.toContain('excluded');
    }
    expect(summary.entryRefs).toEqual(['e1', 'e2', 'e3']);
    // No claims fixture in this test -> held_up falls back to the full
    // period entry id list (zero-claims posture, R4 Phase 2 Task 8).
    expect(heldUp.entryRefs).toEqual(['e1', 'e2', 'e3']);
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

// REP-01 — cross-period fixture (the review's "January-vs-February" test):
// current global state (a stale, January-scoped verified claim) must not be
// silently attributed to a February report. This is the RED driver for the
// whole REP-01 fix: before it, generator.js read a global analytics
// snapshot into period stats and fed every verified claim into "held_up"
// regardless of its evidence window.
describe('generateReport — cross-period fixture: January state must not leak into a February report (REP-01)', () => {
  const FEB_START = new Date('2026-02-01T00:00:00Z');
  const FEB_END = new Date('2026-02-28T23:59:59Z');

  beforeEach(() => {
    vi.clearAllMocks();
    getModel.mockResolvedValue('registry-insight-model-x');
  });

  function claimWithWindow(id, { start, end, wording, sourceEntryIds }) {
    return claimDoc(id, {
      wording,
      evidence: {
        exposedDayCount: 9,
        comparisonDayCount: 15,
        effectMoodPoints: 5,
        sourceEntryIds: sourceEntryIds ?? [`${id}-e1`],
      },
      receipt: {
        sources: [],
        scope: null,
        timeWindow: { start, end },
        sampleSize: 1,
        missingness: null,
        versions: { generator: 'test', computationVersion: 1, generatedAt: start, model: null, promptVersion: null },
      },
    });
  }

  it("February report's mood/category/theme reconcile exactly to the February entry set, and a January-only claim appears only under the current-context label", async () => {
    const febEntries = [
      entryDoc('feb1', { createdAt: new Date('2026-02-02T10:00:00Z'), moodScore: 0.8, category: 'work' }),
      entryDoc('feb2', { createdAt: new Date('2026-02-15T10:00:00Z'), moodScore: 0.4, category: 'work' }),
      entryDoc('feb3', { createdAt: new Date('2026-02-20T10:00:00Z'), moodScore: null, category: 'personal' }),
    ];
    const januaryStaleClaim = claimWithWindow('january_claim', {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-01-31T23:59:59.000Z',
      wording: 'STALE-JANUARY-CLAIM-WORDING',
    });

    buildFakeDb({ entries: febEntries, exclusions: [], claims: [januaryStaleClaim] });

    await generateReport('user1', 'weekly', FEB_START, FEB_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    expect(readyCall).toBeTruthy();
    const { sections, metadata } = readyCall[0];

    // Mood/category/theme reconcile EXACTLY to the February entry set —
    // never to some global/current snapshot.
    // (0.8 + 0.4) / 2 * 10 = 6
    expect(metadata.moodAvg).toBeCloseTo(6, 5);
    expect(metadata.entryCount).toBe(3);

    const categorySection = sections[0];
    expect(categorySection.chartData.categoryBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'work', value: 2 }),
        expect.objectContaining({ label: 'personal', value: 1 }),
      ])
    );

    // The January claim does NOT overlap February -> "held_up" shows the
    // explicit no-claims copy, never the stale claim's wording.
    const heldUp = sections.find((s) => s.id === 'held_up');
    expect(heldUp.narrative).toContain('No verified patterns');
    expect(heldUp.narrative).not.toContain('STALE-JANUARY-CLAIM-WORDING');

    // The stale claim surfaces ONLY under the separately-labeled
    // current-context section — never unlabeled, never inside held_up.
    const currentContext = sections.find((s) => s.id === 'current_context');
    expect(currentContext).toBeTruthy();
    expect(currentContext.title).toBe('Current verified insights (not period-specific)');
    expect(currentContext.narrative).toContain('STALE-JANUARY-CLAIM-WORDING');

    // Its entryRefs are its own claim evidence ids, never borrowed from the
    // February period's entry id list (no unlabeled cross-period
    // attribution via receipts either).
    expect(currentContext.entryRefs).toEqual(['january_claim-e1']);
    expect(currentContext.entryRefs).not.toContain('feb1');

    // topInsights (claims-mode metadata) records the claim id, not a
    // legacy Nexus id.
    expect(metadata.topInsights).toEqual(['january_claim']);
  });

  it('re-generating a historical (January) report from the SAME global state reconciles to January\'s own entries, not February\'s', async () => {
    const JAN_START = new Date('2026-01-01T00:00:00Z');
    const JAN_END = new Date('2026-01-31T23:59:59Z');

    const janEntries = [
      entryDoc('jan1', { createdAt: new Date('2026-01-10T10:00:00Z'), moodScore: 0.2, category: 'health' }),
    ];
    const febOnlyClaim = claimWithWindow('feb_claim', {
      start: '2026-02-01T00:00:00.000Z',
      end: '2026-02-28T23:59:59.000Z',
      wording: 'FEBRUARY-ONLY-CLAIM-WORDING',
    });

    buildFakeDb({ entries: janEntries, exclusions: [], claims: [febOnlyClaim] });

    await generateReport('user1', 'weekly', JAN_START, JAN_END, null);

    const readyCall = mockReportRefUpdate.mock.calls.find((args) => args[0]?.status === 'ready');
    const { sections, metadata } = readyCall[0];

    // 0.2 * 10 = 2
    expect(metadata.moodAvg).toBeCloseTo(2, 5);
    expect(metadata.entryCount).toBe(1);

    const heldUp = sections.find((s) => s.id === 'held_up');
    expect(heldUp.narrative).not.toContain('FEBRUARY-ONLY-CLAIM-WORDING');
    const currentContext = sections.find((s) => s.id === 'current_context');
    expect(currentContext.narrative).toContain('FEBRUARY-ONLY-CLAIM-WORDING');
  });
});
