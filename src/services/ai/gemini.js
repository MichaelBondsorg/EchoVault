import { GEMINI_API_KEY, AI_CONFIG } from '../../config';

/**
 * Call the Gemini API with a system prompt and user prompt
 */
export const callGemini = async (systemPrompt, userPrompt, model = AI_CONFIG.analysis.primary) => {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`, {
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
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

    if (!result) {
      console.error('Gemini API returned no content:', data);
    }

    return result;
  } catch (e) {
    console.error('Gemini API exception:', e);
    return null;
  }
};
