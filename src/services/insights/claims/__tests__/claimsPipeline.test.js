import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

const store = new Map(); // docPath -> data

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  doc: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  getDoc: vi.fn(async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) })),
  getDocs: vi.fn(async (colRef) => {
    const docs = [...store.entries()]
      .filter(([path]) => path.startsWith(`${colRef.path}/`))
      .map(([path, data]) => ({ id: path.slice(colRef.path.length + 1), data: () => data }));
    return { docs };
  }),
  setDoc: vi.fn(async (ref, data) => { store.set(ref.path, data); }),
  updateDoc: vi.fn(async (ref, patch) => {
    if (!store.has(ref.path)) throw new Error(`no doc at ${ref.path}`);
    store.set(ref.path, { ...store.get(ref.path), ...patch });
  }),
  writeBatch: vi.fn((db) => {
    const ops = [];
    return {
      set: (ref, data) => ops.push(() => store.set(ref.path, data)),
      update: (ref, patch) => ops.push(() => {
        if (!store.has(ref.path)) throw new Error(`no doc at ${ref.path}`);
        store.set(ref.path, { ...store.get(ref.path), ...patch });
      }),
      commit: vi.fn(async () => { ops.forEach((fn) => fn()); }),
    };
  }),
  runTransaction: vi.fn(async (db, fn) => fn({
    get: async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
    set: (ref, data) => store.set(ref.path, data),
  })),
}));

// Order-of-operations spies: keep the real implementations (map-backed
// mocks above still back them), but record invocation order/args so the
// "register everything before analyzing anything" and "plans are frozen
// with the POST-registration count" invariants are provable, not assumed.
const callOrder = [];
vi.mock('../../testingLedger', async () => {
  const actual = await vi.importActual('../../testingLedger');
  return {
    ...actual,
    registerCandidates: vi.fn(async (...args) => {
      const result = await actual.registerCandidates(...args);
      callOrder.push({
        op: 'register', familyId: args[2], candidateIds: [...args[3]], testedCount: result.testedCount,
      });
      return result;
    }),
  };
});
vi.mock('../evidenceBuilder', async () => {
  const actual = await vi.importActual('../evidenceBuilder');
  return {
    ...actual,
    freezeCandidatePlan: vi.fn((args) => {
      callOrder.push({
        op: 'freeze', familyId: args.familyId, candidateId: args.candidateId, candidateTestsCount: args.candidateTestsCount,
      });
      return actual.freezeCandidatePlan(args);
    }),
  };
});

// Vanished-candidate retraction sweep (Task 9 re-review gap fix): spy on
// setClaimStatus (keeping the real implementation, backed by the map-store
// mocks above) so tests can prove "at most once per claim id in a mixed
// run" — a fact plain end-state assertions on `store` can't distinguish
// from "called twice, second call was a no-op".
const setClaimStatusCalls = [];
vi.mock('../claimsService', async () => {
  const actual = await vi.importActual('../claimsService');
  return {
    ...actual,
    setClaimStatus: vi.fn(async (...args) => {
      setClaimStatusCalls.push(args[2]); // claimId
      return actual.setClaimStatus(...args);
    }),
  };
});

// Adjacent gap fix (R4 Phase 1 Task 9 review): generateClaims must read
// source_exclusions and drop excluded entries before analysis. Mocked
// directly (rather than routed through the Firestore-mock `store` above)
// because `sourceExclusions.js` imports its Firestore primitives from
// `../../config/firebase` (the app's Firebase bootstrap module), not from
// `firebase/firestore` directly — importing the real module here would pull
// in Firebase app initialization this test suite has no need for.
const listSourceExclusionsMock = vi.fn(async () => []);
vi.mock('../../sourceExclusions', () => ({
  listSourceExclusions: (...args) => listSourceExclusionsMock(...args),
}));

const { generateClaims } = await import('../claimsPipeline');
const { registerCandidates } = await import('../../testingLedger');
const { freezeCandidatePlan } = await import('../evidenceBuilder');
const { readLedgerCounts, familyIdForBasic } = await import('../../testingLedger');
const { claimDocId } = await import('../claimSchema');
const { setClaimStatus, writeClaim } = await import('../claimsService');

