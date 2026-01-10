import { askJournalAIFn } from '../../config';

/**
 * Call the OpenAI GPT API via Cloud Function
 * This function is kept for backwards compatibility but now uses Cloud Functions
 */
export const callOpenAI = async (systemPrompt, userPrompt) => {
  // OpenAI calls now go through the Cloud Function
  // The Cloud Function handles fallback logic internally
  try {
    if (!userPrompt || !userPrompt.trim()) {
      console.error('callOpenAI: userPrompt is empty or missing');
      return null;
    }

    console.log('callOpenAI: Calling Cloud Function with:', {
      questionLength: userPrompt?.length,
      contextLength: systemPrompt?.length
    });

    const result = await askJournalAIFn({
      question: userPrompt,
      entriesContext: systemPrompt || ''
    });

    console.log('callOpenAI: Cloud Function response:', {
      hasData: !!result?.data,
      dataKeys: result?.data ? Object.keys(result.data) : [],
      responsePreview: result?.data?.response?.substring?.(0, 100)
    });

    // Handle different response formats from Cloud Function
    const response = result?.data?.response || result?.data?.answer || result?.data?.text || result?.data;

    if (typeof response === 'string' && response.trim()) {
      return response;
    }

    console.warn('callOpenAI: Unexpected response format:', result?.data);
    return null;
  } catch (e) {
    console.error('callOpenAI (via Cloud Function) error:', e);
    console.error('callOpenAI error details:', {
      message: e.message,
      code: e.code,
      details: e.details
    });
    return null;
  }
};
