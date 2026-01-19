/**
 * Cloud Functions Constants
 *
 * Shared constants used across function modules.
 */

// Firestore collection path prefix
export const APP_COLLECTION_ID = 'echo-vault-v5-fresh';

// Pattern tracking version
export const PATTERN_VERSION = 1;

// AI Model Configuration
export const AI_CONFIG = {
  classification: { primary: 'gemini-3-flash-preview', fallback: 'gpt-4o-mini' },
  analysis: { primary: 'gemini-3-flash-preview', fallback: 'gpt-4o' },
  chat: { primary: 'gpt-4o-mini', fallback: 'gemini-3-flash-preview' },
  embedding: { primary: 'text-embedding-004', fallback: null },
  transcription: { primary: 'whisper-1', fallback: null }
};

// Function regions
export const DEFAULT_REGION = 'us-central1';

// Memory limits
export const MEMORY = {
  standard: '256MiB',
  ai: '512MiB',
  heavy: '1GiB'
};

// Timeouts (in seconds)
export const TIMEOUTS = {
  standard: 60,
  ai: 120,
  transcription: 540,
  batch: 540
};

// Crisis keywords for safety detection
export const CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'kill myself', 'end my life', 'want to die',
  'better off dead', 'no reason to live', 'self-harm', 'cutting myself'
];

// Therapeutic frameworks
export const FRAMEWORKS = ['ACT', 'CBT', 'DBT', 'RAIN', 'general'];

export default {
  APP_COLLECTION_ID,
  PATTERN_VERSION,
  AI_CONFIG,
  DEFAULT_REGION,
  MEMORY,
  TIMEOUTS,
  CRISIS_KEYWORDS,
  FRAMEWORKS
};
