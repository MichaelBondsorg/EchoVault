/**
 * Tests for the storage-triggered background-upload commit (task B5, CAP-01
 * idempotency hardening): the finalize guard chain (flag / consent /
 * duplicate / size), the success path (transcribe → create entry → delete
 * audio), the failure path (keep audio), the core-entry shape, the
 * transactional idempotency guard, and the retention sweeper. All Firebase
 * deps are injected so this is a pure unit test.
 *
 * Idempotency mechanism under test (CAP-01): the operationId embedded in the
 * Storage object path is also the id of a guard doc
 * (`captureUploadGuardRef`). A cheap non-transactional `.get()` short-circuits
 * the common redelivery case before paying for transcription; the
 * AUTHORITATIVE guarantee is a `db.runTransaction` that atomically re-checks
 * the guard and writes {entry, guard} together — so even two invocations
 * racing past the early check can create at most one entry, and a guard is
 * only ever written on SUCCESS (never on a transcription failure), so a
 * legitimate retry of a failed upload with the same operationId is not
 * wrongly blocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processCaptureAudioObject,
  sweepCaptureUploads,
  buildBackgroundCoreEntry,
  parseCaptureObjectPath,
  captureUploadGuardRef,
  MAX_AUDIO_BYTES,
  RETENTION_MAX_AGE_MS,
  VOICE_TONE_CONFIDENCE_THRESHOLD,
} from '../onAudioUploaded.js';

const FieldValue = { serverTimestamp: () => 'SERVER_TS' };
const OP_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OBJECT_NAME = `capture-uploads/user-1/${OP_ID}.m4a`;

function makeFile({ downloadBuffer = Buffer.from('audio-bytes') } = {}) {
  return {
    download: vi.fn().mockResolvedValue([downloadBuffer]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Builds an injectable Firestore double supporting exactly what
 * onAudioUploaded.js needs: `db.doc(path)` for the guard ref (with `.get()`
 * for the early check), `db.collection(path).doc()` for a fresh entry ref,
 * and `db.runTransaction(fn)` calling `fn({get, set})` against simple
 * in-memory maps keyed by ref identity — good enough to exercise real
 * read-your-own-write and cross-invocation race semantics without a Firestore
 * emulator.
 *
 * @param {boolean} guardExistsAtStart  Simulates a guard doc already present
 *   BEFORE this call runs at all (both the early `.get()` and the
 *   transaction's `tx.get()` see it as existing) — the "obvious redelivery"
 *   case.
 * @param {Function} [onTxGet]  Optional hook invoked exactly when the
 *   transaction's `tx.get(guard)` runs, so a test can mutate the guard store
 *   mid-flight to simulate a concurrent writer winning the race.
 */
function makeDeps({
  flagOn = true,
  allowed = true,
  guardExistsAtStart = false,
  onTxGet,
  transcribeResult = { rawTranscript: 'raw', transcript: 'clean', toneAnalysis: null, engine: 'gemini' },
  file = makeFile(),
} = {}) {
  const guardStore = new Map(); // guard doc path -> data
  const entryWrites = []; // {id, data} for every entry the transaction committed

  const guardPath = 'GUARD';
  if (guardExistsAtStart) guardStore.set(guardPath, { entryId: 'prior-entry', operationId: OP_ID });

  const guardDocRef = {
    __path: guardPath,
    get: vi.fn(async () => ({ exists: guardStore.has(guardPath), data: () => guardStore.get(guardPath) })),
  };
  const doc = vi.fn().mockReturnValue(guardDocRef);

  let nextEntryId = 0;
  const entryDoc = vi.fn(() => ({ id: `new-entry-${nextEntryId++}` }));
  const collection = vi.fn().mockReturnValue({ doc: entryDoc });

  const runTransaction = vi.fn(async (fn) => {
    const tx = {
      get: vi.fn(async (ref) => {
        if (onTxGet) onTxGet();
        if (ref === guardDocRef) {
          return { exists: guardStore.has(guardPath), data: () => guardStore.get(guardPath) };
        }
        return { exists: false };
      }),
      set: vi.fn((ref, data) => {
        if (ref === guardDocRef) {
          guardStore.set(guardPath, data);
        } else {
          entryWrites.push({ id: ref.id, data });
        }
      }),
    };
    return fn(tx);
  });

  const db = { doc, collection, runTransaction };

  const bucketFile = vi.fn().mockReturnValue(file);
  const storage = { bucket: vi.fn().mockReturnValue({ file: bucketFile }) };

  const log = vi.fn();
  const transcribe = vi.fn().mockResolvedValue(transcribeResult);
  const getFlag = vi.fn().mockResolvedValue(flagOn);
  const isAllowed = vi.fn().mockResolvedValue(allowed);

  return {
    deps: { db, storage, FieldValue, getFlag, isAllowed, log, transcribe },
    doc, collection, runTransaction, guardStore, entryWrites,
    file, bucketFile, log, transcribe, getFlag, isAllowed,
  };
}

