/**
 * Gentle Revisit selection tests (R2 Task 19).
 *
 * `selectRevisitCandidate` is covered as a pure function with plain-object
 * fixtures (no Firestore). `runGentleRevisitDaily` is covered against a fake
 * Firestore double mirroring the codebase's established fake-transactional-db
 * pattern (see `functions/src/__tests__/triggerIdempotency.test.js` and
 * `functions/src/reports/__tests__/generator.test.js`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn(() => 'SCHEDULED_FN_STUB'),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => 'REAL_DB_STUB'),
  FieldValue: { serverTimestamp: () => '__server_ts__' },
}));

const {
  selectRevisitCandidate,
  runGentleRevisitDaily,
  monthYearLabel,
  MIN_AGE_DAYS,
  MAX_AGE_DAYS,
  ADJACENCY_DAYS,
  DEDUP_WINDOW_DAYS,
} = await import('../selectRevisits.js');
const { _clearFlagCacheForTest } = await import('../../shared/flags.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-21T16:00:00.000Z');

function daysAgo(days) {
  return NOW - days * DAY_MS;
}

function baseEntry(overrides = {}) {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: daysAgo(100),
    spaceId: null,
    safety_flagged: false,
    has_warning_indicators: false,
    analysis: { mood_score: 0.6 },
    tags: [],
    entities: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectRevisitCandidate (pure)
// ---------------------------------------------------------------------------

describe('selectRevisitCandidate — rule 1: safety_flagged', () => {
  it('never selects a safety_flagged entry, even when it is otherwise ideal', () => {
    const flagged = baseEntry({ id: 'flagged-1', safety_flagged: true });
    const result = selectRevisitCandidate({ entries: [flagged], now: NOW });
    expect(result).toBeNull();
  });
});

describe('selectRevisitCandidate — rule 2: has_warning_indicators', () => {
  it('never selects an entry with has_warning_indicators true', () => {
    const warned = baseEntry({ id: 'warned-1', has_warning_indicators: true });
    const result = selectRevisitCandidate({ entries: [warned], now: NOW });
    expect(result).toBeNull();
  });
});

describe('selectRevisitCandidate — rule 3: crisis-window adjacency', () => {
  it('excludes a candidate exactly ADJACENCY_DAYS away from a flagged entry (boundary inclusive)', () => {
    const flaggedAt = daysAgo(100);
    const flagged = baseEntry({ id: 'flagged', createdAt: flaggedAt, safety_flagged: true });
    const candidate = baseEntry({ id: 'edge-in', createdAt: flaggedAt - ADJACENCY_DAYS * DAY_MS });
    const result = selectRevisitCandidate({ entries: [flagged, candidate], now: NOW });
    expect(result).toBeNull();
  });

  it('includes a candidate one millisecond beyond ADJACENCY_DAYS (boundary exclusive just past the edge)', () => {
    const flaggedAt = daysAgo(100);
    const flagged = baseEntry({ id: 'flagged', createdAt: flaggedAt, safety_flagged: true });
    const candidate = baseEntry({ id: 'edge-out', createdAt: flaggedAt - ADJACENCY_DAYS * DAY_MS - 1 });
    const result = selectRevisitCandidate({ entries: [flagged, candidate], now: NOW });
    expect(result?.id).toBe('edge-out');
  });

  it('adjacency is anchored on ANY flagged entry in the passed set, not just same-day ones', () => {
    const flagged = baseEntry({ id: 'flagged', createdAt: daysAgo(100), safety_flagged: true });
    const nearby = baseEntry({ id: 'nearby', createdAt: daysAgo(98) }); // 2 days away
    const result = selectRevisitCandidate({ entries: [flagged, nearby], now: NOW });
    expect(result).toBeNull();
  });
});

describe('selectRevisitCandidate — rule 4: mood floor', () => {
  it('excludes an entry with mood_score below 0.4', () => {
    const low = baseEntry({ id: 'low-mood', analysis: { mood_score: 0.39 } });
    const result = selectRevisitCandidate({ entries: [low], now: NOW });
    expect(result).toBeNull();
  });

  it('excludes an entry with a missing mood_score', () => {
    const missing = baseEntry({ id: 'no-mood', analysis: {} });
    const result = selectRevisitCandidate({ entries: [missing], now: NOW });
    expect(result).toBeNull();
  });

  it('excludes an entry with a null mood_score', () => {
    const nullMood = baseEntry({ id: 'null-mood', analysis: { mood_score: null } });
    const result = selectRevisitCandidate({ entries: [nullMood], now: NOW });
    expect(result).toBeNull();
  });

  it('includes an entry with mood_score exactly at the 0.4 floor', () => {
    const atFloor = baseEntry({ id: 'at-floor', analysis: { mood_score: 0.4 } });
    const result = selectRevisitCandidate({ entries: [atFloor], now: NOW });
    expect(result?.id).toBe('at-floor');
  });
});

describe('selectRevisitCandidate — rule 5: revisit_exclusions', () => {
  it('dimension "entry": excludes by exact entry id', () => {
    const target = baseEntry({ id: 'excl-entry' });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'entry', value: 'excl-entry' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('dimension "date": excludes every entry created on the excluded UTC date', () => {
    const target = baseEntry({ id: 'excl-date', createdAt: Date.parse('2026-04-01T12:00:00.000Z') });
    const fallback = baseEntry({ id: 'fallback', createdAt: Date.parse('2026-04-02T12:00:00.000Z') });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'date', value: '2026-04-01' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('dimension "space": excludes every entry in the excluded space', () => {
    const target = baseEntry({ id: 'excl-space', spaceId: 'space-work' });
    const fallback = baseEntry({ id: 'fallback', spaceId: 'space-personal' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'space', value: 'space-work' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('dimension "person": excludes entries mentioning the excluded person entity', () => {
    const target = baseEntry({ id: 'excl-person', entities: [{ id: 'p1', name: 'Sam', category: 'person' }] });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'person', value: 'p1' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('dimension "tag": excludes entries carrying the excluded tag', () => {
    const target = baseEntry({ id: 'excl-tag', tags: ['breakup'] });
    const fallback = baseEntry({ id: 'fallback', tags: ['hiking'] });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'tag', value: 'breakup' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('dimension "family": excludes entries via a broader entity/tag family match', () => {
    const target = baseEntry({ id: 'excl-family', entities: [{ id: 'e1', name: 'old job', category: 'topic' }] });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'family', value: 'e1' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('an unknown/future exclusion dimension never matches (fails closed to "not excluded", not "exclude everything")', () => {
    const entry = baseEntry({ id: 'only-one' });
    const result = selectRevisitCandidate({
      entries: [entry],
      exclusions: [{ dimension: 'mood', value: 'sad' }],
      now: NOW,
    });
    expect(result?.id).toBe('only-one');
  });
});

describe('selectRevisitCandidate — age window (30-400 days)', () => {
  it(`excludes an entry younger than ${MIN_AGE_DAYS} days`, () => {
    const young = baseEntry({ id: 'young', createdAt: daysAgo(MIN_AGE_DAYS - 1) });
    expect(selectRevisitCandidate({ entries: [young], now: NOW })).toBeNull();
  });

  it(`includes an entry exactly ${MIN_AGE_DAYS} days old (boundary inclusive)`, () => {
    const edge = baseEntry({ id: 'edge-min', createdAt: daysAgo(MIN_AGE_DAYS) });
    expect(selectRevisitCandidate({ entries: [edge], now: NOW })?.id).toBe('edge-min');
  });

  it(`includes an entry exactly ${MAX_AGE_DAYS} days old (boundary inclusive)`, () => {
    const edge = baseEntry({ id: 'edge-max', createdAt: daysAgo(MAX_AGE_DAYS) });
    expect(selectRevisitCandidate({ entries: [edge], now: NOW })?.id).toBe('edge-max');
  });

  it(`excludes an entry older than ${MAX_AGE_DAYS} days`, () => {
    const old = baseEntry({ id: 'old', createdAt: daysAgo(MAX_AGE_DAYS + 1) });
    expect(selectRevisitCandidate({ entries: [old], now: NOW })).toBeNull();
  });
});

describe('selectRevisitCandidate — dedup vs recent queue', () => {
  it(`excludes an entry already selected within the last ${DEDUP_WINDOW_DAYS} days`, () => {
    const target = baseEntry({ id: 'already-shown' });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      recentQueue: [{ entryId: 'already-shown', selectedAt: daysAgo(10) }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it(`does NOT exclude an entry whose prior selection is older than ${DEDUP_WINDOW_DAYS} days (boundary)`, () => {
    const target = baseEntry({ id: 'shown-long-ago' });
    const result = selectRevisitCandidate({
      entries: [target],
      recentQueue: [{ entryId: 'shown-long-ago', selectedAt: daysAgo(DEDUP_WINDOW_DAYS + 1) }],
      now: NOW,
    });
    expect(result?.id).toBe('shown-long-ago');
  });
});

describe('selectRevisitCandidate — null when nothing qualifies', () => {
  it('returns null (not padded) when every candidate fails a rule', () => {
    const flagged = baseEntry({ id: 'a', safety_flagged: true });
    const warned = baseEntry({ id: 'b', has_warning_indicators: true });
    const lowMood = baseEntry({ id: 'c', analysis: { mood_score: 0.1 } });
    const tooYoung = baseEntry({ id: 'd', createdAt: daysAgo(1) });
    const result = selectRevisitCandidate({ entries: [flagged, warned, lowMood, tooYoung], now: NOW });
    expect(result).toBeNull();
  });

  it('returns null for an empty entries array', () => {
    expect(selectRevisitCandidate({ entries: [], now: NOW })).toBeNull();
  });

  it('skips entries with an uncoercible createdAt rather than throwing', () => {
    const broken = baseEntry({ id: 'broken', createdAt: 'not-a-date' });
    expect(selectRevisitCandidate({ entries: [broken], now: NOW })).toBeNull();
  });
});

describe('selectRevisitCandidate — 100% safety-fixture exclusion gate', () => {
  it('never selects ANY entry from an adversarial fixture set covering every exclusion rule', () => {
    const flaggedAnchor = baseEntry({ id: 'anchor-flagged', createdAt: daysAgo(200), safety_flagged: true });
    const adversarial = [
      flaggedAnchor,
      baseEntry({ id: 'unsafe-flagged', safety_flagged: true, createdAt: daysAgo(150) }),
      baseEntry({ id: 'unsafe-warned', has_warning_indicators: true, createdAt: daysAgo(120) }),
      baseEntry({ id: 'unsafe-adjacent-plus', createdAt: daysAgo(200) - ADJACENCY_DAYS * DAY_MS }),
      baseEntry({ id: 'unsafe-adjacent-minus', createdAt: daysAgo(200) + ADJACENCY_DAYS * DAY_MS }),
      baseEntry({ id: 'unsafe-low-mood', analysis: { mood_score: 0.1 }, createdAt: daysAgo(110) }),
      baseEntry({ id: 'unsafe-missing-mood', analysis: {}, createdAt: daysAgo(115) }),
      baseEntry({ id: 'unsafe-excluded-entry', createdAt: daysAgo(130) }),
      baseEntry({ id: 'unsafe-too-young', createdAt: daysAgo(5) }),
      baseEntry({ id: 'unsafe-too-old', createdAt: daysAgo(500) }),
    ];
    const exclusions = [{ dimension: 'entry', value: 'unsafe-excluded-entry' }];

    // Run the full adversarial set with NO safe control present: must be null.
    const noneSafe = selectRevisitCandidate({ entries: adversarial, exclusions, now: NOW });
    expect(noneSafe).toBeNull();

    // Adding exactly one genuinely safe entry proves the adversarial ones
    // really were filtered (not that the input was accidentally empty).
    const safeControl = baseEntry({ id: 'the-only-safe-one', createdAt: daysAgo(180) });
    const withControl = selectRevisitCandidate({
      entries: [...adversarial, safeControl],
      exclusions,
      now: NOW,
    });
    expect(withControl?.id).toBe('the-only-safe-one');
  });
});

describe('selectRevisitCandidate — preference ordering', () => {
  it('prefers an entry with entities/themes present over one with none, all else equal', () => {
    const plain = baseEntry({ id: 'plain', createdAt: daysAgo(100) });
    const rich = baseEntry({ id: 'rich', createdAt: daysAgo(100), tags: ['trip'] });
    const result = selectRevisitCandidate({ entries: [plain, rich], now: NOW });
    expect(result?.id).toBe('rich');
  });

  it('prefers mood >= 0.5 over a lower-but-still-passing mood, all else equal', () => {
    const lower = baseEntry({ id: 'lower', analysis: { mood_score: 0.45 }, createdAt: daysAgo(100) });
    const higher = baseEntry({ id: 'higher', analysis: { mood_score: 0.55 }, createdAt: daysAgo(100) });
    const result = selectRevisitCandidate({ entries: [lower, higher], now: NOW });
    expect(result?.id).toBe('higher');
  });

  it('prefers variety by month: a fresh month beats a month already surfaced recently', () => {
    // recentQueue's selectedAt must itself fall within the DEDUP_WINDOW_DAYS
    // window (relative to NOW) to register as a "recently surfaced month" —
    // June 15 is 36 days before NOW (2026-07-21), well inside the 60-day window.
    const sameMonthAsRecent = baseEntry({ id: 'same-month', createdAt: Date.parse('2026-06-10T00:00:00.000Z') });
    const freshMonth = baseEntry({ id: 'other-month', createdAt: Date.parse('2026-04-10T00:00:00.000Z') });
    const recentQueue = [{ entryId: 'something-else', selectedAt: Date.parse('2026-06-15T00:00:00.000Z') }];
    const result = selectRevisitCandidate({ entries: [sameMonthAsRecent, freshMonth], recentQueue, now: NOW });
    expect(result?.id).toBe('other-month');
  });
});

describe('monthYearLabel', () => {
  it('formats as "{Month} {Year}" in UTC', () => {
    expect(monthYearLabel(Date.parse('2026-03-10T00:00:00.000Z'))).toBe('March 2026');
  });
});

// ---------------------------------------------------------------------------
// runGentleRevisitDaily (scheduled sweep, fake Firestore)
// ---------------------------------------------------------------------------

const APP = 'echo-vault-v5-fresh';

function fakeSnap(docs) {
  return {
    size: docs.length,
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
    forEach(fn) { docs.forEach((d) => fn({ id: d.id, data: () => d.data })); },
  };
}

function fakeQuery(snapshot) {
  const q = {
    where: vi.fn(() => q),
    orderBy: vi.fn(() => q),
    limit: vi.fn(() => q),
    get: vi.fn(async () => snapshot),
  };
  return q;
}

/**
 * Fake Firestore double supporting exactly the surface `runGentleRevisitDaily`
 * uses: `.doc(path)`/`.collection(path)` with a shared docStore (keyed by
 * path) so `runTransaction` (used internally by the real `claimProcessingMarker`)
 * observes the same state as direct `.get()` calls — mirrors
 * `triggerIdempotency.test.js`'s `makeTxDb` pattern, extended for multiple docs.
 */
