/**
 * Tests for the storage-triggered background-upload commit (task B5): the
 * finalize guard chain (flag / consent / duplicate / size), the success path
 * (transcribe → create entry → delete audio), the failure path (keep audio),
 * the core-entry shape, and the retention sweeper. All Firebase deps are
 * injected so this is a pure unit test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processCaptureAudioObject,
  sweepCaptureUploads,
  buildBackgroundCoreEntry,
  parseCaptureObjectPath,
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

function makeDeps({
  flagOn = true,
  allowed = true,
  duplicate = false,
  transcribeResult = { rawTranscript: 'raw', transcript: 'clean', toneAnalysis: null, engine: 'gemini' },
  file = makeFile(),
} = {}) {
  const add = vi.fn().mockResolvedValue({ id: 'new-entry' });
  const get = vi.fn().mockResolvedValue({ empty: !duplicate });
  const limit = vi.fn().mockReturnValue({ get });
  const where = vi.fn().mockReturnValue({ limit });
  const collection = vi.fn().mockReturnValue({ where, add });
  const db = { collection };

  const bucketFile = vi.fn().mockReturnValue(file);
  const storage = { bucket: vi.fn().mockReturnValue({ file: bucketFile }) };

  const log = vi.fn();
  const transcribe = vi.fn().mockResolvedValue(transcribeResult);
  const getFlag = vi.fn().mockResolvedValue(flagOn);
  const isAllowed = vi.fn().mockResolvedValue(allowed);

  return {
    deps: { db, storage, FieldValue, getFlag, isAllowed, log, transcribe },
    add, where, get, file, bucketFile, log, transcribe, getFlag, isAllowed,
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
    expect(t.add).not.toHaveBeenCalled();
  });

  it('consent revoked: deletes without transcribing', async () => {
    const t = makeDeps({ allowed: false });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'consent-denied' });
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.add).not.toHaveBeenCalled();
    expect(t.isAllowed).toHaveBeenCalledWith(t.deps.db, 'user-1');
  });

  it('duplicate operationId: deletes object, creates no second entry', async () => {
    const t = makeDeps({ duplicate: true });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'duplicate' });
    expect(t.where).toHaveBeenCalledWith('operationId', '==', OP_ID);
    expect(t.add).not.toHaveBeenCalled();
    expect(t.transcribe).not.toHaveBeenCalled();
    expect(t.file.delete).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized audio before downloading', async () => {
    const t = makeDeps();
    const res = await processCaptureAudioObject(object({ size: MAX_AUDIO_BYTES + 1 }), t.deps);
    expect(res).toMatchObject({ status: 'deleted', reason: 'too-large' });
    expect(t.file.download).not.toHaveBeenCalled();
    expect(t.transcribe).not.toHaveBeenCalled();
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
      object({ metadata: { capturedAt: '2026-07-20T10:00:00Z', captureTimezone: 'America/Los_Angeles' } }),
      t.deps
    );

    expect(res.status).toBe('created');
    expect(t.transcribe).toHaveBeenCalledWith({ base64: Buffer.from('audio-bytes').toString('base64'), mimeType: 'audio/mp4' });

    const entry = t.add.mock.calls[0][0];
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

    // audio deleted AFTER the entry write
    expect(t.file.delete).toHaveBeenCalledTimes(1);
    const addOrder = t.add.mock.invocationCallOrder[0];
    const delOrder = t.file.delete.mock.invocationCallOrder[0];
    expect(addOrder).toBeLessThan(delOrder);
  });

  it('sets capturedAt/captureTimezone to null when the client provided no metadata', async () => {
    const t = makeDeps();
    await processCaptureAudioObject(object({ metadata: undefined }), t.deps);
    const entry = t.add.mock.calls[0][0];
    expect(entry.capturedAt).toBeNull();
    expect(entry.captureTimezone).toBeNull();
  });
});

describe('processCaptureAudioObject — failure path', () => {
  it('keeps the object when transcription returns an error', async () => {
    const t = makeDeps({ transcribeResult: { error: 'API_ERROR' } });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res).toMatchObject({ status: 'kept', reason: 'transcription-failed' });
    expect(t.add).not.toHaveBeenCalled();
    expect(t.file.delete).not.toHaveBeenCalled();
  });

  it('keeps the object when a download/transcribe exception is thrown', async () => {
    const file = makeFile();
    file.download.mockRejectedValue(new Error('boom'));
    const t = makeDeps({ file });
    const res = await processCaptureAudioObject(object(), t.deps);
    expect(res.status).toBe('kept');
    expect(t.add).not.toHaveBeenCalled();
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