const object = (over = {}) => ({
  name: OBJECT_NAME,
  bucket: 'default-bucket',
  size: 1024,
  contentType: 'audio/mp4',
  metadata: {},
  ...over,
});

describe('parseCaptureObjectPath', () => {
  it('parses a valid capture-uploads path', () => {
    expect(parseCaptureObjectPath(OBJECT_NAME)).toEqual({ uid: 'user-1', operationId: OP_ID });
  });
  it('returns null for unrelated object paths', () => {
    expect(parseCaptureObjectPath('reports/user-1/x.pdf')).toBeNull();
    expect(parseCaptureObjectPath('capture-uploads/user-1/x.txt')).toBeNull();
    expect(parseCaptureObjectPath(null)).toBeNull();
  });
});

describe('processCaptureAudioObject — guard chain', () => {
  it('ignores objects outside capture-uploads (no side effects)', async () => {
    const t = makeDeps();
    const res = await processCaptureAudioObject(object({ name: 'reports/u/x.pdf' }), t.deps);
    expect(res.status).toBe('ignored');
    expect(t.getFlag).not.toHaveBeenCalled();
    expect(t.transcribe).not.toHaveBeenCalled();
  });

  it('flag OFF: deletes the object (fail safe) and does not transcribe', async () => {
    const t = makeDeps({ flagOn: false });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'feature-disabled' });
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.entryWrites).toHaveLength(0);
  });

  it('consent revoked: deletes without transcribing', async () => {
    const t = makeDeps({ allowed: false });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'consent-denied' });
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.entryWrites).toHaveLength(0);
    expect(t.isAllowed).toHaveBeenCalledWith(t.deps.db, 'user-1');
  });

  it('duplicate operationId (guard already exists before this call): deletes object, creates no entry, never downloads/transcribes', async () => {
    const t = makeDeps({ guardExistsAtStart: true });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'duplicate' });
    expect(t.doc).toHaveBeenCalledWith(
      `artifacts/echo-vault-v5-fresh/users/user-1/captureUploadGuards/${OP_ID}`
    );
    expect(t.entryWrites).toHaveLength(0);
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.file.download).not.toHaveBeenCalled();
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    expect(t.log).toHaveBeenCalledWith(OP_ID, 'duplicate_skipped', expect.anything());
  });

  it('rejects oversized audio before downloading', async () => {
    const t = makeDeps();
    const res = await processCaptureAudioObject(object({ size: MAX_AUDIO_BYTES + 1 }), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'too-large' });
    expect(t.file.download).not.toHaveBeenCalled();
    expect(t.transcribe).not.toHaveBeenCalled();
  });
});

