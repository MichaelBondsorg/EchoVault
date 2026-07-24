/**
 * Fused transcription: one Gemini audio-in call that transcribes with light
 * cleanup AND analyzes voice tone. Replaces Whisper + destructive filler
 * regex + separate Gemini tone call. Cleanup philosophy ported from Cosmo:
 * the model hears the audio, removes disfluencies, never restructures.
 */
import { transcribeWithWhisper } from '../shared/openai.js';
import { logModelManifest } from '../models/registry.js';

// Verify against the live models list before changing (see plan Task 2 Step 1).
export const GEMINI_TRANSCRIBE_MODEL = 'gemini-2.5-flash';

// Bound the Gemini/Whisper network call so a hung API can't consume the whole
// function budget. Mirrors TRANSCRIBE_TIMEOUT_MS in functions/index.js.
export const FUSED_TRANSCRIBE_TIMEOUT_MS = 120_000;

export const TRANSCRIPTION_PROMPT = `Transcribe this audio with light cleanup:

- Remove filler words (um, uh, like, you know, basically, sort of) ONLY when used as fillers
- Remove false starts and self-corrections
- Keep the natural flow but make it readable, with normal punctuation and paragraph breaks for topic shifts

Do NOT try to:
- Restructure into bullet points
- Fix proper nouns you don't recognize
- Summarize or condense meaning
- Delete adjectives, adverbs, or other content words

Return both the verbatim transcript and the lightly cleaned transcript. The
rawTranscript must preserve every intelligible spoken word. Use known proper
nouns only to correct spelling; never change meaning to force a match.

Separately, analyze the speaker's emotional tone from the voice itself (pace, pitch, pauses, energy).

Return JSON only, exactly this shape:
{
  "rawTranscript": "<verbatim transcript>",
  "transcript": "<cleaned transcript as natural sentences>",
  "toneAnalysis": {
    "moodScore": <number 0-1, 0 = very negative/distressed, 1 = very positive/joyful>,
    "energy": "<low|medium|high>",
    "emotions": ["<emotion1>", "<emotion2>"],
    "confidence": <number 0-1 indicating analysis confidence>,
    "summary": "<one sentence describing their emotional state>"
  }
}

If there is no intelligible speech, return {"rawTranscript": "", "transcript": "", "toneAnalysis": null}.`;

const normalizeProperNouns = (properNouns) =>
  Array.from(new Set((Array.isArray(properNouns) ? properNouns : [])
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().replace(/[\r\n,]+/g, ' '))
    .filter((value) => value.length > 0 && value.length <= 80)))
    .slice(0, 50);

// Voice Chapters (Task 14, flag: voiceChapters). Markers are captured
// client-side (Task 13) as canonical [{tMs}]; normalize/sort/dedupe defensively
// here since the prompt's chapter count and startMs list derive directly from
// this list.
const normalizeMarkers = (markers) => Array.from(new Set(
  (Array.isArray(markers) ? markers : [])
    .map((m) => Number(m?.tMs))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
)).sort((a, b) => a - b);

// Voice Chapters (Task 14 review — Important 3 + MINOR): THE single source of
// truth for chapter boundary timestamps. Every one of the prompt builder, the
// response validator, and the startMs overwrite derives its boundary count
// and values from this SAME list, so they can never disagree.
//
// - Drops any marker beyond the recording's duration (MINOR review fix): a
//   marker firing after the last audio byte (e.g. a trailing tap right as
//   the recording stopped) can't bound a real chapter.
// - Always prepends an implicit boundary at 0 (every recording's first
//   chapter starts there), then dedupes+sorts — a marker the user tapped at
//   exactly 0ms must NOT produce two boundaries at 0. Previously the chapter
//   count was unconditionally `markers.length + 1`, silently double-counting
//   that case (see the 0ms-marker regression test).
export const computeChapterBoundaries = (markers, durationMs = null) => {
  const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
  const markerTimestamps = normalizeMarkers(markers)
    .filter((ms) => !hasDuration || ms <= durationMs);
  return Array.from(new Set([0, ...markerTimestamps])).sort((a, b) => a - b);
};

