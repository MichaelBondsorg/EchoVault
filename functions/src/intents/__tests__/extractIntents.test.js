import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCandidatesResponse,
  normalizeCandidates,
  deterministicIntentId,
  extractIntentCandidates,
  runIntentExtraction,
} from '../extractIntents.js';
import { INTENT_ATTRIBUTE_KEYS } from '../intentSchema.js';
import { _clearFlagCacheForTest } from '../../shared/flags.js';

function attrs(overrides = {}) {
  const base = {};
  for (const k of INTENT_ATTRIBUTE_KEYS) base[k] = false;
  return { ...base, ...overrides };
}

// --- Minimal in-memory Firestore fake --------------------------------------
function makeFakeDb(flagFields = {}) {
  const store = new Map(); // path -> data

  function makeDocRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      _isDoc: true,
      get parent() { return makeColRef(path.split('/').slice(0, -1).join('/')); },
      collection(name) { return makeColRef(`${path}/${name}`); },
      async get() {
        if (path === 'config/flags') return { exists: true, data: () => flagFields };
        const data = store.get(path);
        return { exists: data !== undefined, data: () => data };
      },
    };
  }
  function makeColRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      _isCol: true,
      get parent() { return makeDocRef(path.split('/').slice(0, -1).join('/')); },
      doc(id) { return makeDocRef(`${path}/${id}`); },
      where(field, _op, value) {
        return {
          async get() {
            const docs = [];
            for (const [p, data] of store.entries()) {
              if (p.startsWith(path + '/') && p.split('/').length === path.split('/').length + 1) {
                if (data[field] === value) docs.push({ id: p.split('/').pop(), data: () => data });
              }
            }
            return { forEach: (fn) => docs.forEach(fn), size: docs.length, empty: docs.length === 0 };
          },
        };
      },
    };
  }
  const db = {
    _store: store,
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push({ type: 'set', ref, data, opts }); },
        delete(ref) { ops.push({ type: 'delete', ref }); },
        async commit() {
          for (const op of ops) {
            if (op.type === 'delete') { store.delete(op.ref.path); continue; }
            const prev = op.opts?.merge ? store.get(op.ref.path) || {} : {};
            store.set(op.ref.path, { ...prev, ...op.data });
          }
        },
      };
    },
    doc: (p) => makeDocRef(p),
    collection: (p) => makeColRef(p),
  };
  return { db, store, makeDocRef };
}

const USER_BASE = 'artifacts/app/users/u1';

beforeEach(() => {
  _clearFlagCacheForTest();
});

describe('parseCandidatesResponse', () => {
  it('parses a JSON array, a fenced array, and a {candidates} wrapper', () => {
    expect(parseCandidatesResponse('[{"kind":"task"}]')).toEqual([{ kind: 'task' }]);
    expect(parseCandidatesResponse('```json\n[{"kind":"task"}]\n```')).toEqual([{ kind: 'task' }]);
    expect(parseCandidatesResponse('{"candidates":[{"kind":"task"}]}')).toEqual([{ kind: 'task' }]);
  });
  it('returns [] for junk / non-arrays', () => {
    expect(parseCandidatesResponse('not json')).toEqual([]);
    expect(parseCandidatesResponse('{"x":1}')).toEqual([]);
    expect(parseCandidatesResponse(null)).toEqual([]);
  });
});