describe('processCaptureAudioObject — idempotency guard (CAP-01)', () => {
  it('captureUploadGuardRef builds the owner-scoped guard doc path from operationId', () => {
    const doc = vi.fn();
    captureUploadGuardRef({ doc }, 'uid-9', OP_ID);
    expect(doc).toHaveBeenCalledWith(`artifacts/echo-vault-v5-fresh/users/uid-9/captureUploadGuards/${OP_ID}`);
  });

  it('a race won by a CONCURRENT invocation (guard appears only between the early check and the transaction) creates no second entry', async () => {
    // Simulates two invocations of the SAME finalize event (or a redelivered
    // one) both passing the early, non-transactional guard.get() check
    // before either has committed anything — the transaction is the only
    // thing standing between them and a duplicate entry.
    const t = makeDeps({
      onTxGet: () => {
        // A "concurrent" writer commits the guard the instant this
        // invocation's transaction tries to read it.
        t.guardStore.set('GUARD', { entryId: 'winner-entry', operationId: OP_ID });
      },
    });
    const res = await processCaptureAudioObject(object(), t.deps);

    expect(res).toMatchObject({ status: 'deleted', reason: 'duplicate' });
    expect(t.transcribe).toHaveBeenCalledTimes(1); // already paid for before the race was detected
    expect(t.entryWrites).toHaveLength(0); // but no second entry was ever written
    expect(t.file.delete).toHaveBeenCalledTimes(1);
  });

  it('writes the guard doc ONLY alongside the entry, inside the same transaction', async () => {
    const t = makeDeps();
    await processCaptureAudioObject(object(), t.deps);

    expect(t.entryWrites).toHaveLength(1);
    expect(t.guardStore.get('GUARD')).toMatchObject({ operationId: OP_ID, entryId: t.entryWrites[0].id });
    expect(t.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('a transcription FAILURE never writes a guard doc — a later legitimate retry with the same operationId is not blocked', async () => {
    const failing = makeDeps({ transcribeResult: { error: 'API_ERROR' } });
    const failRes = await processCaptureAudioObject(object(), failing.deps);
    expect(failRes).toMatchObject({ status: 'kept', reason: 'transcription-failed' });
    expect(failing.guardStore.size).toBe(0); // no guard left behind by the failed attempt

    // A second, independent invocation for the SAME operationId (the retry —
    // e.g. the client re-PUT the object after the user got back online)
    // starts from a fresh guard store exactly like this one, and succeeds.
    const retry = makeDeps({});
    const retryRes = await processCaptureAudioObject(object(), retry.deps);
    expect(retryRes.status).toBe('created');
    expect(retry.entryWrites).toHaveLength(1);
  });
});

describe('processCaptureAudioObject — success path', () => {
  it('transcribes, creates the core entry, then deletes the audio', async () => {
    const t = makeDeps({
      transcribeResult: {
        rawTranscript: 'I had, um, a good day.',
        transcript: 'I had a good day.',
        toneAnalysis: { moodScore: 0.82, energy: 'high', emotions: ['happy'], confidence: 0.9, summary: 'Upbeat.' },
        engine: 'gemini',
      },
    });
    const res = await processCaptureAudioObject(
      // GCS surfaces x-goog-meta-* headers under prefix-stripped, lowercased keys.
      object({ metadata: { 'captured-at': '2026-07-20T10:00:00Z', 'capture-timezone': 'America/Los_Angeles' } }),
      t.deps
    );

    expect(res.status).toBe('created');
    expect(t.transcribe).toHaveBeenCalledWith({ base64: Buffer.from('audio-bytes').toString('base64'), mimeType: 'audio/mp4' });

    expect(t.entryWrites).toHaveLength(1);
    const entry = t.entryWrites[0].data;
    expect(entry).toMatchObject({
      text: 'I had a good day.',
      userId: 'user-1',
      operationId: OP_ID,
      analysisStatus: 'pending',
      aiProcessingConsent: true,
      entryInputVersion: 1,
      createdOnPlatform: 'ios-background',
      capturedAt: '2026-07-20T10:00:00Z',
      captureTimezone: 'America/Los_Angeles',
    });
    expect(entry.transcription).toMatchObject({ rawTranscript: 'I had, um, a good day.', cleanedTranscript: 'I had a good day.', schemaVersion: 1, correctedByUser: false });
    expect(entry.voiceMoodScore).toBe(0.82); // confidence >= threshold
    expect(entry.createdAt).toBe('SERVER_TS');

    // audio deleted AFTER the transaction commits
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    const txOrder = t.runTransaction.mock.invocationCallOrder[0];
    const delOrder = t.file.delete.mock.invocationCallOrder[0];
    expect(txOrder).toBeLessThan(delOrder);
  });

  it('sets capturedAt/captureTimezone to null when the client provided no metadata', async () => {
    const t = makeDeps();
    await processCaptureAudioObject(object({ metadata: undefined }), t.deps);
    const entry = t.entryWrites[0].data;
    expect(entry.capturedAt).toBeNull();
    expect(entry.captureTimezone).toBeNull();
  });

  it('passes space-id metadata through as spaceId on the core entry', async () => {
    const t = makeDeps();
    await processCaptureAudioObject(object({ metadata: { 'space-id': 'space-42' } }), t.deps);
    const entry = t.entryWrites[0].data;
    expect(entry.spaceId).toBe('space-42');
  });

  it('omits spaceId when no space-id metadata is present', async () => {
    const t = makeDeps();
    await processCaptureAudioObject(object({ metadata: {} }), t.deps);
    const entry = t.entryWrites[0].data;
    expect(entry).not.toHaveProperty('spaceId');
  });
});

describe('processCaptureAudioObject — failure path', () => {
  it('keeps the object when transcription returns an error', async () => {
    const t = makeDeps({ transcribeResult: { error: 'API_ERROR' } });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'kept', reason: 'transcription-failed' });
    expect(t.entryWrites).toHaveLength(0);
    expect(t.file.delete).not.toHaveBeenCalled();
  });

  it('keeps the object when a download/transcribe exception is thrown', async () => {
    const file = makeFile();
    file.download.mockRejectedValue(new Error('boom'));
    const t = makeDeps({ file });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res.status).toBe('kept');
    expect(t.entryWrites).toHaveLength(0);
    expect(t.file.delete).not.toHaveBeenCalled();
  });
});

