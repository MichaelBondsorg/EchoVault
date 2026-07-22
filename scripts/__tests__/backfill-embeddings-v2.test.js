/**
 * `scripts/backfill-embeddings-v2.js` — gap mode (`--include-missing-v1`,
 * embeddings migration M4, v1-retirement resilience).
 *
 * Exercises the exported pure/injectable pieces directly (`classifyEntry`,
 * `resolveCheckpointPath`, `processEntryDoc`, `loadCheckpoint`/
 * `saveCheckpoint`) rather than the `main()` CLI entrypoint, which requires
 * real env vars and `admin.initializeApp()`. The module guards `main()`
 * behind an `import.meta.url === process.argv[1]` check specifically so it
 * is import-safe for this test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyEntry,
  resolveCheckpointPath,
  processEntryDoc,
  loadCheckpoint,
  saveCheckpoint,
  DEFAULT_CHECKPOINT_PATH,
  GAP_CHECKPOINT_PATH,
} from '../backfill-embeddings-v2.js';

function makeDoc(id, data, { uid = 'user-1' } = {}) {
  return {
    id,
    ref: {
      path: `artifacts/echo-vault-v5-fresh/users/${uid}/entries/${id}`,
      update: vi.fn().mockResolvedValue(undefined),
      parent: { parent: { id: uid } },
    },
    data: () => data,
  };
}

function makeFakeDb({ consentDenied = new Set() } = {}) {
  const store = new Map();
  return {
    store,
    doc(path) {
      return {
        async get() {
          if (path.endsWith('/settings/consent')) {
            const uid = path.split('/users/')[1]?.split('/')[0];
            if (consentDenied.has(uid)) {
              return { exists: true, data: () => ({ aiProcessing: false }) };
            }
            return { exists: false, data: () => undefined };
          }
          return { exists: store.has(path), data: () => store.get(path) };
        },
        async set(val, opts) {
          const existing = opts?.merge ? (store.get(path) || {}) : {};
          store.set(path, { ...existing, ...val });
        },
      };
    },
  };
}

describe('resolveCheckpointPath — separate checkpoint per mode (M4)', () => {
  it('default mode (false/undefined) resolves to the original checkpoint path', () => {
    expect(resolveCheckpointPath(false)).toBe(DEFAULT_CHECKPOINT_PATH);
    expect(resolveCheckpointPath(undefined)).toBe(DEFAULT_CHECKPOINT_PATH);
    expect(DEFAULT_CHECKPOINT_PATH).toBe('migration_state/embeddingsV2');
  });

  it('gap mode (--include-missing-v1) resolves to a DISTINCT checkpoint path', () => {
    expect(resolveCheckpointPath(true)).toBe(GAP_CHECKPOINT_PATH);
    expect(GAP_CHECKPOINT_PATH).toBe('migration_state/embeddingsV2gap');
    expect(GAP_CHECKPOINT_PATH).not.toBe(DEFAULT_CHECKPOINT_PATH);
  });
});

describe('classifyEntry — eligibility, default vs. gap mode', () => {
  it('default mode: has v1, no v2, has text -> eligible (unchanged contract)', () => {
    expect(classifyEntry({ embedding: [1, 2], text: 'hi' }, { includeMissingV1: false }))
      .toEqual({ eligible: true });
  });

  it('default mode: no v1 at all -> ineligible (that is gap mode\'s job)', () => {
    expect(classifyEntry({ text: 'hi' }, { includeMissingV1: false }))
      .toEqual({ eligible: false, reason: 'no-v1-use-gap-mode' });
  });

  it('gap mode: no v1, no v2, has text -> eligible (the M4 gap)', () => {
    expect(classifyEntry({ text: 'hi' }, { includeMissingV1: true }))
      .toEqual({ eligible: true });
  });

  it('gap mode: HAS v1 already -> ineligible (that is default mode\'s job, not fabricating/re-touching)', () => {
    expect(classifyEntry({ embedding: [1, 2], text: 'hi' }, { includeMissingV1: true }))
      .toEqual({ eligible: false, reason: 'has-v1-use-default-mode' });
  });

  it('either mode: already has v2 -> ineligible (idempotent skip)', () => {
    expect(classifyEntry({ embeddingV2: [1, 2, 3], text: 'hi' }, { includeMissingV1: false }))
      .toEqual({ eligible: false, reason: 'already-has-v2' });
    expect(classifyEntry({ embeddingV2: [1, 2, 3], text: 'hi' }, { includeMissingV1: true }))
      .toEqual({ eligible: false, reason: 'already-has-v2' });
  });

  it('either mode: no text -> ineligible', () => {
    expect(classifyEntry({}, { includeMissingV1: false })).toEqual({ eligible: false, reason: 'no-text' });
    expect(classifyEntry({ text: '   ' }, { includeMissingV1: true })).toEqual({ eligible: false, reason: 'no-text' });
  });
});

describe('processEntryDoc — dry-run counts (gap mode)', () => {
  let cp;
  beforeEach(() => {
    cp = { processed: 0, updated: 0, skipped: 0 };
  });

  it('gap-mode dry-run on an eligible entry increments `updated` WITHOUT calling ref.update or generateEmbeddingV2Fn', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e1', { text: 'no vectors yet' });
    const generateEmbeddingV2Fn = vi.fn();

    const result = await processEntryDoc(doc, cp, {
      db,
      apiKey: 'key',
      v2Model: 'gemini-embedding-2',
      dryRun: true,
      includeMissingV1: true,
      generateEmbeddingV2Fn,
    });

    expect(result).toEqual({ eligible: true, dryRun: true });
    expect(cp).toEqual({ processed: 1, updated: 1, skipped: 0 });
    expect(doc.ref.update).not.toHaveBeenCalled();
    expect(generateEmbeddingV2Fn).not.toHaveBeenCalled();
  });

  it('gap-mode dry-run skips (and does not count as updated) an entry that already has v1', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e2', { text: 'has v1 already', embedding: [1, 2] });

    const result = await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: true, includeMissingV1: true,
    });

    expect(result.eligible).toBe(false);
    expect(cp).toEqual({ processed: 1, updated: 0, skipped: 1 });
  });

  it('default-mode dry-run is unaffected by gap-only entries (no v1) — skips them', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e3', { text: 'no v1 at all' });

    const result = await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: true, includeMissingV1: false,
    });

    expect(result).toEqual({ eligible: false, reason: 'no-v1-use-gap-mode' });
    expect(cp).toEqual({ processed: 1, updated: 0, skipped: 1 });
  });
});

describe('processEntryDoc — real write payload (gap mode): v2-only, never fabricates v1', () => {
  let cp;
  beforeEach(() => {
    cp = { processed: 0, updated: 0, skipped: 0 };
  });

  it('writes exactly {embeddingV2, embeddingMeta} — the `embedding` key is never present in the payload', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e4', { text: 'gap entry' });
    const generateEmbeddingV2Fn = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3], dim: 3 });

    const result = await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: false, includeMissingV1: true, generateEmbeddingV2Fn,
    });

    expect(doc.ref.update).toHaveBeenCalledTimes(1);
    const [writtenUpdate] = doc.ref.update.mock.calls[0];
    expect(Object.keys(writtenUpdate).sort()).toEqual(['embeddingMeta', 'embeddingV2']);
    expect(writtenUpdate.embeddingV2).toEqual([0.1, 0.2, 0.3]);
    expect(writtenUpdate.embeddingMeta).toMatchObject({ model: 'gemini-embedding-2', dim: 3 });
    expect(Object.prototype.hasOwnProperty.call(writtenUpdate, 'embedding')).toBe(false);
    expect(result.eligible).toBe(true);
    expect(cp).toEqual({ processed: 1, updated: 1, skipped: 0 });
  });

  it('v2 generation failure -> skipped, no write', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e5', { text: 'gap entry, v2 fails' });
    const generateEmbeddingV2Fn = vi.fn().mockResolvedValue(null);

    const result = await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: false, includeMissingV1: true, generateEmbeddingV2Fn,
    });

    expect(result).toEqual({ eligible: false, reason: 'v2-generation-failed' });
    expect(doc.ref.update).not.toHaveBeenCalled();
    expect(cp).toEqual({ processed: 1, updated: 0, skipped: 1 });
  });

  it('consent-denied user -> skipped, no write, generateEmbeddingV2Fn never called', async () => {
    const db = makeFakeDb({ consentDenied: new Set(['blocked-user']) });
    const doc = makeDoc('e6', { text: 'gap entry' }, { uid: 'blocked-user' });
    const generateEmbeddingV2Fn = vi.fn();

    const result = await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: false, includeMissingV1: true, generateEmbeddingV2Fn,
    });

    expect(result).toEqual({ eligible: false, reason: 'consent' });
    expect(generateEmbeddingV2Fn).not.toHaveBeenCalled();
    expect(doc.ref.update).not.toHaveBeenCalled();
  });

  it('default mode (has v1, no v2) still writes v2-only too — never re-touches/duplicates the existing v1 field', async () => {
    const db = makeFakeDb();
    const doc = makeDoc('e7', { text: 'legacy v1 entry', embedding: [9, 9, 9] });
    const generateEmbeddingV2Fn = vi.fn().mockResolvedValue({ embedding: [0.4, 0.5], dim: 2 });

    await processEntryDoc(doc, cp, {
      db, apiKey: 'key', v2Model: 'gemini-embedding-2', dryRun: false, includeMissingV1: false, generateEmbeddingV2Fn,
    });

    const [writtenUpdate] = doc.ref.update.mock.calls[0];
    expect(Object.keys(writtenUpdate).sort()).toEqual(['embeddingMeta', 'embeddingV2']);
    expect(Object.prototype.hasOwnProperty.call(writtenUpdate, 'embedding')).toBe(false);
  });
});

describe('loadCheckpoint / saveCheckpoint — the two modes never share state', () => {
  it('gap-mode and default-mode checkpoints live under different doc paths and do not clobber each other', async () => {
    const db = makeFakeDb();

    await saveCheckpoint(db, DEFAULT_CHECKPOINT_PATH, { lastPath: 'a/1', processed: 5, updated: 3, skipped: 2 }, false, false);
    await saveCheckpoint(db, GAP_CHECKPOINT_PATH, { lastPath: 'b/9', processed: 7, updated: 7, skipped: 0 }, false, false);

    const defaultCp = await loadCheckpoint(db, DEFAULT_CHECKPOINT_PATH);
    const gapCp = await loadCheckpoint(db, GAP_CHECKPOINT_PATH);

    expect(defaultCp).toMatchObject({ lastPath: 'a/1', processed: 5, updated: 3, skipped: 2 });
    expect(gapCp).toMatchObject({ lastPath: 'b/9', processed: 7, updated: 7, skipped: 0 });
    expect(db.store.size).toBe(2);
  });

  it('a dry-run save is a no-op (does not persist), regardless of mode', async () => {
    const db = makeFakeDb();
    await saveCheckpoint(db, GAP_CHECKPOINT_PATH, { lastPath: 'x/1', processed: 1, updated: 1, skipped: 0 }, false, true);
    expect(db.store.size).toBe(0);
  });

  it('loadCheckpoint with restart:true ignores any existing checkpoint and starts fresh', async () => {
    const db = makeFakeDb();
    await saveCheckpoint(db, GAP_CHECKPOINT_PATH, { lastPath: 'x/1', processed: 9, updated: 9, skipped: 0 }, false, false);
    const cp = await loadCheckpoint(db, GAP_CHECKPOINT_PATH, true);
    expect(cp).toEqual({ lastPath: null, processed: 0, updated: 0, skipped: 0 });
  });
});