beforeEach(() => {
  store.clear();
  callOrder.length = 0;
  setClaimStatusCalls.length = 0;
  registerCandidates.mockClear();
  freezeCandidatePlan.mockClear();
  setClaimStatus.mockClear();
  listSourceExclusionsMock.mockClear();
  listSourceExclusionsMock.mockImplementation(async () => []);
});

const NOW = '2026-07-22T10:00:00.000Z';
const UID = 'u1';
const DB = {};

// Fixture builders mirror evidenceBuilder.test.js's STRONG-set precedent
// (single entry per day; day-based gate-6 reconciliation coincides with the
// entry-based one). `extraTag` lets one test add a second, weak candidate
// exposure without disturbing the gym signal.
function fixtures(days) {
  return days.map((x, i) => {
    const tags = [];
    if (x.gym) tags.push('gym');
    if (x.extraTag) tags.push(x.extraTag);
    return {
      id: `e${i}`, createdAt: `${x.d}T12:00:00Z`, text: `entry ${i} text`,
      analysis: { mood_score: x.mood }, tags,
      safety_flagged: x.sensitive === true,
    };
  });
}
const mk = (n, startDay, month, gym, mood) => Array.from({ length: n }, (_, i) => ({
  d: `2026-${month}-${String(startDay + i).padStart(2, '0')}`, gym, mood,
}));
// 40 days spanning >3 weeks: 16 gym days mood 0.72, 24 non-gym mood 0.55.
const STRONG = [...mk(16, 1, '06', true, 0.72), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)];
// 10 more gym days at LOW mood (July 11-20): meaningfully shrinks the gym
// effect (different exposedDayCount and effectMoodPoints), driving supersede.
const CONTRADICTING = mk(10, 11, '07', true, 0.55);

function ledgerPath(familyId) {
  return `artifacts/echo-vault-v5-fresh/users/${UID}/testing_ledger/${familyId.replace(/\//g, '__')}`;
}
function claimsPrefix() {
  return `artifacts/echo-vault-v5-fresh/users/${UID}/insight_claims/`;
}
function allClaimDocs() {
  return [...store.entries()].filter(([path]) => path.startsWith(claimsPrefix())).map(([, data]) => data);
}

describe('generateClaims — pipeline order (count-before-analyze)', () => {
  it('registers every candidate before analyzing any (ONE call per engine family), and freezes plans with the post-registration family count', async () => {
    const days = STRONG.map((d, i) => (i < 3 ? { ...d, extraTag: 'call' } : d));
    await generateClaims(DB, UID, fixtures(days), { timeZone: 'UTC', now: NOW });

    const registerOps = callOrder.filter((c) => c.op === 'register');
    const freezeOps = callOrder.filter((c) => c.op === 'freeze');
    // tag:gym and tag:call both belong to the 'activity' engine family, so
    // they are registered together in ONE registerCandidates call.
    expect(registerOps).toHaveLength(1);
    expect(registerOps[0].candidateIds.sort()).toEqual(['tag:call', 'tag:gym']);
    expect(freezeOps.map((f) => f.candidateId).sort()).toEqual(['tag:call', 'tag:gym']);

    // Count-before-analyze: the LAST register call happens before the
    // FIRST freeze call — analysis never starts on a partially-registered
    // batch.
    const lastRegisterIndex = callOrder.map((c) => c.op).lastIndexOf('register');
    const firstFreezeIndex = callOrder.map((c) => c.op).indexOf('freeze');
    expect(lastRegisterIndex).toBeLessThan(firstFreezeIndex);

    // Each freeze call's candidateTestsCount is exactly the testedCount its
    // own family's registerCandidates call returned (captured
    // post-registration, not re-derived from a separate/stale read) —
    // and, since both candidates share one family, both freezes get the
    // SAME pooled count.
    for (const freeze of freezeOps) {
      const matchingRegister = registerOps.find((r) => r.familyId === freeze.familyId);
      expect(freeze.candidateTestsCount).toBe(matchingRegister.testedCount);
    }
    expect(freezeOps.every((f) => f.candidateTestsCount === 2)).toBe(true);
  });
});

