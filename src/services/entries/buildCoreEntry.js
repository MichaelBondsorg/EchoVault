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

// Voice Chapters (Task 14 review — Important 2b): the server's join
// validation (extractChapters in fusedTranscription.js) normalizes
// whitespace before comparing joined chapter text against the transcript —
// so a chapter response that PASSED server validation can still carry
// internal whitespace (collapsed/extra spaces) that doesn't byte-match the
// client's stored cleaned transcript. Escapes regex specials per token and
// joins tokens with `\s+` so token-level content still matches even when the
// whitespace between tokens differs.
const escapeRegExpToken = (token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Locate `chapterText` in `text` starting at-or-after `cursor`. Tries an
 * exact `indexOf` first (fast path, preserves prior behavior byte-for-byte);
 * only falls back to a whitespace-tolerant regex search when the exact match
 * fails. Returns `null` (never throws) if neither search finds it — the
 * caller's fail-safe (no chapters) still applies.
 */
function findChapterText(text, chapterText, cursor) {
  const exactIndex = text.indexOf(chapterText, cursor);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + chapterText.length };
  }

  const tokens = chapterText.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const pattern = tokens.map(escapeRegExpToken).join('\\s+');
  const tolerantSearch = new RegExp(pattern, 'g');
  tolerantSearch.lastIndex = cursor;
  const match = tolerantSearch.exec(text);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

/**
 * Voice Chapters (Task 14, flag: voiceChapters) — turns the server's
 * marker-aligned chapters (each `{startMs, title, text}`, already validated
 * server-side to reconstruct the transcript when joined — see
 * `functions/src/transcription/fusedTranscription.js#extractChapters`) into
 * char offsets into the ACTUAL stored cleaned-transcript string.
 *
 * Walks forward with `indexOf(chapterText, cursor)`, resuming from the
 * previous chapter's end each time — never re-searching from 0 — so a
 * transcript with duplicate/repeated phrasing (e.g. two chapters that both
 * start "I said hello...") still lands each chapter at its real, later
 * position instead of re-matching an earlier occurrence.
 *
 * Task 14 review (Important 2b): the server's join validation normalizes
 * whitespace before comparing, so a chapter that PASSED that validation can
 * still fail a raw `indexOf` here (collapsed/extra internal spaces). When
 * the exact match fails, `findChapterText` retries with a whitespace-
 * tolerant regex (chapter text tokens joined by `\s+`) before giving up.
 *
 * Returns null (never throws) if any chapter's text can't be found in order,
 * by either search — chapters are metadata layered on top of an already-
 * successful transcription/save; a failed walk must never block the save.
 */
function computeChapterOffsets(rawChapters, text) {
  if (typeof text !== 'string' || !text || !Array.isArray(rawChapters) || rawChapters.length === 0) {
    return null;
  }
  let cursor = 0;
  const result = [];
  for (let index = 0; index < rawChapters.length; index++) {
    const chapterText = rawChapters[index]?.text;
    if (typeof chapterText !== 'string' || !chapterText) return null;
    const match = findChapterText(text, chapterText, cursor);
    if (!match) return null;
    const { start: charStart, end: charEnd } = match;
    result.push({
      id: `ch_${index}`,
      index,
      startMs: Number(rawChapters[index].startMs) || 0,
      title: typeof rawChapters[index].title === 'string' ? rawChapters[index].title : '',
      charStart,
      charEnd,
    });
    cursor = charEnd;
  }
  return result;
}

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
 * @param {Array<{startMs:number,title:string,text:string}>|null} [args.chapters]
 *                                          Voice Chapters (Task 14, flag: voiceChapters) — raw
 *                                          marker-aligned chapters from the transcription response
 *                                          (server already validated their joined text reconstructs
 *                                          the transcript). Offsets are computed here against the
 *                                          stored cleaned transcript; a failed offset walk omits
 *                                          `transcription.chapters` entirely rather than blocking
 *                                          the save. Ignored when there's no transcription.
 * @param {number|null} [args.audioDurationMs]  Total recording duration (ms), captured alongside
 *                                          markers (Task 13). Independent of chapters succeeding —
 *                                          omitted (no null-stuffing) unless a positive finite number.
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
  chapters = null,
  audioDurationMs = null,
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

    // Voice Chapters (Task 14, flag: voiceChapters) — metadata only. A
    // failed/mismatched offset walk NEVER blocks the save; it just omits
    // transcription.chapters (logged once so it's visible without breaking
    // capture).
    if (Array.isArray(chapters) && chapters.length > 0) {
      const computed = computeChapterOffsets(chapters, entry.transcription.cleanedTranscript);
      if (computed) {
        entry.transcription.chapters = computed;
      } else {
        console.warn('[buildCoreEntry] Chapter offset walk failed — saving without chapters', {
          chapterCount: chapters.length,
        });
      }
    }
  }

  // Independent of chapters succeeding — duration is capture metadata
  // (Task 13), useful for the audio player even without a valid segmentation.
  if (Number.isFinite(audioDurationMs) && audioDurationMs > 0) {
    entry.audioDurationMs = audioDurationMs;
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