function buildFakeDb({ flags = { gentleRevisit: true }, userIds = [], prefsByUser = {}, entriesByUser = {}, exclusionsByUser = {}, queueByUser = {} } = {}) {
  const docStore = new Map();
  const queueWrites = [];

  function docRef(path) {
    if (!docStore.has(path)) docStore.set(path, { data: null });
    const store = docStore.get(path);
    return {
      __path: path,
      get: vi.fn(async () => ({ exists: store.data !== null, data: () => store.data })),
    };
  }

  // Seed prefs docs up front.
  for (const [uid, data] of Object.entries(prefsByUser)) {
    docStore.set(`artifacts/${APP}/users/${uid}/settings/revisitPrefs`, { data });
  }

  const entriesQueryCalls = [];

  const db = {
    doc: vi.fn((path) => {
      if (path === 'config/flags') {
        return { get: vi.fn(async () => ({ exists: true, data: () => flags })) };
      }
      return docRef(path);
    }),
    collection: vi.fn((path) => {
      if (path === `artifacts/${APP}/users`) {
        return fakeQuery(fakeSnap(userIds.map((id) => ({ id, data: {} }))));
      }
      const entriesMatch = path.match(new RegExp(`users/([^/]+)/entries$`));
      if (entriesMatch) {
        const uid = entriesMatch[1];
        const q = fakeQuery(fakeSnap(entriesByUser[uid] || []));
        entriesQueryCalls.push(q);
        return q;
      }
      const exclusionsMatch = path.match(new RegExp(`users/([^/]+)/revisit_exclusions$`));
      if (exclusionsMatch) return fakeQuery(fakeSnap(exclusionsByUser[exclusionsMatch[1]] || []));
      const queueMatch = path.match(new RegExp(`users/([^/]+)/revisit_queue$`));
      if (queueMatch) {
        const uid = queueMatch[1];
        const q = fakeQuery(fakeSnap(queueByUser[uid] || []));
        q.doc = vi.fn(() => ({
          set: vi.fn(async (data) => {
            queueWrites.push({ uid, data });
          }),
        }));
        return q;
      }
      return fakeQuery(fakeSnap([]));
    }),
    runTransaction: vi.fn(async (fn) => {
      const tx = {
        get: vi.fn(async (ref) => {
          const store = docStore.get(ref.__path) || { data: null };
          docStore.set(ref.__path, store);
          return { exists: store.data !== null, data: () => store.data };
        }),
        set: vi.fn((ref, data, opts) => {
          const store = docStore.get(ref.__path) || { data: null };
          store.data = opts?.merge ? { ...(store.data || {}), ...data } : data;
          docStore.set(ref.__path, store);
        }),
      };
      return fn(tx);
    }),
  };

  return { db, queueWrites, entriesQueryCalls, docStore };
}