describe('generateClaims — strong candidate, mixed eligibility', () => {
  it('a strong candidate ends as ONE verified claim doc; ALL enumerated candidates pool into ONE engine-level family doc even though only one is eligible; every frozen plan (including the eligible one) carries the family-pooled candidateTestsCount/ciLevel — this IS the multiple-testing correction the defect defeated', async () => {
    // 3 tag specs enumerated within the SAME 'activity' engine: tag:gym
    // (16 present days, clears every gate), tag:call and tag:book (3
    // present days each — enumerated, ledgered, but too few days to be
    // eligible). Before this fix, each would have formed its OWN
    // singleton family (m=1, ciLevel=0.95, correction never applies).
    const days = STRONG.map((d, i) => {
      if (i < 3) return { ...d, extraTag: 'call' };
      if (i >= 3 && i < 6) return { ...d, extraTag: 'book' };
      return d;
    });
    const result = await generateClaims(DB, UID, fixtures(days), { timeZone: 'UTC', now: NOW });

    expect(result.candidatesTested).toBe(3); // tag:gym + tag:call + tag:book
    expect(result.eligible).toBe(1); // only tag:gym clears the gates
    expect(result.written).toBe(1);
    expect(result.superseded).toBe(0);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe('verified');
    expect(claims[0].analysisPlan.candidateId).toBe('tag:gym');
    // The point of the fix: the eligible candidate's frozen plan carries
    // the FAMILY's pooled count (3), not its own singleton count (1).
    expect(claims[0].analysisPlan.candidateTestsCount).toBe(3);
    expect(claims[0].analysisPlan.ciLevel).toBeCloseTo(1 - 0.05 / 3);
    expect(claims[0].id).toBe(claimDocId({
      familyId: familyIdForBasic('activity'), candidateId: 'tag:gym', version: 1,
    }));

    // All three candidates pool into ONE engine-level family doc — not
    // three single-member families.
    const activityFamily = familyIdForBasic('activity');
    const counts = await readLedgerCounts(DB, UID, [activityFamily]);
    expect(counts.get(activityFamily)).toBe(3);
    expect(store.has(ledgerPath(activityFamily))).toBe(true);
    const ledgerDoc = store.get(ledgerPath(activityFamily));
    expect(Object.keys(ledgerDoc.candidates).sort()).toEqual(['tag:book', 'tag:call', 'tag:gym']);
  });
});

describe('generateClaims — dedup and supersede', () => {
  it('an identical rerun writes nothing new (dedup via evidenceEquivalent)', async () => {
    const entries = fixtures(STRONG);
    const first = await generateClaims(DB, UID, entries, { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);

    const second = await generateClaims(DB, UID, entries, { timeZone: 'UTC', now: NOW });
    expect(second.written).toBe(0);
    expect(second.superseded).toBe(0);
    expect(second.eligible).toBe(1);
    expect(allClaimDocs()).toHaveLength(1);
  });

  it('meaningfully changed evidence supersedes: old gains supersededByClaimId, new is version 2 with parentClaimId, BOTH docs remain', async () => {
    const first = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);
    const before = allClaimDocs();
    expect(before).toHaveLength(1);
    const oldId = before[0].id;

    const laterNow = '2026-07-30T10:00:00.000Z';
    const changedDays = [...STRONG, ...CONTRADICTING];
    const second = await generateClaims(DB, UID, fixtures(changedDays), { timeZone: 'UTC', now: laterNow });

    expect(second.written).toBe(1);
    expect(second.superseded).toBe(1);

    const after = allClaimDocs();
    expect(after).toHaveLength(2); // never overwrite — both versions persist
    const oldDoc = after.find((c) => c.id === oldId);
    const newDoc = after.find((c) => c.id !== oldId);
    expect(oldDoc).toBeTruthy();
    expect(newDoc).toBeTruthy();
    expect(oldDoc.supersededByClaimId).toBe(newDoc.id);
    expect(newDoc.version).toBe(2);
    expect(newDoc.parentClaimId).toBe(oldId);
    expect(newDoc.supersededByClaimId).toBeNull();
  });
});

// A live prior whose candidate stops clearing the gates on rerun — e.g. new
// data weakens the effect below the practical floor. Same day/span structure
// as STRONG (so only gate 5 fails) but gym-day mood dropped from 0.72 to
// 0.58: delta ~3 points < the 5-point floor. Proven ineligible with
// below_practical_floor in evidenceBuilder.test.js's identical fixture.
const WEAK = [...mk(16, 1, '06', true, 0.58), ...mk(14, 17, '06', false, 0.55), ...mk(10, 1, '07', false, 0.55)];

