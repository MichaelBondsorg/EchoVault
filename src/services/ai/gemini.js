import { analyzeJournalEntryFn, askJournalAIFn } from '../../config';

/**
 * Call the Gemini API via Cloud Function for journal analysis
 * This function is kept for backwards compatibility but now uses Cloud Functions
 */
export const callGemini = async (systemPrompt, userPrompt) => {
  // For direct callGemini usage (like askJournalAI), use the askJournalAI Cloud Function
  // This is a simplified wrapper - most analysis now goes through analyzeJournalEntry
  try {
    const result = await askJournalAIFn({
      question: userPrompt,
      entriesContext: systemPrompt
    });
    return result.data.response;
  } catch (e) {
    console.error('callGemini (via Cloud Function) error:', e);
    return null;
  }
};

/**
 * Analyze a journal entry using Cloud Functions
 * @param {string} text - The journal entry text
 * @param {Object} options - Analysis options
 * @param {string} options.recentEntriesContext - Context from recent entries for enhanced extraction
 * @param {string} options.historyContext - History context for insight generation
 * @param {Object} options.moodTrajectory - Mood trajectory data
 * @param {Object} options.cyclicalPatterns - Cyclical pattern data
 * @param {string[]} options.operations - Which operations to run: ['classify', 'analyze', 'extractContext', 'generateInsight']
 * @returns {Promise<Object>} Analysis results
 */
export const analyzeJournalEntryCloud = async (text, options = {}) => {
  try {
    const result = await analyzeJournalEntryFn({
      text,
      recentEntriesContext: options.recentEntriesContext || '',
      historyContext: options.historyContext || '',
      moodTrajectory: options.moodTrajectory || null,
      cyclicalPatterns: options.cyclicalPatterns || null,
      operations: options.operations || ['classify', 'analyze', 'extractContext', 'generateInsight']
    });
    return result.data;
  } catch (e) {
    console.error('analyzeJournalEntryCloud error:', e);
    return null;
  }
};
