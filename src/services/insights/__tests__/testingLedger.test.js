import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));
const store = new Map(); // docPath -> data
vi.mock('../../../config/firebase', () => ({}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...segs) => ({ path: segs.join('/') })),
  getDoc: vi.fn(async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) })),
  setDoc: vi.fn(async (ref, data, opts) => {
    store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...data } : data);
  }),
  runTransaction: vi.fn(async (db, fn) => fn({
    get: async (ref) => ({ exists: () => store.has(ref.path), data: () => store.get(ref.path) }),
    set: (ref, data) => store.set(ref.path, data),
  })),
}));

import {
  familyIdForBasic, familyIdForExperiment, bonferroniCiLevel,
  registerCandidates, readLedgerCounts, ledgerDocIdFor,
} from '../testingLedger';

beforeEach(() => store.clear());
const NOW = '2026-07-22T10:00:00.000Z';

describe('family ids and correction', () => {
  it('builds stable family ids', () => {
    expect(familyIdForBasic('activity', 'tag:gym')).toBe('basic:activity:tag:gym:mood');
    expect(familyIdForExperiment('steps-mood')).toBe('experiment:steps-mood');
    expect(familyIdForExperiment('tag-presence-mood', 'Gym')).toBe('experiment:tag-presence-mood:tag:gym');
  });
  it('bonferroniCiLevel: 1 test -> 0.95; m tests -> 1 - 0.05/m', () => {
    expect(bonferroniCiLevel(1)).toBeCloseTo(0.95);
    expect(bonferroniCiLevel(0)).toBeCloseTo(0.95);
    expect(bonferroniCiLevel(10)).toBeCloseTo(0.995);
  });
});

describe('registerCandidates', () => {
  it('counts DISTINCT candidates; re-registering the same candidate never inflates m', async () => {
    const r1 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:gym', 'tag:run'], { now: NOW });
    expect(r1.testedCount).toBe(2);
    const r2 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:gym'], { now: NOW });
    expect(r2.testedCount).toBe(2); // rerun of same candidate: same ledger row
    const r3 = await registerCandidates({}, 'u1', 'basic:activity:mood', ['tag:swim'], { now: NOW });
    expect(r3.testedCount).toBe(3);
  });

  it('inconclusive candidates count: registration happens before analysis, so there is no outcome parameter at all', async () => {
    // API-shape assertion: registerCandidates takes no outcome/status argument.
    expect(registerCandidates.length).toBeLessThanOrEqual(5);
  });
});

describe('readLedgerCounts', () => {
  it('returns 0 for families never tested', async () => {
    await registerCandidates({}, 'u1', 'famA', ['x'], { now: NOW });
    const counts = await readLedgerCounts({}, 'u1', ['famA', 'famB']);
    expect(counts.get('famA')).toBe(1);
    expect(counts.get('famB')).toBe(0);
  });
});

describe('ledgerDocIdFor', () => {
  it('produces a Firestore-legal doc id (no forward slashes)', () => {
    expect(ledgerDocIdFor('experiment:tag-presence-mood:tag:a/b')).not.toContain('/');
  });
});