const formatTimestamp = (ms) => {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Additive-only prompt block appended when markers are present. The
// no-marker prompt (TRANSCRIPTION_PROMPT, optionally + proper-noun
// dictionary) is untouched byte-for-byte — see the byte-identity test.
const buildChapterMarkerBlock = (boundaries, durationMs) => {
  const chapterCount = boundaries.length;
  // boundaries[0] is always the implicit 0 — only list the ones the user
  // actually tapped (or that survived duration-clamping) as marker lines.
  const markerLines = boundaries.slice(1)
    .map((ms) => `- ${formatTimestamp(ms)} (${ms}ms)`)
    .join('\n');
  const durationLine = Number.isFinite(durationMs) && durationMs > 0
    ? `\nRecording duration: ${formatTimestamp(durationMs)} (${durationMs}ms).`
    : '';
  const startMsList = boundaries.join(', ');

  return `The user marked chapter boundaries at these points while recording:
${markerLines}${durationLine}

Segment the transcript into exactly ${chapterCount} chapters at these marked positions (the first chapter begins at the start of the audio, before the first marker). Return an additional "chapters" field in the JSON, alongside rawTranscript/transcript/toneAnalysis: an array of exactly ${chapterCount} objects shaped { "startMs": <number>, "title": "<a 2-4 word chapter title>", "text": "<the exact portion of the cleaned transcript spoken in this chapter>" }, using startMs values [${startMsList}] in order. Concatenating all chapters' "text" values in order must reproduce the "transcript" field exactly. You can hear the audio, so use what's actually being said near each marked timestamp to choose the precise word boundary — word-level timestamps are not required.`;
};

export function buildGeminiRequestBody(base64, mimeType, properNouns = [], markers = [], durationMs = null) {
  const dictionary = normalizeProperNouns(properNouns);
  let prompt = dictionary.length
    ? `${TRANSCRIPTION_PROMPT}\n\nKNOWN PROPER NOUN SPELLINGS:\n${dictionary.join(', ')}`
    : TRANSCRIPTION_PROMPT;

  const markerTimestamps = normalizeMarkers(markers);
  if (markerTimestamps.length > 0) {
    const boundaries = computeChapterBoundaries(markers, durationMs);
    prompt = `${prompt}\n\n${buildChapterMarkerBlock(boundaries, durationMs)}`;
  }

  return {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: prompt }
      ]
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

export const cleanTranscriptArtifacts = (value) => value
  .replace(/,\s*,+/g, ',')
  .replace(/\s+([,.!?;:])/g, '$1')
  .replace(/[ \t]{2,}/g, ' ')
  .trim();

const normalizeWhitespace = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// Voice Chapters (Task 14): STRICT, fail-to-null validation. Chapter
// segmentation is a nice-to-have on top of a transcription that has ALREADY
// succeeded — any shape mismatch or a joined-text drift from the transcript
// means we drop chapters entirely rather than risk showing a wrong/misleading
// segmentation. Never throws; never affects the caller's transcript/toneAnalysis.
function extractChapters(rawChapters, boundaries, transcript) {
  if (!Array.isArray(rawChapters) || rawChapters.length !== boundaries.length) return null;

  const chapters = [];
  for (const c of rawChapters) {
    if (!c || typeof c !== 'object') return null;
    const startMs = Number(c.startMs);
    if (!Number.isFinite(startMs) || startMs < 0) return null;
    if (typeof c.title !== 'string' || !c.title.trim()) return null;
    if (typeof c.text !== 'string' || !c.text.trim()) return null;
    chapters.push({ title: c.title.trim(), text: c.text.trim() });
  }

  const joined = normalizeWhitespace(chapters.map((c) => c.text).join(' '));
  if (joined !== normalizeWhitespace(transcript)) return null;

  // Voice Chapters (Task 14 review — Important 1): markers are GROUND TRUTH
  // for startMs, never Gemini's echo. Gemini hears the audio and picks the
  // precise word boundary for title/text, but the boundary TIMESTAMP itself
  // must always be exactly what the user tapped (or 0 for the first
  // chapter) — overwrite whatever value Gemini echoed back with the
  // canonical `boundaries` list computed from the real markers.
  return chapters.map((c, i) => ({ startMs: boundaries[i], ...c }));
}

export function parseFusedResponse(geminiJson, { markers = [], durationMs = null } = {}) {
  const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (typeof parsed.transcript !== 'string') return null;

  const rawTranscript = typeof parsed.rawTranscript === 'string'
    ? parsed.rawTranscript.trim()
    : parsed.transcript.trim();
  const transcript = cleanTranscriptArtifacts(parsed.transcript);

  let toneAnalysis = null;
  const t = parsed.toneAnalysis;
  if (t && typeof t === 'object') {
    toneAnalysis = {
      moodScore: clamp01(t.moodScore),
      energy: ['low', 'medium', 'high'].includes(t.energy) ? t.energy : 'medium',
      emotions: Array.isArray(t.emotions) ? t.emotions.slice(0, 5) : [],
      confidence: clamp01(t.confidence),
      summary: (typeof t.summary === 'string' && t.summary.trim()) || 'Unable to determine emotional state'
    };
  }

  const result = { rawTranscript, transcript, toneAnalysis };

  // Only attach a `chapters` key at all when markers were actually requested
  // — keeps the no-marker response shape byte-for-byte identical to before
  // Task 14 (see the no-speech contract test).
  const hasMarkers = Array.isArray(markers) && markers.length > 0;
  if (hasMarkers) {
    const boundaries = computeChapterBoundaries(markers, durationMs);
    result.chapters = extractChapters(parsed.chapters, boundaries, transcript);
  }

  return result;
}

/**
 * Run the SAME fused transcription flow the `transcribeEntry` callable uses,
 * but from a raw audio buffer (base64) rather than an HTTPS request. Primary
 * is one fused Gemini audio-in call (transcript + tone); on any Gemini failure
 * (rate limit, HTTP error, unparseable body, network) it falls back to a raw
 * Whisper transcript with NO filler-word stripping (that regex corrupts
 * meaning). Reuses buildGeminiRequestBody / parseFusedResponse / the shared
 * Whisper helper so the server-triggered path and the callable stay in lockstep.
 *
 * @returns {Promise<{rawTranscript:string, transcript:string, toneAnalysis:object|null, engine:'gemini'|'whisper'}|{error:string}>}
 *   Same response contract as the callable: a success object or `{ error }`
 *   ('API_NO_CONTENT' = call succeeded but no intelligible speech).
 * @param {object} args
 * @param {string} args.base64            Audio bytes, base64-encoded.
 * @param {string} args.mimeType          Audio MIME type (audio/mp4, audio/webm, ...).
 * @param {string[]} [args.properNouns]   Known proper-noun spellings.
 * @param {Array<{tMs:number}>} [args.markers]  Voice Chapters (Task 14, flag:
 *   voiceChapters) marker timestamps; omit/empty for no chapter segmentation.
 * @param {number|null} [args.durationMs] Total recording duration, for the prompt.
 * @param {string|null} [args.gemKey]     Gemini API key (primary engine).
 * @param {string|null} [args.oaiKey]     OpenAI API key (Whisper fallback).
 * @param {number} [args.timeoutMs]       Per-call network timeout.
 * @param {Function} [args.fetchImpl]     Injectable fetch (tests); defaults to global fetch.
 * @param {string} [args.modelId]         Gemini model id (resolve via getModel(db, 'fusedTranscription')).
 * @param {string} [args.whisperModelId]  Whisper fallback model id (MOD-02: resolve via
 *   getModel(db, 'transcriptionFallback') — a caller that doesn't pass this gets
 *   transcribeWithWhisper's own 'whisper-1' default, same as before this fix).
 */
export async function runFusedTranscription({
  base64,
  mimeType,
  properNouns = [],
  markers = [],
  durationMs = null,
  gemKey = null,
  oaiKey = null,
  timeoutMs = FUSED_TRANSCRIBE_TIMEOUT_MS,
  fetchImpl = fetch,
  modelId = GEMINI_TRANSCRIBE_MODEL,
  whisperModelId = undefined,
} = {}) {
  if (!gemKey && !oaiKey) {
    return { error: 'API_ERROR' };
  }

  // 1. Primary: fused Gemini call (transcript + tone in one pass).
  if (gemKey) {
    const startedAt = Date.now();
    try {
      const geminiRes = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${gemKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGeminiRequestBody(base64, mimeType, properNouns, markers, durationMs)),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );

      if (geminiRes.status === 429) {
        // rate limited — fall through to Whisper
        logModelManifest({ workload: 'fusedTranscription', modelId, ok: false, durationMs: Date.now() - startedAt, fallback: false });
      } else if (geminiRes.ok) {
        const parsed = parseFusedResponse(await geminiRes.json(), { markers, durationMs });
        if (parsed && parsed.transcript) {
          logModelManifest({ workload: 'fusedTranscription', modelId, ok: true, durationMs: Date.now() - startedAt, fallback: false });
          return {
            rawTranscript: parsed.rawTranscript,
            transcript: parsed.transcript,
            toneAnalysis: parsed.toneAnalysis,
            engine: 'gemini',
            // Chapters are metadata-only, best-effort: a failed/mismatched
            // parse never blocks the transcription itself — chapters is just
            // null in that case (see extractChapters).
            chapters: parsed.chapters ?? null,
          };
        }
        if (parsed && parsed.transcript === '') {
          logModelManifest({ workload: 'fusedTranscription', modelId, ok: true, durationMs: Date.now() - startedAt, fallback: false });
          return { error: 'API_NO_CONTENT' }; // model heard no speech
        }
        // unparseable — fall through to Whisper
        logModelManifest({ workload: 'fusedTranscription', modelId, ok: false, durationMs: Date.now() - startedAt, fallback: false });
      } else {
        // non-429 HTTP error — fall through to Whisper
        logModelManifest({ workload: 'fusedTranscription', modelId, ok: false, durationMs: Date.now() - startedAt, fallback: false });
      }
    } catch (geminiError) {
      // network/timeout — fall through to Whisper
      logModelManifest({ workload: 'fusedTranscription', modelId, ok: false, durationMs: Date.now() - startedAt, fallback: false });
    }
  }

  // 2. Fallback: Whisper raw transcript (NO filler-word regex — it corrupts meaning).
  if (!oaiKey) {
    return { error: 'API_ERROR' };
  }
  const whisperStartedAt = Date.now();
  // Must mirror transcribeWithWhisper's own default so the manifest reports
  // the model actually used when no registry override is threaded through.
  const fallbackModelUsed = whisperModelId || 'whisper-1';
  const logFallbackManifest = (ok) => logModelManifest({
    workload: 'transcriptionFallback', modelId: fallbackModelUsed, ok,
    durationMs: Date.now() - whisperStartedAt, fallback: true,
  });
  try {
    const buffer = Buffer.from(base64, 'base64');
    const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
    const whisperResult = await transcribeWithWhisper(oaiKey, buffer, {
      // MOD-02: thread the registry-resolved fallback model through — without
      // this, transcribeWithWhisper's own 'whisper-1' default silently wins
      // even when `model.transcriptionFallback` is overridden in config/flags.
      ...(whisperModelId ? { model: whisperModelId } : {}),
      filename: `audio.${fileExt}`,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (whisperResult === null) {
      logFallbackManifest(false);
      return { error: 'API_ERROR' };
    }
    const transcript = whisperResult?.text?.trim();
    if (!transcript) {
      logFallbackManifest(true);
      return { error: 'API_NO_CONTENT' }; // call succeeded, no speech detected
    }
    logFallbackManifest(true);
    // Whisper has no audio-aligned segmentation ability — chapters always null.
    return { rawTranscript: transcript, transcript, toneAnalysis: null, engine: 'whisper', chapters: null };
  } catch (error) {
    logFallbackManifest(false);
    return { error: 'API_EXCEPTION' };
  }
}
