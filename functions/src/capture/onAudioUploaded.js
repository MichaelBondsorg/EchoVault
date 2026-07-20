/**
 * onCaptureAudioUploaded — Storage-triggered, server-owned transcription commit
 * for the native background-upload path (plan task B5).
 *
 * When the iOS background URLSession PUTs a captured .m4a via a signed ticket
 * (see uploadTicket.js), the object finalizes at
 *   capture-uploads/{uid}/{opId}.m4a
 * and this trigger owns the rest: gate on the feature flag + consent, dedupe by
 * operationId, transcribe with the SAME fused helper the transcribeEntry
 * callable uses, and CREATE the core journal entry server-side. Raw audio is
 * retained only until a transcript succeeds (then deleted immediately); the
 * `captureUploadsRetention` sweeper is the backstop for anything left behind.
 *
 * The whole feature ships behind the default-OFF `nativeBackgroundUpload`
 * server flag: when off, any object that somehow lands here is DELETED (fail
 * safe — never leave orphaned audio) without transcription.
 *
 * Core logic (processCaptureAudioObject / sweepCaptureUploads) takes injected
 * dependencies so it is unit-testable without the Firebase runtime. The thin
 * onObjectFinalized / onSchedule wrappers that wire the real dependencies live
 * in functions/index.js (importing the Storage trigger wrapper here would
 * require a bucket name at module load, breaking unit tests). This module has
 * NO Firebase runtime imports on purpose.
 */
import { APP_COLLECTION_ID } from '../shared/constants.js';
import { CAPTURE_UPLOAD_PREFIX } from './uploadTicket.js';

// Server flag that gates the entire native-background-upload feature.
export const NATIVE_BACKGROUND_UPLOAD_FLAG = 'nativeBackgroundUpload';

// Reject audio larger than this before downloading it (cost/DoS bound).
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

// Retention sweeper deletes pending capture uploads older than this.
export const RETENTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Seed analysis mood from voice tone only when the model is confident enough.
// Copied from src/services/entries/buildCoreEntry.js so the two paths agree.
export const VOICE_TONE_CONFIDENCE_THRESHOLD = 0.6;

const CAPTURE_OBJECT_RE = /^capture-uploads\/([^/]+)\/([^/]+)\.m4a$/;

/**
 * Parse `capture-uploads/{uid}/{opId}.m4a`. Returns null for any other object
 * path so the trigger ignores unrelated finalize events (it fires bucket-wide).
 */
export function parseCaptureObjectPath(name) {
  const m = CAPTURE_OBJECT_RE.exec(String(name || ''));
  if (!m) return null;
  return { uid: m[1], operationId: m[2] };
}

/**
 * Build the core journal entry for a background-captured recording. Mirrors the
 * client's buildCoreEntry shape (src/services/entries/buildCoreEntry.js) but
 * uses server timestamps and marks provenance as 'ios-background'. Only the
 * durable core fields are written; enrichment stays pending.
 */
export function buildBackgroundCoreEntry(
  { cleaned, rawTranscript, userId, operationId, toneAnalysis, capturedAt, captureTimezone },
  { FieldValue: FV }
) {
  const entry = {
    text: cleaned,
    transcription: {
      rawTranscript: rawTranscript ?? cleaned,
      cleanedTranscript: cleaned,
      schemaVersion: 1,
      correctedByUser: false,
    },
    userId,
    createdAt: FV.serverTimestamp(),
    effectiveDate: FV.serverTimestamp(),
    // Provenance from the capture moment, IF the client supplied it via
    // signed-URL upload headers (custom object metadata); else null.
    capturedAt: capturedAt ?? null,
    captureTimezone: captureTimezone ?? null,
    // Consent was already asserted before we got here.
    analysisStatus: 'pending',
    aiProcessingConsent: true,
    entryInputVersion: 1,
    enrichment: { status: 'pending' },
    operationId,
    createdOnPlatform: 'ios-background',
  };

  if (toneAnalysis) {
    entry.voiceTone = {
      moodScore: toneAnalysis.moodScore,
      energy: toneAnalysis.energy,
      emotions: toneAnalysis.emotions,
      confidence: toneAnalysis.confidence,
      summary: toneAnalysis.summary,
      analyzedAt: FV.serverTimestamp(),
    };
    if (toneAnalysis.confidence >= VOICE_TONE_CONFIDENCE_THRESHOLD) {
      entry.voiceMoodScore = toneAnalysis.moodScore;
    }
  }

  return entry;
}

/**
 * Core finalize handler. See module header for the guard chain.
 *
 * @param {object} object  Finalized Storage object (name, bucket, size, contentType, metadata).
 * @param {object} deps
 * @param {object}  deps.db          admin Firestore.
 * @param {object}  deps.storage     admin Storage.
 * @param {object}  deps.FieldValue  admin FieldValue (serverTimestamp).
 * @param {Function} deps.getFlag    (name, default) => Promise<value>, pre-bound to db.
 * @param {Function} deps.isAllowed  (db, uid) => Promise<boolean> consent check.
 * @param {Function} deps.log        logStage(opId, stage, meta).
 * @param {Function} deps.transcribe ({base64, mimeType}) => Promise<result|{error}>.
 * @returns {Promise<{status:string, reason?:string}>}
 */
