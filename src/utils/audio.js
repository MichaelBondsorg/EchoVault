// OpenAI Text-to-Speech
// NOTE: TTS functionality requires API key which has been moved to Cloud Functions for security.
// To re-enable TTS, create a Cloud Function that handles the OpenAI TTS API call.

export const synthesizeSpeech = async (text, voice = 'nova') => {
  // TTS not available - would need a Cloud Function to securely call OpenAI TTS API
  console.warn('TTS not available: requires Cloud Function implementation');
  return null;
};
