import { describe, it, expect, vi } from 'vitest';
import { resumeIncompleteOperations } from '../resumeOperations';

const OWNER = 'user-a';

// A fake operation store whose behaviour we can assert against.
const makeStore = (ops) => {
  const state = ops.map((o) => ({ attempts: 0, ...o }));
  return {
    _state: state,
    listIncomplete: vi.fn(async () => state.filter((o) => o.stage !== 'complete')),
    advance: vi.fn(async (uid, opId, stage, meta = {}) => {
      const op = state.find((o) => o.opId === opId);
      if (op) { op.stage = stage; if (meta.entryId) op.entryId = meta.entryId; }
    }),
    completeOperation: vi.fn(async (uid, opId) => {
      const op = state.find((o) => o.opId === opId);
      if (op) op.stage = 'complete';
    }),
    markNeedsAttention: vi.fn(async (uid, opId, code) => {
      const op = state.find((o) => o.opId === opId);
      if (op) { op.stage = 'needs_attention'; op.attempts += 1; op.lastError = code; }
    }),
  };
};

const makeVault = (present) => ({
  getRecording: vi.fn(async (uid, recId) => (present.has(recId) ? { base64: 'QUJD', mime: 'audio/mp4' } : null)),
});

describe('resumeIncompleteOperations', () => {
  it('idempotent duplicate-delivery guard: an already-saved entry completes the op WITHOUT re-transcribing', async () => {
    const store = makeStore([
      { opId: 'op-dup', ownerUid: OWNER, stage: 'transcribing', recordingId: 'rec_1_aaaaaa', attempts: 1 },
    ]);
    const vault = makeVault(new Set(['rec_1_aaaaaa']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => 'entry-existing');

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).not.toHaveBeenCalled();
    expect(store.advance).toHaveBeenCalledWith(OWNER, 'op-dup', 'entry_saved', { entryId: 'entry-existing' });
    expect(store.completeOperation).toHaveBeenCalledWith(OWNER, 'op-dup');
  });

  it('retries an in-flight op with vault audio and no existing entry', async () => {
    const store = makeStore([
      { opId: 'op-live', ownerUid: OWNER, stage: 'uploading', recordingId: 'rec_2_bbbbbb', attempts: 2 },
    ]);
    const vault = makeVault(new Set(['rec_2_bbbbbb']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).toHaveBeenCalledWith('rec_2_bbbbbb', 'op-live');
    expect(store.completeOperation).not.toHaveBeenCalled();
  });

  it('respects the attempts cap: >= 5 attempts is never auto-retried', async () => {
    const store = makeStore([
      { opId: 'op-capped', ownerUid: OWNER, stage: 'transcribing', recordingId: 'rec_3_cccccc', attempts: 5 },
    ]);
    const vault = makeVault(new Set(['rec_3_cccccc']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).not.toHaveBeenCalled();
    expect(findEntryByOperationId).not.toHaveBeenCalled();
  });

  it('audio-missing: an in-flight op with no vault audio goes to needs_attention', async () => {
    const store = makeStore([
      { opId: 'op-gone', ownerUid: OWNER, stage: 'local_ready', recordingId: 'rec_4_dddddd', attempts: 0 },
    ]);
    const vault = makeVault(new Set()); // nothing present
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).not.toHaveBeenCalled();
    expect(store.markNeedsAttention).toHaveBeenCalledWith(OWNER, 'op-gone', 'audio-missing');
  });

  it('entry_saved op with a persisted entry self-heals to complete', async () => {
    const store = makeStore([
      { opId: 'op-saved', ownerUid: OWNER, stage: 'entry_saved', recordingId: 'rec_5_eeeeee', entryId: 'entry-5', attempts: 1 },
    ]);
    const vault = makeVault(new Set(['rec_5_eeeeee']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => 'entry-5');

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(store.completeOperation).toHaveBeenCalledWith(OWNER, 'op-saved');
    expect(handleAudioRetry).not.toHaveBeenCalled();
  });

  it('entry_saved op whose entry vanished goes to needs_attention', async () => {
    const store = makeStore([
      { opId: 'op-lost', ownerUid: OWNER, stage: 'enriching', recordingId: 'rec_6_ffffff', attempts: 1 },
    ]);
    const vault = makeVault(new Set(['rec_6_ffffff']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(store.markNeedsAttention).toHaveBeenCalledWith(OWNER, 'op-lost', 'entry-missing');
    expect(store.completeOperation).not.toHaveBeenCalled();
  });

  it('leaves needs_attention ops untouched (surfaced, no auto-retry)', async () => {
    const store = makeStore([
      { opId: 'op-na', ownerUid: OWNER, stage: 'needs_attention', recordingId: 'rec_7_gggggg', attempts: 3 },
    ]);
    const vault = makeVault(new Set(['rec_7_gggggg']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async () => null);

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).not.toHaveBeenCalled();
    expect(store.completeOperation).not.toHaveBeenCalled();
    expect(store.markNeedsAttention).not.toHaveBeenCalled();
  });

  it('one failing op never aborts the resume of the others', async () => {
    const store = makeStore([
      { opId: 'op-boom', ownerUid: OWNER, stage: 'transcribing', recordingId: 'rec_8_hhhhhh', attempts: 0 },
      { opId: 'op-ok', ownerUid: OWNER, stage: 'transcribing', recordingId: 'rec_9_iiiiii', attempts: 0 },
    ]);
    const vault = makeVault(new Set(['rec_8_hhhhhh', 'rec_9_iiiiii']));
    const handleAudioRetry = vi.fn();
    const findEntryByOperationId = vi.fn(async (db, uid, opId) => {
      if (opId === 'op-boom') throw new Error('firestore down');
      return null;
    });

    await resumeIncompleteOperations({
      ownerUid: OWNER, db: {}, handleAudioRetry,
      store, vault, findEntryByOperationId,
    });

    expect(handleAudioRetry).toHaveBeenCalledWith('rec_9_iiiiii', 'op-ok');
  });
});