describe('generateClaims — retraction (ineligible candidate vs. live prior)', () => {
  it('(a) ineligible candidate with a live VERIFIED prior: prior is expired, no new claim written, stats.expired === 1', async () => {
    const first = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);
    const priorId = allClaimDocs()[0].id;

    const laterNow = '2026-07-30T10:00:00.000Z';
    const second = await generateClaims(DB, UID, fixtures(WEAK), { timeZone: 'UTC', now: laterNow });

    expect(second.eligible).toBe(0);
    expect(second.written).toBe(0);
    expect(second.superseded).toBe(0);
    expect(second.expired).toBe(1);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(1); // no new claim written
    const prior = claims.find((c) => c.id === priorId);
    expect(prior.status).toBe('expired');
    expect(prior.supersededByClaimId).toBeNull();
    expect(prior.updatedAt).toBe(laterNow);
  });

  it('(b) ineligible candidate with a live SUPPRESSED prior is left untouched (user suppression sticks)', async () => {
    await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    const priorId = allClaimDocs()[0].id;
    await setClaimStatus(DB, UID, priorId, 'suppressed', { now: '2026-07-23T00:00:00.000Z' });

    const laterNow = '2026-07-30T10:00:00.000Z';
    const second = await generateClaims(DB, UID, fixtures(WEAK), { timeZone: 'UTC', now: laterNow });

    expect(second.expired).toBe(0);
    const prior = allClaimDocs().find((c) => c.id === priorId);
    expect(prior.status).toBe('suppressed');
    expect(prior.updatedAt).toBe('2026-07-23T00:00:00.000Z'); // no status call touched it
  });

  it('(c) ineligible candidate with NO prior claim does nothing (current behavior)', async () => {
    const result = await generateClaims(DB, UID, fixtures(WEAK), { timeZone: 'UTC', now: NOW });
    expect(result.eligible).toBe(0);
    expect(result.written).toBe(0);
    expect(result.expired).toBe(0);
    expect(allClaimDocs()).toHaveLength(0);
  });

  it('(d) revival: v1 verified -> v1 expired (ineligible rerun) -> v2 verified supersedes v1 (evidence re-strengthens); v1 keeps status expired + gains supersededByClaimId, both docs exist', async () => {
    const runA = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(runA.written).toBe(1);
    const v1Id = allClaimDocs()[0].id;

    const runB = await generateClaims(DB, UID, fixtures(WEAK), { timeZone: 'UTC', now: '2026-07-25T00:00:00.000Z' });
    expect(runB.expired).toBe(1);
    expect(allClaimDocs().find((c) => c.id === v1Id).status).toBe('expired');

    // liveByCandidate only filters supersededByClaimId==null — an expired
    // (not superseded) claim is still found as `prior` here, so re-strengthened
    // evidence takes the normal supersede path.
    const changedDays = [...STRONG, ...CONTRADICTING];
    const runC = await generateClaims(DB, UID, fixtures(changedDays), { timeZone: 'UTC', now: '2026-08-01T00:00:00.000Z' });
    expect(runC.eligible).toBe(1);
    expect(runC.written).toBe(1);
    expect(runC.superseded).toBe(1);
    expect(runC.expired).toBe(0);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(2); // both versions persist
    const v1 = claims.find((c) => c.id === v1Id);
    const v2 = claims.find((c) => c.id !== v1Id);
    expect(v1.status).toBe('expired'); // supersedeClaim never touches status
    expect(v1.supersededByClaimId).toBe(v2.id);
    expect(v2.version).toBe(2);
    expect(v2.parentClaimId).toBe(v1Id);
    expect(v2.status).toBe('verified');
    expect(v2.supersededByClaimId).toBeNull();
  });
});

