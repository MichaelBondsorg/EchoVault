/**
 * Personal Experiments — service tests (R3 Task 3).
 *
 * Payload-exactness against the firestore.rules `/experiments/{id}` contract
 * (commit a47a893's `experimentUpdateAllowed`/`experimentTransitionAllowed`,
 * and the create `hasOnly` list) — the R2 regression-guard pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
// Pure, no-Firebase module (see computeResult.test.js's own note on why it
// avoids importing experimentsService.js directly) — safe to import
// statically here since this file already mocks `../../../config/firebase`
// for `experimentsService.js` itself.
import { computeExperimentResult } from '../computeResult';
import { getTemplateById } from '../templates';
// Pure, no-Firebase module — used only to independently verify the
// deterministic claim doc id in the idempotency test below.
import { claimDocId } from '../../insights/claims/claimSchema';

const mocks = {
  collection: vi.fn((_db, path) => ({ __col: path })),
  doc: vi.fn((_db, path, id) => ({ __doc: `${path}/${id}` })),
  query: vi.fn((...args) => ({ __query: args })),
  orderBy: vi.fn((f, dir) => ({ __orderBy: [f, dir] })),
  onSnapshot: vi.fn(() => () => {}),
  addDoc: vi.fn(async () => ({ id: 'exp-1' })),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })),
  getDocs: vi.fn(async () => ({ forEach: () => {} })),
  setDoc: vi.fn(async () => {}),
};

vi.mock('../../../config/firebase', () => mocks);
vi.mock('../../../config/constants', () => ({ APP_COLLECTION_ID: 'echo-vault-v5-fresh' }));

// Hypothesis-family testing ledger (T2/R4 Phase 1). `familyIdForExperiment`
// and `bonferroniCiLevel` are re-implemented here as plain (non-Firestore)
// logic identical to `testingLedger.js`'s real implementation, so every
// existing/new `buildAnalysisPlan` assertion below can rely on real,
// deterministic family ids/ciLevel values. `registerCandidates` and
// `readLedgerCounts` — the two Firestore-touching exports — are spies
// (`vi.fn()`) so `createExperiment`/`startExperiment` tests can assert on
// how they're called and control their resolved/rejected values per test.
const ledgerMocks = {
  familyIdForExperiment: vi.fn((templateId, tag) => (
    tag == null ? `experiment:${templateId}` : `experiment:${templateId}:tag:${String(tag).toLowerCase()}`
  )),
  bonferroniCiLevel: vi.fn((testedCount, alpha = 0.05) => {
    const m = Number.isFinite(testedCount) && testedCount > 1 ? testedCount : 1;
    return 1 - alpha / m;
  }),
  registerCandidates: vi.fn(async () => ({ testedCount: 1 })),
  readLedgerCounts: vi.fn(async () => new Map()),
};
vi.mock('../../insights/testingLedger', () => ledgerMocks);

// experiment_result claims (R4 Phase 2, Task 4): claimsService.js is mocked
// the same way testingLedger.js is above — `writeResult`/`writeAdjustedResult`
// tests assert ON these calls (claimType, direction, version/parentClaimId
// lineage) without touching real Firestore. `experimentClaim.js` itself is
// NOT mocked — it's pure, so letting the real mapping run end-to-end here is
// a genuine (not just unit-isolated) integration check of the wiring.
const claimsServiceMocks = {
  writeClaim: vi.fn(async (_db, _uid, claim) => claim),
  supersedeClaim: vi.fn(async (_db, _uid, _oldClaim, newClaim) => newClaim),
  listAllClaims: vi.fn(async () => []),
};
vi.mock('../../insights/claims/claimsService', () => claimsServiceMocks);

const {
  resolveDeviceTimezone,
  buildAnalysisPlan,
  subscribeExperiments,
  createExperiment,
  startExperiment,
  pauseExperiment,
  resumeExperiment,
  stopExperiment,
  deleteExperiment,
  setObservationExcluded,
  writeResult,
  EXCLUSION_REASONS,
  buildAdjustedResultUpdate,
  writeAdjustedResult,
  getExperimentPrefs,
  markExplainerSeen,
  setConfirmation,
  clearConfirmation,
  listConfirmations,
  listFamilyRuns,
} = await import('../experimentsService.js');

const { MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } = await import('../estimator.js');

const db = {};
const UID = 'user-1';
const EXPERIMENTS_PATH = 'artifacts/echo-vault-v5-fresh/users/user-1/experiments';

// The rules' full create hasOnly list (12 keys) — every write this module
// makes at create time must be a SUBSET of this.
const CREATE_ALLOWED_KEYS = [
  'question', 'template', 'analysisPlan', 'scope', 'status', 'startAt', 'endAt',
  'durationDays', 'excludedObservations', 'result', 'createdAt', 'updatedAt',
];

// The rules' update affectedKeys allow-list.
const UPDATE_ALLOWED_KEYS = ['status', 'excludedObservations', 'result', 'updatedAt', 'startAt', 'endAt'];

function validTemplate(overrides = {}) {
  return {
    id: 'sleep-hours-mood-same-day',
    exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
    outcome: { field: 'analysis.mood_score', label: 'mood' },
    lag: 0,
    confounders: ['Confounder one.', 'Confounder two.'],
    whatThisDoesNotProve: ['Does not prove one.', 'Does not prove two.'],
    ...overrides,
  };
}

function validCreateInput(overrides = {}) {
  return {
    question: 'Does how much I sleep affect my mood?',
    template: 'sleep-hours-mood-same-day',
    analysisPlan: buildAnalysisPlan(validTemplate()),
    durationDays: 14,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onSnapshot.mockReturnValue(() => {});
  mocks.addDoc.mockResolvedValue({ id: 'exp-1' });
  mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
});

// ---------------------------------------------------------------------------
// experiment_result claim fixtures (R4 Phase 2, Task 4) — a real frozen plan
// (hypothesisFamilyId present, post-Phase-1) and a real `status:'ok'`
// computeResult.js-shaped result, reused by the writeResult/
// writeAdjustedResult claim-write describe blocks below.
// ---------------------------------------------------------------------------

const CLAIM_PLAN = {
  templateId: 'sleep-hours-mood-same-day',
  lag: 0,
  exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
  outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
  minPairedObservations: 10,
  coverageFloor: 0.5,
  confounders: [],
  whatThisDoesNotProve: [
    'This does not show that sleep hours caused the change in mood.',
    'Other things that changed around the same time could explain some or all of this difference.',
  ],
  timezone: 'UTC',
  hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day',
};

const CLAIM_EXPERIMENT_DATA = {
  question: 'Does how much I sleep affect my mood?',
  analysisPlan: CLAIM_PLAN,
  durationDays: 14,
  createdAt: '2026-07-01T00:00:00.000Z',
};

function claimOkResult(overrides = {}) {
  return {
    status: 'ok',
    estimate: {
      meanHigh: 70,
      meanLow: 60,
      delta: 10,
      ci: [4, 16],
      n: 20,
      pearsonR: 0.3,
      nHigh: 10,
      nLow: 10,
      splitThreshold: 7,
      exposureContrast: 2.5,
      resampleDiscardCount: 0,
      stability: { signConsistent: true },
    },
    coverage: {
      exposure: { covered: 20, total: 20, label: '20 of 20 days' },
      outcome: { covered: 20, total: 20, label: '20 of 20 days' },
    },
    receipt: {
      sources: [{ entryId: 'e1', date: '2026-07-10T00:00:00.000Z', excerpt: 'slept well' }],
      scope: null,
      timeWindow: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z' },
      sampleSize: 20,
      missingness: 'Exposure: 20 of 20 days. Outcome: 20 of 20 days.',
      versions: {
        generator: 'experiment_v1', computationVersion: 1, generatedAt: '2026-07-20T00:00:00.000Z', model: null, promptVersion: null,
      },
      computation: {
        nHigh: 10, nLow: 10, splitThreshold: 7, exposureContrast: 2.5,
      },
    },
    sensitiveObservationCount: 0,
    invalidObservationCount: 0,
    narrative: {
      summary: 'On days with more sleep hours than usual, mood averaged 10.0 points (0-100) higher than on '
        + 'days with less (based on 20 paired days). This is an association, not proof that one caused the other.',
      alternatives: [],
      whatThisDoesNotProve: [],
    },
    ...overrides,
  };
}

describe('buildAnalysisPlan', () => {
  it('snapshots template id, lag, exposure, outcome, the estimator constants, the frozen device timezone, and the narrative caveat strings', () => {
    const plan = buildAnalysisPlan(validTemplate());
    expect(plan).toEqual({
      templateId: 'sleep-hours-mood-same-day',
      lag: 0,
      exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
      outcome: { field: 'analysis.mood_score', label: 'mood' },
      minPairedObservations: MIN_PAIRED_OBSERVATIONS,
      coverageFloor: COVERAGE_FLOOR,
      confounders: ['Confounder one.', 'Confounder two.'],
      whatThisDoesNotProve: ['Does not prove one.', 'Does not prove two.'],
      timezone: resolveDeviceTimezone(),
      hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day',
    });
    // No priorTestedCount given -> no ciLevel key (absence, not undefined).
    expect(plan).not.toHaveProperty('ciLevel');
  });

  it('carries splitMode onto the plan only when the template declares one (e.g. tag-presence-mood: binary)', () => {
    const tagTemplate = validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
      splitMode: 'binary',
    });
    const plan = buildAnalysisPlan(tagTemplate, { tag: '@person:spencer' });
    expect(plan.splitMode).toBe('binary');

    const noSplitModePlan = buildAnalysisPlan(validTemplate());
    expect(noSplitModePlan).not.toHaveProperty('splitMode');
  });

  it('resolveDeviceTimezone falls back to UTC when Intl throws', () => {
    const original = Intl.DateTimeFormat;
    Intl.DateTimeFormat = () => { throw new Error('no Intl here'); };
    try {
      expect(resolveDeviceTimezone()).toBe('UTC');
    } finally {
      Intl.DateTimeFormat = original;
    }
  });

  it('snapshotted confounders/whatThisDoesNotProve are copies, not the same array reference (defensive — the template catalog is frozen but callers must not assume it)', () => {
    const template = validTemplate();
    const plan = buildAnalysisPlan(template);
    expect(plan.confounders).not.toBe(template.confounders);
    expect(plan.whatThisDoesNotProve).not.toBe(template.whatThisDoesNotProve);
  });

  it('defaults confounders/whatThisDoesNotProve to empty arrays when the template carries neither (defensive, not expected from the real catalog)', () => {
    const template = validTemplate({ confounders: undefined, whatThisDoesNotProve: undefined });
    const plan = buildAnalysisPlan(template);
    expect(plan.confounders).toEqual([]);
    expect(plan.whatThisDoesNotProve).toEqual([]);
  });

  it('embeds the chosen tag for a tag-presence template', () => {
    const tagTemplate = validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
    });
    const plan = buildAnalysisPlan(tagTemplate, { tag: '@person:spencer' });
    expect(plan.exposure).toEqual({ source: 'tags', field: 'tags', label: 'tag presence', tag: '@person:spencer' });
  });

  it('throws for a tag-presence template with no params.tag', () => {
    const tagTemplate = validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
    });
    expect(() => buildAnalysisPlan(tagTemplate)).toThrow(/params\.tag/);
  });

  it('throws for an invalid template', () => {
    expect(() => buildAnalysisPlan(null)).toThrow();
    expect(() => buildAnalysisPlan({})).toThrow();
  });
});

describe('buildAnalysisPlan — exposureMode (R4 Phase 3 Task 3, action confirmation v1)', () => {
  function tagTemplateWith(overrides = {}) {
    return validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
      splitMode: 'binary',
      ...overrides,
    });
  }

  it("sets plan.exposureMode 'confirmed' for the tag template when params.exposureMode is 'confirmed'", () => {
    const plan = buildAnalysisPlan(tagTemplateWith(), { tag: '@person:spencer', exposureMode: 'confirmed' });
    expect(plan.exposureMode).toBe('confirmed');
  });

  it('omits exposureMode entirely (never writes "passive") for the tag template with no exposureMode param', () => {
    const plan = buildAnalysisPlan(tagTemplateWith(), { tag: '@person:spencer' });
    expect(plan).not.toHaveProperty('exposureMode');
  });

  it('omits exposureMode for the tag template with an unrecognized exposureMode value', () => {
    const plan = buildAnalysisPlan(tagTemplateWith(), { tag: '@person:spencer', exposureMode: 'bogus' });
    expect(plan).not.toHaveProperty('exposureMode');
  });

  it('ignores params.exposureMode entirely for a non-tag (no splitMode:"binary") template', () => {
    const plan = buildAnalysisPlan(validTemplate(), { exposureMode: 'confirmed' });
    expect(plan).not.toHaveProperty('exposureMode');
  });

  it('a legacy/passive plan is byte-identical to a plan built before exposureMode existed', () => {
    const plan = buildAnalysisPlan(validTemplate());
    expect(plan).toEqual({
      templateId: 'sleep-hours-mood-same-day',
      lag: 0,
      exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
      outcome: { field: 'analysis.mood_score', label: 'mood' },
      minPairedObservations: MIN_PAIRED_OBSERVATIONS,
      coverageFloor: COVERAGE_FLOOR,
      confounders: ['Confounder one.', 'Confounder two.'],
      whatThisDoesNotProve: ['Does not prove one.', 'Does not prove two.'],
      timezone: resolveDeviceTimezone(),
      hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day',
    });
  });
});

describe('setConfirmation / clearConfirmation / listConfirmations — confirmations subcollection (R4 Phase 3 Task 3)', () => {
  const CONFIRMATIONS_PATH = `${EXPERIMENTS_PATH}/exp-1/confirmations`;

  function mockExperimentStatus(status) {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status }) });
  }

  it('setConfirmation writes {dateKey, done, createdAt} to the doc keyed by dateKey while running', async () => {
    mockExperimentStatus('running');
    await setConfirmation(db, UID, 'exp-1', '2026-07-23', true);
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = mocks.setDoc.mock.calls[0];
    expect(ref.__doc).toBe(`${CONFIRMATIONS_PATH}/2026-07-23`);
    expect(Object.keys(payload).sort()).toEqual(['createdAt', 'dateKey', 'done']);
    expect(payload.dateKey).toBe('2026-07-23');
    expect(payload.done).toBe(true);
    expect(typeof payload.createdAt).toBe('string');
  });

  it('setConfirmation accepts done:false (a real, explicit "no")', async () => {
    mockExperimentStatus('running');
    await setConfirmation(db, UID, 'exp-1', '2026-07-23', false);
    expect(mocks.setDoc.mock.calls[0][1].done).toBe(false);
  });

  it('setConfirmation throws (client-side, before any write) when the experiment is not running', async () => {
    mockExperimentStatus('stopped');
    await expect(setConfirmation(db, UID, 'exp-1', '2026-07-23', true)).rejects.toThrow(/running/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('setConfirmation throws when the experiment does not exist', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(setConfirmation(db, UID, 'exp-1', '2026-07-23', true)).rejects.toThrow(/not found/);
  });

  it('setConfirmation throws for a non-boolean done', async () => {
    mockExperimentStatus('running');
    await expect(setConfirmation(db, UID, 'exp-1', '2026-07-23', 'yes')).rejects.toThrow(/boolean/);
    expect(mocks.setDoc).not.toHaveBeenCalled();
  });

  it('clearConfirmation deletes the dateKey doc while running', async () => {
    mockExperimentStatus('running');
    await clearConfirmation(db, UID, 'exp-1', '2026-07-23');
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
    expect(mocks.deleteDoc.mock.calls[0][0].__doc).toBe(`${CONFIRMATIONS_PATH}/2026-07-23`);
  });

  it('clearConfirmation throws (client-side, before any write) when the experiment is stopped', async () => {
    mockExperimentStatus('completed');
    await expect(clearConfirmation(db, UID, 'exp-1', '2026-07-23')).rejects.toThrow(/running/);
    expect(mocks.deleteDoc).not.toHaveBeenCalled();
  });

  it('listConfirmations reads every doc in the subcollection', async () => {
    mocks.getDocs.mockResolvedValue({
      forEach: (cb) => {
        cb({ id: '2026-07-22', data: () => ({ dateKey: '2026-07-22', done: true, createdAt: 'x' }) });
        cb({ id: '2026-07-23', data: () => ({ dateKey: '2026-07-23', done: false, createdAt: 'y' }) });
      },
    });
    const list = await listConfirmations(db, UID, 'exp-1');
    expect(mocks.collection.mock.calls[0][1]).toBe(CONFIRMATIONS_PATH);
    expect(list).toEqual([
      { id: '2026-07-22', dateKey: '2026-07-22', done: true, createdAt: 'x' },
      { id: '2026-07-23', dateKey: '2026-07-23', done: false, createdAt: 'y' },
    ]);
  });

  it('listConfirmations throws without an experimentId', async () => {
    await expect(listConfirmations(db, UID, '')).rejects.toThrow(/experimentId/);
  });
});

describe('buildAnalysisPlan — hypothesis family + Bonferroni ciLevel (R4 Phase 1 retrofit, Task 7)', () => {
  it('always stamps hypothesisFamilyId (experiment:{templateId}) for an untagged template, with no ciLevel when no priorTestedCount is given', () => {
    const template = validTemplate({ id: 'steps-mood' });
    const plan = buildAnalysisPlan(template);
    expect(plan.hypothesisFamilyId).toBe('experiment:steps-mood');
    expect(plan).not.toHaveProperty('ciLevel');
  });

  it('stamps a tag-qualified (lowercased) hypothesisFamilyId and the Bonferroni-adjusted ciLevel when priorTestedCount is finite >= 1', () => {
    const tagTemplate = validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
    });
    const plan = buildAnalysisPlan(tagTemplate, { tag: 'Gym', priorTestedCount: 3 });
    expect(plan.hypothesisFamilyId).toBe('experiment:tag-presence-mood:tag:gym');
    // m = priorTestedCount + 1 (this experiment included) = 4 -> 1 - 0.05/4.
    expect(plan.ciLevel).toBeCloseTo(1 - 0.05 / 4, 10);
  });

  it('omits ciLevel when priorTestedCount is 0, negative, non-finite, or simply absent (absence, not undefined — estimator default applies)', () => {
    const template = validTemplate();
    expect(buildAnalysisPlan(template, {})).not.toHaveProperty('ciLevel');
    expect(buildAnalysisPlan(template, { priorTestedCount: 0 })).not.toHaveProperty('ciLevel');
    expect(buildAnalysisPlan(template, { priorTestedCount: -1 })).not.toHaveProperty('ciLevel');
    expect(buildAnalysisPlan(template, { priorTestedCount: NaN })).not.toHaveProperty('ciLevel');
    expect(buildAnalysisPlan(template, { priorTestedCount: Infinity })).not.toHaveProperty('ciLevel');
  });

  it('priorTestedCount === 1 (exactly one prior candidate) DOES trigger a ciLevel — the boundary is inclusive', () => {
    const template = validTemplate();
    const plan = buildAnalysisPlan(template, { priorTestedCount: 1 });
    // m = 1 + 1 = 2 -> 1 - 0.05/2.
    expect(plan.ciLevel).toBeCloseTo(1 - 0.05 / 2, 10);
  });

  it('an untagged experiment repeated (same template) resolves to the SAME family id regardless of params.tag being absent vs explicitly null', () => {
    const template = validTemplate();
    const planA = buildAnalysisPlan(template);
    const planB = buildAnalysisPlan(template, { tag: null });
    expect(planA.hypothesisFamilyId).toBe(planB.hypothesisFamilyId);
  });

  it('two different tags on the same tag-presence template resolve to DIFFERENT family ids (each tag is its own hypothesis)', () => {
    const tagTemplate = validTemplate({
      id: 'tag-presence-mood',
      exposure: { source: 'tags', field: 'tags', label: 'tag presence' },
    });
    const gymPlan = buildAnalysisPlan(tagTemplate, { tag: 'Gym' });
    const runPlan = buildAnalysisPlan(tagTemplate, { tag: 'Run' });
    expect(gymPlan.hypothesisFamilyId).not.toBe(runPlan.hypothesisFamilyId);
  });
});

describe('subscribeExperiments', () => {
  it('queries the experiments collection ordered by createdAt desc', () => {
    subscribeExperiments(db, UID, () => {});
    expect(mocks.collection).toHaveBeenCalledWith(db, EXPERIMENTS_PATH);
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('calls onError when the snapshot listener errors', () => {
    const onError = vi.fn();
    let errorCb;
    mocks.onSnapshot.mockImplementation((_q, _cb, errCb) => {
      errorCb = errCb;
      return () => {};
    });
    subscribeExperiments(db, UID, () => {}, onError);
    const err = new Error('boom');
    errorCb(err);
    expect(onError).toHaveBeenCalledWith(err);
  });
});

describe('createExperiment — payload exactness', () => {
  it('writes exactly {question, template, analysisPlan, scope, status:draft, durationDays, excludedObservations:[], createdAt, updatedAt}', async () => {
    const result = await createExperiment(db, UID, validCreateInput());
    expect(mocks.collection).toHaveBeenCalledWith(db, EXPERIMENTS_PATH);
    expect(mocks.addDoc).toHaveBeenCalledTimes(1);
    const payload = mocks.addDoc.mock.calls[0][1];

    const expectedKeys = [
      'question', 'template', 'analysisPlan', 'scope', 'status',
      'durationDays', 'excludedObservations', 'createdAt', 'updatedAt',
    ];
    expect(Object.keys(payload).sort()).toEqual(expectedKeys.sort());

    // Every key written is a subset of the rules' create hasOnly list.
    for (const key of Object.keys(payload)) {
      expect(CREATE_ALLOWED_KEYS).toContain(key);
    }

    // Create-time absence guard: result/startAt/endAt must be ABSENT keys,
    // not merely null/undefined-valued.
    expect(Object.prototype.hasOwnProperty.call(payload, 'result')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'startAt')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, 'endAt')).toBe(false);

    expect(payload.status).toBe('draft');
    expect(payload.excludedObservations).toEqual([]);
    expect(result.id).toBe('exp-1');
  });

  it('accepts a template object (extracts .id) as well as a string id', async () => {
    await createExperiment(db, UID, validCreateInput({ template: validTemplate() }));
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.template).toBe('sleep-hours-mood-same-day');
    expect(typeof payload.template).toBe('string');
  });

  it('writes scope: null when no scope is given (recipes precedent, documented choice)', async () => {
    await createExperiment(db, UID, validCreateInput());
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.scope).toBeNull();
  });

  it('writes the given scope through unchanged', async () => {
    await createExperiment(db, UID, validCreateInput({ scope: { spaceId: 'space-1' } }));
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.scope).toEqual({ spaceId: 'space-1' });
  });

  it('rejects a question over 200 characters', async () => {
    await expect(
      createExperiment(db, UID, validCreateInput({ question: 'x'.repeat(201) })),
    ).rejects.toThrow(/200/);
  });

  it('rejects an empty question', async () => {
    await expect(createExperiment(db, UID, validCreateInput({ question: '   ' }))).rejects.toThrow();
  });

  it('rejects a durationDays outside [14, 28]', async () => {
    await expect(createExperiment(db, UID, validCreateInput({ durationDays: 21 }))).rejects.toThrow();
  });

  it('rejects a missing/invalid analysisPlan', async () => {
    await expect(createExperiment(db, UID, validCreateInput({ analysisPlan: null }))).rejects.toThrow();
    await expect(createExperiment(db, UID, validCreateInput({ analysisPlan: ['not', 'a', 'map'] }))).rejects.toThrow();
  });

  it('rejects a missing template', async () => {
    await expect(createExperiment(db, UID, validCreateInput({ template: undefined }))).rejects.toThrow();
  });

  it('never calls registerCandidates (ledger candidate registration only ever happens at start/result time, never at create — Important review finding, fix wave 1)', async () => {
    await createExperiment(db, UID, validCreateInput());
    expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
  });
});

describe('createExperiment — hypothesis-family ledger read + Bonferroni ciLevel freeze (R4 Phase 1 retrofit, Task 7)', () => {
  const FAMILY_ID = 'experiment:sleep-hours-mood-same-day'; // validTemplate()'s id, untagged

  it('reads the ledger count for the plan\'s hypothesisFamilyId before writing', async () => {
    await createExperiment(db, UID, validCreateInput());
    expect(ledgerMocks.readLedgerCounts).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.readLedgerCounts).toHaveBeenCalledWith(db, UID, [FAMILY_ID]);
  });

  it('writes NO ciLevel (analysisPlan keeps the default) when the ledger reports no prior tests for the family', async () => {
    ledgerMocks.readLedgerCounts.mockResolvedValueOnce(new Map()); // count undefined -> treated as 0
    await createExperiment(db, UID, validCreateInput());
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.analysisPlan).not.toHaveProperty('ciLevel');
    expect(payload.analysisPlan.hypothesisFamilyId).toBe(FAMILY_ID);
  });

  it('freezes a Bonferroni ciLevel onto analysisPlan when the ledger reports priorTestedCount >= 1, computed from THIS create\'s fresh read (overriding whatever ciLevel — if any — the caller\'s own buildAnalysisPlan call already set)', async () => {
    ledgerMocks.readLedgerCounts.mockResolvedValueOnce(new Map([[FAMILY_ID, 2]]));
    await createExperiment(db, UID, validCreateInput());
    const payload = mocks.addDoc.mock.calls[0][1];
    // m = priorTestedCount (2) + 1 (this experiment) = 3 -> 1 - 0.05/3.
    expect(payload.analysisPlan.ciLevel).toBeCloseTo(1 - 0.05 / 3, 10);
    expect(payload.analysisPlan.hypothesisFamilyId).toBe(FAMILY_ID);
  });

  it('does not mutate the caller-provided analysisPlan object (writes a new object when ciLevel is stamped)', async () => {
    ledgerMocks.readLedgerCounts.mockResolvedValueOnce(new Map([[FAMILY_ID, 2]]));
    const input = validCreateInput();
    const originalPlan = input.analysisPlan;
    await createExperiment(db, UID, input);
    expect(originalPlan).not.toHaveProperty('ciLevel');
  });

  it('fails closed: a ledger read failure throws and NOTHING is written (never silently falls back to the unadjusted 0.95 default)', async () => {
    ledgerMocks.readLedgerCounts.mockRejectedValueOnce(new Error('ledger unavailable'));
    await expect(createExperiment(db, UID, validCreateInput())).rejects.toThrow(/ledger unavailable/);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('skips the ledger read entirely for a hand-built analysisPlan with no hypothesisFamilyId (defensive; every real buildAnalysisPlan output always has one)', async () => {
    const { hypothesisFamilyId, ...planWithoutFamilyId } = buildAnalysisPlan(validTemplate());
    await createExperiment(db, UID, validCreateInput({ analysisPlan: planWithoutFamilyId }));
    expect(ledgerMocks.readLedgerCounts).not.toHaveBeenCalled();
    const payload = mocks.addDoc.mock.calls[0][1];
    expect(payload.analysisPlan).not.toHaveProperty('ciLevel');
    expect(payload.analysisPlan).not.toHaveProperty('hypothesisFamilyId');
  });
});

describe('startExperiment — the only startAt/endAt writer', () => {
  it('writes exactly {status:running, startAt, endAt, updatedAt} on the draft->running transition', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    await startExperiment(db, UID, 'exp-1', 14, now);
    expect(mocks.doc).toHaveBeenCalledWith(db, EXPERIMENTS_PATH, 'exp-1');
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['endAt', 'startAt', 'status', 'updatedAt'].sort());
    for (const key of Object.keys(payload)) {
      expect(UPDATE_ALLOWED_KEYS).toContain(key);
    }
    expect(payload.status).toBe('running');
    expect(payload.startAt).toBe('2026-07-22T12:00:00.000Z');
    expect(payload.endAt).toBe('2026-08-05T12:00:00.000Z'); // +14 days
    expect(payload.updatedAt).toBe(payload.startAt);
  });

  it('computes endAt correctly for a 28-day duration', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    await startExperiment(db, UID, 'exp-1', 28, now);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(payload.endAt).toBe('2026-01-29T00:00:00.000Z');
  });

  it('rejects a durationDays outside [14, 28]', async () => {
    await expect(startExperiment(db, UID, 'exp-1', 21, new Date())).rejects.toThrow();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('is the ONLY function in this module whose payload includes startAt or endAt', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ status: 'running', excludedObservations: [] }) });
    await pauseExperiment(db, UID, 'exp-1');
    await resumeExperiment(db, UID, 'exp-1');
    await stopExperiment(db, UID, 'exp-1');
    await setObservationExcluded(db, UID, 'exp-1', '2026-01-01', true);
    await writeResult(db, UID, 'exp-1', { status: 'ok' });

    for (const call of mocks.updateDoc.mock.calls) {
      const payload = call[1];
      expect(payload).not.toHaveProperty('startAt');
      expect(payload).not.toHaveProperty('endAt');
    }
  });
});

describe('startExperiment — hypothesis-family ledger registration (R4 Phase 1 retrofit, Task 7)', () => {
  const FAMILY_ID = 'experiment:sleep-hours-mood-same-day';

  it('registers the candidate (candidateId = plan.hypothesisFamilyId) in the ledger, AFTER the status-transition write succeeds', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ analysisPlan: { hypothesisFamilyId: FAMILY_ID } }),
    });
    const now = new Date('2026-07-22T12:00:00.000Z');
    await startExperiment(db, UID, 'exp-1', 14, now);

    expect(ledgerMocks.registerCandidates).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.registerCandidates).toHaveBeenCalledWith(
      db, UID, FAMILY_ID, [FAMILY_ID], { now: '2026-07-22T12:00:00.000Z' },
    );

    // Ordering: the draft->running updateDoc must precede registerCandidates
    // — a status-transition that never happens must never register a test.
    const updateOrder = mocks.updateDoc.mock.invocationCallOrder[0];
    const registerOrder = ledgerMocks.registerCandidates.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(registerOrder);
  });

  it('does not register a candidate for a legacy experiment whose stored plan has no hypothesisFamilyId', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ analysisPlan: {} }) });
    await startExperiment(db, UID, 'exp-1', 14, new Date('2026-07-22T12:00:00.000Z'));
    expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
  });

  it('does not register a candidate (and does not throw) when the experiment doc is not found on the post-write read', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(startExperiment(db, UID, 'exp-1', 14, new Date('2026-07-22T12:00:00.000Z'))).resolves.toBeUndefined();
    expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
  });

  it('a durationDays validation failure never reaches the ledger at all', async () => {
    await expect(startExperiment(db, UID, 'exp-1', 21, new Date())).rejects.toThrow();
    expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });
});

describe('startExperiment — ledger registration containment (Important review finding, fix wave 1)', () => {
  const FAMILY_ID = 'experiment:sleep-hours-mood-same-day';

  it('does NOT reject startExperiment when registerCandidates rejects — the status write already committed, so a thrown error here would falsely tell the UI the experiment never started; warns instead, with the experimentId in the message', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ analysisPlan: { hypothesisFamilyId: FAMILY_ID } }),
    });
    ledgerMocks.registerCandidates.mockRejectedValueOnce(new Error('ledger write failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        startExperiment(db, UID, 'exp-1', 14, new Date('2026-07-22T12:00:00.000Z')),
      ).resolves.toBeUndefined();
      // The draft->running status write happened regardless of the ledger failure.
      expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
      expect(mocks.updateDoc.mock.calls[0][1].status).toBe('running');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exp-1');
      expect(warnSpy.mock.calls[0][0]).toContain(FAMILY_ID);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('also contains a read-back (getDoc) failure the same way — resolves, warns, does not call registerCandidates', async () => {
    mocks.getDoc.mockRejectedValueOnce(new Error('read-back failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(
        startExperiment(db, UID, 'exp-1', 14, new Date('2026-07-22T12:00:00.000Z')),
      ).resolves.toBeUndefined();
      expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exp-1');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('pauseExperiment / resumeExperiment / stopExperiment', () => {
  it('pauseExperiment writes exactly {status:paused, updatedAt}', async () => {
    await pauseExperiment(db, UID, 'exp-1');
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('paused');
  });

  it('resumeExperiment writes exactly {status:running, updatedAt}', async () => {
    await resumeExperiment(db, UID, 'exp-1');
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('running');
  });

  it('stopExperiment writes exactly {status:stopped, updatedAt}', async () => {
    await stopExperiment(db, UID, 'exp-1');
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['status', 'updatedAt']);
    expect(payload.status).toBe('stopped');
  });

  it('none of these ever touch the entries collection (they only call doc()/updateDoc() on the experiments path)', async () => {
    await pauseExperiment(db, UID, 'exp-1');
    await resumeExperiment(db, UID, 'exp-1');
    await stopExperiment(db, UID, 'exp-1');
    for (const call of mocks.doc.mock.calls) {
      expect(call[1]).toBe(EXPERIMENTS_PATH);
    }
  });
});

describe('deleteExperiment', () => {
  it('deletes only the experiment doc', async () => {
    await deleteExperiment(db, UID, 'exp-1');
    expect(mocks.deleteDoc).toHaveBeenCalledTimes(1);
    expect(mocks.doc).toHaveBeenCalledWith(db, EXPERIMENTS_PATH, 'exp-1');
  });
});

describe('setObservationExcluded — read-modify-write, dedupe, round-trip', () => {
  function mockExisting(status, excludedObservations) {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ status, excludedObservations }),
    });
  }

  it('adds a dateKey when excluding it for the first time', async () => {
    mockExisting('running', []);
    const result = await setObservationExcluded(db, UID, 'exp-1', '2026-07-01', true);
    expect(result).toEqual(['2026-07-01']);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['excludedObservations', 'updatedAt']);
    expect(payload.excludedObservations).toEqual(['2026-07-01']);
  });

  it('is idempotent — excluding an already-excluded dateKey does not duplicate it', async () => {
    mockExisting('running', ['2026-07-01']);
    const result = await setObservationExcluded(db, UID, 'exp-1', '2026-07-01', true);
    expect(result).toEqual(['2026-07-01']);
  });

  it('removes a dateKey on un-exclude (round trip)', async () => {
    mockExisting('running', ['2026-07-01', '2026-07-02']);
    const result = await setObservationExcluded(db, UID, 'exp-1', '2026-07-01', false);
    expect(result).toEqual(['2026-07-02']);
  });

  it('un-excluding a dateKey that is not present is a no-op', async () => {
    mockExisting('paused', ['2026-07-02']);
    const result = await setObservationExcluded(db, UID, 'exp-1', '2026-07-01', false);
    expect(result).toEqual(['2026-07-02']);
  });

  it('works while the experiment is completed (rerun case)', async () => {
    mockExisting('completed', []);
    await expect(setObservationExcluded(db, UID, 'exp-1', '2026-07-01', true)).resolves.toEqual(['2026-07-01']);
  });

  it('throws (client-side, before any write) when the experiment is stopped', async () => {
    mockExisting('stopped', []);
    await expect(setObservationExcluded(db, UID, 'exp-1', '2026-07-01', true)).rejects.toThrow(/stopped/);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it('throws when the experiment does not exist', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(setObservationExcluded(db, UID, 'exp-1', '2026-07-01', true)).rejects.toThrow(/not found/);
  });
});

describe('writeResult — sets result + status:completed in one update (result integrity, Michael review item 3)', () => {
  it('wraps the FIRST-completion result as {original: result, exclusionHistory: []}, status:completed, updatedAt', async () => {
    const result = { status: 'ok', estimate: { delta: 4 } };
    await writeResult(db, UID, 'exp-1', result);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['result', 'status', 'updatedAt']);
    expect(payload.status).toBe('completed');
    expect(payload.result).toEqual({ original: result, exclusionHistory: [] });
    // `original` is the SAME object reference as the passed-in result — no
    // deep clone, matching this module's existing "trust the caller's
    // already-shaped payload" posture.
    expect(payload.result.original).toBe(result);
  });

  it('a second writeResult call ALSO wraps fresh (writeResult is only ever a first-completion writer; reruns after a result exists go through writeAdjustedResult)', async () => {
    const firstResult = { status: 'ok', estimate: { delta: 4 } };
    const secondResult = { status: 'ok', estimate: { delta: 6 } };
    await writeResult(db, UID, 'exp-1', firstResult);
    await writeResult(db, UID, 'exp-1', secondResult);
    expect(mocks.updateDoc).toHaveBeenCalledTimes(2);
    const secondPayload = mocks.updateDoc.mock.calls[1][1];
    expect(secondPayload.status).toBe('completed');
    expect(secondPayload.result).toEqual({ original: secondResult, exclusionHistory: [] });
  });

  it('supports the insufficiency result shape too (still requires status:completed)', async () => {
    const insufficientResult = { status: 'insufficient', reasons: ['insufficient_paired_observations'] };
    await writeResult(db, UID, 'exp-1', insufficientResult);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(payload.status).toBe('completed');
    expect(payload.result).toEqual({ original: insufficientResult, exclusionHistory: [] });
  });

  it('rejects a non-object result', async () => {
    await expect(writeResult(db, UID, 'exp-1', null)).rejects.toThrow();
    await expect(writeResult(db, UID, 'exp-1', 'not an object')).rejects.toThrow();
  });
});

describe('writeResult — idempotent ledger re-registration retry (Important review finding, fix wave 1)', () => {
  const FAMILY_ID = 'experiment:sleep-hours-mood-same-day';

  it('re-attempts registerCandidates with the experiment\'s frozen hypothesisFamilyId AFTER the result write succeeds', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ analysisPlan: { hypothesisFamilyId: FAMILY_ID } }),
    });
    await writeResult(db, UID, 'exp-1', { status: 'ok' });

    expect(ledgerMocks.registerCandidates).toHaveBeenCalledTimes(1);
    expect(ledgerMocks.registerCandidates).toHaveBeenCalledWith(
      db, UID, FAMILY_ID, [FAMILY_ID], expect.objectContaining({ now: expect.any(String) }),
    );
    // Ordering: the result updateDoc must precede the retry registration.
    const updateOrder = mocks.updateDoc.mock.invocationCallOrder[0];
    const registerOrder = ledgerMocks.registerCandidates.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(registerOrder);
  });

  it('a rejection from the retry registration does NOT reject writeResult (contained, warned — the result write already committed)', async () => {
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ analysisPlan: { hypothesisFamilyId: FAMILY_ID } }),
    });
    ledgerMocks.registerCandidates.mockRejectedValueOnce(new Error('ledger write failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(writeResult(db, UID, 'exp-1', { status: 'ok' })).resolves.toBeUndefined();
      expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
      expect(mocks.updateDoc.mock.calls[0][1].status).toBe('completed');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exp-1');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('skips registration silently (no warn, registerCandidates not called) for a legacy experiment whose stored plan has no hypothesisFamilyId', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ analysisPlan: {} }) });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await writeResult(db, UID, 'exp-1', { status: 'ok' });
      expect(ledgerMocks.registerCandidates).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('writeResult — experiment_result claim write (R4 Phase 2, Task 4)', () => {
  it('writes an experiment_result claim (via claimsService.writeClaim) AFTER the result write commits', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const result = claimOkResult();
    await writeResult(db, UID, 'exp-1', result);

    expect(claimsServiceMocks.writeClaim).toHaveBeenCalledTimes(1);
    const [claimDb, claimUid, claimInput] = claimsServiceMocks.writeClaim.mock.calls[0];
    expect(claimDb).toBe(db);
    expect(claimUid).toBe(UID);
    expect(claimInput.claimType).toBe('experiment_result');
    expect(claimInput.direction).toBe('positive');
    expect(claimInput.version).toBe(1);
    expect(claimInput.parentClaimId).toBeNull();

    const updateOrder = mocks.updateDoc.mock.invocationCallOrder[0];
    const claimOrder = claimsServiceMocks.writeClaim.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(claimOrder);
  });

  it('does not write a claim for an insufficient result — insufficiency is not a claim', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    await writeResult(db, UID, 'exp-1', { status: 'insufficient', reasons: ['insufficient_paired_observations'] });
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
  });

  it('does NOT reject writeResult when the claim write rejects — the result save already committed; warns instead', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    claimsServiceMocks.writeClaim.mockRejectedValueOnce(new Error('claim write failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = claimOkResult();
      await expect(writeResult(db, UID, 'exp-1', result)).resolves.toBeUndefined();
      expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
      expect(mocks.updateDoc.mock.calls[0][1].status).toBe('completed');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exp-1');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('is idempotent — re-writing the same result twice builds the SAME deterministic claim doc id both times', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const result = claimOkResult();
    await writeResult(db, UID, 'exp-1', result);
    await writeResult(db, UID, 'exp-1', result);
    expect(claimsServiceMocks.writeClaim).toHaveBeenCalledTimes(2);
    const input1 = claimsServiceMocks.writeClaim.mock.calls[0][2];
    const input2 = claimsServiceMocks.writeClaim.mock.calls[1][2];
    const id1 = claimDocId({ familyId: input1.analysisPlan.hypothesisFamilyId, candidateId: input1.analysisPlan.candidateId, version: input1.version });
    const id2 = claimDocId({ familyId: input2.analysisPlan.hypothesisFamilyId, candidateId: input2.analysisPlan.candidateId, version: input2.version });
    expect(id1).toBe(id2);
  });

  it('does not write a claim for a legacy experiment doc whose frozen plan has no hypothesisFamilyId', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ ...CLAIM_EXPERIMENT_DATA, analysisPlan: { ...CLAIM_PLAN, hypothesisFamilyId: undefined } }) });
    await writeResult(db, UID, 'exp-1', claimOkResult());
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// R4 Phase 3 Task 6 — the repeat-run claim lineage fix. Before this task,
// `writeResult` called `claimsService.writeClaim` directly (bare) — a second
// completed run of the SAME hypothesis (same candidateId) produced the exact
// same deterministic claim doc id as the first run's already-existing claim,
// `writeClaim`'s create-only `setDoc` got rules-denied against it, and the
// denial was silently warned away by the containing catch: the repeat run's
// claim NEVER landed. These tests pin the fix — `writeResult` now routes
// through the SAME find-live-prior-and-decide helper `writeAdjustedResult`
// already used, so it supersedes instead of colliding.
// ---------------------------------------------------------------------------
describe('writeResult — repeat-run claim lineage fix (R4 Phase 3 Task 6)', () => {
  it('a repeat run SUPERSEDES the prior VERIFIED experiment_result claim for the same candidate — new claim v2/parentClaimId, prior linked (both docs)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const priorClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'verified',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([priorClaim]);

    // A repeat run's result: same candidate/plan (frozen at re-create), a
    // fresh estimate.
    const repeatResult = claimOkResult({ estimate: { ...claimOkResult().estimate, delta: 14 } });
    await writeResult(db, UID, 'exp-2', repeatResult);

    // NOT the pre-fix bare-writeClaim path — the second run supersedes.
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    expect(claimsServiceMocks.supersedeClaim).toHaveBeenCalledTimes(1);
    const [supDb, supUid, oldClaimArg, newClaimArg] = claimsServiceMocks.supersedeClaim.mock.calls[0];
    expect(supDb).toBe(db);
    expect(supUid).toBe(UID);
    // Both docs are present in the call: the OLD claim being linked from...
    expect(oldClaimArg).toBe(priorClaim);
    // ...and the NEW claim doc, with real lineage.
    expect(newClaimArg.claimType).toBe('experiment_result');
    expect(newClaimArg.version).toBe(2);
    expect(newClaimArg.parentClaimId).toBe(priorClaim.id);
    expect(newClaimArg.direction).toBe('positive');
    // The experiment doc's own result save still committed first, as always.
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc.mock.calls[0][1].status).toBe('completed');
  });

  it('does NOT resurrect a SUPPRESSED prior claim on a repeat run: skips the write/supersede entirely, prior untouched, result still saves', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const suppressedClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'suppressed',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([suppressedClaim]);

    await writeResult(db, UID, 'exp-2', claimOkResult());

    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    expect(claimsServiceMocks.supersedeClaim).not.toHaveBeenCalled();
    expect(suppressedClaim.status).toBe('suppressed');
    expect(suppressedClaim.supersededByClaimId).toBeNull();
    // The result save itself is unaffected by the suppressed-skip.
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    expect(mocks.updateDoc.mock.calls[0][1].status).toBe('completed');
  });

  it('a FIRST run (no prior claim for this candidate) still writes a plain v1 — unchanged from before this task', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([]);

    await writeResult(db, UID, 'exp-1', claimOkResult());

    expect(claimsServiceMocks.supersedeClaim).not.toHaveBeenCalled();
    expect(claimsServiceMocks.writeClaim).toHaveBeenCalledTimes(1);
    const claimInput = claimsServiceMocks.writeClaim.mock.calls[0][2];
    expect(claimInput.version).toBe(1);
    expect(claimInput.parentClaimId).toBeNull();
  });

  it('supersedes an EXPIRED prior claim on a repeat run too (documented revival path, same as writeAdjustedResult)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const expiredClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'expired',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([expiredClaim]);

    await writeResult(db, UID, 'exp-2', claimOkResult());

    expect(claimsServiceMocks.supersedeClaim).toHaveBeenCalledTimes(1);
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    const [, , oldClaimArg, newClaimArg] = claimsServiceMocks.supersedeClaim.mock.calls[0];
    expect(oldClaimArg).toBe(expiredClaim);
    expect(newClaimArg.version).toBe(2);
    expect(newClaimArg.parentClaimId).toBe(expiredClaim.id);
  });
});

describe('buildAdjustedResultUpdate — pure helper (result integrity, item 3)', () => {
  const ORIGINAL = { status: 'ok', estimate: { delta: 4 } };
  const ADJUSTED = { status: 'ok', estimate: { delta: 6 } };

  it('wraps a fresh {original, adjusted, exclusionHistory:[entry]} from an existing {original, exclusionHistory:[]} field', () => {
    const existing = { original: ORIGINAL, exclusionHistory: [] };
    const next = buildAdjustedResultUpdate(existing, {
      adjusted: ADJUSTED, dateKey: '2026-07-01', excluded: true, reason: 'wrong_data', at: '2026-07-22T00:00:00.000Z',
    });
    expect(next.original).toBe(ORIGINAL);
    expect(next.adjusted).toBe(ADJUSTED);
    expect(next.exclusionHistory).toEqual([
      { dateKey: '2026-07-01', excluded: true, reason: 'wrong_data', at: '2026-07-22T00:00:00.000Z' },
    ]);
  });

  it('APPENDS to exclusionHistory across repeated calls — original is never disturbed', () => {
    const existing = { original: ORIGINAL, adjusted: ADJUSTED, exclusionHistory: [
      { dateKey: '2026-07-01', excluded: true, reason: 'wrong_data', at: 't1' },
    ] };
    const secondAdjusted = { status: 'ok', estimate: { delta: 8 } };
    const next = buildAdjustedResultUpdate(existing, {
      adjusted: secondAdjusted, dateKey: '2026-07-02', excluded: true, reason: 'wrong_date', at: 't2',
    });
    expect(next.original).toBe(ORIGINAL);
    expect(next.adjusted).toBe(secondAdjusted);
    expect(next.exclusionHistory).toEqual([
      { dateKey: '2026-07-01', excluded: true, reason: 'wrong_data', at: 't1' },
      { dateKey: '2026-07-02', excluded: true, reason: 'wrong_date', at: 't2' },
    ]);
  });

  it('legacy bare-shape fallback: an existing field with no `original` key is treated as the original itself', () => {
    const legacyBare = ORIGINAL; // pre-wrapping shape: the result itself, no wrapper
    const next = buildAdjustedResultUpdate(legacyBare, {
      adjusted: ADJUSTED, dateKey: '2026-07-01', excluded: true, reason: 'other', at: 't1',
    });
    expect(next.original).toBe(ORIGINAL);
    expect(next.exclusionHistory).toEqual([{ dateKey: '2026-07-01', excluded: true, reason: 'other', at: 't1' }]);
  });

  it('un-excluding (excluded:false) is recorded the same way as excluding', () => {
    const existing = { original: ORIGINAL, exclusionHistory: [] };
    const next = buildAdjustedResultUpdate(existing, {
      adjusted: ORIGINAL, dateKey: '2026-07-01', excluded: false, reason: 'wrong_data', at: 't1',
    });
    expect(next.exclusionHistory).toEqual([{ dateKey: '2026-07-01', excluded: false, reason: 'wrong_data', at: 't1' }]);
  });

  it('rejects an invalid reason', () => {
    expect(() => buildAdjustedResultUpdate({ original: ORIGINAL, exclusionHistory: [] }, {
      adjusted: ADJUSTED, dateKey: '2026-07-01', excluded: true, reason: 'not_a_real_reason', at: 't1',
    })).toThrow();
  });

  it('EXCLUSION_REASONS is exactly [wrong_data, wrong_date, other]', () => {
    expect(EXCLUSION_REASONS).toEqual(['wrong_data', 'wrong_date', 'other']);
  });
});

describe('writeAdjustedResult — writes only {result, updatedAt} (status untouched, already completed)', () => {
  it('writes exactly {result, updatedAt}', async () => {
    const resultField = { original: { status: 'ok' }, adjusted: { status: 'ok' }, exclusionHistory: [] };
    await writeAdjustedResult(db, UID, 'exp-1', resultField);
    expect(mocks.doc).toHaveBeenCalledWith(db, EXPERIMENTS_PATH, 'exp-1');
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['result', 'updatedAt']);
    expect(payload.result).toBe(resultField);
    for (const key of Object.keys(payload)) {
      expect(UPDATE_ALLOWED_KEYS).toContain(key);
    }
  });

  it('rejects a missing experimentId or non-object resultField', async () => {
    await expect(writeAdjustedResult(db, UID, '', {})).rejects.toThrow();
    await expect(writeAdjustedResult(db, UID, 'exp-1', null)).rejects.toThrow();
  });
});

describe('writeAdjustedResult — experiment_result claim supersede (R4 Phase 2, Task 4)', () => {
  it('writes a fresh v1 claim when no prior experiment_result claim exists for this candidate', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([]);
    const adjusted = claimOkResult({ estimate: { ...claimOkResult().estimate, delta: 12 } });
    const resultField = {
      original: claimOkResult(),
      adjusted,
      exclusionHistory: [{ dateKey: '2026-07-05', excluded: true, reason: 'wrong_data', at: 't1' }],
    };
    await writeAdjustedResult(db, UID, 'exp-1', resultField);

    expect(claimsServiceMocks.writeClaim).toHaveBeenCalledTimes(1);
    expect(claimsServiceMocks.supersedeClaim).not.toHaveBeenCalled();
    const claimInput = claimsServiceMocks.writeClaim.mock.calls[0][2];
    expect(claimInput.claimType).toBe('experiment_result');
    expect(claimInput.version).toBe(1);
    expect(claimInput.parentClaimId).toBeNull();
  });

  it('supersedes the existing non-superseded VERIFIED experiment_result claim, linking parentClaimId and bumping version (existing behavior pinned)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const existingClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'verified',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([existingClaim]);
    const adjusted = claimOkResult({ estimate: { ...claimOkResult().estimate, delta: 12 } });
    const resultField = { original: claimOkResult(), adjusted, exclusionHistory: [] };
    await writeAdjustedResult(db, UID, 'exp-1', resultField);

    expect(claimsServiceMocks.supersedeClaim).toHaveBeenCalledTimes(1);
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    const [supDb, supUid, oldClaimArg, newClaimArg] = claimsServiceMocks.supersedeClaim.mock.calls[0];
    expect(supDb).toBe(db);
    expect(supUid).toBe(UID);
    expect(oldClaimArg).toBe(existingClaim);
    expect(newClaimArg.claimType).toBe('experiment_result');
    expect(newClaimArg.version).toBe(2);
    expect(newClaimArg.parentClaimId).toBe(existingClaim.id);
  });

  it('picks only the CURRENT (non-superseded) claim version to supersede, ignoring an already-superseded ancestor', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const supersededV1 = {
      id: 'claim-v1', version: 1, claimType: 'experiment_result', supersededByClaimId: 'claim-v2',
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day' },
    };
    const currentV2 = {
      id: 'claim-v2', version: 2, claimType: 'experiment_result', supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([supersededV1, currentV2]);
    await writeAdjustedResult(db, UID, 'exp-1', { original: claimOkResult(), adjusted: claimOkResult(), exclusionHistory: [] });

    const [, , oldClaimArg, newClaimArg] = claimsServiceMocks.supersedeClaim.mock.calls[0];
    expect(oldClaimArg).toBe(currentV2);
    expect(newClaimArg.version).toBe(3);
    expect(newClaimArg.parentClaimId).toBe('claim-v2');
  });

  it('does not write or supersede a claim when the adjusted result is insufficient', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    await writeAdjustedResult(db, UID, 'exp-1', {
      original: claimOkResult(), adjusted: { status: 'insufficient', reasons: ['x'] }, exclusionHistory: [],
    });
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    expect(claimsServiceMocks.supersedeClaim).not.toHaveBeenCalled();
  });

  it('does NOT resurrect a SUPPRESSED prior claim: skips the claim write/supersede entirely, prior untouched, but the adjusted result still saves (invariant: claimsPipeline.js, matrix row R4P1-j)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const suppressedClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'suppressed',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([suppressedClaim]);
    const adjusted = claimOkResult({ estimate: { ...claimOkResult().estimate, delta: 12 } });
    const resultField = { original: claimOkResult(), adjusted, exclusionHistory: [] };

    await writeAdjustedResult(db, UID, 'exp-1', resultField);

    // Prior claim is untouched: no supersede, no fresh write.
    expect(claimsServiceMocks.supersedeClaim).not.toHaveBeenCalled();
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    expect(suppressedClaim.status).toBe('suppressed');
    expect(suppressedClaim.supersededByClaimId).toBeNull();
    // The experiment doc's own adjusted result still saves as today.
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
    const payload = mocks.updateDoc.mock.calls[0][1];
    expect(payload.result).toBe(resultField);
  });

  it('supersedes an EXPIRED prior claim (documented revival path preserved)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    const expiredClaim = {
      id: 'claim_experiment-sleep-hours-mood-same-day_abcd1234_v1',
      version: 1,
      claimType: 'experiment_result',
      status: 'expired',
      supersededByClaimId: null,
      analysisPlan: { candidateId: 'experiment:sleep-hours-mood-same-day', hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day' },
    };
    claimsServiceMocks.listAllClaims.mockResolvedValueOnce([expiredClaim]);
    const adjusted = claimOkResult({ estimate: { ...claimOkResult().estimate, delta: 12 } });
    const resultField = { original: claimOkResult(), adjusted, exclusionHistory: [] };

    await writeAdjustedResult(db, UID, 'exp-1', resultField);

    expect(claimsServiceMocks.supersedeClaim).toHaveBeenCalledTimes(1);
    expect(claimsServiceMocks.writeClaim).not.toHaveBeenCalled();
    const [, , oldClaimArg, newClaimArg] = claimsServiceMocks.supersedeClaim.mock.calls[0];
    expect(oldClaimArg).toBe(expiredClaim);
    expect(newClaimArg.version).toBe(2);
    expect(newClaimArg.parentClaimId).toBe(expiredClaim.id);
  });

  it('does NOT reject writeAdjustedResult when the claim supersede/read fails — the adjusted result save already committed; warns instead', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => CLAIM_EXPERIMENT_DATA });
    claimsServiceMocks.listAllClaims.mockRejectedValueOnce(new Error('read failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resultField = { original: claimOkResult(), adjusted: claimOkResult(), exclusionHistory: [] };
      await expect(writeAdjustedResult(db, UID, 'exp-1', resultField)).resolves.toBeUndefined();
      expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exp-1');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('getExperimentPrefs / markExplainerSeen — settings/experimentPrefs (revisitPrefs twin)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getExperimentPrefs returns {enabled:false} when the doc does not exist', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(getExperimentPrefs(db, UID)).resolves.toEqual({ enabled: false });
  });

  it('getExperimentPrefs reads {enabled:true} from an existing doc', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true, optInAt: 'x' }) });
    await expect(getExperimentPrefs(db, UID)).resolves.toEqual({ enabled: true });
  });

  it('markExplainerSeen writes exactly {enabled:true, optInAt, updatedAt} on first call (rules hasOnly)', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await markExplainerSeen(db, UID);
    expect(mocks.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, opts] = mocks.setDoc.mock.calls[0];
    expect(ref.__doc).toBe(`artifacts/echo-vault-v5-fresh/users/${UID}/settings/experimentPrefs`);
    expect(Object.keys(payload).sort()).toEqual(['enabled', 'optInAt', 'updatedAt']);
    expect(payload.enabled).toBe(true);
    expect(opts).toEqual({ merge: true });
  });

  it('markExplainerSeen never overwrites an existing optInAt on a repeat call', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ enabled: true, optInAt: 'first-time' }) });
    await markExplainerSeen(db, UID);
    const payload = mocks.setDoc.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['enabled', 'updatedAt']);
    expect(payload.optInAt).toBeUndefined();
  });
});

describe('listFamilyRuns — family history (R4 Phase 3 Task 6, repeated trials)', () => {
  const FAMILY_ID = 'experiment:sleep-hours-mood-same-day';

  function experimentDoc(id, overrides = {}) {
    return {
      id,
      status: 'completed',
      analysisPlan: { hypothesisFamilyId: FAMILY_ID },
      createdAt: '2026-07-05T00:00:00.000Z',
      updatedAt: '2026-07-10T00:00:00.000Z',
      result: { original: { status: 'ok', estimate: { delta: 5 } } },
      ...overrides,
    };
  }

  function mockDocs(docs) {
    mocks.getDocs.mockResolvedValue({
      forEach: (cb) => docs.forEach((d) => cb({ id: d.id, data: () => d })),
    });
  }

  it('reads over the SAME collection/ordering subscribeExperiments uses (no new query shape)', async () => {
    mockDocs([]);
    await listFamilyRuns(db, UID, FAMILY_ID);
    expect(mocks.collection).toHaveBeenCalledWith(db, EXPERIMENTS_PATH);
    expect(mocks.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  });

  it('includes only COMPLETED experiments sharing the exact hypothesisFamilyId, mapped to {id, completedAt, delta, status}', async () => {
    mockDocs([
      experimentDoc('exp-a'),
      experimentDoc('exp-b', { analysisPlan: { hypothesisFamilyId: 'experiment:some-other-family' } }),
      experimentDoc('exp-c', { status: 'running' }),
    ]);
    const runs = await listFamilyRuns(db, UID, FAMILY_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({
      id: 'exp-a', completedAt: '2026-07-10T00:00:00.000Z', delta: 5, status: 'ok',
    });
  });

  it('sorts by createdAt (immutable), oldest first', async () => {
    mockDocs([
      experimentDoc('exp-newest', { createdAt: '2026-07-20T00:00:00.000Z' }),
      experimentDoc('exp-oldest', { createdAt: '2026-07-01T00:00:00.000Z' }),
      experimentDoc('exp-middle', { createdAt: '2026-07-10T00:00:00.000Z' }),
    ]);
    const runs = await listFamilyRuns(db, UID, FAMILY_ID);
    expect(runs.map((r) => r.id)).toEqual(['exp-oldest', 'exp-middle', 'exp-newest']);
  });

  it('R4 Phase 3 backlog (review item B): a LATER exclusion-adjustment on an EARLIER run (bumping its updatedAt past a more-recent run\'s) does NOT reshuffle the order — createdAt is the sort key, not updatedAt', async () => {
    mockDocs([
      // exp-first was created first but its updatedAt (a post-result
      // exclusion toggle, long after completion) is LATER than exp-second's.
      // Pre-fix, sorting by updatedAt would have put exp-second first.
      experimentDoc('exp-first', { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z' }),
      experimentDoc('exp-second', { createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z' }),
    ]);
    const runs = await listFamilyRuns(db, UID, FAMILY_ID);
    expect(runs.map((r) => r.id)).toEqual(['exp-first', 'exp-second']);
    // completedAt (the displayed value) is still sourced from updatedAt,
    // unchanged — only the ORDER key moved to createdAt.
    expect(runs[0].completedAt).toBe('2026-08-15T00:00:00.000Z');
    expect(runs[1].completedAt).toBe('2026-07-11T00:00:00.000Z');
    // The sort-key field never leaks into the returned shape.
    expect(runs[0]).not.toHaveProperty('_createdAt');
    expect(runs[0]).not.toHaveProperty('createdAt');
  });

  it('an insufficient original result reports its real status ("insufficient") with delta:null (no estimate to read)', async () => {
    mockDocs([experimentDoc('exp-a', { result: { original: { status: 'insufficient' } } })]);
    const runs = await listFamilyRuns(db, UID, FAMILY_ID);
    expect(runs[0]).toMatchObject({ delta: null, status: 'insufficient' });
  });

  it('a malformed/missing original (no status field at all) falls back to delta:null, status:"unknown"', async () => {
    mockDocs([experimentDoc('exp-a', { result: { original: {} } })]);
    const runs = await listFamilyRuns(db, UID, FAMILY_ID);
    expect(runs[0]).toMatchObject({ delta: null, status: 'unknown' });
  });

  it('returns [] for an empty/invalid hypothesisFamilyId without reading Firestore', async () => {
    await expect(listFamilyRuns(db, UID, '')).resolves.toEqual([]);
    await expect(listFamilyRuns(db, UID, null)).resolves.toEqual([]);
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });
});

describe('computeExperimentResult — legacy plans (no hypothesisFamilyId/ciLevel) compute byte-identically to the new plan shape (T2/Task 7 regression proof)', () => {
  // Small, self-contained fixture (independent of computeResult.test.js's
  // own GOLDEN fixture) — 14 days of perfectly-covered sleep/mood data, well
  // above MIN_PAIRED_OBSERVATIONS/COVERAGE_FLOOR, so this exercises a real
  // `status: 'ok'` estimate rather than a degenerate/insufficient one. The
  // POINT of this test is not the specific numbers (computeResult.test.js
  // already hand-verifies those) — it's that adding `hypothesisFamilyId` to
  // the plan (this task's change) does not alter the computed result AT
  // ALL, proving `computeExperimentResult` never reads that key.
  const REG_DAY_MS = 24 * 60 * 60 * 1000;
  function regIsoDay(y, m, d, hour = 12) {
    return new Date(Date.UTC(y, m - 1, d, hour)).toISOString();
  }
  function buildRegressionEntries() {
    const entries = [];
    for (let i = 0; i < 14; i++) {
      const day = i + 1;
      const hours = 4 + (i % 7);
      entries.push({
        id: `reg-${day}`,
        createdAt: regIsoDay(2026, 1, day),
        healthContext: { sleep: { totalHours: hours } },
        analysis: { mood_score: (hours * 10) / 100 },
      });
    }
    return entries;
  }
  const REG_START = regIsoDay(2026, 1, 1, 0);
  const REG_END = regIsoDay(2026, 1, 15, 0); // start + 14 days
  const REG_NOW = new Date(regIsoDay(2026, 1, 20, 0));

  function buildRegressionExperiment(analysisPlan) {
    // Partial-start-day rule (see computeResult.test.js's baseExperiment
    // doc comment): the real stored startAt is one day before the intended
    // first full data day.
    const shiftedStart = new Date(Date.parse(REG_START) - REG_DAY_MS).toISOString();
    return {
      id: 'exp-legacy-regression',
      question: 'legacy plan regression',
      template: 'sleep-hours-mood-same-day',
      analysisPlan,
      scope: null,
      status: 'running',
      startAt: shiftedStart,
      endAt: REG_END,
      durationDays: 14,
      excludedObservations: [],
      createdAt: shiftedStart,
      updatedAt: shiftedStart,
    };
  }

  /** Strips the one genuinely non-deterministic field (real-wall-clock `receipt.versions.generatedAt` — see computeResult.js's own module doc comment) before a deep-equality comparison. */
  function stripGeneratedAt(result) {
    const clone = JSON.parse(JSON.stringify(result));
    if (clone?.receipt?.versions) delete clone.receipt.versions.generatedAt;
    return clone;
  }

  it('a plan built by the CURRENT buildAnalysisPlan (hypothesisFamilyId present, no ciLevel/priorTestedCount) computes an identical result to a hand-stripped LEGACY plan (neither key present) — proves the new key is inert to computation', () => {
    const entries = buildRegressionEntries();
    // The real catalog template (not this file's minimal validTemplate()
    // helper) — computeExperimentResult's outcome-unit gate requires the
    // real `unit: 'mood_0_100'` MOOD_OUTCOME shape, exactly like
    // computeResult.test.js's own fixtures use.
    const template = getTemplateById('sleep-hours-mood-same-day');
    // Fixed to UTC for determinism (matches computeResult.test.js's own
    // fixture convention) — buildAnalysisPlan's real timezone snapshot is
    // exercised elsewhere; this test isn't about timezone behavior.
    const newPlan = { ...buildAnalysisPlan(template), timezone: 'UTC' };
    expect(newPlan.hypothesisFamilyId).toBe('experiment:sleep-hours-mood-same-day');
    expect(newPlan).not.toHaveProperty('ciLevel');

    const { hypothesisFamilyId, ...legacyPlan } = newPlan; // simulates a pre-Task-7 stored plan

    const newResult = computeExperimentResult({ experiment: buildRegressionExperiment(newPlan), entries, now: REG_NOW });
    const legacyResult = computeExperimentResult({ experiment: buildRegressionExperiment(legacyPlan), entries, now: REG_NOW });

    expect(newResult.status).toBe('ok'); // sanity: a real, meaningful result — not degenerate/insufficient
    expect(stripGeneratedAt(newResult)).toEqual(stripGeneratedAt(legacyResult));
  });
});
