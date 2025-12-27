import OpenAI from 'openai';
import type WebSocket from 'ws';
import { config } from '../config/index.js';
import type { SessionState, ConversationContext, GuidedSessionType } from '../types/index.js';
import type { SessionContext, GuidedSessionState } from '../sessions/schema.js';
import {
  createGuidedSessionState,
  getNextPrompt,
  processResponse,
  getResponsesAsEntryText,
  generateSessionSummary,
} from '../sessions/runner.js';
import { appendTranscript, flushAudioBuffer, sendToClient, getSession } from './sessionManager.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

/**
 * Convert raw PCM16 data to WAV format
 */
const pcmToWav = (pcmBuffer: Buffer, sampleRate: number = 24000): Buffer => {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const headerSize = 44;
  const fileSize = headerSize + dataSize;

  const wav = Buffer.alloc(fileSize);

  // RIFF header
  wav.write('RIFF', 0);
  wav.writeUInt32LE(fileSize - 8, 4);
  wav.write('WAVE', 8);

  // fmt subchunk
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);

  // data subchunk
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);

  // Copy PCM data
  pcmBuffer.copy(wav, 44);

  return wav;
};

interface GuidedSession {
  clientWs: WebSocket;
  sessionState: SessionState;
  guidedState: GuidedSessionState;
}

const guidedSessions = new Map<string, GuidedSession>();

/**
 * Convert ConversationContext to SessionContext for guided sessions
 */
const convertToSessionContext = (context: ConversationContext | null): SessionContext => {
  if (!context) {
    return {
      recentEntries: [],
      activeGoals: [],
      openSituations: [],
      moodTrajectory: {
        trend: 'stable',
        recentAverage: 0.5,
      },
    };
  }

  return {
    recentEntries: context.recentEntries.map((e) => ({
      id: e.id,
      date: e.effectiveDate,
      title: e.title,
      text: e.text,
      moodScore: e.moodScore,
    })),
    activeGoals: context.activeGoals,
    openSituations: context.openSituations,
    yesterdayHighlight: context.recentEntries[0]?.title,
    moodTrajectory: {
      trend: context.moodTrajectory.trend,
      recentAverage: 0.5, // Default if not calculated
    },
  };
};

/**
 * Initialize a guided session
 */
export const initializeGuidedSession = async (
  clientWs: WebSocket,
  sessionState: SessionState,
  context: ConversationContext | null,
  sessionType: GuidedSessionType
): Promise<boolean> => {
  const { sessionId } = sessionState;

  // Convert context for guided session
  const sessionContext = convertToSessionContext(context);

  // Create guided session state
  const guidedState = createGuidedSessionState(sessionType, sessionContext);
  if (!guidedState) {
    sendToClient(clientWs, {
      type: 'error',
      code: 'SESSION_TYPE_NOT_FOUND',
      message: `Session type "${sessionType}" is not available yet.`,
      recoverable: false,
    });
    return false;
  }

  const guidedSession: GuidedSession = {
    clientWs,
    sessionState,
    guidedState,
  };

  guidedSessions.set(sessionId, guidedSession);

  // Store guided state in session state
  sessionState.guidedState = guidedState;

  // Send session ready
  sendToClient(clientWs, {
    type: 'session_ready',
    sessionId,
    mode: 'standard',
  });

  // Get and send the first prompt (opening message)
  await sendNextGuidedPrompt(sessionId);

  return true;
};

/**
 * Send the next prompt to the client
 */
const sendNextGuidedPrompt = async (sessionId: string): Promise<void> => {
  const session = guidedSessions.get(sessionId);
  if (!session) return;

  const { clientWs, guidedState } = session;

  const nextPrompt = getNextPrompt(guidedState);

  if (!nextPrompt) {
    // Session complete
    await completeGuidedSession(sessionId);
    return;
  }

  // Send prompt info to client
  sendToClient(clientWs, {
    type: 'guided_prompt',
    promptId: nextPrompt.promptId,
    prompt: nextPrompt.prompt,
    isOpening: nextPrompt.isOpening,
    isClosing: nextPrompt.isClosing,
    promptIndex: guidedState.currentPromptIndex,
    totalPrompts: guidedState.definition.prompts.length,
  });

  // Generate and send TTS for the prompt
  await generateAndSendTTS(sessionId, nextPrompt.prompt);

  // Record assistant transcript
  const result = appendTranscript(sessionId, nextPrompt.prompt, 'assistant');
  if (result) {
    sendToClient(clientWs, {
      type: 'transcript_delta',
      delta: result.delta,
      speaker: 'assistant',
      timestamp: Date.now(),
      sequenceId: result.sequenceId,
    });
  }
};

/**
 * Process user audio turn in guided session
 */