describe('generateClaims — suppressed prior durability (eligible/supersede branch)', () => {
  it('a suppressed prior is left untouched even when its still-eligible candidate\'s evidence drifts (>0.5 mood-point delta) — no new claim, no supersede, status/updatedAt unchanged; lifting suppression re-enables normal supersede on the next run', async () => {
    // Run A: v1 written verified.
    const first = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);
    const priorId = allClaimDocs()[0].id;

    // User suppresses it ("Don't analyze this topic").
    const suppressedAt = '2026-07-23T00:00:00.000Z';
    await setClaimStatus(DB, UID, priorId, 'suppressed', { now: suppressedAt });

    // Run B: evidence drifts (CONTRADICTING shrinks the gym effect by more
    // than 0.5 mood points — the exact fixture claimsPipeline.test.js's own
    // "meaningfully changed evidence supersedes" test proves triggers the
    // supersede path) but the candidate STAYS eligible. Before the fix, this
    // silently un-suppresses: the old doc gains supersededByClaimId and a
    // new status:'verified' claim is written.
    const laterNow = '2026-07-30T10:00:00.000Z';
    const changedDays = [...STRONG, ...CONTRADICTING];
    const second = await generateClaims(DB, UID, fixtures(changedDays), { timeZone: 'UTC', now: laterNow });

    expect(second.eligible).toBe(1); // still analyzed as eligible...
    expect(second.written).toBe(0); // ...but nothing written
    expect(second.superseded).toBe(0);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(1); // no new claim doc
    const prior = claims.find((c) => c.id === priorId);
    expect(prior.status).toBe('suppressed'); // untouched
    expect(prior.supersededByClaimId).toBeNull(); // never superseded
    expect(prior.updatedAt).toBe(suppressedAt); // no write touched it at all

    // Lift: explicit user action flips it back to verified.
    const liftedAt = '2026-07-31T00:00:00.000Z';
    await setClaimStatus(DB, UID, priorId, 'verified', { now: liftedAt });

    // Run C: same drifted evidence, prior now verified again -> normal
    // supersede occurs. Proves the skip above is status-gated, not a
    // permanent hole for this candidate.
    const third = await generateClaims(DB, UID, fixtures(changedDays), { timeZone: 'UTC', now: '2026-08-01T00:00:00.000Z' });
    expect(third.eligible).toBe(1);
    expect(third.written).toBe(1);
    expect(third.superseded).toBe(1);

    const after = allClaimDocs();
    expect(after).toHaveLength(2);
    const oldDoc = after.find((c) => c.id === priorId);
    const newDoc = after.find((c) => c.id !== priorId);
    expect(oldDoc.supersededByClaimId).toBe(newDoc.id);
    expect(newDoc.version).toBe(2);
    expect(newDoc.parentClaimId).toBe(priorId);
    expect(newDoc.status).toBe('verified');
  });
});

describe('generateClaims — two-engine fixture (tag + health) in one run', () => {
  it('registers ONE call per engine family and freezes each candidate with its own family testedCount', async () => {
    // First 5 days also carry health.sleep data, clearing the health
    // engine's minHealthDays=5 floor, alongside STRONG's tag:gym exposure.
    const entries = fixtures(STRONG).map((e, i) => (
      i < 5 ? { ...e, healthContext: { sleep: { totalHours: 7 + (i % 2) } } } : e
    ));
    await generateClaims(DB, UID, entries, { timeZone: 'UTC', now: NOW });

    const registerOps = callOrder.filter((c) => c.op === 'register');
    const activityFamily = familyIdForBasic('activity');
    const healthFamily = familyIdForBasic('health');
    expect(registerOps).toHaveLength(2); // one registerCandidates call PER family
    expect(registerOps.map((r) => r.familyId).sort()).toEqual([activityFamily, healthFamily].sort());

    const freezeOps = callOrder.filter((c) => c.op === 'freeze');
    expect(freezeOps.some((f) => f.familyId === activityFamily && f.candidateId === 'tag:gym')).toBe(true);
    expect(freezeOps.some((f) => f.familyId === healthFamily && f.candidateId === 'health:sleepHours')).toBe(true);
    for (const freeze of freezeOps) {
      const matchingRegister = registerOps.find((r) => r.familyId === freeze.familyId);
      expect(freeze.candidateTestsCount).toBe(matchingRegister.testedCount);
    }
  });
});

