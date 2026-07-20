/**
 * Fused transcription: one Gemini audio-in call that transcribes with light
 * cleanup AND analyzes voice tone. Replaces Whisper + destructive filler
 * regex + separate Gemini tone call. Cleanup philosophy ported from Cosmo:
 * the model hears the audio, removes disfluencies, never restructures.
 */
import { transcribeWithWhisper } from '../shared/openai.js';

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

export function buildGeminiRequestBody(base64, mimeType, properNouns = []) {
  const dictionary = normalizeProperNouns(properNouns);
  const prompt = dictionary.length
    ? `${TRANSCRIPTION_PROMPT}\n\nKNOWN PROPER NOUN SPELLINGS:\n${dictionary.join(', ')}`
    : TRANSCRIPTION_PROMPT;
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

export function parseFusedResponse(geminiJson) {
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

  return { rawTranscript, transcript, toneAnalysis };
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
 * @param {string|null} [args.gemKey]     Gemini API key (primary engine).
 * @param {string|null} [args.oaiKey]     OpenAI API key (Whisper fallback).
 * @param {number} [args.timeoutMs]       Per-call network timeout.
 * @param {Function} [args.fetchImpl]     Injectable fetch (tests); defaults to global fetch.
 */
export async function runFusedTranscription({
  base64,
  mimeType,
  properNouns = [],
  gemKey = null,
  oaiKey = null,
  timeoutMs = FUSED_TRANSCRIBE_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  if (!gemKey && !oaiKey) {
    return { error: 'API_ERROR' };
  }

  // 1. Primary: fused Gemini call (transcript + tone in one pass).
  if (gemKey) {
    try {
      const geminiRes = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TRANSCRIBE_MODEL}:generateContent?key=${gemKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildGeminiRequestBody(base64, mimeType, properNouns)),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );

      if (geminiRes.status === 429) {
        // rate limited — fall through to Whisper
      } else if (geminiRes.ok) {
        const parsed = parseFusedResponse(await geminiRes.json());
        if (parsed && parsed.transcript) {
          return {
            rawTranscript: parsed.rawTranscript,
            transcript: parsed.transcript,
            toneAnalysis: parsed.toneAnalysis,
            engine: 'gemini',
          };
        }
        if (parsed && parsed.transcript === '') {
          return { error: 'API_NO_CONTENT' }; // model heard no speech
        }
        // unparseable — fall through to Whisper
      }
      // non-429 HTTP error — fall through to Whisper
    } catch (geminiError) {
      // network/timeout — fall through to Whisper
    }
  }

  // 2. Fallback: Whisper raw transcript (NO filler-word regex — it corrupts meaning).
  if (!oaiKey) {
    return { error: 'API_ERROR' };
  }
  try {
    const buffer = Buffer.from(base64, 'base64');
    const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
    const whisperResult = await transcribeWithWhisper(oaiKey, buffer, {
      filename: `audio.${fileExt}`,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (whisperResult === null) {
      return { error: 'API_ERROR' };
    }
    const transcript = whisperResult?.text?.trim();
    if (!transcript) {
      return { error: 'API_NO_CONTENT' }; // call succeeded, no speech detected
    }
    return { rawTranscript: transcript, transcript, toneAnalysis: null, engine: 'whisper' };
  } catch (error) {
    return { error: 'API_EXCEPTION' };
  }
}
