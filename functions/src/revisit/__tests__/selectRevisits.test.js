/**
 * Gentle Revisit selection tests (R2 Task 19; hardened in Michael's direct
 * safety review, Task GR1 —
 * `docs/superpowers/plans/2026-07-22-michael-review-hardening.md`).
 *
 * `selectRevisitCandidate` (and the new GR1 pure helpers
 * `currentStateGateTripped`/`sustainedLowMoodTripped`/`weeklyCadenceTripped`)
 * are covered as pure functions with plain-object fixtures (no Firestore).
 * `runGentleRevisitDaily` is covered against a fake Firestore double
 * mirroring the codebase's established fake-transactional-db pattern (see
 * `functions/src/__tests__/triggerIdempotency.test.js` and
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
  matchesExclusion,
  isExclusionActive,
  currentStateGateTripped,
  sustainedLowMoodTripped,
  weeklyCadenceTripped,
  MIN_AGE_DAYS,
  MAX_AGE_DAYS,
  ADJACENCY_DAYS,
  DEDUP_WINDOW_DAYS,
  MOOD_FLOOR,
  RECENT_WINDOW_DAYS,
  LOW_MOOD_LOOKBACK,
  LOW_MOOD_MIN_SCORED,
  LOW_MOOD_THRESHOLD,
  WEEKLY_CADENCE_DAYS,
  DISMISSED_CADENCE_DAYS,
  ANNIVERSARY_BLACKOUT_DAYS,
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
    analysis: { mood_score: 0.7 },
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

describe('selectRevisitCandidate — rule 0 (GR1): legacy fail-closed', () => {
  it('never selects an entry with a non-boolean (e.g. undefined/legacy) safety_flagged', () => {
    const legacy = baseEntry({ id: 'legacy-1', safety_flagged: undefined });
    expect(selectRevisitCandidate({ entries: [legacy], now: NOW })).toBeNull();
  });

  it('never selects an entry with a non-boolean (e.g. undefined/legacy) has_warning_indicators', () => {
    const legacy = baseEntry({ id: 'legacy-2', has_warning_indicators: undefined });
    expect(selectRevisitCandidate({ entries: [legacy], now: NOW })).toBeNull();
  });

  it('never selects an entry where both safety fields are missing entirely (real legacy-doc shape)', () => {
    const legacy = { id: 'legacy-3', createdAt: daysAgo(100), analysis: { mood_score: 0.8 }, tags: [], entities: [] };
    expect(selectRevisitCandidate({ entries: [legacy], now: NOW })).toBeNull();
  });

  it('selects normally once both fields are explicit booleans (baseline sanity check)', () => {
    const clean = baseEntry({ id: 'clean-1' });
    expect(selectRevisitCandidate({ entries: [clean], now: NOW })?.id).toBe('clean-1');
  });
});

describe('selectRevisitCandidate — rule 3: crisis-window adjacency (flagged anchor)', () => {
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

describe('selectRevisitCandidate — rule 3 (GR1: widened): crisis-window adjacency to warning-indicator anchors too', () => {
  it('excludes a candidate exactly ADJACENCY_DAYS away from a has_warning_indicators-only entry (not safety_flagged)', () => {
    const warnedAt = daysAgo(100);
    const warned = baseEntry({ id: 'warned', createdAt: warnedAt, has_warning_indicators: true });
    const candidate = baseEntry({ id: 'edge-in', createdAt: warnedAt - ADJACENCY_DAYS * DAY_MS });
    const result = selectRevisitCandidate({ entries: [warned, candidate], now: NOW });
    expect(result).toBeNull();
  });

  it('includes a candidate one millisecond beyond ADJACENCY_DAYS from a warning-indicator anchor', () => {
    const warnedAt = daysAgo(100);
    const warned = baseEntry({ id: 'warned', createdAt: warnedAt, has_warning_indicators: true });
    const candidate = baseEntry({ id: 'edge-out', createdAt: warnedAt - ADJACENCY_DAYS * DAY_MS - 1 });
    const result = selectRevisitCandidate({ entries: [warned, candidate], now: NOW });
    expect(result?.id).toBe('edge-out');
  });

  it('an entry that is BOTH flagged and warned anchors adjacency only once (no double-counting bug)', () => {
    const anchorAt = daysAgo(100);
    const anchor = baseEntry({ id: 'anchor', createdAt: anchorAt, safety_flagged: true, has_warning_indicators: true });
    const nearby = baseEntry({ id: 'nearby', createdAt: anchorAt - 1 * DAY_MS });
    const result = selectRevisitCandidate({ entries: [anchor, nearby], now: NOW });
    expect(result).toBeNull();
  });
});

describe('selectRevisitCandidate — rule 4 (GR1: retuned to 0.6): mood floor', () => {
  it(`excludes an entry with mood_score below MOOD_FLOOR (${MOOD_FLOOR})`, () => {
    const low = baseEntry({ id: 'low-mood', analysis: { mood_score: MOOD_FLOOR - 0.01 } });
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

  it(`includes an entry with mood_score exactly at the ${MOOD_FLOOR} floor`, () => {
    const atFloor = baseEntry({ id: 'at-floor', analysis: { mood_score: MOOD_FLOOR } });
    const result = selectRevisitCandidate({ entries: [atFloor], now: NOW });
    expect(result?.id).toBe('at-floor');
  });

  it('GR1 regression guard: a mood_score of 0.5 (eligible under the OLD 0.4 floor) is now excluded under the retuned 0.6 floor', () => {
    const wasEligible = baseEntry({ id: 'old-floor-only', analysis: { mood_score: 0.5 } });
    expect(selectRevisitCandidate({ entries: [wasEligible], now: NOW })).toBeNull();
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

  it('dimension "date": excludes every entry created on the excluded UTC date (and, per the ±1-day tolerance below, its immediate UTC neighbors)', () => {
    const target = baseEntry({ id: 'excl-date', createdAt: Date.parse('2026-04-01T12:00:00.000Z') });
    // Minor 3+6 fix: the ±1-day tolerance means 2026-04-02 (exactly +1 day
    // from the excluded value) ALSO matches now — a fallback candidate must
    // sit outside the window (2026-04-05, +4 days) to survive.
    const fallback = baseEntry({ id: 'fallback', createdAt: Date.parse('2026-04-05T12:00:00.000Z') });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'date', value: '2026-04-01' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  describe('dimension "date" — ±1-day tolerance boundary (Minor 3+6, R2 final review)', () => {
    // matchesExclusion is exported and pure — exercise the boundary directly
    // rather than through the full selector, per the codebase's existing
    // "matchesExclusion — family dimension" precedent below.
    const excl = { dimension: 'date', value: '2026-04-01' };

    it('matches an entry created on the exact excluded UTC date (0 days)', () => {
      const ms = Date.parse('2026-04-01T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), excl, ms)).toBe(true);
    });

    it('matches an entry created exactly +1 day after the excluded UTC date', () => {
      const ms = Date.parse('2026-04-02T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), excl, ms)).toBe(true);
    });

    it('matches an entry created exactly -1 day before the excluded UTC date', () => {
      const ms = Date.parse('2026-03-31T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), excl, ms)).toBe(true);
    });

    it('does NOT match an entry created +2 days after the excluded UTC date', () => {
      const ms = Date.parse('2026-04-03T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), excl, ms)).toBe(false);
    });

    it('does NOT match an entry created -2 days before the excluded UTC date', () => {
      const ms = Date.parse('2026-03-30T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), excl, ms)).toBe(false);
    });

    it('falls back to an exact string match when the excluded value is malformed', () => {
      const ms = Date.parse('2026-04-01T09:00:00.000Z');
      expect(matchesExclusion(baseEntry({ createdAt: ms }), { dimension: 'date', value: 'not-a-date' }, ms)).toBe(false);
    });
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

// ---------------------------------------------------------------------------
// isExclusionActive — R2 review follow-up: "Less like this" (permanent:false
// + ~90-day expiresAt) was written by the client but never enforced by the
// selector, so it was silently permanent. Covered both directly and threaded
// through selectRevisitCandidate's rule 5.
// ---------------------------------------------------------------------------

describe('isExclusionActive', () => {
  it('an active non-permanent exclusion (expiresAt in the future) is active', () => {
    expect(isExclusionActive({ permanent: false, expiresAt: NOW + DAY_MS }, NOW)).toBe(true);
  });

  it('an expired non-permanent exclusion (expiresAt in the past) is NOT active', () => {
    expect(isExclusionActive({ permanent: false, expiresAt: NOW - DAY_MS }, NOW)).toBe(false);
  });

  it('a non-permanent exclusion with a malformed expiresAt fails closed (still active)', () => {
    expect(isExclusionActive({ permanent: false, expiresAt: 'not-a-date' }, NOW)).toBe(true);
  });

  it('a non-permanent exclusion with a missing expiresAt fails closed (still active)', () => {
    expect(isExclusionActive({ permanent: false }, NOW)).toBe(true);
  });

  it('a permanent exclusion is active regardless of expiresAt (ignored entirely)', () => {
    expect(isExclusionActive({ permanent: true, expiresAt: NOW - DAY_MS }, NOW)).toBe(true);
    expect(isExclusionActive({ permanent: true }, NOW)).toBe(true);
  });
});

describe('selectRevisitCandidate — rule 5 respects exclusion expiry (via isExclusionActive)', () => {
  it('an active (non-expired) "less like this" family exclusion still excludes', () => {
    const target = baseEntry({ id: 'excl-active', tags: ['breakup'] });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'family', value: 'breakup', permanent: false, expiresAt: NOW + 30 * DAY_MS }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('an expired "less like this" family exclusion no longer excludes', () => {
    const target = baseEntry({ id: 'excl-expired', tags: ['breakup'] });
    const result = selectRevisitCandidate({
      entries: [target],
      exclusions: [{ dimension: 'family', value: 'breakup', permanent: false, expiresAt: NOW - DAY_MS }],
      now: NOW,
    });
    expect(result?.id).toBe('excl-expired');
  });

  it('a "never show" (permanent:true) exclusion excludes forever, ignoring any expiresAt', () => {
    const target = baseEntry({ id: 'excl-permanent' });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'entry', value: 'excl-permanent', permanent: true, expiresAt: NOW - DAY_MS }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });

  it('a non-permanent exclusion with a malformed expiresAt still excludes (fails closed)', () => {
    const target = baseEntry({ id: 'excl-malformed', tags: ['grief'] });
    const fallback = baseEntry({ id: 'fallback' });
    const result = selectRevisitCandidate({
      entries: [target, fallback],
      exclusions: [{ dimension: 'family', value: 'grief', permanent: false, expiresAt: 'not-a-date' }],
      now: NOW,
    });
    expect(result?.id).toBe('fallback');
  });
});

// ---------------------------------------------------------------------------
// matchesExclusion / family dimension — production schema regression guard
// (R2 review: the widget must derive its "Less like this" value from
// EXACTLY the fields this function reads for `family`, i.e. top-level
// `entry.tags`/`entry.entities`, never `entry.analysis.themes` or
// `entry.analysis.entities`, which no real write path populates).
// ---------------------------------------------------------------------------

describe('matchesExclusion — family dimension reads top-level tags/entities only', () => {
  it('matches via top-level entry.tags (the field production analysis writes populate)', () => {
    expect(matchesExclusion(baseEntry({ tags: ['grief'] }), { dimension: 'family', value: 'grief' }, NOW)).toBe(true);
  });

  it('matches via top-level entry.entities id (preferred over name when both present)', () => {
    expect(matchesExclusion(
      baseEntry({ entities: [{ id: 'e1', name: 'old job' }] }),
      { dimension: 'family', value: 'e1' },
      NOW,
    )).toBe(true);
  });

  it('matches via top-level entry.entities name (fallback when no id)', () => {
    expect(matchesExclusion(
      baseEntry({ entities: [{ name: 'old job' }] }),
      { dimension: 'family', value: 'old job' },
      NOW,
    )).toBe(true);
  });

  it('does NOT match against entry.analysis.themes or entry.analysis.entities (never populated in production)', () => {
    const entry = baseEntry({ tags: [], entities: [], analysis: { mood_score: 0.7, themes: ['grief'], entities: [{ name: 'grief' }] } });
    expect(matchesExclusion(entry, { dimension: 'family', value: 'grief' }, NOW)).toBe(false);
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

describe(`selectRevisitCandidate — Round 2: anniversary blackout (${ANNIVERSARY_BLACKOUT_DAYS[0]}-${ANNIVERSARY_BLACKOUT_DAYS[1]} days, ±14 around 365)`, () => {
  it('ANNIVERSARY_BLACKOUT_DAYS is exactly [351, 379]', () => {
    expect(ANNIVERSARY_BLACKOUT_DAYS).toEqual([351, 379]);
  });

  it('excludes an entry exactly 351 days old (lower boundary, inclusive)', () => {
    const entry = baseEntry({ id: 'anniv-351', createdAt: daysAgo(351) });
    expect(selectRevisitCandidate({ entries: [entry], now: NOW })).toBeNull();
  });

  it('excludes an entry exactly 365 days old (the anniversary itself)', () => {
    const entry = baseEntry({ id: 'anniv-365', createdAt: daysAgo(365) });
    expect(selectRevisitCandidate({ entries: [entry], now: NOW })).toBeNull();
  });

  it('excludes an entry exactly 379 days old (upper boundary, inclusive)', () => {
    const entry = baseEntry({ id: 'anniv-379', createdAt: daysAgo(379) });
    expect(selectRevisitCandidate({ entries: [entry], now: NOW })).toBeNull();
  });

  it('includes an entry exactly 350 days old (one day short of the blackout)', () => {
    const entry = baseEntry({ id: 'anniv-350', createdAt: daysAgo(350) });
    expect(selectRevisitCandidate({ entries: [entry], now: NOW })?.id).toBe('anniv-350');
  });

  it('includes an entry exactly 380 days old (one day past the blackout)', () => {
    const entry = baseEntry({ id: 'anniv-380', createdAt: daysAgo(380) });
    expect(selectRevisitCandidate({ entries: [entry], now: NOW })?.id).toBe('anniv-380');
  });

  it('the blackout applies even to a maximally attractive "bait" entry (high mood, rich entities/tags) — proves this is a hard gate, not a scoring penalty', () => {
    const bait = baseEntry({
      id: 'anniv-bait',
      createdAt: daysAgo(365),
      tags: ['reunion', 'good-news'],
      entities: [{ id: 'p1', name: 'Sam', category: 'person' }],
      analysis: { mood_score: 0.95 },
    });
    const fallback = baseEntry({ id: 'fallback', createdAt: daysAgo(100), analysis: { mood_score: MOOD_FLOOR } });
    const result = selectRevisitCandidate({ entries: [bait, fallback], now: NOW });
    expect(result?.id).toBe('fallback');
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

describe('selectRevisitCandidate — 100% coverage of the stated exclusion rules', () => {
  it('never selects ANY entry from an adversarial fixture set covering every exclusion rule — including "bait" entries with maximally attractive scoring attributes', () => {
    // Every unsafe entry below is deliberately given rich entities/tags AND
    // high mood — the exact attributes the preference-scoring step favors
    // most — to prove exclusion is a hard gate that runs BEFORE scoring ever
    // sees these entries, not a soft penalty scoring could outweigh.
    const bait = { tags: ['reunion', 'good-news'], entities: [{ id: 'p1', name: 'Sam', category: 'person' }], analysis: { mood_score: 0.95 } };
    const flaggedAnchor = baseEntry({ id: 'anchor-flagged', createdAt: daysAgo(200), safety_flagged: true, ...bait });
    const adversarial = [
      flaggedAnchor,
      baseEntry({ id: 'unsafe-flagged', safety_flagged: true, createdAt: daysAgo(150), ...bait }),
      baseEntry({ id: 'unsafe-warned', has_warning_indicators: true, createdAt: daysAgo(120), ...bait }),
      baseEntry({ id: 'unsafe-adjacent-plus', createdAt: daysAgo(200) - ADJACENCY_DAYS * DAY_MS, ...bait }),
      baseEntry({ id: 'unsafe-adjacent-minus', createdAt: daysAgo(200) + ADJACENCY_DAYS * DAY_MS, ...bait }),
      baseEntry({ id: 'unsafe-low-mood', analysis: { mood_score: 0.1 }, createdAt: daysAgo(110), tags: bait.tags, entities: bait.entities }),
      baseEntry({ id: 'unsafe-missing-mood', analysis: {}, createdAt: daysAgo(115), tags: bait.tags, entities: bait.entities }),
      baseEntry({ id: 'unsafe-excluded-entry', createdAt: daysAgo(130), ...bait }),
      baseEntry({ id: 'unsafe-too-young', createdAt: daysAgo(5), ...bait }),
      baseEntry({ id: 'unsafe-too-old', createdAt: daysAgo(500), ...bait }),
      // GR1 addition: a legacy entry (non-boolean safety fields) with
      // otherwise-ideal bait attributes must also never be selected.
      { id: 'unsafe-legacy', createdAt: daysAgo(140), ...bait },
      // Round 2 addition: an entry sitting exactly at the anniversary
      // (day 365, deep inside the blackout window) with otherwise-ideal
      // bait attributes must also never be selected.
      baseEntry({ id: 'unsafe-anniversary', createdAt: daysAgo(365), ...bait }),
    ];
    const exclusions = [{ dimension: 'entry', value: 'unsafe-excluded-entry' }];

    // Run the full adversarial set with NO safe control present: must be null.
    const noneSafe = selectRevisitCandidate({ entries: adversarial, exclusions, now: NOW });
    expect(noneSafe).toBeNull();

    // Adding exactly one genuinely safe entry — deliberately LESS
    // "attractive" than the bait (no tags/entities, mood right at the
    // eligible-but-not-preferred MOOD_FLOOR, not PREFERRED_MOOD) — proves
    // the adversarial ones really were structurally filtered, not merely
    // outscored.
    const safeControl = baseEntry({ id: 'the-only-safe-one', createdAt: daysAgo(180), analysis: { mood_score: MOOD_FLOOR } });
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

  it('prefers a PREFERRED_MOOD-and-above entry over one that only clears the (lower) MOOD_FLOOR, all else equal', () => {
    const lower = baseEntry({ id: 'lower', analysis: { mood_score: 0.65 }, createdAt: daysAgo(100) });
    const higher = baseEntry({ id: 'higher', analysis: { mood_score: 0.75 }, createdAt: daysAgo(100) });
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
// GR1 pure helpers: currentStateGateTripped / sustainedLowMoodTripped
// (rule 7) and weeklyCadenceTripped (rule 9) — fixtures for each sub-rule,
// independent of the scheduled-job integration tests further below.
// ---------------------------------------------------------------------------

function scoredRecent(id, mood, daysBack) {
  return baseEntry({ id, createdAt: daysAgo(daysBack), analysis: { mood_score: mood } });
}

describe('currentStateGateTripped (rule 7)', () => {
  it('trips when ANY passed entry has safety_flagged true', () => {
    expect(currentStateGateTripped([baseEntry({ safety_flagged: true })])).toBe(true);
  });

  it('trips when ANY passed entry has has_warning_indicators true', () => {
    expect(currentStateGateTripped([baseEntry({ has_warning_indicators: true })])).toBe(true);
  });

  it('does not trip when entries are all clean and mood is unremarkable', () => {
    expect(currentStateGateTripped([baseEntry(), baseEntry({ analysis: { mood_score: 0.6 } })])).toBe(false);
  });

  it('does not trip on an empty/undefined entries list', () => {
    expect(currentStateGateTripped([])).toBe(false);
    expect(currentStateGateTripped(undefined)).toBe(false);
  });

  it('delegates the sustained-low-mood check (integration smoke test — full coverage below)', () => {
    const entries = [
      scoredRecent('m1', 0.1, 1), scoredRecent('m2', 0.1, 2), scoredRecent('m3', 0.1, 3),
    ];
    expect(currentStateGateTripped(entries)).toBe(true);
  });
});

describe(`sustainedLowMoodTripped (rule 7 sub-rule): last ${LOW_MOOD_LOOKBACK} mood-scored, >=${LOW_MOOD_MIN_SCORED} below ${LOW_MOOD_THRESHOLD}`, () => {
  it(`trips when exactly ${LOW_MOOD_MIN_SCORED} of the last ${LOW_MOOD_LOOKBACK} mood-scored entries are below the threshold (boundary)`, () => {
    const entries = [
      scoredRecent('a', 0.1, 1), scoredRecent('b', 0.1, 2), scoredRecent('c', 0.1, 3),
      scoredRecent('d', 0.8, 4), scoredRecent('e', 0.8, 5),
    ];
    expect(sustainedLowMoodTripped(entries)).toBe(true);
  });

  it(`does NOT trip with only ${LOW_MOOD_MIN_SCORED - 1} low-mood scored entries (one below the boundary)`, () => {
    const entries = [
      scoredRecent('a', 0.1, 1), scoredRecent('b', 0.1, 2),
      scoredRecent('c', 0.8, 3), scoredRecent('d', 0.8, 4), scoredRecent('e', 0.8, 5),
    ];
    expect(sustainedLowMoodTripped(entries)).toBe(false);
  });

  it(`fails OPEN with fewer than ${LOW_MOOD_MIN_SCORED} mood-scored entries at all, even if ALL of them are low (insufficient signal is not treated as vulnerable)`, () => {
    const entries = [scoredRecent('a', 0.05, 1), scoredRecent('b', 0.05, 2)];
    expect(sustainedLowMoodTripped(entries)).toBe(false);
  });

  it(`mood_score exactly at ${LOW_MOOD_THRESHOLD} does NOT count as low (boundary exclusive)`, () => {
    const entries = [
      scoredRecent('a', LOW_MOOD_THRESHOLD, 1), scoredRecent('b', LOW_MOOD_THRESHOLD, 2), scoredRecent('c', LOW_MOOD_THRESHOLD, 3),
    ];
    expect(sustainedLowMoodTripped(entries)).toBe(false);
  });

  it(`only considers the FIRST ${LOW_MOOD_LOOKBACK} mood-scored entries (newest-first input order), ignoring older scored entries beyond the lookback`, () => {
    // 7 healthy entries (newest-first) followed by 3 very old low-mood ones
    // that fall outside the lookback window entirely.
    const healthy = Array.from({ length: LOW_MOOD_LOOKBACK }, (_, i) => scoredRecent(`h${i}`, 0.9, i + 1));
    const oldLow = [scoredRecent('old1', 0.05, 20), scoredRecent('old2', 0.05, 21), scoredRecent('old3', 0.05, 22)];
    expect(sustainedLowMoodTripped([...healthy, ...oldLow])).toBe(false);
  });

  it('entries without a numeric mood_score are excluded from the mood-scored count entirely (neither help nor hurt)', () => {
    const entries = [
      scoredRecent('a', 0.1, 1), scoredRecent('b', 0.1, 2), scoredRecent('c', 0.1, 3),
      baseEntry({ id: 'unscored', createdAt: daysAgo(1), analysis: {} }),
    ];
    expect(sustainedLowMoodTripped(entries)).toBe(true); // the 3 scored low entries alone already trip it
  });
});

describe(`weeklyCadenceTripped (rule 9): live selection within ${WEEKLY_CADENCE_DAYS} days`, () => {
  it('trips for a "queued" item within the cadence window', () => {
    expect(weeklyCadenceTripped([{ status: 'queued', selectedAt: daysAgo(2) }], NOW)).toBe(true);
  });

  it('trips for a "shown" item within the cadence window', () => {
    expect(weeklyCadenceTripped([{ status: 'shown', selectedAt: daysAgo(2) }], NOW)).toBe(true);
  });

  it('does NOT trip for a queued item older than the 7-day cadence window', () => {
    expect(weeklyCadenceTripped([{ status: 'queued', selectedAt: daysAgo(WEEKLY_CADENCE_DAYS + 1) }], NOW)).toBe(false);
  });

  it(`trips at exactly ${WEEKLY_CADENCE_DAYS} days (boundary inclusive) for a queued/shown item`, () => {
    expect(weeklyCadenceTripped([{ status: 'queued', selectedAt: daysAgo(WEEKLY_CADENCE_DAYS) }], NOW)).toBe(true);
  });

  it('does not trip on an empty list', () => {
    expect(weeklyCadenceTripped([], NOW)).toBe(false);
  });

  it('ignores an item with an uncoercible selectedAt rather than throwing', () => {
    expect(weeklyCadenceTripped([{ status: 'queued', selectedAt: 'not-a-date' }], NOW)).toBe(false);
  });
});

describe(`weeklyCadenceTripped — Round 2 reversal: dismissal trips cadence too, at its own longer ${DISMISSED_CADENCE_DAYS}-day window (Michael's round-2 review)`, () => {
  it('DISMISSED_CADENCE_DAYS === 14 (2x WEEKLY_CADENCE_DAYS)', () => {
    expect(DISMISSED_CADENCE_DAYS).toBe(14);
    expect(DISMISSED_CADENCE_DAYS).toBe(WEEKLY_CADENCE_DAYS * 2);
  });

  it('a "dismissed" item 6 days ago trips the gate (skip today)', () => {
    expect(weeklyCadenceTripped([{ status: 'dismissed', selectedAt: daysAgo(6) }], NOW)).toBe(true);
  });

  it('a "dismissed" item 13 days ago still trips the gate', () => {
    expect(weeklyCadenceTripped([{ status: 'dismissed', selectedAt: daysAgo(13) }], NOW)).toBe(true);
  });

  it(`a "dismissed" item at exactly ${DISMISSED_CADENCE_DAYS} days trips (boundary inclusive)`, () => {
    expect(weeklyCadenceTripped([{ status: 'dismissed', selectedAt: daysAgo(DISMISSED_CADENCE_DAYS) }], NOW)).toBe(true);
  });

  it('a "dismissed" item 15 days ago does NOT trip the gate (past the 14-day dismissed cadence) — eligible', () => {
    expect(weeklyCadenceTripped([{ status: 'dismissed', selectedAt: daysAgo(15) }], NOW)).toBe(false);
  });

  it('a "shown" item 8 days ago does NOT trip the gate (the unchanged 7-day queued/shown cadence) — eligible', () => {
    expect(weeklyCadenceTripped([{ status: 'shown', selectedAt: daysAgo(8) }], NOW)).toBe(false);
  });

  // Anchor semantics (review follow-up): the dismissed block runs from the
  // DISMISSAL action (updatedAt, stamped by dismissRevisit), not from the
  // original selection — "a dismissal should count as an exposure", and the
  // exposure the user reacted to is the Not-now tap. selectedAt is only the
  // legacy fallback.
  it('dismissed anchors on updatedAt: selected 16d ago but dismissed 5d ago → still blocked (selectedAt anchor would wrongly free it)', () => {
    expect(weeklyCadenceTripped([
      { status: 'dismissed', selectedAt: daysAgo(16), updatedAt: daysAgo(5) },
    ], NOW)).toBe(true);
  });

  it('dismissed anchors on updatedAt: selected 20d ago, dismissed 15d ago → past the 14-day window either way — eligible', () => {
    expect(weeklyCadenceTripped([
      { status: 'dismissed', selectedAt: daysAgo(20), updatedAt: daysAgo(15) },
    ], NOW)).toBe(false);
  });

  it('legacy dismissed doc without a parseable updatedAt falls back to selectedAt (6d ago → blocked)', () => {
    expect(weeklyCadenceTripped([{ status: 'dismissed', selectedAt: daysAgo(6) }], NOW)).toBe(true);
    expect(weeklyCadenceTripped([
      { status: 'dismissed', selectedAt: daysAgo(6), updatedAt: 'not-a-date' },
    ], NOW)).toBe(true);
  });

  it('live (shown) items keep anchoring on selectedAt even when updatedAt is recent (selected 8d ago, updated 1d ago → eligible)', () => {
    expect(weeklyCadenceTripped([
      { status: 'shown', selectedAt: daysAgo(8), updatedAt: daysAgo(1) },
    ], NOW)).toBe(false);
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

function comparable(v) {
  if (v instanceof Date) return v.getTime();
  return v;
}

/**
 * A REAL (if minimal) query engine over a fixed array of `{id, data}` docs —
 * used only for the `entries` collection, where the tests below need
 * `.where()`/`.orderBy()`/`.limit()` to actually filter/sort/slice (unlike
 * `fakeQuery`, which just resolves a pre-baked snapshot regardless of the
 * chain). This is what lets the "far-edge flagged anchor gets sliced out of
 * the 200-cap but is still recovered by the dedicated anchor query" test
 * exercise the real bug this fixes, instead of asserting against a stub.
 */
