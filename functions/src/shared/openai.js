/**
 * OpenAI API Helper
 *
 * Shared helper for calling OpenAI's APIs.
 * Extracted from functions/index.js for reuse across function modules.
 */

/**
 * Call the OpenAI Chat Completions API
 * @param {string} apiKey - OpenAI API key
 * @param {string} systemPrompt - System message
 * @param {string} userPrompt - User message
 * @param {Object} options - Additional options
 * @returns {Promise<string|null>} Response text or null on error
 */
export async function callOpenAI(apiKey, systemPrompt, userPrompt, options = {}) {
  try {
    if (!apiKey) {
      console.error('OpenAI API key not configured');
      return null;
    }

    const {
      model = 'gpt-4o-mini',
      temperature = 0.7,
      maxTokens = 500
    } = options;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature,
        max_tokens: maxTokens
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('OpenAI API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (e) {
    console.error('OpenAI API exception:', e);
    return null;
  }
}

/**
 * Call the OpenAI Whisper Transcription API
 * @param {string} apiKey - OpenAI API key
 * @param {Buffer} audioBuffer - Audio data as buffer
 * @param {Object} options - Additional options
 * @returns {Promise<Object|null>} Transcription result or null on error
 */
export async function transcribeWithWhisper(apiKey, audioBuffer, options = {}) {
  try {
    if (!apiKey) {
      console.error('OpenAI API key not configured');
      return null;
    }

    const {
      model = 'whisper-1',
      language = 'en',
      responseFormat = 'verbose_json',
      filename = 'audio.webm'
    } = options;

    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer]), filename);
    formData.append('model', model);
    formData.append('language', language);
    formData.append('response_format', responseFormat);

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('Whisper API error:', res.status, errorText);
      return null;
    }

    return await res.json();
  } catch (e) {
    console.error('Whisper API exception:', e);
    return null;
  }
}

/**
 * Generate embeddings using OpenAI
 * @param {string} apiKey - OpenAI API key
 * @param {string} text - Text to embed
 * @param {string} model - Model ID (default: text-embedding-3-small)
 * @returns {Promise<number[]|null>} Embedding vector or null on error
 */
export async function generateOpenAIEmbedding(apiKey, text, model = 'text-embedding-3-small') {
  try {
    if (!apiKey) {
      console.error('OpenAI API key not configured');
      return null;
    }

    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: text
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('OpenAI embedding error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  } catch (e) {
    console.error('OpenAI embedding exception:', e);
    return null;
  }
}

export default { callOpenAI, transcribeWithWhisper, generateOpenAIEmbedding };
