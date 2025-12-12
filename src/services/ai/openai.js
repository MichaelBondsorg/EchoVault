import { askJournalAIFn } from '../../config';

/**
 * Call the OpenAI GPT API via Cloud Function
 * This function is kept for backwards compatibility but now uses Cloud Functions
 */
export const callOpenAI = async (systemPrompt, userPrompt) => {
  // OpenAI calls now go through the Cloud Function
  // The Cloud Function handles fallback logic internally
  try {
    const result = await askJournalAIFn({
      question: userPrompt,
      entriesContext: systemPrompt
    });
    return result.data.response;
  } catch (e) {
    console.error('callOpenAI (via Cloud Function) error:', e);
    return null;
  }
};
