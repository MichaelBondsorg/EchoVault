/**
 * Personal Experiments — service tests (R3 Task 3).
 *
 * Payload-exactness against the firestore.rules `/experiments/{id}` contract
 * (commit a47a893's `experimentUpdateAllowed`/`experimentTransitionAllowed`,
 * and the create `hasOnly` list) — the R2 regression-guard pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    });
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
