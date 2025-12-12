import { transcribeAudioFn } from '../../config';

/**
 * Transcribe audio using Cloud Function (Whisper API)
 * @param {string} base64 - Base64 encoded audio
 * @param {string} mimeType - MIME type of the audio
 * @returns {Promise<string>} - Transcription text or error code
 */
export const transcribeAudio = async (base64, mimeType) => {
  try {
    console.log('Whisper transcription request (via Cloud Function):', {
      mimeType,
      model: 'whisper-1'
    });

    const result = await transcribeAudioFn({ base64, mimeType });

    // Check for error response
    if (result.data?.error) {
      console.error('Transcription error:', result.data.error);
      return result.data.error;
    }

    const transcript = result.data?.transcript;

    if (!transcript) {
      console.error('Transcription returned no content');
      return 'API_NO_CONTENT';
    }

    console.log('Whisper transcription result:', transcript);
    return transcript;
  } catch (e) {
    console.error('Whisper API exception:', e);
    return 'API_EXCEPTION';
  }
};
