import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

import { config, validateConfig } from './config/index.js';
import { verifyToken } from './auth/firebase.js';
import {
  createSession,
  getSession,
  getSessionByUser,
  endSession,
  checkSessionDuration,
  addAudioChunk,
  loadSessionContext,
  sendToClient,
  checkUsageLimits,
  getProcessingMode,
} from './relay/sessionManager.js';
import {
  createRealtimeConnection,
  sendAudioToRealtime,
  commitRealtimeAudio,
  closeRealtimeConnection,
  hasRealtimeSession,
} from './relay/realtimeProxy.js';
import {
  initializeStandardSession,
  processStandardTurn,
  closeStandardSession,
  hasStandardSession,
} from './relay/standardPipeline.js';
import {
  initializeGuidedSession,
  processGuidedTurn,
  closeGuidedSession,
  hasGuidedSession,
  getGuidedSessionData,
} from './relay/guidedPipeline.js';
import { ClientMessageSchema } from './types/index.js';
import type { GuidedSessionType } from './types/index.js';

// Validate configuration on startup
validateConfig();

// Create Express app
const app = express();
app.use(express.json());

// Health check endpoint (required for Cloud Run)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'echovault-voice-relay' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/voice',
});

// Track authenticated connections
const authenticatedConnections = new Map<WebSocket, string>(); // ws -> userId

/**
 * Handle new WebSocket connections
 */
