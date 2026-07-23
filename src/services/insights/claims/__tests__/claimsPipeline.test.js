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
      callOrder.push({ op: 'register', candidateId: args[3][0], testedCount: result.testedCount });
      return result;
    }),
  };
});
vi.mock('../evidenceBuilder', async () => {
  const actual = await vi.importActual('../evidenceBuilder');
  return {
    ...actual,
    freezeCandidatePlan: vi.fn((args) => {
      callOrder.push({ op: 'freeze', candidateId: args.candidateId, candidateTestsCount: args.candidateTestsCount });
      return actual.freezeCandidatePlan(args);
    }),
  };
});

const { generateClaims } = await import('../claimsPipeline');
const { registerCandidates } = await import('../../testingLedger');
const { freezeCandidatePlan } = await import('../evidenceBuilder');
const { readLedgerCounts, familyIdForBasic } = await import('../../testingLedger');
const { claimDocId } = await import('../claimSchema');

beforeEach(() => {
  store.clear();
  callOrder.length = 0;
  registerCandidates.mockClear();
  freezeCandidatePlan.mockClear();
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
  it('registers every candidate before analyzing any, and freezes plans with the post-registration family count', async () => {
    const days = STRONG.map((d, i) => (i < 3 ? { ...d, extraTag: 'call' } : d));
    await generateClaims(DB, UID, fixtures(days), { timeZone: 'UTC', now: NOW });

    const registerOps = callOrder.filter((c) => c.op === 'register');
    const freezeOps = callOrder.filter((c) => c.op === 'freeze');
    expect(registerOps.map((r) => r.candidateId).sort()).toEqual(['tag:call', 'tag:gym']);
    expect(freezeOps.map((f) => f.candidateId).sort()).toEqual(['tag:call', 'tag:gym']);

    // Count-before-analyze: the LAST register call happens before the
    // FIRST freeze call — analysis never starts on a partially-registered
    // batch.
    const lastRegisterIndex = callOrder.map((c) => c.op).lastIndexOf('register');
    const firstFreezeIndex = callOrder.map((c) => c.op).indexOf('freeze');
    expect(lastRegisterIndex).toBeLessThan(firstFreezeIndex);

    // Each freeze call's candidateTestsCount is exactly the testedCount its
    // own registerCandidates call returned (captured post-registration, not
    // re-derived from a separate/stale read).
    for (const freeze of freezeOps) {
      const matchingRegister = registerOps.find((r) => r.candidateId === freeze.candidateId);
      expect(freeze.candidateTestsCount).toBe(matchingRegister.testedCount);
    }
  });
});

describe('generateClaims — strong candidate, mixed eligibility', () => {
  it('a strong candidate ends as ONE verified claim doc, and ALL enumerated candidates are ledgered even though only one is eligible', async () => {
    const days = STRONG.map((d, i) => (i < 3 ? { ...d, extraTag: 'call' } : d));
    const result = await generateClaims(DB, UID, fixtures(days), { timeZone: 'UTC', now: NOW });

    expect(result.candidatesTested).toBe(2); // tag:gym + tag:call
    expect(result.eligible).toBe(1); // only tag:gym clears the gates
    expect(result.written).toBe(1);
    expect(result.superseded).toBe(0);

    const claims = allClaimDocs();
    expect(claims).toHaveLength(1);
    expect(claims[0].status).toBe('verified');
    expect(claims[0].analysisPlan.candidateId).toBe('tag:gym');
    expect(claims[0].id).toBe(claimDocId({
      familyId: familyIdForBasic('activity', 'tag:gym'), candidateId: 'tag:gym', version: 1,
    }));

    // Both candidates left a ledger mark, even the ineligible one.
    const gymFamily = familyIdForBasic('activity', 'tag:gym');
    const callFamily = familyIdForBasic('activity', 'tag:call');
    const counts = await readLedgerCounts(DB, UID, [gymFamily, callFamily]);
    expect(counts.get(gymFamily)).toBe(1);
    expect(counts.get(callFamily)).toBe(1);
    expect(store.has(ledgerPath(callFamily))).toBe(true);
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
