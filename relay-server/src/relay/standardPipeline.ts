import OpenAI from 'openai';
import type WebSocket from 'ws';
import { config } from '../config/index.js';
import type { SessionState, ConversationContext } from '../types/index.js';
import {
  buildSystemPrompt,
  buildOpeningMessage,
  getMemoryToolDefinition,
} from '../context/promptBuilder.js';
import { appendTranscript, flushAudioBuffer, sendToClient } from './sessionManager.js';

const openai = new OpenAI({
  apiKey: config.openaiApiKey,
});

interface StandardSession {
  clientWs: WebSocket;
  sessionState: SessionState;
  context: ConversationContext | null;
  conversationHistory: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

const standardSessions = new Map<string, StandardSession>();

/**
 * Initialize a standard mode session
 */
export const initializeStandardSession = async (
  clientWs: WebSocket,
  sessionState: SessionState,
  context: ConversationContext | null
): Promise<void> => {
  const { sessionId } = sessionState;

  const standardSession: StandardSession = {
    clientWs,
    sessionState,
    context,
    conversationHistory: [
      {
        role: 'system',
        content: buildSystemPrompt(context, sessionState.sessionType),
      },
    ],
  };

  standardSessions.set(sessionId, standardSession);

  // Send session ready
  sendToClient(clientWs, {
    type: 'session_ready',
    sessionId,
    mode: 'standard',
  });

  // Generate and send opening message
  const openingText = buildOpeningMessage(
    sessionState.sessionType || 'free',
    context
  );

  // Add to history
  standardSession.conversationHistory.push({
    role: 'assistant',
    content: openingText,
  });

  // Generate TTS for opening
  await generateAndSendTTS(sessionId, openingText);

  // Record transcript
  const result = appendTranscript(sessionId, openingText, 'assistant');
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
 * Process audio turn in standard mode
 * Called when user finishes speaking (end_turn)
 */
export const processStandardTurn = async (sessionId: string): Promise<void> => {
  const session = standardSessions.get(sessionId);
  if (!session) return;

  const { clientWs, sessionState, context, conversationHistory } = session;

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

    // 4. Add to conversation history
    conversationHistory.push({
      role: 'user',
      content: transcript,
    });

    // 5. Generate response with GPT-4o
    const response = await generateResponse(sessionId, conversationHistory);
    if (!response) {
      return;
    }

    // 6. Add response to history
    conversationHistory.push({
      role: 'assistant',
      content: response,
    });

    // 7. Record assistant transcript
    const assistantResult = appendTranscript(sessionId, response, 'assistant');
    if (assistantResult) {
      sendToClient(clientWs, {
        type: 'transcript_delta',
        delta: assistantResult.delta,
        speaker: 'assistant',
        timestamp: Date.now(),
        sequenceId: assistantResult.sequenceId,
      });
    }

    // 8. Generate and send TTS
    await generateAndSendTTS(sessionId, response);
  } catch (error) {
    console.error(`[${sessionId}] Standard turn processing error:`, error);
    sendToClient(clientWs, {
      type: 'error',
      code: 'PROCESSING_ERROR',
      message: 'Failed to process your message. Please try again.',
      recoverable: true,
    });
  }
};

/**
 * Transcribe audio using Whisper
 */
const transcribeAudio = async (audioBuffer: Buffer): Promise<string> => {
  // Convert Buffer to File using OpenAI's toFile helper
  const file = await OpenAI.toFile(audioBuffer, 'audio.webm', {
    type: 'audio/webm',
  });

  const response = await openai.audio.transcriptions.create({
    file,
    model: config.whisperModel,
    language: 'en',
  });

  return response.text;
};

/**
 * Generate response using GPT-4o
 */
const generateResponse = async (
  sessionId: string,
  conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Promise<string | null> => {
  const session = standardSessions.get(sessionId);
  if (!session) return null;

  try {
    const response = await openai.chat.completions.create({
      model: config.chatModel,
      messages: conversationHistory,
      tools: [getMemoryToolDefinition()],
      tool_choice: 'auto',
      max_tokens: 300, // Keep responses concise for voice
      temperature: 0.7,
    });

    const message = response.choices[0]?.message;

    // Handle tool calls
    if (message?.tool_calls && message.tool_calls.length > 0) {
      // Process tool calls and get final response
      return await handleToolCallsAndRespond(
        sessionId,
        conversationHistory,
        message.tool_calls
      );
    }

    return message?.content || null;
  } catch (error) {
    console.error(`[${sessionId}] GPT-4o error:`, error);
    return null;
  }
};

/**
 * Handle tool calls and generate final response
 */
const handleToolCallsAndRespond = async (
  sessionId: string,
  conversationHistory: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  toolCalls: Array<{
    id: string;
    function: { name: string; arguments: string };
  }>
): Promise<string | null> => {
  const session = standardSessions.get(sessionId);
  if (!session) return null;

  // Process each tool call
  const toolResults: Array<{
    role: 'tool';
    tool_call_id: string;
    content: string;
  }> = [];

  for (const toolCall of toolCalls) {
    if (toolCall.function.name === 'get_memory') {
      try {
        const args = JSON.parse(toolCall.function.arguments);
        // TODO: Implement actual RAG search
        const result = await searchMemory(session.sessionState.userId, args);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      } catch (error) {
        console.error(`[${sessionId}] Tool call error:`, error);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: 'Error retrieving memory.',
        });
      }
    }
  }

  // Generate final response with tool results
  try {
    const messagesWithTools = [
      ...conversationHistory,
      {
        role: 'assistant' as const,
        content: null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: tc.function,
        })),
      },
      ...toolResults,
    ];

    const response = await openai.chat.completions.create({
      model: config.chatModel,
      messages: messagesWithTools as any,
      max_tokens: 300,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || null;
  } catch (error) {
    console.error(`[${sessionId}] Final response error:`, error);
    return null;
  }
};

/**
 * Search memory (RAG) - placeholder
 */
const searchMemory = async (
  userId: string,
  args: { query: string; date_hint?: string; entity_type?: string }
): Promise<string> => {
  // TODO: Implement actual hybrid RAG search
  return 'No relevant entries found for this query.';
};

/**
 * Generate TTS and send to client
 */
const generateAndSendTTS = async (
  sessionId: string,
  text: string
): Promise<void> => {
  const session = standardSessions.get(sessionId);
  if (!session) return;

  try {
    const response = await openai.audio.speech.create({
      model: config.ttsModel,
      voice: config.ttsVoice,
      input: text,
      response_format: 'mp3',
    });

    // Get audio as buffer
    const arrayBuffer = await response.arrayBuffer();
    const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

    // Send to client
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
 * Add audio chunk to buffer (called from main handler)
 */
export const addAudioToStandard = (sessionId: string, audioBase64: string): void => {
  const session = standardSessions.get(sessionId);
  if (!session) return;

  // Decode base64 and add to session's audio buffer
  const audioBuffer = Buffer.from(audioBase64, 'base64');
  // The actual buffering is handled by sessionManager.addAudioChunk
};

/**
 * Close standard session
 */
export const closeStandardSession = (sessionId: string): void => {
  standardSessions.delete(sessionId);
};

/**
 * Check if standard session exists
 */
export const hasStandardSession = (sessionId: string): boolean => {
  return standardSessions.has(sessionId);
};
