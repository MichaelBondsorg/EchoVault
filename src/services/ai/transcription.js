import { transcribeAudioFn, transcribeWithToneFn, transcribeEntryFn } from '../../config';

/**
 * Sleep helper for retry backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if an error is retryable (network issues, timeouts)
 */
const isRetryableError = (error) => {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code?.toLowerCase() || '';

  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('failed to fetch') ||
    message.includes('connection') ||
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code === 'internal'
  );
};

/**
 * Transcribe audio using Cloud Function (Whisper API)
 * Includes retry logic with exponential backoff for mobile reliability
 * @param {string} base64 - Base64 encoded audio
 * @param {string} mimeType - MIME type of the audio
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<string>} - Transcription text or error code
 */
export const transcribeAudio = async (base64, mimeType, maxRetries = 3) => {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`Transcription retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms backoff`);
        await sleep(backoffMs);
      }

      console.log('Whisper transcription request (via Cloud Function):', {
        mimeType,
        model: 'whisper-1',
        attempt: attempt + 1,
        maxRetries: maxRetries + 1
      });

      const result = await transcribeAudioFn({ base64, mimeType });

      // Check for error response
      if (result.data?.error) {
        const errorCode = result.data.error;
        console.error('Transcription error:', errorCode);

        // Don't retry non-retryable errors (rate limit, auth, bad request)
        if (errorCode === 'API_RATE_LIMIT' || errorCode === 'API_AUTH_ERROR' || errorCode === 'API_BAD_REQUEST') {
          return errorCode;
        }

        // For other errors, continue to next retry
        lastError = new Error(errorCode);
        continue;
      }

      const transcript = result.data?.transcript;

      if (!transcript) {
        console.error('Transcription returned no content');
        lastError = new Error('API_NO_CONTENT');
        continue;
      }

      // Do not log journal/voice content (PII). Log length only.
      console.log('Whisper transcription result length:', transcript?.length ?? 0);
      return transcript;
    } catch (e) {
      console.error(`Whisper API exception (attempt ${attempt + 1}):`, e);
      lastError = e;

      // Only retry on network-related errors
      if (!isRetryableError(e)) {
        console.log('Non-retryable error, stopping retry attempts');
        break;
      }
    }
  }

  // All retries exhausted
  console.error('All transcription attempts failed:', lastError);
  return 'API_EXCEPTION';
};

/**
 * Transcribe audio with voice tone analysis using Cloud Function
 * Combines Whisper transcription with Gemini voice tone analysis
 * @param {string} base64 - Base64 encoded audio
 * @param {string} mimeType - MIME type of the audio
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 * @returns {Promise<{transcript: string, toneAnalysis: object|null}|string>} - Result object or error code
 */
export const transcribeAudioWithTone = async (base64, mimeType, maxRetries = 3) => {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`Transcription+Tone retry attempt ${attempt}/${maxRetries} after ${backoffMs}ms backoff`);
        await sleep(backoffMs);
      }

      console.log('Transcription+Tone request (via Cloud Function):', {
        mimeType,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1
      });

      const result = await transcribeWithToneFn({ base64, mimeType });

      // Check for error response
      if (result.data?.error) {
        const errorCode = result.data.error;
        console.error('Transcription+Tone error:', errorCode);

        // Don't retry non-retryable errors
        if (errorCode === 'API_RATE_LIMIT' || errorCode === 'API_AUTH_ERROR' || errorCode === 'API_BAD_REQUEST') {
          return errorCode;
        }

        lastError = new Error(errorCode);
        continue;
      }

      const { transcript, rawTranscript = transcript, toneAnalysis } = result.data || {};

      if (!transcript) {
        console.error('Transcription returned no content');
        lastError = new Error('API_NO_CONTENT');
        continue;
      }

      console.log('Transcription+Tone result:', {
        transcriptLength: transcript.length,
        hasToneAnalysis: !!toneAnalysis,
        toneEnergy: toneAnalysis?.energy,
        toneMood: toneAnalysis?.moodScore?.toFixed(2)
      });

      return { rawTranscript, transcript, toneAnalysis };
    } catch (e) {
      console.error(`Transcription+Tone API exception (attempt ${attempt + 1}):`, e);
      lastError = e;

      if (!isRetryableError(e)) {
        console.log('Non-retryable error, stopping retry attempts');
        break;
      }
    }
  }

  console.error('All transcription+tone attempts failed:', lastError);
  return 'API_EXCEPTION';
};

/**
 * Fused transcription via Cloud Function (Gemini audio-in: transcript + tone
 * in one call, Whisper fallback server-side). Same return contract as
 * transcribeAudioWithTone: {transcript, toneAnalysis} or an error-code string.
 *
 * Voice Chapters (Task 14, flag: voiceChapters): `markers`/`durationMs` are
 * omitted from the request entirely when there are no markers — a caller that
 * never passes them (or passes an empty array) gets the exact same request
 * payload as before Task 14. When markers ARE present, the server may return
 * a validated `chapters` array (or null on a failed/mismatched parse); that
 * is forwarded through as `result.chapters`, but the `chapters` key itself is
 * only added to the returned object when markers were actually sent — so the
 * no-markers return shape is unchanged too.
 */
export const transcribeEntryFused = async (
  base64,
  mimeType,
  maxRetries = 3,
  properNouns = [],
  markers = [],
  durationMs = null
) => {
  let lastError = null;
  const hasMarkers = Array.isArray(markers) && markers.length > 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.log(`Fused transcription retry ${attempt}/${maxRetries} after ${backoffMs}ms`);
        await sleep(backoffMs);
      }

      const payload = { base64, mimeType, properNouns };
      if (hasMarkers) {
        payload.markers = markers;
        if (Number.isFinite(durationMs) && durationMs > 0) {
          payload.durationMs = durationMs;
        }
      }
      const result = await transcribeEntryFn(payload);

      if (result.data?.error) {
        const errorCode = result.data.error;
        if (errorCode === 'API_RATE_LIMIT' || errorCode === 'API_AUTH_ERROR' || errorCode === 'API_BAD_REQUEST' || errorCode === 'API_NO_CONTENT') {
          return errorCode;
        }
        lastError = new Error(errorCode);
        continue;
      }

      const { transcript, rawTranscript = transcript, toneAnalysis, chapters } = result.data || {};
      if (!transcript) {
        // Terminal, not retryable: silent/near-silent audio produces the
        // same empty result on every attempt, so burning the retry budget
        // (and surfacing a misleading "check your network" message) just
        // delays the user from re-recording. Return immediately, like the
        // other non-retryable codes above.
        console.error('Fused transcription returned no content');
        return 'API_NO_CONTENT';
      }

      console.log('Fused transcription result:', {
        transcriptLength: transcript.length,
        engine: result.data?.engine,
        hasToneAnalysis: !!toneAnalysis,
        hasChapters: Array.isArray(chapters)
      });
      return {
        rawTranscript,
        transcript,
        toneAnalysis: toneAnalysis || null,
        // Only present when markers were sent (chapters was requested) —
        // keeps the no-markers return shape identical to before Task 14.
        ...(hasMarkers ? { chapters: chapters ?? null } : {})
      };
    } catch (e) {
      console.error(`Fused transcription exception (attempt ${attempt + 1}):`, e);
      lastError = e;
      if (!isRetryableError(e)) break;
    }
  }

  console.error('All fused transcription attempts failed:', lastError);
  return 'API_EXCEPTION';
};
