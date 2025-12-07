import { OPENAI_API_KEY } from '../../config';

/**
 * Transcribe audio using OpenAI Whisper API
 * @param {string} base64 - Base64 encoded audio
 * @param {string} mimeType - MIME type of the audio
 * @returns {Promise<string>} - Transcription text or error code
 */
export const transcribeAudio = async (base64, mimeType) => {
  try {
    console.log('Whisper transcription request:', {
      mimeType,
      audioLength: base64.length,
      model: 'whisper-1'
    });

    // Check API key
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
      console.error('OpenAI API key not configured');
      return 'API_AUTH_ERROR';
    }

    // Convert base64 to Blob
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: mimeType });

    // Create FormData for Whisper API
    const formData = new FormData();
    // Determine file extension from mimeType
    const fileExt = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp4') ? 'mp4' : 'wav';
    formData.append('file', audioBlob, `audio.${fileExt}`);
    formData.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: formData
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Whisper API error:', res.status, errorData);
      console.error('Full error details:', {
        status: res.status,
        statusText: res.statusText,
        error: errorData,
        mimeType,
        audioSizeBytes: base64.length
      });

      if (res.status === 429) return 'API_RATE_LIMIT';
      if (res.status === 401) return 'API_AUTH_ERROR';
      if (res.status === 400) return 'API_BAD_REQUEST';
      return 'API_ERROR';
    }

    const data = await res.json();
    let transcript = data.text || null;

    if (!transcript) {
      console.error('Whisper API returned no content:', data);
      return 'API_NO_CONTENT';
    }

    // Remove filler words (um, uh, like, etc.)
    const fillerWords = /\b(um|uh|uhm|like|you know|so|well|actually|basically|literally)\b/gi;
    transcript = transcript.replace(fillerWords, ' ').replace(/\s+/g, ' ').trim();

    console.log('Whisper transcription result:', transcript);
    return transcript;
  } catch (e) {
    console.error('Whisper API exception:', e);
    return 'API_EXCEPTION';
  }
};
