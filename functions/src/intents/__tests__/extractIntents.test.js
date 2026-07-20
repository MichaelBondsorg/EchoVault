import { describe, it, expect } from 'vitest';
import {
  parseCandidatesResponse,
  normalizeCandidates,
  deterministicIntentId,
  extractIntentCandidates,
  runIntentExtraction,
} from '../extractIntents.js';
import { INTENT_ATTRIBUTE_KEYS } from '../intentSchema.js';

function attrs(overrides = {}) {
  const base = {};
  for (const k of INTENT_ATTRIBUTE_KEYS) base[k] = false;
  return { ...base, ...overrides };
}

// --- Minimal in-memory Firestore fake --------------------------------------
function makeFakeDb() {
  const store = new Map(); // path -> data

  function makeDocRef(path) {
    return {
      path,
      id: path.split('/').pop(),
      _isDoc: true,
      get parent() { return makeColRef(path.split('/').slice(0, -1).join('/')); },
      collection(name) { return makeColRef(`${path}/${name}`); },
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
            return { forEach: (fn) => docs.forEach(fn), size: docs.length };
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
        set(ref, data, opts) { ops.push({ ref, data, opts }); },
        async commit() {
          for (const { ref, data, opts } of ops) {
            const prev = opts?.merge ? store.get(ref.path) || {} : {};
            store.set(ref.path, { ...prev, ...data });
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

  function setup() {
    const { db, store } = makeFakeDb();
    const entryRef = db.doc(`${USER_BASE}/entries/e1`);
    return { db, store, entryRef };
  }

  it('writes intents, stamps the version marker in the same batch, and derives active-task compat list', async () => {
    const { db, store, entryRef } = setup();
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3 };

    const fakeCandidates = async () => normalizeCandidates([
      // an active task
      { kind: 'task', text: 'call the dentist', attributes: attrs({ agency: true, concrete: true, unfinished: true, temporalFit: true }), confidence: 0.9 },
      // a goalLanguage hard-negative -> abstain
      { kind: 'goal_habit', text: 'exercise more', attributes: attrs({ agency: true, goalLanguage: true }), confidence: 0.9 },
    ], entryText);

    const result = await runIntentExtraction({ db, entryRef, entry, modelId: 'gemini-3.5-flash', apiKey: 'k', extractCandidates: fakeCandidates });

    expect(result.ran).toBe(true);
    expect(result.extractedTasks).toEqual([{ text: 'call the dentist', completed: false, index: 0 }]);

    // two intent docs written
    const intentPaths = [...store.keys()].filter((p) => p.includes('/intents/'));
    expect(intentPaths).toHaveLength(2);

    // marker stamped on the entry doc, same batch
    const entryDoc = store.get(`${USER_BASE}/entries/e1`);
    expect(entryDoc.processing.intentsExtractedForVersion).toBe(3);

    // the goal_habit intent is stored abstain
    const stored = intentPaths.map((p) => store.get(p));
    const goal = stored.find((d) => d.kind === 'goal_habit');
    expect(goal.state).toBe('abstain');
  });

  it('is idempotent: a re-run for the same version does not re-call the model', async () => {
    const { db, entryRef } = setup();
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3, processing: { intentsExtractedForVersion: 3 } };
    let called = false;
    const spy = async () => { called = true; return []; };
    const result = await runIntentExtraction({ db, entryRef, entry, modelId: 'm', apiKey: 'k', extractCandidates: spy });
    expect(called).toBe(false);
    expect(result.ran).toBe(false);
  });

  it('a model failure propagates and NO marker is committed (retry stays possible)', async () => {
    const { db, store, entryRef } = setup();
    const entry = { id: 'e1', text: entryText, entryInputVersion: 3 };
    const boom = async () => { throw new Error('gemini-intent-extract 503'); };
    await expect(runIntentExtraction({ db, entryRef, entry, modelId: 'm', apiKey: 'k', extractCandidates: boom })).rejects.toThrow(/503/);
    expect(store.get(`${USER_BASE}/entries/e1`)).toBeUndefined();
  });
});
