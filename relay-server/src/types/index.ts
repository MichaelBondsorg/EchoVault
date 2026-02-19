import { z } from 'zod';
import type { GuidedSessionState } from '../sessions/schema.js';

// Processing modes
export type ProcessingMode = 'realtime' | 'standard';

// Guided session types
export type GuidedSessionType =
  | 'morning_checkin'
  | 'evening_reflection'
  | 'gratitude_practice'
  | 'goal_setting'
  | 'emotional_processing'
  | 'stress_release'
  | 'weekly_review'
  | 'celebration'
  | 'situation_processing'
  | 'insight_exploration'
  | 'custom';

// Client -> Relay messages
export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('audio_chunk'),
    data: z.string(), // base64 audio
  }),
  z.object({
    type: z.literal('end_turn'),
  }),
  z.object({
    type: z.literal('end_session'),
    saveOptions: z.object({
      save: z.boolean(),
      asGuidedSession: z.boolean().optional(),
      sessionType: z.string().optional(),
    }).optional(),
  }),
  z.object({
    type: z.literal('token_refresh'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('restore_transcript'),
    content: z.string(),
    sequenceId: z.number(),
  }),
  z.object({
    type: z.literal('start_session'),
    mode: z.enum(['realtime', 'standard']),
    sessionType: z.string().optional(),
  }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// Relay -> Client messages
export interface TranscriptDelta {
  type: 'transcript_delta';
  delta: string;
  speaker: 'user' | 'assistant';
  timestamp: number;
  sequenceId: number;
}

export interface AudioResponse {
  type: 'audio_response';
  data: string; // base64 audio
  transcript?: string;
}

export interface SessionSaved {
  type: 'session_saved';
  entryId: string;
  success: boolean;
}

export interface SessionError {
  type: 'error';
  code: string;
  message: string;
  recoverable: boolean;
}

export interface SessionReady {
  type: 'session_ready';
  sessionId: string;
  mode: ProcessingMode;
}

export interface UsageLimitReached {
  type: 'usage_limit';
  limitType: 'daily_cost' | 'realtime_minutes' | 'session_duration';
  suggestion: string;
}

export interface GuidedPromptMessage {
  type: 'guided_prompt';
  promptId?: string;
  prompt: string;
  isOpening: boolean;
  isClosing: boolean;
  promptIndex: number;
  totalPrompts: number;
}

export interface GuidedSessionComplete {
  type: 'guided_session_complete';
  sessionType: string;
  responses: Record<string, string>;
  summary: string;
}

// Voice tone analysis result
export interface VoiceToneAnalysis {
  moodScore: number; // 0-1 scale
  energy: 'low' | 'medium' | 'high';
  emotions: string[];
  confidence: number;
  summary: string;
}

// Session analysis results (sent before session_saved)
export interface SessionAnalysis {
  type: 'session_analysis';
  voiceTone?: VoiceToneAnalysis;
  suggestedTitle?: string;
  suggestedTags?: string[];
  transcript: string;
}

export type RelayMessage =
  | TranscriptDelta
  | AudioResponse
  | SessionSaved
  | SessionError
  | SessionReady
  | UsageLimitReached
  | GuidedPromptMessage
  | GuidedSessionComplete
  | SessionAnalysis;

// Session state
export interface SessionState {
  sessionId: string;
  userId: string;
  mode: ProcessingMode;
  sessionType?: GuidedSessionType | 'free';
  transcript: string;
  sequenceId: number;
  startTime: number;
  lastActivity: number;
  audioBuffer: Buffer[]; // Current turn audio buffer
  fullSessionAudio: Buffer[]; // All audio for tone analysis
  context?: ConversationContext;
  // Guided session state (when in guided mode)
  guidedState?: GuidedSessionState;
}

// Conversation context for RAG
export interface ConversationContext {
  recentEntries: EntryContext[];
  activeGoals: string[];
  openSituations: string[];
  moodTrajectory: {
    trend: 'improving' | 'stable' | 'declining';
    description: string;
  };
}

export interface EntryContext {
  id: string;
  effectiveDate: string;
  title: string;
  text: string;
  moodScore?: number;
}

// Usage tracking
export interface UserUsage {
  date: string;
  realtimeMinutes: number;
  standardMinutes: number;
  estimatedCostUSD: number;
}

// Usage limits
export const USAGE_LIMITS = {
  maxSessionDuration: 900, // 15 min
  maxDailyRealtimeMinutes: 10,
  maxDailyStandardMinutes: 60,
  maxDailyCostUSD: 5.0,
} as const;

// Cost rates per minute
export const COST_RATES = {
  realtime: 0.30, // $0.30/min
  standard: 0.03, // $0.03/min
} as const;