export const processGuidedTurn = async (sessionId: string): Promise<void> => {
  const session = guidedSessions.get(sessionId);
  if (!session) return;

  const { clientWs, guidedState } = session;

  try {
    // 1. Get buffered audio
    const audioBuffer = flushAudioBuffer(sessionId);
    if (!audioBuffer || audioBuffer.length === 0) {
      console.log(`[${sessionId}] No audio to process`);
      return;
    }

    // 2. Transcribe with Whisper
    const transcript = await transcribeAudio(audioBuffer);
    if (!transcript || transcript.trim().length === 0) {
      console.log(`[${sessionId}] Empty transcription`);
      return;
    }

    console.log(`[${sessionId}] Transcribed: ${transcript}`);

    // 3. Record user transcript
    const userResult = appendTranscript(sessionId, transcript, 'user');
    if (userResult) {
      sendToClient(clientWs, {
        type: 'transcript_delta',
        delta: userResult.delta,
        speaker: 'user',
        timestamp: Date.now(),
        sequenceId: userResult.sequenceId,
      });
    }

    // 4. Process response in guided session
    const result = processResponse(guidedState, transcript);

    if (result.hasFollowUp && result.followUpPrompt) {
      // Send follow-up prompt
      sendToClient(clientWs, {
        type: 'guided_prompt',
        prompt: result.followUpPrompt,
        isOpening: false,
        isClosing: false,
        promptIndex: guidedState.currentPromptIndex,
        totalPrompts: guidedState.definition.prompts.length,
      });

      await generateAndSendTTS(sessionId, result.followUpPrompt);

      const assistantResult = appendTranscript(sessionId, result.followUpPrompt, 'assistant');
      if (assistantResult) {
        sendToClient(clientWs, {
          type: 'transcript_delta',
          delta: assistantResult.delta,
          speaker: 'assistant',
          timestamp: Date.now(),
          sequenceId: assistantResult.sequenceId,
        });
      }
    } else if (result.sessionComplete) {
      // Session is complete
      await completeGuidedSession(sessionId);
    } else {
      // Send next prompt
      await sendNextGuidedPrompt(sessionId);
    }
  } catch (error) {
    console.error(`[${sessionId}] Guided turn processing error:`, error);
    sendToClient(clientWs, {
      type: 'error',
      code: 'PROCESSING_ERROR',
      message: 'Failed to process your message. Please try again.',
      recoverable: true,
    });
  }
};

/**
 * Complete the guided session
 */
const completeGuidedSession = async (sessionId: string): Promise<void> => {
  const session = guidedSessions.get(sessionId);
  if (!session) return;

  const { clientWs, guidedState } = session;

  // Generate summary
  const summary = generateSessionSummary(guidedState);
  const entryText = getResponsesAsEntryText(guidedState);

  // Send completion message
  sendToClient(clientWs, {
    type: 'guided_session_complete',
    sessionType: guidedState.definition.id,
    responses: guidedState.responses,
    summary: entryText,
  });

  // If there's a closing message, send it
  if (guidedState.definition.closingMessage) {
    await generateAndSendTTS(sessionId, guidedState.definition.closingMessage);
  }

  console.log(`[${sessionId}] Guided session completed:`, guidedState.definition.name);
};

/**
 * Transcribe audio using Whisper
 */
const transcribeAudio = async (audioBuffer: Buffer): Promise<string> => {
  const wavBuffer = pcmToWav(audioBuffer);
  const file = await OpenAI.toFile(wavBuffer, 'audio.wav', {
    type: 'audio/wav',
  });

  const response = await openai.audio.transcriptions.create({
    file,
    model: config.whisperModel,
    language: 'en',
  });

  return response.text;
};

/**
 * Generate TTS and send to client
 */
const generateAndSendTTS = async (
  sessionId: string,
  text: string
): Promise<void> => {
  const session = guidedSessions.get(sessionId);
  if (!session) return;

  try {
    const response = await openai.audio.speech.create({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    sendToClient(session.clientWs, {
      type: 'audio_response',
      data: audioBase64,
      transcript: text,
    });
  } catch (error) {
    console.error(`[${sessionId}] TTS error:`, error);
    // Still send transcript even if TTS fails
    sendToClient(session.clientWs, {
      type: 'audio_response',
      data: '',
      transcript: text,
    });
  }
};

/**
 * Close guided session
 */
export const closeGuidedSession = (sessionId: string): void => {
  guidedSessions.delete(sessionId);
};

/**
 * Check if guided session exists
 */
export const hasGuidedSession = (sessionId: string): boolean => {
  return guidedSessions.has(sessionId);
};

/**
 * Get guided session responses for saving
 */
export const getGuidedSessionData = (sessionId: string): {
  responses: Record<string, string>;
  entryText: string;
  sessionType: string;
  definition: { name: string; summaryPrompt: string };
} | null => {
  const session = guidedSessions.get(sessionId);
  if (!session) return null;

  return {
    responses: session.guidedState.responses,
    entryText: getResponsesAsEntryText(session.guidedState),
    sessionType: session.guidedState.definition.id,
    definition: {
      name: session.guidedState.definition.name,
      summaryPrompt: session.guidedState.definition.outputProcessing.summaryPrompt,
    },
  };
};
