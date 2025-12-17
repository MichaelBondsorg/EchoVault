import { OPENAI_API_KEY } from '../../config';

// Timeout duration for API calls (30 seconds)
const API_TIMEOUT_MS = 30000;
// Maximum retry attempts
const MAX_RETRIES = 3;
// Initial retry delay (will double each retry)
const INITIAL_RETRY_DELAY_MS = 2000;

/**
 * Wraps a promise with a timeout
 */
const withTimeout = (promise, timeoutMs) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('API call timeout')), timeoutMs)
    )
  ]);
};

/**
 * Retry a function with exponential backoff
 */
const withRetry = async (fn, maxRetries = MAX_RETRIES) => {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(`API call failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, error.message);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

/**
 * Call the OpenAI GPT API
 */
export const callOpenAI = async (systemPrompt, userPrompt) => {
  try {
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
      console.error('OpenAI API key not configured');
      return null;
    }

    // Wrap the API call with both timeout and retry logic
    const res = await withRetry(async () => {
      return await withTimeout(
        fetch('https://api.openai.com/v1/chat/completions', {
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
        }),
        API_TIMEOUT_MS
      );
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