describe('normalizeCandidates', () => {
  const entryText = 'I need to call the dentist tomorrow.';

  it('drops candidates with an unlocatable span', () => {
    const raw = [{ kind: 'task', text: 'buy a yacht', attributes: attrs(), confidence: 0.9 }];
    expect(normalizeCandidates(raw, entryText)).toEqual([]);
  });

  it('drops candidates with an unknown kind', () => {
    const raw = [{ kind: 'nonsense', text: 'call the dentist', attributes: attrs(), confidence: 0.9 }];
    expect(normalizeCandidates(raw, entryText)).toEqual([]);
  });

  it('locates a span by indexOf when offsets are wrong and coerces attributes to booleans', () => {
    const raw = [{
      kind: 'task', text: 'call the dentist', sourceSpan: { start: 999, end: 1000 },
      attributes: { agency: true, concrete: 'yes' }, confidence: 5, targetAt: 42,
    }];
    const [c] = normalizeCandidates(raw, entryText);
    expect(c.sourceSpan.text).toBe('call the dentist');
    expect(c.sourceSpan.start).toBe(entryText.indexOf('call the dentist'));
    expect(c.attributes.agency).toBe(true);
    expect(c.attributes.concrete).toBe(false); // 'yes' is not === true
    expect(c.confidence).toBe(1); // clamped
    expect(c.targetAt).toBeNull(); // non-string dropped
    for (const k of INTENT_ATTRIBUTE_KEYS) expect(typeof c.attributes[k]).toBe('boolean');
  });
});

describe('deterministicIntentId', () => {
  it('is stable and 20 chars', () => {
    const a = deterministicIntentId('e1', 0, 'task');
    const b = deterministicIntentId('e1', 0, 'task');
    expect(a).toBe(b);
    expect(a).toHaveLength(20);
    expect(deterministicIntentId('e1', 5, 'task')).not.toBe(a);
  });
});

describe('extractIntentCandidates', () => {
  it('propagates a hard model failure (so the caller may retry)', async () => {
    const boom = async () => { throw new Error('gemini-intent-extract 500'); };
    await expect(extractIntentCandidates({
      apiKey: 'k', modelId: 'm', entry: { text: 'call the dentist' }, callModel: boom,
    })).rejects.toThrow(/500/);
  });

  it('returns [] for empty entry text without calling the model', async () => {
    let called = false;
    const spy = async () => { called = true; return '[]'; };
    const r = await extractIntentCandidates({ apiKey: 'k', modelId: 'm', entry: { text: '   ' }, callModel: spy });
    expect(r).toEqual([]);
    expect(called).toBe(false);
  });
});

