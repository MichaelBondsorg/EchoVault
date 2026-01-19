/**
 * Shared Utilities Index
 *
 * Re-exports all shared utilities for Cloud Functions.
 */

export { callGemini, generateGeminiEmbedding } from './gemini.js';
export { callOpenAI, transcribeWithWhisper, generateOpenAIEmbedding } from './openai.js';
export {
  levenshteinDistance,
  similarityRatio,
  findBestMatch,
  extractPotentialMentions
} from './entityResolution.js';
export {
  APP_COLLECTION_ID,
  PATTERN_VERSION,
  AI_CONFIG,
  DEFAULT_REGION,
  MEMORY,
  TIMEOUTS,
  CRISIS_KEYWORDS,
  FRAMEWORKS
} from './constants.js';