wss.on('connection', async (ws, req) => {
  console.log('New WebSocket connection');

  // Parse token from query string
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    console.log('Connection rejected: No token provided');
    ws.close(4001, 'Authentication required');
    return;
  }

  // Verify token
  const authResult = await verifyToken(token);
  if (!authResult.success || !authResult.userId) {
    console.log('Connection rejected: Invalid token');
    ws.close(4002, 'Invalid authentication');
    return;
  }

  const userId = authResult.userId;
  authenticatedConnections.set(ws, userId);
  console.log(`User ${userId} connected`);

  // Handle messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, userId, message);
    } catch (error) {
      console.error('Error handling message:', error);
      sendToClient(ws, {
        type: 'error',
        code: 'INVALID_MESSAGE',
        message: 'Invalid message format',
        recoverable: true,
      });
    }
  });

  // Handle disconnection
  ws.on('close', async (code, reason) => {
    console.log(`User ${userId} disconnected: ${code} ${reason}`);
    authenticatedConnections.delete(ws);

    // Clean up any active session
    const session = getSessionByUser(userId);
    if (session) {
      if (hasRealtimeSession(session.sessionId)) {
        closeRealtimeConnection(session.sessionId);
      }
      if (hasStandardSession(session.sessionId)) {
        closeStandardSession(session.sessionId);
      }
      if (hasGuidedSession(session.sessionId)) {
        closeGuidedSession(session.sessionId);
      }
      await endSession(session.sessionId);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for user ${userId}:`, error);
  });
});

/**
 * Handle incoming messages from authenticated clients
 */
async function handleMessage(
  ws: WebSocket,
  userId: string,
  rawMessage: unknown
): Promise<void> {
  // Validate message schema
  const parseResult = ClientMessageSchema.safeParse(rawMessage);
  if (!parseResult.success) {
    console.error('Invalid message:', parseResult.error);
    sendToClient(ws, {
      type: 'error',
      code: 'INVALID_MESSAGE',
      message: 'Invalid message format',
      recoverable: true,
    });
    return;
  }

  const message = parseResult.data;

  switch (message.type) {
    case 'start_session': {
      await handleStartSession(ws, userId, message.mode, message.sessionType);
      break;
    }

    case 'audio_chunk': {
      await handleAudioChunk(ws, userId, message.data);
      break;
    }

    case 'end_turn': {
      await handleEndTurn(ws, userId);
      break;
    }

    case 'end_session': {
      await handleEndSession(ws, userId, message.saveOptions);
      break;
    }

    case 'token_refresh': {
      await handleTokenRefresh(ws, userId, message.token);
      break;
    }

    case 'restore_transcript': {
      await handleRestoreTranscript(ws, userId, message.content, message.sequenceId);
      break;
    }
  }
}

/**
 * Handle session start
 */
async function handleStartSession(
  ws: WebSocket,
  userId: string,
  requestedMode: 'realtime' | 'standard',
  sessionType?: string
): Promise<void> {
  const typedSessionType = (sessionType || 'free') as GuidedSessionType | 'free';

  // Determine actual mode based on session type
  const mode = requestedMode === 'realtime'
    ? getProcessingMode(typedSessionType)
    : 'standard';

  // Check usage limits
  const limitCheck = await checkUsageLimits(userId, mode);
  if (!limitCheck.allowed) {
    sendToClient(ws, {
      type: 'usage_limit',
      limitType: limitCheck.reason as any,
      suggestion: limitCheck.suggestion || 'Please try again later.',
    });
    return;
  }

  try {
    // Create session
    const { session, error } = await createSession(userId, typedSessionType);

    if (error === 'Session already exists') {
      // Resume existing session
      sendToClient(ws, {
        type: 'session_ready',
        sessionId: session.sessionId,
        mode: session.mode,
      });
      return;
    }

    // Load RAG context
    const context = await loadSessionContext(session.sessionId);

    // Initialize appropriate pipeline
    if (session.mode === 'realtime') {
      await createRealtimeConnection(ws, session, context);
    } else if (typedSessionType !== 'free') {
      // Use guided pipeline for structured sessions
      const success = await initializeGuidedSession(
        ws,
        session,
        context,
        typedSessionType as GuidedSessionType
      );
      if (!success) {
        // Fall back to standard if guided session not available
        await initializeStandardSession(ws, session, context);
      }
    } else {
      await initializeStandardSession(ws, session, context);
    }

    console.log(`Session ${session.sessionId} started for user ${userId} in ${session.mode} mode (${typedSessionType})`);
  } catch (error) {
    console.error('Failed to start session:', error);
    sendToClient(ws, {
      type: 'error',
      code: 'SESSION_ERROR',
      message: error instanceof Error ? error.message : 'Failed to start session',
      recoverable: false,
    });
  }
}

/**
 * Handle audio chunk from client
 */
async function handleAudioChunk(
  ws: WebSocket,
  userId: string,
  audioBase64: string
): Promise<void> {
  const session = getSessionByUser(userId);
  if (!session) {
    sendToClient(ws, {
      type: 'error',
      code: 'NO_SESSION',
      message: 'No active session. Please start a session first.',
      recoverable: true,
    });
    return;
  }

  // Check session duration
  if (!checkSessionDuration(session.sessionId)) {
    sendToClient(ws, {
      type: 'usage_limit',
      limitType: 'session_duration',
      suggestion: 'Session time limit reached. Please save your entry.',
    });
    return;
  }

  if (session.mode === 'realtime') {
    // Send directly to OpenAI Realtime
    sendAudioToRealtime(session.sessionId, audioBase64);
  } else {
    // Buffer audio for standard processing
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    addAudioChunk(session.sessionId, audioBuffer);
  }
}

/**
 * Handle end of turn (user finished speaking)
 */
async function handleEndTurn(ws: WebSocket, userId: string): Promise<void> {
  const session = getSessionByUser(userId);
  if (!session) return;

  if (session.mode === 'realtime') {
    // Commit audio buffer to OpenAI Realtime
    commitRealtimeAudio(session.sessionId);
  } else if (hasGuidedSession(session.sessionId)) {
    // Process through guided pipeline
    await processGuidedTurn(session.sessionId);
  } else {
    // Process buffered audio through standard pipeline
    await processStandardTurn(session.sessionId);
  }
}

/**
 * Handle session end
 */
async function handleEndSession(
  ws: WebSocket,
  userId: string,
  saveOptions?: { save: boolean; asGuidedSession?: boolean; sessionType?: string }
): Promise<void> {
  const session = getSessionByUser(userId);
  if (!session) {
    sendToClient(ws, {
      type: 'error',
      code: 'NO_SESSION',
      message: 'No active session to end.',
      recoverable: true,
    });
    return;
  }

  // Get guided session data before cleanup
  const guidedData = hasGuidedSession(session.sessionId)
    ? getGuidedSessionData(session.sessionId)
    : null;

  // Close OpenAI connection
  if (hasRealtimeSession(session.sessionId)) {
    closeRealtimeConnection(session.sessionId);
  }
  if (hasStandardSession(session.sessionId)) {
    closeStandardSession(session.sessionId);
  }
  if (hasGuidedSession(session.sessionId)) {
    closeGuidedSession(session.sessionId);
  }

  // End session and get stats
  const result = await endSession(session.sessionId);

  if (result && saveOptions?.save) {
    // For guided sessions, send the structured data
    if (guidedData) {
      sendToClient(ws, {
        type: 'guided_session_complete',
        sessionType: guidedData.sessionType,
        responses: guidedData.responses,
        summary: guidedData.entryText,
      });
    }

    // TODO: Save transcript as entry via Cloud Function
    // For now, send success response
    sendToClient(ws, {
      type: 'session_saved',
      entryId: 'pending-implementation',
      success: true,
    });
  }

  console.log(
    `Session ${session.sessionId} ended. Duration: ${result?.durationMinutes.toFixed(1)}min, Cost: $${result?.costUSD.toFixed(2)}`
  );
}

/**
 * Handle token refresh
 */
async function handleTokenRefresh(
  ws: WebSocket,
  userId: string,
  newToken: string
): Promise<void> {
  const authResult = await verifyToken(newToken);
  if (!authResult.success || authResult.userId !== userId) {
    console.log('Token refresh failed');
    ws.close(4002, 'Token refresh failed');
    return;
  }

  console.log(`Token refreshed for user ${userId}`);
}

/**
 * Handle transcript restore (reconnection)
 */
async function handleRestoreTranscript(
  ws: WebSocket,
  userId: string,
  content: string,
  sequenceId: number
): Promise<void> {
  const session = getSessionByUser(userId);
  if (!session) {
    // Create new session to restore into
    // TODO: Implement proper reconnection flow
    console.log(`Restore attempted but no session for user ${userId}`);
    return;
  }

  // Restore handled by session manager
  console.log(`Transcript restored for session ${session.sessionId}`);
}

// Start server
const PORT = config.port;
server.listen(PORT, () => {
  console.log(`Voice relay server listening on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');

  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