describe('runIntentExtraction', () => {
  const entryText = 'I need to call the dentist tomorrow. I should exercise more.';

  function fakeCandidates() {
    return async () => normalizeCandidates([
      { kind: 'task', text: 'call the dentist', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
      { kind: 'goal_habit', text: 'exercise more', attributes: attrs({ agency: true, goalLanguage: true }), confidence: 0.9 },
    ], entryText);
  }

  it('persists only active/suggested by default (abstain NOT stored) + stamps marker + inputVersion + compat list', async () => {
    const { db, store } = makeFakeDb(); // intentAbstainAudit off
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3 };

    const result = await runIntentExtraction({ db, entryRef, entry, modelId: 'gemini-3.5-flash', apiKey: 'k', extractCandidates: fakeCandidates() });

    expect(result.ran).toBe(true);
    expect(result.extractedTasks).toEqual([{ text: 'call the dentist', completed: false, index: 0 }]);

    const intentPaths = [...store.keys()].filter((p) => p.includes('/intents/'));
    expect(intentPaths).toHaveLength(1); // the abstain goal_habit was NOT persisted
    const stored = store.get(intentPaths[0]);
    expect(stored.kind).toBe('task');
    expect(stored.state).toBe('active');
    expect(stored.inputVersion).toBe(3);

    expect(store.get(`${USER_BASE}/entries/e1`).processing.intentsExtractedForVersion).toBe(3);
  });

  it('persists abstain candidates when intentAbstainAudit is ON', async () => {
    const { db, store } = makeFakeDb({ intentAbstainAudit: true });
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    const entry = { id: 'e1', text: entryText, entryInputVersion: 1 };
    await runIntentExtraction({ db, entryRef, entry, modelId: 'm', apiKey: 'k', extractCandidates: fakeCandidates() });
    const stored = [...store.keys()].filter((p) => p.includes('/intents/')).map((p) => store.get(p));
    expect(stored).toHaveLength(2);
    expect(stored.find((d) => d.kind === 'goal_habit').state).toBe('abstain');
  });

  it('is idempotent: a re-run for the same version does not re-call the model', async () => {
    const { db } = makeFakeDb();
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3, processing: { intentsExtractedForVersion: 3 } };
    let called = false;
    const spy = async () => { called = true; return []; };
    const result = await runIntentExtraction({ db, entryRef, entry, modelId: 'm', apiKey: 'k', extractCandidates: spy });
    expect(called).toBe(false);
    expect(result.ran).toBe(false);
  });

  it('a model failure propagates and NO marker is committed (retry stays possible)', async () => {
    const { db, store } = makeFakeDb();
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3 };
    const boom = async () => { throw new Error('gemini-intent-extract 503'); };
    await expect(runIntentExtraction({ db, entryRef, entry, modelId: 'm', apiKey: 'k', extractCandidates: boom })).rejects.toThrow(/503/);
    expect(store.get(`${USER_BASE}/entries/e1`)).toBeUndefined();
  });

  describe('orphan reap on re-extraction of an edited entry', () => {
    const v1Text = 'Buy milk and call the dentist tomorrow.';
    const v2Text = 'I already got the milk. I still need to call the dentist tomorrow.';

    async function seedV1(db) {
      const entryRef = db.doc(`${USER_BASE}/entries/e1`);
      const v1Cands = async () => normalizeCandidates([
        { kind: 'task', text: 'Buy milk', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
        { kind: 'task', text: 'call the dentist', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
      ], v1Text);
      await runIntentExtraction({ db, entryRef, entry: { id: 'e1', text: v1Text, entryInputVersion: 1 }, modelId: 'm', apiKey: 'k', extractCandidates: v1Cands });
    }

    it('deletes stale-version intents (including an active one) while keeping current-version ones', async () => {
      const { db, store } = makeFakeDb();
      await seedV1(db);
      expect([...store.keys()].filter((p) => p.includes('/intents/'))).toHaveLength(2);

      const entryRef = db.doc(`${USER_BASE}/entries/e1`);
      const v2Cands = async () => normalizeCandidates([
        { kind: 'task', text: 'call the dentist', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
      ], v2Text);
      await runIntentExtraction({ db, entryRef, entry: { id: 'e1', text: v2Text, entryInputVersion: 2 }, modelId: 'm', apiKey: 'k', extractCandidates: v2Cands });

      const remaining = [...store.keys()].filter((p) => p.includes('/intents/')).map((p) => store.get(p));
      expect(remaining).toHaveLength(1);
      expect(remaining[0].inputVersion).toBe(2);
      expect(remaining[0].sourceSpan.text).toBe('call the dentist');
      expect(remaining.some((d) => d.sourceSpan.text === 'Buy milk')).toBe(false);
    });

    it('supersedes (not deletes) a stale intent that a user_decision references', async () => {
      const { db, store } = makeFakeDb();
      await seedV1(db);
      const milkPath = [...store.keys()].find((p) => p.includes('/intents/') && store.get(p).sourceSpan.text === 'Buy milk');
      const milkId = milkPath.split('/').pop();
      store.set(`${USER_BASE}/user_decisions/d1`, { targetId: milkId, targetType: 'intent', action: 'kept', createdAt: 'x', reversible: true });

      const entryRef = db.doc(`${USER_BASE}/entries/e1`);
      const v2Cands = async () => normalizeCandidates([
        { kind: 'task', text: 'call the dentist', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
      ], v2Text);
      await runIntentExtraction({ db, entryRef, entry: { id: 'e1', text: v2Text, entryInputVersion: 2 }, modelId: 'm', apiKey: 'k', extractCandidates: v2Cands });

      expect(store.get(milkPath)).toBeDefined();
      expect(store.get(milkPath).state).toBe('superseded');
    });
  });
});