describe('generateClaims — source_exclusions (adjacent gap fix)', () => {
  it("an entry excluded appliesTo:'all' is dropped from analysis — absent from the written claim's sourceEntryIds", async () => {
    const baseline = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(baseline.written).toBe(1);
    // Confirm the baseline (un-excluded) run actually cites e0, so the
    // exclusion test below is proving something, not vacuously true.
    expect(allClaimDocs()[0].evidence.sourceEntryIds).toContain('e0');
    store.clear();

    listSourceExclusionsMock.mockImplementation(async () => [
      { entryId: 'e0', appliesTo: 'all', reason: 'excluded_by_user' },
    ]);
    const result = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(result.written).toBe(1);
    expect(allClaimDocs()[0].evidence.sourceEntryIds).not.toContain('e0');
  });

  it("an entry excluded appliesTo:'basic:activity:mood' (family-scoped, as claimFeedback's wrong_source writes) is ALSO dropped, whole-run", async () => {
    listSourceExclusionsMock.mockImplementation(async () => [
      { entryId: 'e0', appliesTo: 'basic:activity:mood', reason: 'wrong_source' },
    ]);
    const result = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(result.written).toBe(1);
    expect(allClaimDocs()[0].evidence.sourceEntryIds).not.toContain('e0');
  });

  it('an exclusion whose appliesTo is unrelated (neither "all" nor "basic:"-prefixed) is left alone', async () => {
    listSourceExclusionsMock.mockImplementation(async () => [
      { entryId: 'e0', appliesTo: 'activity_gym', reason: 'wrong_source' }, // legacy pattern-type shape
    ]);
    const result = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(result.written).toBe(1);
    expect(allClaimDocs()[0].evidence.sourceEntryIds).toContain('e0');
  });

  it('exclusions read failure -> generateClaims rejects (fail-closed, never runs on unknown exclusions)', async () => {
    listSourceExclusionsMock.mockImplementation(async () => {
      throw new Error('firestore unavailable');
    });
    await expect(
      generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW }),
    ).rejects.toThrow('firestore unavailable');
    expect(allClaimDocs()).toHaveLength(0);
    expect(registerCandidates).not.toHaveBeenCalled(); // failed before any analysis started
  });
});

