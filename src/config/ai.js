// AI Model Configuration (for reference - actual API calls are now handled by Cloud Functions)
export const AI_CONFIG = {
  classification: {
    primary: 'gemini-2.0-flash',
    fallback: 'gpt-4o-mini'
  },
  analysis: {
    primary: 'gemini-2.0-flash',
    fallback: 'gpt-4o'
  },
  chat: {
    primary: 'gpt-4o-mini',
    fallback: 'gemini-2.0-flash'
  },
  embedding: {
    primary: 'text-embedding-004',
    fallback: null
  },
  transcription: {
    primary: 'whisper-1',
    fallback: null
  }
};

// Note: API keys are now securely stored in Firebase Cloud Functions
// and are no longer exposed in the frontend code