describe('buildBackgroundCoreEntry', () => {
  it('omits voiceMoodScore when tone confidence is below threshold', () => {
    const entry = buildBackgroundCoreEntry(
      {
        cleaned: 'hi', rawTranscript: 'hi', userId: 'u', operationId: OP_ID,
        toneAnalysis: { moodScore: 0.5, energy: 'low', emotions: [], confidence: VOICE_TONE_CONFIDENCE_THRESHOLD - 0.01, summary: 's' },
        capturedAt: null, captureTimezone: null,
      },
      { FieldValue }
    );
    expect(entry.voiceTone).toBeTruthy();
    expect(entry.voiceMoodScore).toBeUndefined();
  });

  it('falls back rawTranscript to the cleaned transcript when absent', () => {
    const entry = buildBackgroundCoreEntry(
      { cleaned: 'only clean', rawTranscript: null, userId: 'u', operationId: OP_ID, toneAnalysis: null },
      { FieldValue }
    );
    expect(entry.transcription.rawTranscript).toBe('only clean');
    expect(entry.voiceTone).toBeUndefined();
  });

  it('includes spaceId only when a non-null space is passed', () => {
    const withSpace = buildBackgroundCoreEntry(
      { cleaned: 'hi', rawTranscript: 'hi', userId: 'u', operationId: OP_ID, toneAnalysis: null, spaceId: 'space-1' },
      { FieldValue }
    );
    expect(withSpace.spaceId).toBe('space-1');

    const without = buildBackgroundCoreEntry(
      { cleaned: 'hi', rawTranscript: 'hi', userId: 'u', operationId: OP_ID, toneAnalysis: null, spaceId: null },
      { FieldValue }
    );
    expect(without).not.toHaveProperty('spaceId');
  });
});

describe('sweepCaptureUploads', () => {
  function fileWithAge(ageMs, nowMs) {
    return {
      metadata: { timeCreated: new Date(nowMs - ageMs).toISOString() },
      delete: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('deletes only objects older than the retention window', async () => {
    const nowMs = Date.parse('2026-07-20T00:00:00Z');
    const oldFile = fileWithAge(RETENTION_MAX_AGE_MS + 60_000, nowMs);
    const freshFile = fileWithAge(60_000, nowMs);
    const getFiles = vi.fn().mockResolvedValue([[oldFile, freshFile]]);
    const storage = { bucket: vi.fn().mockReturnValue({ getFiles }) };
    const log = vi.fn();

    const res = await sweepCaptureUploads({ storage, log, now: () => nowMs });

    expect(res.deleted).toBe(1);
    expect(oldFile.delete).toHaveBeenCalledTimes(1);
    expect(freshFile.delete).not.toHaveBeenCalled();
    expect(getFiles).toHaveBeenCalledWith({ prefix: 'capture-uploads/' });
    expect(log).toHaveBeenCalledWith(null, 'retention_sweep', { count: 1 });
  });

  it('returns 0 and logs when nothing is old enough', async () => {
    const nowMs = Date.now();
    const getFiles = vi.fn().mockResolvedValue([[fileWithAge(1000, nowMs)]]);
    const storage = { bucket: vi.fn().mockReturnValue({ getFiles }) };
    const log = vi.fn();
    const res = await sweepCaptureUploads({ storage, log, now: () => nowMs });
    expect(res.deleted).toBe(0);
  });
});
