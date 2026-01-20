import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

import { config, validateConfig } from './config/index.js';
import { verifyToken } from './auth/firebase.js';
import {
  getAuthorizationUrl,
  completeOAuthFlow,
  disconnectWhoop,
  getHealthSummary as getWhoopHealthSummary,
  hasWhoopLinked,
} from './services/whoop/index.js';
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
  getFullSessionAudio,
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
import {
  analyzeVoiceTone,
  generateTitleAndTags,
  isVoiceToneAnalysisAvailable,
} from './analysis/voiceTone.js';
import { ClientMessageSchema } from './types/index.js';
import type { GuidedSessionType } from './types/index.js';

// Validate configuration on startup
validateConfig();

// Create Express app
const app = express();

// CORS configuration - allow requests from the web app
app.use(cors({
  origin: [
    'https://echo-vault-app.web.app',
    'http://localhost:5173',      // Vite dev server
    'http://localhost:3000',
    'capacitor://localhost',      // iOS app
    'http://localhost',           // Android app
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check endpoint (required for Cloud Run)
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'echovault-voice-relay' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ============================================================================
// HTTP Authentication Middleware
// ============================================================================

interface AuthenticatedRequest extends express.Request {
  userId?: string;
}

/**
 * Middleware to verify Firebase ID token from Authorization header
 */
const authenticateHttp = async (
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.substring(7);
  const authResult = await verifyToken(token);

  if (!authResult.success || !authResult.userId) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.userId = authResult.userId;
  next();
};

// ============================================================================
// Whoop OAuth Endpoints
// ============================================================================

/**
 * GET /auth/whoop
 * Initiates OAuth flow by returning the authorization URL
 */
app.get('/auth/whoop', authenticateHttp, (req: AuthenticatedRequest, res) => {
  try {
    // Use userId as state for CSRF protection
    const state = Buffer.from(
      JSON.stringify({ userId: req.userId, timestamp: Date.now() })
    ).toString('base64');

    const authUrl = getAuthorizationUrl(state);
    res.json({ authUrl });
  } catch (error) {
    console.error('Error generating Whoop auth URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
});

/**
 * GET /auth/whoop/callback
 * Handles OAuth callback from Whoop
 * Exchanges code for tokens and stores them
 */
app.get('/auth/whoop/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Check for OAuth errors
    if (error) {
      console.error('Whoop OAuth error:', error);
      // Redirect to app with error
      res.redirect(`engram://auth-error?provider=whoop&error=${error}`);
      return;
    }

    if (!code || !state) {
      res.redirect('engram://auth-error?provider=whoop&error=missing_params');
      return;
    }

    // Decode state to get userId
    let stateData: { userId: string; timestamp: number };
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch {
      res.redirect('engram://auth-error?provider=whoop&error=invalid_state');
      return;
    }

    // Validate state timestamp (5 minute expiry)
    if (Date.now() - stateData.timestamp > 5 * 60 * 1000) {
      res.redirect('engram://auth-error?provider=whoop&error=state_expired');
      return;
    }

    // Complete the OAuth flow
    await completeOAuthFlow(stateData.userId, code as string);

    console.log(`Whoop linked successfully for user ${stateData.userId}`);

    // Redirect to app with success
    res.redirect('engram://auth-success?provider=whoop');
  } catch (error) {
    console.error('Error completing Whoop OAuth:', error);
    res.redirect('engram://auth-error?provider=whoop&error=token_exchange_failed');
  }
});

/**
 * DELETE /auth/whoop
 * Disconnects Whoop from user account
 */
app.delete('/auth/whoop', authenticateHttp, async (req: AuthenticatedRequest, res) => {
  try {
    await disconnectWhoop(req.userId!);
    console.log(`Whoop disconnected for user ${req.userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error disconnecting Whoop:', error);
    res.status(500).json({ error: 'Failed to disconnect Whoop' });
  }
});

/**
 * GET /auth/whoop/status
 * Check if user has Whoop linked
 */
app.get('/auth/whoop/status', authenticateHttp, async (req: AuthenticatedRequest, res) => {
  try {
    const linked = await hasWhoopLinked(req.userId!);
    res.json({ linked });
  } catch (error) {
    console.error('Error checking Whoop status:', error);
    res.status(500).json({ error: 'Failed to check Whoop status' });
  }
});

// ============================================================================
// Whoop Health Data Endpoints
// ============================================================================

/**
 * GET /health/whoop/summary
 * Returns aggregated health data from Whoop
 */
app.get('/health/whoop/summary', authenticateHttp, async (req: AuthenticatedRequest, res) => {
  try {
    // Parse date from query param, default to today
    const dateParam = req.query.date as string | undefined;
    const date = dateParam ? new Date(dateParam) : new Date();

    // Check if user has Whoop linked
    const linked = await hasWhoopLinked(req.userId!);
    if (!linked) {
      res.status(404).json({
        available: false,
        error: 'Whoop not connected',
        source: 'whoop',
      });
      return;
    }

    const summary = await getWhoopHealthSummary(req.userId!, date);
    res.json(summary);
  } catch (error) {
    console.error('Error fetching Whoop summary:', error);

    // Handle rate limiting gracefully
    if (error instanceof Error && error.message === 'RATE_LIMITED') {
      res.status(429).json({
        available: false,
        error: 'Rate limited. Please try again later.',
        source: 'whoop',
      });
      return;
    }

    res.status(500).json({
      available: false,
      error: 'Failed to fetch Whoop data',
      source: 'whoop',
    });
  }
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

  // Get full session audio for tone analysis BEFORE cleanup
  const fullAudio = getFullSessionAudio(session.sessionId);
  const transcript = session.transcript;

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

  // Run voice tone analysis and title generation in parallel (if saving)
  let voiceToneResult = null;
  let titleTagsResult = null;

  if (saveOptions?.save && fullAudio) {
    console.log(`[${session.sessionId}] Running voice analysis on ${fullAudio.length} bytes of audio`);

    // Run analysis in parallel
    const [toneResult, titleResult] = await Promise.all([
      analyzeVoiceTone(fullAudio, transcript),
      generateTitleAndTags(transcript, session.sessionType),
    ]);

    voiceToneResult = toneResult;
    titleTagsResult = titleResult;

    // Send session analysis results to client
    sendToClient(ws, {
      type: 'session_analysis',
      voiceTone: voiceToneResult || undefined,
      suggestedTitle: titleTagsResult?.title,
      suggestedTags: titleTagsResult?.tags,
      transcript,
    });

    console.log(`[${session.sessionId}] Voice analysis complete:`, {
      mood: voiceToneResult?.moodScore,
      emotions: voiceToneResult?.emotions,
      title: titleTagsResult?.title,
    });
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