const RUN_NOW = new Date('2026-07-21T15:00:00.000Z'); // 08:00 America/Los_Angeles

function eligibleEntryDoc(id, overrides = {}) {
  return {
    id,
    data: {
      createdAt: new Date(RUN_NOW.getTime() - 100 * DAY_MS),
      safety_flagged: false,
      has_warning_indicators: false,
      analysis: { mood_score: 0.7 },
      tags: ['calm'],
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // getServerFlag caches config/flags in a module-level singleton (60s TTL)
  // keyed only by doc path, not by db instance — clear it so each test's
  // fake db's own `flags` fixture is actually observed.
  _clearFlagCacheForTest();
});

describe('runGentleRevisitDaily — server flag gate', () => {
  it('skips every user without reading the users collection when the server flag is off', async () => {
    const { db } = buildFakeDb({ flags: { gentleRevisit: false }, userIds: ['u1'] });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result).toEqual({ processed: 0, selected: 0, skipped: 0 });
    expect(db.collection).not.toHaveBeenCalledWith(`artifacts/${APP}/users`);
  });
});

describe('runGentleRevisitDaily — per-user opt-in gate', () => {
  it('skips a user with no revisitPrefs doc at all', async () => {
    const { db, queueWrites } = buildFakeDb({ userIds: ['u1'], prefsByUser: {} });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('skips a user with revisitPrefs.enabled === false', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: false } },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.skipped).toBe(1);
    expect(queueWrites).toHaveLength(0);
  });

  it('does not read entries for a skipped (non-opted-in) user', async () => {
    const { db, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: false } },
    });
    await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(entriesQueryCalls).toHaveLength(0);
  });
});