export async function processCaptureAudioObject(object, deps) {
  const { db, storage, FieldValue: FV, getFlag, isAllowed, log, transcribe } = deps;

  const name = object?.name;
  const parsed = parseCaptureObjectPath(name);
  if (!parsed) {
    return { status: 'ignored' }; // not a capture upload — nothing to do
  }
  const { uid, operationId } = parsed;

  const file = storage.bucket(object.bucket).file(name);
  const safeDelete = async () => {
    try { await file.delete(); } catch (_e) { /* already gone / benign */ }
  };

  // 1. Feature flag. Off ⇒ fail safe: delete so no orphaned audio lingers.
  const flagOn = await getFlag(NATIVE_BACKGROUND_UPLOAD_FLAG, false);
  if (!flagOn) {
    await safeDelete();
    log(operationId, 'needs_attention', { errorCode: 'feature-disabled' });
    return { status: 'deleted', reason: 'feature-disabled' };
  }

  // 2. Consent (revoked ⇒ delete without transcribing).
  const allowed = await isAllowed(db, uid);
  if (!allowed) {
    await safeDelete();
    log(operationId, 'needs_attention', { errorCode: 'consent-denied', uid });
    return { status: 'deleted', reason: 'consent-denied' };
  }

  // 3. Duplicate guard — an entry already exists for this op (redelivered event
  // or a client that also saved foreground). Delete the object, create nothing.
  const entriesRef = db.collection(`artifacts/${APP_COLLECTION_ID}/users/${uid}/entries`);
  const dup = await entriesRef.where('operationId', '==', operationId).limit(1).get();
  if (!dup.empty) {
    await safeDelete();
    log(operationId, 'duplicate_skipped', { errorCode: 'duplicate' });
    return { status: 'deleted', reason: 'duplicate' };
  }

  // 4. Size cap (checked from metadata before download).
  const bytes = Number(object.size || 0);
  if (bytes > MAX_AUDIO_BYTES) {
    await safeDelete();
    log(operationId, 'needs_attention', { errorCode: 'too-large', bytes });
    return { status: 'deleted', reason: 'too-large' };
  }

  // 5. Download → transcribe → create entry.
  try {
    const [buffer] = await file.download();
    const base64 = buffer.toString('base64');
    const mimeType = object.contentType || 'audio/mp4';
    const result = await transcribe({ base64, mimeType });

    if (!result || result.error || !result.transcript) {
      // Failure: LEAVE the object for the retention sweeper / manual retry.
      log(operationId, 'needs_attention', { errorCode: result?.error || 'transcription-empty', bytes });
      return { status: 'kept', reason: 'transcription-failed' };
    }

    // Capture provenance rides in as GCS custom metadata: the ticket signed
    // `x-goog-meta-captured-at` / `x-goog-meta-capture-timezone` PUT headers, and
    // GCS surfaces them here under the prefix-stripped, lowercased keys
    // `captured-at` / `capture-timezone` (NOT camelCase). Absent ⇒ null.
    const meta = object.metadata || {};
    const entry = buildBackgroundCoreEntry(
      {
        cleaned: result.transcript,
        rawTranscript: result.rawTranscript,
        userId: uid,
        operationId,
        toneAnalysis: result.toneAnalysis,
        capturedAt: meta['captured-at'] || null,
        captureTimezone: meta['capture-timezone'] || null,
      },
      { FieldValue: FV }
    );
    await entriesRef.add(entry);

    // Success ⇒ raw audio retention: delete immediately.
    await safeDelete();
    log(operationId, 'entry_saved', { engine: result.engine, bytes });
    return { status: 'created' };
  } catch (err) {
    // Leave the object; retention sweeper is the backstop.
    log(operationId, 'needs_attention', { errorCode: 'processing-exception' });
    return { status: 'kept', reason: 'exception', error: err?.message };
  }
}

/**
 * Retention sweeper core: delete pending capture uploads older than maxAgeMs.
 *
 * @param {object} deps
 * @param {object}   deps.storage   admin Storage.
 * @param {Function} deps.log       logStage.
 * @param {Function} [deps.now]     clock injection (tests).
 * @param {number}   [deps.maxAgeMs]
 * @returns {Promise<{deleted:number}>}
 */
export async function sweepCaptureUploads(deps) {
  const { storage, log, now = () => Date.now(), maxAgeMs = RETENTION_MAX_AGE_MS } = deps;

  const bucket = storage.bucket();
  const [files] = await bucket.getFiles({ prefix: `${CAPTURE_UPLOAD_PREFIX}/` });
  const cutoff = now() - maxAgeMs;

  let deleted = 0;
  for (const f of files) {
    const created = Date.parse(f?.metadata?.timeCreated || '') || 0;
    if (created && created < cutoff) {
      try {
        await f.delete();
        deleted += 1;
      } catch (_e) {
        /* already gone / benign */
      }
    }
  }

  log(null, 'retention_sweep', { count: deleted });
  return { deleted };
}

export default {
  processCaptureAudioObject,
  sweepCaptureUploads,
  buildBackgroundCoreEntry,
  parseCaptureObjectPath,
};
