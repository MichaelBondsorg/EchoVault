import { v4 as uuidv4 } from 'uuid';
import type WebSocket from 'ws';
import {
  SessionState,
  ProcessingMode,
  GuidedSessionType,
  ConversationContext,
  USAGE_LIMITS,
  COST_RATES,
  RelayMessage,
} from '../types/index.js';
import {
  getUserUsage,
  updateUserUsage,
  getRecentEntries,
  getActiveGoals,
  getOpenSituations,
  getMoodTrajectory,
} from '../auth/firebase.js';

// In-memory session storage (Phase 1)
// TODO: Phase 2 - Move to Redis for cross-instance state
const sessions = new Map<string, SessionState>();
const userSessions = new Map<string, string>(); // userId -> sessionId (prevent concurrent sessions)

// Maximum audio buffer size per session (50MB) - prevents memory exhaustion DoS
const MAX_AUDIO_BUFFER_BYTES = 50 * 1024 * 1024;

/**
 * Determine processing mode based on session type
 */
export const getProcessingMode = (
  sessionType: GuidedSessionType | 'free'
): ProcessingMode => {
  // Use Realtime API only when interactivity matters
  const realtimeSessions: GuidedSessionType[] = [
    'emotional_processing',
    'situation_processing',
    'stress_release',
  ];

  if (sessionType === 'free') return 'realtime';
  return realtimeSessions.includes(sessionType as GuidedSessionType)
    ? 'realtime'
    : 'standard';
};

/**
 * Check if user can start a session (usage limits)
 */
export const checkUsageLimits = async (
  userId: string,
  mode: ProcessingMode
): Promise<{ allowed: boolean; reason?: string; suggestion?: string }> => {
  const usage = await getUserUsage(userId);

  // Check daily cost limit
  if (usage.estimatedCostUSD >= USAGE_LIMITS.maxDailyCostUSD) {
    return {
      allowed: false,
      reason: 'daily_cost',
      suggestion: 'You\'ve reached your daily voice limit. Try text journaling or come back tomorrow!',
    };
  }

  // Check realtime minutes limit
  if (mode === 'realtime' && usage.realtimeMinutes >= USAGE_LIMITS.maxDailyRealtimeMinutes) {
    return {
      allowed: false,
      reason: 'realtime_minutes',
      suggestion: 'Realtime voice is limited today. Try a guided session instead (they use less quota).',
    };
  }

  // Check standard minutes limit
  if (mode === 'standard' && usage.standardMinutes >= USAGE_LIMITS.maxDailyStandardMinutes) {
    return {
      allowed: false,
      reason: 'standard_minutes',
      suggestion: 'You\'ve used a lot of voice journaling today. Try text entry or come back tomorrow!',
    };
  }

  return { allowed: true };
};

/**
 * Create a new session
 */
export const createSession = async (
  userId: string,
  sessionType: GuidedSessionType | 'free' = 'free'
): Promise<{ session: SessionState; error?: string }> => {
  // Check for existing session
  const existingSessionId = userSessions.get(userId);
  if (existingSessionId && sessions.has(existingSessionId)) {
    return {
      session: sessions.get(existingSessionId)!,
      error: 'Session already exists',
    };
  }

  const mode = getProcessingMode(sessionType);

  // Check usage limits
  const limitCheck = await checkUsageLimits(userId, mode);
  if (!limitCheck.allowed) {
    throw new Error(limitCheck.suggestion || 'Usage limit reached');
  }

  const sessionId = uuidv4();
  const now = Date.now();

  const session: SessionState = {
    sessionId,
    userId,
    mode,
    sessionType,
    transcript: '',
    sequenceId: 0,
    startTime: now,
    lastActivity: now,
    audioBuffer: [],
    fullSessionAudio: [],
  };

  sessions.set(sessionId, session);
  userSessions.set(userId, sessionId);

  return { session };
};

/**
 * Get session by ID
 */
export const getSession = (sessionId: string): SessionState | undefined => {
  return sessions.get(sessionId);
};

/**
 * Get session by user ID
 */
export const getSessionByUser = (userId: string): SessionState | undefined => {
  const sessionId = userSessions.get(userId);
  if (!sessionId) return undefined;
  return sessions.get(sessionId);
};

/**
 * Update session transcript
 */
export const appendTranscript = (
  sessionId: string,
  text: string,
  speaker: 'user' | 'assistant'
): { delta: string; sequenceId: number } | null => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const prefix = speaker === 'user' ? 'User: ' : 'Assistant: ';
  const delta = `${prefix}${text}\n`;

  session.transcript += delta;
  session.sequenceId++;
  session.lastActivity = Date.now();

  return {
    delta,
    sequenceId: session.sequenceId,
  };
};

