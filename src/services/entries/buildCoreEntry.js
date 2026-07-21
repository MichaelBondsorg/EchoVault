/**
 * buildCoreEntry — pure builder for the DURABLE core journal entry.
 *
 * Part of the "core-first save" redesign (flag: coreFirstSave). The core
 * entry is the object persisted FIRST, before any optional enrichment. It
 * carries capture-time provenance (capturedAt, captureTimezone) so that the
 * post-save enrichment runner can derive weather/health/temporal context
 * against the moment of capture rather than the moment enrichment happens.
 *
 * Extracted verbatim (field names / shapes preserved) from the previous
 * inline `entryData` construction in App.jsx#doSaveEntry so that nothing
 * downstream (Firestore consumers, analysis pipeline, EntryCard) breaks.
 *
 * IMPORTANT: The core object deliberately contains NONE of the optional
 * enrichment fields (healthContext / location / environmentContext /
 * localAnalysis / temporalContext / futureMentions). Those are added later
 * by enrichmentRunner via a post-save updateDoc. Missing context stays
 * ABSENT — this builder never null-stuffs optional fields into the write.
 *
 * `Timestamp` is imported directly from `firebase/firestore` (not the app's
 * config/firebase) so this stays a pure, side-effect-free module: no Firebase
 * app initialization happens on import.
 */
import { Timestamp } from 'firebase/firestore';

/**
 * @param {Object} args
 * @param {string} args.text                Final entry text (reply-context already prepended).
 * @param {string} [args.category]          Entry category ('cat'); omitted when falsy.
 * @param {Object} args.user                Authenticated user ({ uid }).
 * @param {Object|string|null} [args.transcription]  Voice transcription source: { rawTranscript }
 *                                          (or the raw transcript string). Absent for typed entries.
 * @param {Object|boolean} args.consentSnapshot  Consent captured at save time:
 *                                          { aiProcessingConsent: boolean } or a bare boolean.
 * @param {Object} args.captureContext      { capturedAt (ISO), captureTimezone (IANA), coarseLocation }.
 *                                          coarseLocation is for the enrichment runner and is NOT
 *                                          stored on the core entry.
 * @param {Object} [args.safety]            { safetyFlagged, safetyUserResponse, hasWarning }. Safety
 *                                          state derives from TEXT upstream (crisis keywords / warning
 *                                          indicators), never from enrichment.
 * @param {string} args.platform            'ios' | 'android' | 'web'.
 * @param {Object|null} [args.voiceTone]    Capture-time voice tone analysis (from a voice recording).
 *                                          Not part of the specified signature but IS capture-time
 *                                          provenance and belongs on the core write (voiceMoodScore
 *                                          rule preserved from the legacy path).
 * @param {string} [args.operationId]       Capture pipeline operation id (voice pipeline supplies it
 *                                          in a later task; optional now).
 * @param {string|null} [args.spaceId]      Context Space (PRD R1 Context Spaces) the entry is
 *                                          captured into. Omitted from the write entirely when
 *                                          null/absent — entries are unscoped by default; only an
 *                                          explicit selection sets this (see EntryBar's capture
 *                                          pill / spacesService.getLastCaptureSpaceId).
 * @returns {Object} The core entry object to persist FIRST via addDoc.
 */
export function buildCoreEntry({
  text,
  category,
  user,
  transcription,
  consentSnapshot,
  captureContext,
  safety,
  platform,
  voiceTone = null,
  operationId,
  spaceId,
} = {}) {
  const aiProcessingConsent = typeof consentSnapshot === 'boolean'
    ? consentSnapshot
    : (consentSnapshot?.aiProcessingConsent !== false);

  const isNative = platform === 'ios' || platform === 'android';

  const capturedAt = captureContext?.capturedAt ?? new Date().toISOString();
  const captureTimezone = captureContext?.captureTimezone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const entry = {
    text,
    analysisStatus: aiProcessingConsent ? 'pending' : 'disabled',
    aiProcessingConsent,
    userId: user?.uid,
    createdAt: Timestamp.now(),
    // effectiveDate is anchored to capture time. Per the temporal redesign it
    // always equals "now"; signals (not backdating) own temporal attribution.
    effectiveDate: Timestamp.fromDate(new Date(capturedAt)),
    createdOnPlatform: platform,
    signalExtractionVersion: 1,
    // Web entries never have on-device health data; flag them so the native
    // backfill effect picks them up (matches legacy `!healthContext && !isNative`,
    // where healthContext is always absent on web).
    needsHealthContext: !isNative,
    // New capture-provenance fields:
    entryInputVersion: 1,
    capturedAt,
    captureTimezone,
    enrichment: { status: 'pending', requestedAt: new Date().toISOString() },
  };

  // Only set category when present — the core write must not stuff undefined
  // into Firestore.
  if (category) {
    entry.category = category;
  }

  // Only set spaceId when a space was explicitly selected — same
  // no-null-stuffing rule as category. Unscoped is the default; entries
  // never carry a `spaceId: null` field.
  if (spaceId) {
    entry.spaceId = spaceId;
  }

  const rawTranscript = typeof transcription === 'string'
    ? transcription
    : (transcription?.rawTranscript ?? null);
  if (rawTranscript) {
    entry.transcription = {
      rawTranscript,
      cleanedTranscript: text,
      schemaVersion: 1,
      correctedByUser: false,
    };
  }

  if (voiceTone) {
    entry.voiceTone = {
      moodScore: voiceTone.moodScore,
      energy: voiceTone.energy,
      emotions: voiceTone.emotions,
      confidence: voiceTone.confidence,
      summary: voiceTone.summary,
      analyzedAt: Timestamp.now(),
    };
    // Seed initial analysis mood from voice tone only when confident enough.
    if (voiceTone.confidence >= 0.6) {
      entry.voiceMoodScore = voiceTone.moodScore;
    }
  }

  if (safety?.safetyFlagged) {
    entry.safety_flagged = true;
    if (safety.safetyUserResponse) {
      entry.safety_user_response = safety.safetyUserResponse;
    }
  }
  if (safety?.hasWarning) {
    entry.has_warning_indicators = true;
  }

  if (operationId) {
    entry.operationId = operationId;
  }

  return entry;
}

export default buildCoreEntry;
