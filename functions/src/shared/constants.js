/**
 * Cloud Functions Constants
 *
 * Shared constants used across function modules.
 */

import { MODEL_DEFAULTS } from '../models/registry.js';

// Firestore collection path prefix
export const APP_COLLECTION_ID = 'echo-vault-v5-fresh';

// Pattern tracking version
export const PATTERN_VERSION = 1;

// AI Model Configuration.
// DEPRECATED shape — retained so untouched call sites keep working. All values
// are re-exported from the server-owned model registry (MODEL_DEFAULTS); prefer
// getModel(db, workload) / getModelSync(workload) in new code.
export const AI_CONFIG = {
  classification: { primary: MODEL_DEFAULTS.classify, fallback: MODEL_DEFAULTS.chat },
  analysis: { primary: MODEL_DEFAULTS.analyze, fallback: MODEL_DEFAULTS.chatFallback },
  chat: { primary: MODEL_DEFAULTS.chat, fallback: MODEL_DEFAULTS.classify },
  embedding: { primary: MODEL_DEFAULTS.embedding, fallback: null },
  transcription: { primary: MODEL_DEFAULTS.transcriptionFallback, fallback: null }
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