/**
 * Restore transcript from client (reconnection)
 */
export const restoreTranscript = (
  sessionId: string,
  content: string,
  sequenceId: number
): boolean => {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Only restore if client has newer data
  if (sequenceId > session.sequenceId) {
    session.transcript = content;
    session.sequenceId = sequenceId;
    session.lastActivity = Date.now();
  }

  return true;
};

/**
 * Get current audio buffer size in bytes
 */
const getAudioBufferSize = (session: SessionState): number => {
  return session.fullSessionAudio.reduce((sum, buf) => sum + buf.length, 0);
};

/**
 * Add audio chunk to buffer (for standard mode)
 * Returns false if buffer limit exceeded (DoS protection)
 */
export const addAudioChunk = (sessionId: string, chunk: Buffer): boolean => {
  const session = sessions.get(sessionId);
  if (!session) return false;

  // Check buffer size limit to prevent memory exhaustion
  const currentSize = getAudioBufferSize(session);
  if (currentSize + chunk.length > MAX_AUDIO_BUFFER_BYTES) {
    console.warn(`[${sessionId}] Audio buffer limit exceeded (${currentSize} bytes)`);
    return false;
  }

  session.audioBuffer.push(chunk);
  // Also save to full session audio for tone analysis
  session.fullSessionAudio.push(chunk);
  session.lastActivity = Date.now();
  return true;
};

/**
 * Get and clear audio buffer
 */
export const flushAudioBuffer = (sessionId: string): Buffer | null => {
  const session = sessions.get(sessionId);
  if (!session || session.audioBuffer.length === 0) return null;

  const combined = Buffer.concat(session.audioBuffer);
  session.audioBuffer = [];
  return combined;
};

/**
 * Get full session audio (for tone analysis)
 */
export const getFullSessionAudio = (sessionId: string): Buffer | null => {
  const session = sessions.get(sessionId);
  if (!session || session.fullSessionAudio.length === 0) return null;
  return Buffer.concat(session.fullSessionAudio);
};

/**
 * Load RAG context for session
 */
export const loadSessionContext = async (
  sessionId: string
): Promise<ConversationContext | null> => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  try {
    const [recentEntries, activeGoals, openSituations, moodTrajectory] =
      await Promise.all([
        getRecentEntries(session.userId, 5),
        getActiveGoals(session.userId),
        getOpenSituations(session.userId),
        getMoodTrajectory(session.userId),
      ]);

    const context: ConversationContext = {
      recentEntries,
      activeGoals,
      openSituations,
      moodTrajectory,
    };

    session.context = context;
    return context;
  } catch (error) {
    console.error('Failed to load session context:', error);
    return null;
  }
};

/**
 * End session and calculate costs
 */
export const endSession = async (
  sessionId: string
): Promise<{
  transcript: string;
  durationMinutes: number;
  costUSD: number;
} | null> => {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const durationMinutes = (Date.now() - session.startTime) / 1000 / 60;
  const costUSD = durationMinutes * COST_RATES[session.mode];

  // Update usage in Firestore
  await updateUserUsage(session.userId, session.mode, durationMinutes, costUSD);

  // Cleanup
  sessions.delete(sessionId);
  userSessions.delete(session.userId);

  return {
    transcript: session.transcript,
    durationMinutes,
    costUSD,
  };
};

/**
 * Check session duration limit
 */
export const checkSessionDuration = (sessionId: string): boolean => {
  const session = sessions.get(sessionId);
  if (!session) return false;

  const durationSeconds = (Date.now() - session.startTime) / 1000;
  return durationSeconds < USAGE_LIMITS.maxSessionDuration;
};

/**
 * Send message to client
 */
export const sendToClient = (ws: WebSocket, message: RelayMessage): void => {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
};

/**
 * Cleanup stale sessions (run periodically)
 */
export const cleanupStaleSessions = (): void => {
  const now = Date.now();
  const maxInactivity = 5 * 60 * 1000; // 5 minutes

  for (const [sessionId, session] of sessions) {
    if (now - session.lastActivity > maxInactivity) {
      console.log(`Cleaning up stale session: ${sessionId}`);
      sessions.delete(sessionId);
      userSessions.delete(session.userId);
    }
  }
};

// Run cleanup every minute
setInterval(cleanupStaleSessions, 60 * 1000);