function makeEntriesQuery(docs) {
  const wheres = [];
  let orderField = null;
  let orderDir = 'asc';
  let limitN = null;
  const q = {
    where: vi.fn((field, op, value) => { wheres.push([field, op, value]); return q; }),
    orderBy: vi.fn((field, dir) => { orderField = field; orderDir = dir || 'asc'; return q; }),
    limit: vi.fn((n) => { limitN = n; return q; }),
    get: vi.fn(async () => {
      let result = docs.filter((d) => wheres.every(([field, op, value]) => {
        const actual = comparable(d.data[field]);
        const expected = comparable(value);
        switch (op) {
          case '==': return actual === expected;
          case '>=': return actual >= expected;
          case '<=': return actual <= expected;
          default: return true;
        }
      }));
      if (orderField) {
        result = [...result].sort((a, b) => {
          const diff = comparable(a.data[orderField]) - comparable(b.data[orderField]);
          return orderDir === 'desc' ? -diff : diff;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);
      return fakeSnap(result);
    }),
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
  const docPathsRequested = [];

  const db = {
    doc: vi.fn((path) => {
      docPathsRequested.push(path);
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
        const q = makeEntriesQuery(entriesByUser[uid] || []);
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

  return { db, queueWrites, entriesQueryCalls, docStore, docPathsRequested };
}

const RUN_NOW = new Date('2026-07-21T15:00:00.000Z'); // 08:00 America/Los_Angeles

function eligibleEntryDoc(id, overrides = {}) {
  return {
    id,
    data: {
      createdAt: new Date(RUN_NOW.getTime() - 100 * DAY_MS),
      safety_flagged: false,
      has_warning_indicators: false,
      analysis: { mood_score: 0.8 },
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
    expect(result).toEqual({ processed: 0, selected: 0, skipped: 0, skippedCoverageUnknown: 0 });
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

  it('caps every entries-collection read: recent-window at 50, main candidate query at 200, flagged-anchor and warning-anchor backfills at 50 each', async () => {
    const { db, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });
    await runGentleRevisitDaily(db, { now: RUN_NOW });
    // Order: [0] GR1 current-state recent-window read, [1] main candidate
    // query, [2] flagged-anchor backfill, [3] warning-anchor backfill.
    expect(entriesQueryCalls).toHaveLength(4);
    expect(entriesQueryCalls[0].limit).toHaveBeenCalledWith(50);
    expect(entriesQueryCalls[0].where).not.toHaveBeenCalledWith('safety_flagged', '==', true);
    expect(entriesQueryCalls[1].limit).toHaveBeenCalledWith(200);
    expect(entriesQueryCalls[2].where).toHaveBeenCalledWith('safety_flagged', '==', true);
    expect(entriesQueryCalls[2].limit).toHaveBeenCalledWith(50);
    expect(entriesQueryCalls[3].where).toHaveBeenCalledWith('has_warning_indicators', '==', true);
    expect(entriesQueryCalls[3].limit).toHaveBeenCalledWith(50);
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
    expect(shared.entriesQueryCalls).toHaveLength(4); // recent-window + main + flagged + warning, only from the first (successful) run
  });

  it('claims the marker on a dedicated revisit_job_state doc, never on settings/revisitPrefs', async () => {
    const shared = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true, optInAt: '2026-01-01T00:00:00.000Z' } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
    });

    await runGentleRevisitDaily(shared.db, { now: RUN_NOW });

    expect(shared.docPathsRequested).toContain(`artifacts/${APP}/users/u1/revisit_job_state/state`);

    const jobStateDoc = shared.docStore.get(`artifacts/${APP}/users/u1/revisit_job_state/state`);
    expect(Object.keys(jobStateDoc.data)).toEqual(['selectedFor2026-07-21']);
    expect(jobStateDoc.data['selectedFor2026-07-21']).toBeTruthy();

    // The client-writable prefs doc must be untouched by the job — still
    // exactly what it was seeded with, no `selectedFor*`/`revisit` key added.
    const prefsDoc = shared.docStore.get(`artifacts/${APP}/users/u1/settings/revisitPrefs`);
    expect(prefsDoc.data).toEqual({ enabled: true, optInAt: '2026-01-01T00:00:00.000Z' });
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

describe('runGentleRevisitDaily — flagged-anchor backfill (200-cap edge case)', () => {
  it('a far-edge flagged entry sliced out of the 200-most-recent main query still vetoes its adjacent in-cap candidate', async () => {
    // 199 recent "filler" entries (ages 30-228 days) — all deliberately
    // unselectable (low mood) so they can never be the thing that gets
    // written, isolating the assertion to the candidate/flagged pair below.
    // They exist purely to push the flagged entry (age 242d) out of the
    // main query's `.orderBy('createdAt','desc').limit(200)` top-200 —
    // while the candidate (age 240d, 2 days newer) stays IN the top-200.
    const fillers = Array.from({ length: 199 }, (_, i) => eligibleEntryDoc(`filler-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - (30 + i) * DAY_MS),
      analysis: { mood_score: 0.1 }, // fails rule 4 — never selectable
    }));
    const candidate = eligibleEntryDoc('the-candidate', {
      createdAt: new Date(RUN_NOW.getTime() - 240 * DAY_MS),
      analysis: { mood_score: 0.8 },
      tags: ['calm'],
    });
    const flaggedFarEdge = eligibleEntryDoc('flagged-far-edge', {
      createdAt: new Date(RUN_NOW.getTime() - 242 * DAY_MS), // 2 days from candidate, within ADJACENCY_DAYS
      safety_flagged: true,
    });

    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [...fillers, candidate, flaggedFarEdge] },
    });

    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });

    // Sanity-check the premise (re-querying the recorded main-query object,
    // whose where/orderBy/limit chain is unchanged by re-invoking `.get()`):
    // the main (capped) query alone must NOT contain the flagged entry, but
    // MUST contain the candidate — otherwise this test isn't actually
    // exercising the 200-cap edge case. entriesQueryCalls[1] is the main
    // candidate query (index [0] is the GR1 current-state recent-window read).
    const mainQuerySnap = await entriesQueryCalls[1].get();
    const mainIds = [];
    mainQuerySnap.forEach((d) => mainIds.push(d.id));
    expect(mainIds).toContain('the-candidate');
    expect(mainIds).not.toContain('flagged-far-edge');

    // Without the anchor backfill, 'the-candidate' would incorrectly win
    // (highest mood/content score, no visible flagged neighbor). With it,
    // the flagged entry is recovered via the anchor query and vetoes it.
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });
});

describe('runGentleRevisitDaily — warning-indicator anchor backfill (GR1 rule 3b, 200-cap edge case)', () => {
  it('a far-edge warning-indicator entry sliced out of the 200-most-recent main query still vetoes its adjacent in-cap candidate', async () => {
    const fillers = Array.from({ length: 199 }, (_, i) => eligibleEntryDoc(`filler-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - (30 + i) * DAY_MS),
      analysis: { mood_score: 0.1 },
    }));
    const candidate = eligibleEntryDoc('the-candidate', {
      createdAt: new Date(RUN_NOW.getTime() - 240 * DAY_MS),
      analysis: { mood_score: 0.8 },
      tags: ['calm'],
    });
    const warnedFarEdge = eligibleEntryDoc('warned-far-edge', {
      createdAt: new Date(RUN_NOW.getTime() - 242 * DAY_MS),
      has_warning_indicators: true,
    });

    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [...fillers, candidate, warnedFarEdge] },
    });

    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });

    const mainQuerySnap = await entriesQueryCalls[1].get();
    const mainIds = [];
    mainQuerySnap.forEach((d) => mainIds.push(d.id));
    expect(mainIds).toContain('the-candidate');
    expect(mainIds).not.toContain('warned-far-edge');

    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });
});

