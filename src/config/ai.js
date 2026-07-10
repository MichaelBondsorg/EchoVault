// AI Model Configuration (for reference - actual API calls are now handled by Cloud Functions)
export const AI_CONFIG = {
  classification: {
    primary: 'gemini-3.0-flash',
    fallback: 'gpt-4o-mini'
  },
  analysis: {
    primary: 'gemini-3.0-flash',
    fallback: 'gpt-4o'
  },
  chat: {
    primary: 'gpt-4o-mini',
    fallback: 'gemini-3.0-flash'
  },
  embedding: {
    primary: 'text-embedding-004',
    fallback: null
  },
  transcription: {
    primary: 'gemini-2.5-flash',   // fused transcript+tone via transcribeEntry
    fallback: 'whisper-1'          // server-side fallback inside transcribeEntry
  }
};

// Kill switch: false restores the legacy whisper-1 + separate tone pipeline
// (transcribeWithTone) with no server redeploy.
export const USE_FUSED_TRANSCRIPTION = true;

// Note: API keys are now securely stored in Firebase Cloud Functions
// and are no longer exposed in the frontend code
