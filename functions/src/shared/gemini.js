/**
 * Gemini API Helper
 *
 * Shared helper for calling Google's Gemini AI API.
 * Extracted from functions/index.js for reuse across function modules.
 */

/**
 * Call the Gemini API
 * @param {string} apiKey - Gemini API key
 * @param {string} systemPrompt - System instruction
 * @param {string} userPrompt - User message
 * @param {string} model - Model ID (default: gemini-3-flash-preview)
 * @returns {Promise<string|null>} Response text or null on error
 */
export async function callGemini(apiKey, systemPrompt, userPrompt, model = 'gemini-3-flash-preview') {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Gemini API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    console.error('Gemini API exception:', e);
    return null;
  }
}

/**
 * Generate embeddings using Gemini
 * @param {string} apiKey - Gemini API key
 * @param {string} text - Text to embed
 * @param {string} model - Model ID (default: text-embedding-004)
 * @returns {Promise<number[]|null>} Embedding vector or null on error
 */
export async function generateGeminiEmbedding(apiKey, text, model = 'text-embedding-004') {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${model}`,
        content: { parts: [{ text }] }
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('Gemini embedding error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    return data.embedding?.values || null;
  } catch (e) {
    console.error('Gemini embedding exception:', e);
    return null;
  }
}

export default { callGemini, generateGeminiEmbedding };
