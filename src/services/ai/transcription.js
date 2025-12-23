import { transcribeAudioFn } from '../../config';

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

      console.log('Whisper transcription result:', transcript);
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