describe('runGentleRevisitDaily — selection + write', () => {
  it('writes exactly one revisit_queue doc for an opted-in user with an eligible entry', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(1);
    expect(queueWrites).toHaveLength(1);
    expect(queueWrites[0].uid).toBe('u1');
    expect(queueWrites[0].data).toEqual({
      entryId: 'entry-1',
      spaceId: null,
      selectedAt: '__server_ts__',
      dueDate: '2026-07-21',
      status: 'queued',
      reason: expect.stringMatching(/^A calm moment from \w+ \d{4}$/),
    });
  });

  it('caps the candidate entries read at 200', async () => {
    const { db, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });
    await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(entriesQueryCalls).toHaveLength(1);
    expect(entriesQueryCalls[0].limit).toHaveBeenCalledWith(200);
  });

  it('writes spaceId when the selected entry has one', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1', { spaceId: 'space-work' })] },
    });
    await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(queueWrites[0].data.spaceId).toBe('space-work');
  });

  it('claims the marker but writes nothing when no candidate qualifies (null is correct)', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('flagged', { safety_flagged: true })] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });
});

describe('runGentleRevisitDaily — idempotency marker', () => {
  it('a second run on the same local day is a no-op: no second entries read, no second write', async () => {
    const shared = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });

    const first = await runGentleRevisitDaily(shared.db, { now: RUN_NOW });
    expect(first.selected).toBe(1);
    expect(shared.queueWrites).toHaveLength(1);

    const second = await runGentleRevisitDaily(shared.db, { now: RUN_NOW });
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(shared.queueWrites).toHaveLength(1); // still just the one write
    expect(shared.entriesQueryCalls).toHaveLength(1); // entries were only ever read once
  });

  it('a run on the following local day claims a fresh marker and can select again', async () => {
    const shared = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });

    await runGentleRevisitDaily(shared.db, { now: RUN_NOW });
    const nextDay = new Date(RUN_NOW.getTime() + 24 * 60 * 60 * 1000);
    const second = await runGentleRevisitDaily(shared.db, { now: nextDay });

    expect(second.processed).toBe(1);
    expect(second.selected).toBe(1);
    expect(shared.queueWrites).toHaveLength(2);
  });
});

describe('runGentleRevisitDaily — per-user isolation', () => {
  it('one user erroring does not stop the sweep for the next user', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['broken-user', 'u2'],
      prefsByUser: {
        'broken-user': { enabled: true },
        u2: { enabled: true },
      },
      entriesByUser: {
        u2: [eligibleEntryDoc('entry-2')],
      },
    });
    // Force the first user's prefs read to throw.
    const originalDoc = db.doc;
    db.doc = vi.fn((path) => {
      if (path === 'artifacts/echo-vault-v5-fresh/users/broken-user/settings/revisitPrefs') {
        return { get: vi.fn(async () => { throw new Error('boom'); }) };
      }
      return originalDoc(path);
    });

    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.skipped).toBe(1);
    expect(result.selected).toBe(1);
    expect(queueWrites).toHaveLength(1);
    expect(queueWrites[0].uid).toBe('u2');
  });
});