describe('generateClaims — vanished-candidate retraction (candidate not enumerated at all)', () => {
  it('(1) a live VERIFIED claim whose candidate is removed off the board entirely (source-exclusion drops ALL its backing entries, so it never reaches enumerateExposures) is expired; stats.expired counts it; no analysis is attempted for it', async () => {
    const first = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);
    const priorId = allClaimDocs()[0].id;

    const gymEntryIds = fixtures(STRONG).filter((e) => e.tags.includes('gym')).map((e) => e.id);
    listSourceExclusionsMock.mockImplementation(async () => gymEntryIds.map((entryId) => ({
      entryId, appliesTo: 'basic:activity:mood', reason: 'wrong_source',
    })));

    const freezeCallsBefore = callOrder.filter((c) => c.op === 'freeze').length;
    const laterNow = '2026-07-30T10:00:00.000Z';
    const second = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: laterNow });

    // tag:gym no longer clears minPresentDays (its every backing entry was
    // excluded), so it isn't in `specs` at all this run.
    expect(second.candidatesTested).toBe(0);
    expect(second.eligible).toBe(0);
    expect(second.written).toBe(0);
    expect(second.superseded).toBe(0);
    expect(second.expired).toBe(1);
    // No analysis (freezeCandidatePlan) was attempted for it — or anything else.
    const newFreezeOps = callOrder.filter((c) => c.op === 'freeze').slice(freezeCallsBefore);
    expect(newFreezeOps).toHaveLength(0);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(1); // no new claim written
    const prior = claims.find((c) => c.id === priorId);
    expect(prior.status).toBe('expired');
    expect(prior.supersededByClaimId).toBeNull();
    expect(prior.updatedAt).toBe(laterNow);
    expect(setClaimStatusCalls.filter((id) => id === priorId)).toHaveLength(1);
  });

  it('(2) same as (1) but the prior is SUPPRESSED: left untouched (user suppression sticks, sweep never overrides it)', async () => {
    await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    const priorId = allClaimDocs()[0].id;
    await setClaimStatus(DB, UID, priorId, 'suppressed', { now: '2026-07-23T00:00:00.000Z' });
    setClaimStatusCalls.length = 0; // isolate the assertions below to the run under test

    const gymEntryIds = fixtures(STRONG).filter((e) => e.tags.includes('gym')).map((e) => e.id);
    listSourceExclusionsMock.mockImplementation(async () => gymEntryIds.map((entryId) => ({
      entryId, appliesTo: 'basic:activity:mood', reason: 'wrong_source',
    })));

    const laterNow = '2026-07-30T10:00:00.000Z';
    const second = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: laterNow });

    expect(second.expired).toBe(0);
    expect(setClaimStatusCalls).toHaveLength(0);
    const prior = allClaimDocs().find((c) => c.id === priorId);
    expect(prior.status).toBe('suppressed');
    expect(prior.updatedAt).toBe('2026-07-23T00:00:00.000Z'); // no status call touched it
  });

  it('(3) a live verified claim whose candidate IS enumerated stays governed by the existing (ineligible) path — mixed run proves no candidate is expired twice: setClaimStatus called at most once per claim id', async () => {
    // Two candidates in the SAME 'activity' family, both strong on the same
    // days (tag:yoga piggybacks on every gym day) so both start verified.
    const days = STRONG.map((d, i) => (i < 16 ? { ...d, extraTag: 'yoga' } : d));
    const first = await generateClaims(DB, UID, fixtures(days), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(2); // tag:gym + tag:yoga
    const firstClaims = allClaimDocs();
    expect(firstClaims).toHaveLength(2);
    const gymId = firstClaims.find((c) => c.analysisPlan.candidateId === 'tag:gym').id;
    const yogaId = firstClaims.find((c) => c.analysisPlan.candidateId === 'tag:yoga').id;

    // Second run: WEAK has no 'yoga' extraTag anywhere (data drift vanishes
    // tag:yoga from enumeration entirely), while tag:gym IS still enumerated
    // (still present >= minPresentDays) but now fails the practical-floor
    // gate (the existing ineligible-retraction path in the analyze loop).
    const laterNow = '2026-07-30T10:00:00.000Z';
    const second = await generateClaims(DB, UID, fixtures(WEAK), { timeZone: 'UTC', now: laterNow });

    expect(second.eligible).toBe(0);
    expect(second.expired).toBe(2); // gym via the analyze loop, yoga via the sweep

    const gymCalls = setClaimStatusCalls.filter((id) => id === gymId);
    const yogaCalls = setClaimStatusCalls.filter((id) => id === yogaId);
    expect(gymCalls).toHaveLength(1);
    expect(yogaCalls).toHaveLength(1);

    const claims = allClaimDocs();
    expect(claims.find((c) => c.id === gymId).status).toBe('expired');
    expect(claims.find((c) => c.id === yogaId).status).toBe('expired');
  });

  it('(4) a claim whose analysisPlan.hypothesisFamilyId is "experiment:steps-mood" (not a "basic:" family) is never touched by the sweep, even though its candidate is never enumerated by this pipeline', async () => {
    const first = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: NOW });
    expect(first.written).toBe(1);
    const basicClaim = allClaimDocs()[0];

    // Hand-construct a valid experiment_result claim in a non-'basic:'
    // family — this pipeline never enumerates it (its candidateId/family
    // shape isn't one enumerateExposures/familyIdForBasic can produce), so
    // it must be excluded on the hypothesisFamilyId check alone.
    const experimentClaim = await writeClaim(DB, UID, {
      ...basicClaim,
      version: 1,
      parentClaimId: null,
      claimType: 'experiment_result',
      analysisPlan: {
        ...basicClaim.analysisPlan,
        hypothesisFamilyId: 'experiment:steps-mood',
        candidateId: 'steps-mood',
      },
    });
    setClaimStatusCalls.length = 0; // isolate to the run under test

    const second = await generateClaims(DB, UID, fixtures(STRONG), { timeZone: 'UTC', now: '2026-07-30T10:00:00.000Z' });

    expect(second.expired).toBe(0); // gym is a dedup rerun (still eligible); nothing to expire
    expect(setClaimStatusCalls).toHaveLength(0);
    const stillThere = allClaimDocs().find((c) => c.id === experimentClaim.id);
    expect(stillThere.status).toBe('verified');
  });
});
