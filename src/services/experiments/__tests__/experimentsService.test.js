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
