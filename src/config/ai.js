// Client-side AI configuration.
//
// Model ids are NOT declared here. All AI calls run server-side (Cloud
// Functions / relay-server) which own model selection via the server model
// registry (functions/src/models/registry.js). The client never sends a model
// name — see src/services/ai/gemini.js, which delegates to executePrompt.

// Kill switch: false restores the legacy whisper-1 + separate tone pipeline
// (transcribeWithTone) with no server redeploy.
export const USE_FUSED_TRANSCRIPTION = true;

// Note: API keys are securely stored in Firebase Cloud Functions and are not
// exposed in the frontend code.
