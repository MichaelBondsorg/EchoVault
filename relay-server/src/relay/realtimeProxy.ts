import WebSocket from 'ws';
import { config } from '../config/index.js';
import type { SessionState, ConversationContext } from '../types/index.js';
import { buildSystemPrompt, getMemoryToolDefinition } from '../context/promptBuilder.js';
import { appendTranscript, sendToClient } from './sessionManager.js';

const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';

interface RealtimeSession {
  openaiWs: WebSocket;
  clientWs: WebSocket;
  sessionState: SessionState;
}

const realtimeSessions = new Map<string, RealtimeSession>();

/**
 * Create a new OpenAI Realtime API connection
 */
export const createRealtimeConnection = async (
  clientWs: WebSocket,
  sessionState: SessionState,
  context: ConversationContext | null
): Promise<void> => {
  const { sessionId } = sessionState;

  // Connect to OpenAI Realtime API
  const openaiWs = new WebSocket(
    `${OPENAI_REALTIME_URL}?model=${config.realtimeModel}`,
    {
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }
  );

  const realtimeSession: RealtimeSession = {
    openaiWs,
    clientWs,
    sessionState,
  };

  realtimeSessions.set(sessionId, realtimeSession);

  // Handle OpenAI connection open
  openaiWs.on('open', () => {
    console.log(`[${sessionId}] OpenAI Realtime connection established`);

    // Configure the session
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: buildSystemPrompt(context, sessionState.sessionType),
        voice: config.realtimeVoice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
        tools: [getMemoryToolDefinition()],
        tool_choice: 'auto',
      },
    };

    openaiWs.send(JSON.stringify(sessionConfig));
  });

  // Handle messages from OpenAI
  openaiWs.on('message', (data) => {
    handleOpenAIMessage(sessionId, data.toString());
  });

  // Handle OpenAI errors
  openaiWs.on('error', (error) => {
    console.error(`[${sessionId}] OpenAI WebSocket error:`, error);
    sendToClient(clientWs, {
      type: 'error',
      code: 'OPENAI_ERROR',
      message: 'Voice connection error. Please try again.',
      recoverable: true,
    });
  });

  // Handle OpenAI connection close
  openaiWs.on('close', (code, reason) => {
    console.log(`[${sessionId}] OpenAI connection closed: ${code} ${reason}`);
    realtimeSessions.delete(sessionId);
  });
};

/**
 * Handle messages from OpenAI Realtime API
 */
const handleOpenAIMessage = (sessionId: string, data: string): void => {
  const session = realtimeSessions.get(sessionId);
  if (!session) return;

  const { clientWs, sessionState } = session;

  try {
    const event = JSON.parse(data);

    switch (event.type) {
      case 'session.created':
        console.log(`[${sessionId}] Session created`);
        sendToClient(clientWs, {
          type: 'session_ready',
          sessionId,
          mode: 'realtime',
        });
        break;

      case 'session.updated':
        console.log(`[${sessionId}] Session updated`);
        break;

      case 'input_audio_buffer.speech_started':
        // User started speaking
        break;

      case 'input_audio_buffer.speech_stopped':
        // User stopped speaking
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // User's speech transcribed
        if (event.transcript) {
          const result = appendTranscript(sessionId, event.transcript, 'user');
          if (result) {
            sendToClient(clientWs, {
              type: 'transcript_delta',
              delta: result.delta,
              speaker: 'user',
              timestamp: Date.now(),
              sequenceId: result.sequenceId,
            });
          }
        }
        break;

      case 'response.audio.delta':
        // Streaming audio response
        if (event.delta) {
          sendToClient(clientWs, {
            type: 'audio_response',
            data: event.delta,
          });
        }
        break;

      case 'response.audio_transcript.delta':
        // Streaming text of audio response
        break;

      case 'response.audio_transcript.done':
        // Complete transcript of assistant response
        if (event.transcript) {
          const result = appendTranscript(sessionId, event.transcript, 'assistant');
          if (result) {
            sendToClient(clientWs, {
              type: 'transcript_delta',
              delta: result.delta,
              speaker: 'assistant',
              timestamp: Date.now(),
              sequenceId: result.sequenceId,
            });
          }
        }
        break;

      case 'response.function_call_arguments.done':
        // Handle tool calls (get_memory)
        handleToolCall(sessionId, event);
        break;

      case 'response.done':
        // Response complete
        break;

      case 'error':
        console.error(`[${sessionId}] OpenAI error:`, event.error);
        sendToClient(clientWs, {
          type: 'error',
          code: event.error?.code || 'OPENAI_ERROR',
          message: event.error?.message || 'An error occurred',
          recoverable: true,
        });
        break;

      default:
        // Log unhandled events in development
        if (config.nodeEnv === 'development') {
          console.log(`[${sessionId}] Unhandled event: ${event.type}`);
        }
    }
  } catch (error) {
    console.error(`[${sessionId}] Error parsing OpenAI message:`, error);
  }
};

/**
 * Handle tool calls from the model
 */
const handleToolCall = async (sessionId: string, event: any): Promise<void> => {
  const session = realtimeSessions.get(sessionId);
  if (!session) return;

  const { openaiWs, sessionState } = session;

  if (event.name === 'get_memory') {
    try {
      const args = JSON.parse(event.arguments);

      // TODO: Implement actual RAG search
      // For now, return a placeholder
      const result = await searchMemory(sessionState.userId, args);

      // Send tool result back to OpenAI
      openaiWs.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: event.call_id,
            output: result,
          },
        })
      );

      // Trigger response generation
      openaiWs.send(JSON.stringify({ type: 'response.create' }));
    } catch (error) {
      console.error(`[${sessionId}] Tool call error:`, error);
    }
  }
};

/**
 * Search memory (RAG) - placeholder implementation
 */
const searchMemory = async (
  userId: string,
  args: { query: string; date_hint?: string; entity_type?: string }
): Promise<string> => {
  // TODO: Implement actual hybrid RAG search via Firebase
  // This would call a Cloud Function or directly query Firestore + vector DB

  // Placeholder response
  return 'No relevant entries found for this query.';
};

/**
 * Send audio chunk to OpenAI
 */
export const sendAudioToRealtime = (sessionId: string, audioBase64: string): void => {
  const session = realtimeSessions.get(sessionId);
  if (!session || session.openaiWs.readyState !== WebSocket.OPEN) return;

  session.openaiWs.send(
    JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: audioBase64,
    })
  );
};

/**
 * Commit audio buffer (end of turn)
 */
export const commitRealtimeAudio = (sessionId: string): void => {
  const session = realtimeSessions.get(sessionId);
  if (!session || session.openaiWs.readyState !== WebSocket.OPEN) return;

  session.openaiWs.send(
    JSON.stringify({
      type: 'input_audio_buffer.commit',
    })
  );

  // Request response
  session.openaiWs.send(JSON.stringify({ type: 'response.create' }));
};

/**
 * Close realtime connection
 */
export const closeRealtimeConnection = (sessionId: string): void => {
  const session = realtimeSessions.get(sessionId);
  if (!session) return;

  if (session.openaiWs.readyState === WebSocket.OPEN) {
    session.openaiWs.close();
  }

  realtimeSessions.delete(sessionId);
};

/**
 * Check if realtime session exists
 */
export const hasRealtimeSession = (sessionId: string): boolean => {
  return realtimeSessions.has(sessionId);
};
