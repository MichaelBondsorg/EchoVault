import { OPENAI_API_KEY } from '../../config';

/**
 * Call the OpenAI GPT API
 */
export const callOpenAI = async (systemPrompt, userPrompt) => {
  try {
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
      console.error('OpenAI API key not configured');
      return null;
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error('OpenAI API error:', res.status, errorData);
      return null;
    }

    const data = await res.json();
    const result = data.choices?.[0]?.message?.content || null;

    if (!result) {
      console.error('OpenAI API returned no content:', data);
    }

    return result;
  } catch (e) {
    console.error('OpenAI API exception:', e);
    return null;
  }
};
