/**
 * Configuration and environment variables
 * In Cloud Run, secrets are mounted as environment variables
 */

export const config = {
  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',

  // Google Gemini (for voice tone analysis)
  geminiApiKey: process.env.GEMINI_API_KEY || '',

  // Firebase (optional - uses default credentials in Cloud Run)
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,

  // Whoop Integration
  whoopClientId: process.env.WHOOP_CLIENT_ID || '',
  whoopClientSecret: process.env.WHOOP_CLIENT_SECRET || '',
  whoopRedirectUri: process.env.WHOOP_REDIRECT_URI || 'https://echo-vault-app.web.app/__/auth/handler',
  whoopTokenEncryptionKey: process.env.WHOOP_TOKEN_ENCRYPTION_KEY || '',

  // Realtime API settings
  realtimeModel: 'gpt-4o-realtime-preview-2024-12-17',
  realtimeVoice: 'alloy', // Options: alloy, echo, fable, onyx, nova, shimmer

  // Standard mode settings
  whisperModel: 'whisper-1',
  chatModel: 'gpt-4o',
  ttsModel: 'tts-1',
  ttsVoice: 'nova',

  // Gemini settings
  geminiModel: 'gemini-2.0-flash-exp', // Supports audio input

  // Session settings
  maxSessionDurationMs: 15 * 60 * 1000, // 15 minutes
  sessionTimeoutMs: 5 * 60 * 1000, // 5 minutes inactivity
} as const;

export const validateConfig = (): void => {
  const required = ['openaiApiKey'];
  const missing = required.filter(
    (key) => !config[key as keyof typeof config]
  );

  if (missing.length > 0) {
    throw new Error(`Missing required config: ${missing.join(', ')}`);
  }

  // Warn about optional but recommended config
  if (!config.geminiApiKey) {
    console.warn('GEMINI_API_KEY not set - voice tone analysis will be disabled');
  }
};