describe('runGentleRevisitDaily — legacy entries fail closed (GR1 rule 0/8)', () => {
  it('a legacy entry (no explicit safety fields) with crisis-keyword text is re-screened and never selected', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [eligibleEntryDoc('legacy-crisis', {
          safety_flagged: undefined,
          has_warning_indicators: undefined,
          text: 'I want to end my life and there is no reason to live anymore.',
        })],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('a legacy entry with clean text and no explicit fields IS selectable (re-screen is not "never select anything legacy")', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [eligibleEntryDoc('legacy-clean', {
          safety_flagged: undefined,
          has_warning_indicators: undefined,
          text: 'A quiet, uneventful afternoon at the park.',
        })],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
    expect(queueWrites[0].data.entryId).toBe('legacy-clean');
  });

  it('a legacy entry with missing/empty text is excluded — no re-screen possible, fails closed', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [eligibleEntryDoc('legacy-no-text', {
          safety_flagged: undefined,
          has_warning_indicators: undefined,
          text: undefined,
        })],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('regression guard: an already-explicit-true safety_flagged is NEVER cleared by re-screening the other (legacy) field against clean text', async () => {
    // safety_flagged is explicitly true (e.g. set by something other than
    // plain keyword matching); has_warning_indicators is legacy/missing;
    // the entry's OWN text is clean. A "both-or-neither" re-screen bug would
    // re-derive BOTH fields from the clean text and incorrectly clear the
    // known-true safety_flagged, making this entry wrongly selectable.
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [eligibleEntryDoc('partial-legacy', {
          safety_flagged: true,
          has_warning_indicators: undefined,
          text: 'A perfectly calm and uneventful day.',
        })],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });
});

describe('runGentleRevisitDaily — current-state gate (GR1 rule 7)', () => {
  it('skips selection entirely today when a recent (within 14 days) entry has safety_flagged true, even though an old candidate would otherwise qualify', async () => {
    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [
          eligibleEntryDoc('old-candidate'),
          eligibleEntryDoc('recent-flagged', { createdAt: new Date(RUN_NOW.getTime() - 2 * DAY_MS), safety_flagged: true }),
        ],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
    // Gated before the padded/anchor reads: only the recent-window query ran.
    expect(entriesQueryCalls).toHaveLength(1);
  });

  it('skips selection entirely today when a recent entry has has_warning_indicators true', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: {
        u1: [
          eligibleEntryDoc('old-candidate'),
          eligibleEntryDoc('recent-warned', { createdAt: new Date(RUN_NOW.getTime() - 2 * DAY_MS), has_warning_indicators: true }),
        ],
      },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('skips selection entirely today on sustained low mood among the last 7 mood-scored recent entries', async () => {
    const recentLow = Array.from({ length: 3 }, (_, i) => eligibleEntryDoc(`recent-low-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - (1 + i) * DAY_MS),
      analysis: { mood_score: 0.1 },
    }));
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('old-candidate'), ...recentLow] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('does NOT skip when fewer than 3 recent entries are mood-scored (fail-open) — the old candidate still gets selected', async () => {
    const recentLow = Array.from({ length: 2 }, (_, i) => eligibleEntryDoc(`recent-low-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - (1 + i) * DAY_MS),
      analysis: { mood_score: 0.1 },
    }));
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('old-candidate'), ...recentLow] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
    expect(queueWrites[0].data.entryId).toBe('old-candidate');
  });

  it('a low-mood entry older than the 14-day recent window does not trip the gate', async () => {
    const oldLow = Array.from({ length: 3 }, (_, i) => eligibleEntryDoc(`old-low-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - (RECENT_WINDOW_DAYS + 1 + i) * DAY_MS),
      analysis: { mood_score: 0.1 },
    }));
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('old-candidate'), ...oldLow] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
  });
});

describe('runGentleRevisitDaily — weekly cadence (GR1 rule 9)', () => {
  it('skips selection when a "queued" revisit_queue doc exists with selectedAt within the last 7 days, without reading any entries', async () => {
    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
      queueByUser: { u1: [{ id: 'q1', data: { status: 'queued', selectedAt: new Date(RUN_NOW.getTime() - 2 * DAY_MS) } }] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
    expect(entriesQueryCalls).toHaveLength(0); // gated before ANY entries read
  });

  it('skips selection when a "shown" revisit_queue doc exists within the last 7 days', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
      queueByUser: { u1: [{ id: 'q1', data: { status: 'shown', selectedAt: new Date(RUN_NOW.getTime() - 5 * DAY_MS) } }] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('Round 2 reversal: a "dismissed" doc within the last 14 days now DOES skip selection (dismissal is an exposure, longer cadence)', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
      queueByUser: { u1: [{ id: 'q1', data: { status: 'dismissed', selectedAt: new Date(RUN_NOW.getTime() - 2 * DAY_MS) } }] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(0);
    expect(queueWrites).toHaveLength(0);
  });

  it('a "dismissed" doc 15 days ago (past the 14-day dismissed cadence) does NOT skip selection', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
      queueByUser: { u1: [{ id: 'q1', data: { status: 'dismissed', selectedAt: new Date(RUN_NOW.getTime() - 15 * DAY_MS) } }] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
    expect(queueWrites[0].data.entryId).toBe('entry-1');
  });

  it('does NOT skip when the queued doc is older than 7 days', async () => {
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [eligibleEntryDoc('entry-1')] },
      queueByUser: { u1: [{ id: 'q1', data: { status: 'queued', selectedAt: new Date(RUN_NOW.getTime() - 8 * DAY_MS) } }] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
  });
});

describe('runGentleRevisitDaily — Round 2: at-cap reads treat safety coverage as unknown and skip (Michael\'s round-2 review)', () => {
  it('recent-window read at cap (50) → skip today, counted in skippedCoverageUnknown, no further entries reads', async () => {
    const recentDocs = Array.from({ length: 50 }, (_, i) => eligibleEntryDoc(`recent-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - 1 * DAY_MS),
    }));
    const oldCandidate = eligibleEntryDoc('old-candidate'); // would otherwise be selected
    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [...recentDocs, oldCandidate] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.processed).toBe(1);
    expect(result.selected).toBe(0);
    expect(result.skippedCoverageUnknown).toBe(1);
    expect(queueWrites).toHaveLength(0);
    expect(entriesQueryCalls).toHaveLength(1); // gated before the padded/anchor reads
  });

  it('main candidate read at cap (200) → skip today, counted in skippedCoverageUnknown', async () => {
    const fillers = Array.from({ length: 200 }, (_, i) => eligibleEntryDoc(`filler-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - 200 * DAY_MS),
    }));
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: fillers },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(result.skippedCoverageUnknown).toBe(1);
    expect(queueWrites).toHaveLength(0);
  });

  it('flagged-anchor backfill read at cap (50) → skip today, counted in skippedCoverageUnknown', async () => {
    const flaggedDocs = Array.from({ length: 50 }, (_, i) => eligibleEntryDoc(`flagged-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - 200 * DAY_MS),
      safety_flagged: true,
    }));
    const oldCandidate = eligibleEntryDoc('old-candidate', { createdAt: new Date(RUN_NOW.getTime() - 50 * DAY_MS) });
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [...flaggedDocs, oldCandidate] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(result.skippedCoverageUnknown).toBe(1);
    expect(queueWrites).toHaveLength(0);
  });

  it('warning-indicator anchor backfill read at cap (50) → skip today, counted in skippedCoverageUnknown', async () => {
    const warnedDocs = Array.from({ length: 50 }, (_, i) => eligibleEntryDoc(`warned-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - 200 * DAY_MS),
      has_warning_indicators: true,
    }));
    const oldCandidate = eligibleEntryDoc('old-candidate', { createdAt: new Date(RUN_NOW.getTime() - 50 * DAY_MS) });
    const { db, queueWrites } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: [...warnedDocs, oldCandidate] },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(0);
    expect(result.skippedCoverageUnknown).toBe(1);
    expect(queueWrites).toHaveLength(0);
  });

  it('one entry under every cap (199/49/49/49) proceeds normally — the at-cap check does not false-positive one below the limit', async () => {
    const fillers = Array.from({ length: 199 }, (_, i) => eligibleEntryDoc(`filler-${i}`, {
      createdAt: new Date(RUN_NOW.getTime() - 200 * DAY_MS),
    }));
    const { db, queueWrites, entriesQueryCalls } = buildFakeDb({
      userIds: ['u1'],
      prefsByUser: { u1: { enabled: true } },
      entriesByUser: { u1: fillers },
    });
    const result = await runGentleRevisitDaily(db, { now: RUN_NOW });
    expect(result.selected).toBe(1);
    expect(result.skippedCoverageUnknown).toBe(0);
    expect(queueWrites).toHaveLength(1);
    const mainSnap = await entriesQueryCalls[1].get();
    expect(mainSnap.size).toBe(199);
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
