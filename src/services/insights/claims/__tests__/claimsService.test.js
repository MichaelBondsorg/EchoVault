import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));
const store = new Map(); // docPath -> data

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  doc: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
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
      commit: async () => { ops.forEach((fn) => fn()); },
    };
  }),
}));

import {
  writeClaim, listActiveClaims, listAllClaims, supersedeClaim, setClaimStatus, evidenceEquivalent,
} from '../claimsService';

beforeEach(() => store.clear());

const NOW = '2026-07-22T10:00:00.000Z';
const validPlan = {
  frozenAt: NOW, hypothesisFamilyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym',
  candidateTestsCount: 4, ciLevel: 0.9875, outcomeUnit: 'mood_0_100', timezone: 'America/Los_Angeles',
  datePolicy: 'user_local_calendar_day', exposureDefinition: 'day includes tag "gym"',
  outcomeDefinition: 'daily mean mood (0-100)', lagDays: 0, splitMode: 'binary',
  minExposureContrast: 0, minimumTotalDays: 14, minimumSpanDays: 21,
  practicalEffectFloorMoodPoints: 5, adapterVersion: 1, observationSchemaVersion: 1,
  evidenceBuilderVersion: 1,
  estimatorThresholds: { minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000 },
};
const validEvidence = {
  sourceEntryIds: ['e1', 'e2'], hiddenSensitiveSourceCount: 1,
  totalCandidateDayCount: 24, exposedDayCount: 9, comparisonDayCount: 15,
  observedSpanDays: 34, exposureContrast: 1, effectMoodPoints: 7.2,
  stabilityInterval: [2.1, 12.3], leaveOneDayOutDirectionStable: true,
  exposureCoverage: 0.8, outcomeCoverage: 0.75, representativeness: 'unknown',
};
const makeClaim = (overrides = {}) => ({
  version: 1, parentClaimId: null, claimType: 'pattern_to_watch',
  subject: 'gym', outcome: 'mood', direction: 'positive',
  questionWording: 'How did gym days and mood move together in your recorded days?',
  wording: 'On days you logged gym, recorded mood averaged 7 points higher (9 vs 15 days).',
  limitations: ['Same-day association only.'],
  analysisPlan: validPlan, evidence: validEvidence,
  receipt: { sources: [], scope: null, timeWindow: { start: NOW, end: NOW }, sampleSize: 24, missingness: null, versions: { generator: 'insight_claims', computationVersion: 1, generatedAt: NOW, model: null, promptVersion: null } },
  status: 'verified',
  provenance: { generatorVersion: 2, evidenceBuilderVersion: 1, wordingSource: 'deterministic_template_v1' },
  createdAt: NOW, updatedAt: NOW,
  ...overrides,
});

describe('writeClaim', () => {
  it('writes the validated claim at insight_claims/{claim.id}', async () => {
    const written = await writeClaim({}, 'u1', makeClaim());
    const all = await listAllClaims({}, 'u1');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(written.id);
  });
});

describe('listActiveClaims', () => {
  it('filters out superseded and suppressed/expired claims, sorted createdAt desc', async () => {
    await writeClaim({}, 'u1', makeClaim({ createdAt: '2026-07-20T00:00:00.000Z', status: 'verified' }));
    const c2 = await writeClaim({}, 'u1', makeClaim({
      version: 2, parentClaimId: 'x',
      analysisPlan: { ...validPlan, candidateId: 'tag:run' },
      createdAt: '2026-07-21T00:00:00.000Z', status: 'candidate',
    }));
    await writeClaim({}, 'u1', makeClaim({
      analysisPlan: { ...validPlan, candidateId: 'tag:swim' },
      createdAt: '2026-07-19T00:00:00.000Z', status: 'suppressed',
    }));
    const active = await listActiveClaims({}, 'u1');
    expect(active.map((c) => c.id)).toEqual([c2.id, active[1].id]);
    expect(active.every((c) => c.status !== 'suppressed' && c.status !== 'expired')).toBe(true);
  });

  it('excludes claims with a non-null supersededByClaimId', async () => {
    const c1 = await writeClaim({}, 'u1', makeClaim());
    await updateDocDirectly(c1);
    const active = await listActiveClaims({}, 'u1');
    expect(active).toHaveLength(0);
  });
});

async function updateDocDirectly(claim) {
  // simulate a supersede pointer stamp without going through supersedeClaim
  const path = `artifacts/echo-vault-v5-fresh/users/u1/insight_claims/${claim.id}`;
  store.set(path, { ...store.get(path), supersededByClaimId: 'claim_other_v2' });
}

describe('supersedeClaim', () => {
  it('writes the new claim and stamps the old claim supersededByClaimId in one batch', async () => {
    const oldClaim = await writeClaim({}, 'u1', makeClaim());
    const newClaim = makeClaim({
      version: 2, parentClaimId: oldClaim.id, updatedAt: '2026-07-22T11:00:00.000Z',
    });
    const written = await supersedeClaim({}, 'u1', oldClaim, newClaim);
    const all = await listAllClaims({}, 'u1');
    const oldFromStore = all.find((c) => c.id === oldClaim.id);
    expect(oldFromStore.supersededByClaimId).toBe(written.id);
    expect(all.find((c) => c.id === written.id)).toBeTruthy();
  });

  it('throws on a lineage mismatch (newClaim.parentClaimId must equal oldClaim.id)', async () => {
    const oldClaim = await writeClaim({}, 'u1', makeClaim());
    const newClaim = makeClaim({ version: 2, parentClaimId: 'not-the-old-claim' });
    await expect(supersedeClaim({}, 'u1', oldClaim, newClaim)).rejects.toThrow();
  });
});

describe('setClaimStatus', () => {
  it('allows only suppressed/verified from app code', async () => {
    const claim = await writeClaim({}, 'u1', makeClaim());
    await setClaimStatus({}, 'u1', claim.id, 'suppressed', { now: '2026-07-22T12:00:00.000Z' });
    const all = await listAllClaims({}, 'u1');
    expect(all[0].status).toBe('suppressed');
    await expect(setClaimStatus({}, 'u1', claim.id, 'expired')).rejects.toThrow();
    await expect(setClaimStatus({}, 'u1', claim.id, 'candidate')).rejects.toThrow();
  });
});

describe('evidenceEquivalent', () => {
  it('true for identical rounded evidence', () => {
    const a = makeClaim();
    const b = makeClaim();
    expect(evidenceEquivalent(a, b)).toBe(true);
  });
  it('false when direction differs', () => {
    const a = makeClaim();
    const b = makeClaim({ direction: 'negative' });
    expect(evidenceEquivalent(a, b)).toBe(false);
  });
  it('false when day counts differ', () => {
    const a = makeClaim();
    const b = makeClaim({ evidence: { ...validEvidence, exposedDayCount: 3 } });
    expect(evidenceEquivalent(a, b)).toBe(false);
  });
  it('false when effectMoodPoints delta exceeds 0.5', () => {
    const a = makeClaim();
    const b = makeClaim({ evidence: { ...validEvidence, effectMoodPoints: validEvidence.effectMoodPoints + 0.6 } });
    expect(evidenceEquivalent(a, b)).toBe(false);
  });
  it('true when effectMoodPoints delta is within 0.5', () => {
    const a = makeClaim();
    const b = makeClaim({ evidence: { ...validEvidence, effectMoodPoints: validEvidence.effectMoodPoints + 0.4 } });
    expect(evidenceEquivalent(a, b)).toBe(true);
  });
});
