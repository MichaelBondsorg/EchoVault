/**
 * Fused transcription: one Gemini audio-in call that transcribes with light
 * cleanup AND analyzes voice tone. Replaces Whisper + destructive filler
 * regex + separate Gemini tone call. Cleanup philosophy ported from Cosmo:
 * the model hears the audio, removes disfluencies, never restructures.
 */

// Verify against the live models list before changing (see plan Task 2 Step 1).
export const GEMINI_TRANSCRIBE_MODEL = 'gemini-2.5-flash';

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
