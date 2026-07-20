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
  whoopRedirectUri: process.env.WHOOP_REDIRECT_URI || 'https://echovault-voice-relay-581319345416.us-central1.run.app/auth/whoop/callback',
  whoopTokenEncryptionKey: process.env.WHOOP_TOKEN_ENCRYPTION_KEY || '',

  // Realtime API settings. Model overridable via REALTIME_MODEL. Default is
  // the GA gpt-realtime-2.1 (replaces the deprecated preview model). The
  // session.update payload uses only stable Realtime API fields.
  realtimeModel: process.env.REALTIME_MODEL || 'gpt-realtime-2.1',
  realtimeVoice: 'alloy', // Options: alloy, echo, fable, onyx, nova, shimmer

  // Standard mode settings. Models overridable via env for parity with the
  // Cloud Functions model registry.
  whisperModel: process.env.WHISPER_MODEL || 'whisper-1',
  chatModel: process.env.CHAT_MODEL || 'gpt-4o',
  ttsModel: process.env.TTS_MODEL || 'tts-1',
  ttsVoice: 'nova',

  // Gemini settings (voice tone analysis). Overridable via TONE_MODEL. Default
  // is GA gemini-3.5-flash (replaces the shut-down 2.0 experimental preview);
  // same generateContent surface for audio-in tone analysis.
  geminiModel: process.env.TONE_MODEL || 'gemini-3.5-flash', // Supports audio input

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
