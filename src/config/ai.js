// API Keys from environment
export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
export const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

// AI Model Configuration
export const AI_CONFIG = {
  classification: {
    primary: 'gemini-1.5-flash',
    fallback: 'gpt-4o-mini'
  },
  analysis: {
    primary: 'gemini-2.0-flash',
    fallback: 'gpt-4o'
  },
  chat: {
    primary: 'gpt-4o-mini',
    fallback: 'gemini-1.5-flash'
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
