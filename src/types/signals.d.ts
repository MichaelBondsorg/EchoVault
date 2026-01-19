/**
 * Signal Type Definitions
 *
 * Types for the signal lifecycle system - goals, insights, patterns, and contradictions.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Signal types in the system
 */
export type SignalType = 'goal' | 'insight' | 'pattern' | 'contradiction';

/**
 * Goal lifecycle states
 */
export type GoalState = 'proposed' | 'active' | 'achieved' | 'abandoned' | 'paused';

/**
 * Insight lifecycle states
 */
export type InsightState = 'pending' | 'verified' | 'dismissed' | 'actioned';

/**
 * Pattern lifecycle states
 */
export type PatternState = 'detected' | 'confirmed' | 'rejected' | 'resolved';

/**
 * All possible signal states
 */
export type SignalState = GoalState | InsightState | PatternState;

/**
 * State transition history entry
 */
export interface StateTransition {
  from: SignalState | null;
  to: SignalState;
  at: Timestamp;
  context: TransitionContext;
}

/**
 * Context provided during state transitions
 */
export interface TransitionContext {
  reason?: string;
  action?: string;
  resolvedBy?: string;
  excludePattern?: boolean;
  permanent?: boolean;
  [key: string]: unknown;
}

/**
 * Signal exclusion settings
 */
export interface SignalExclusions {
  excludeFromContradictions: boolean;
  excludeFromInsights: boolean;
  excludeFromPatterns: boolean;
}

/**
 * User feedback on a signal
 */
export interface SignalUserFeedback {
  verified: boolean;
  dismissed: boolean;
  dismissReason: string | null;
  actionTaken: string | null;
}

/**
 * Signal metadata - type-specific additional data
 */
export interface SignalMetadata {
  patternType?: string;
  patternContext?: Record<string, unknown>;
  confidence?: number;
  frequency?: number;
  timeframe?: string;
  relatedSignals?: string[];
  [key: string]: unknown;
}

/**
 * Core signal state document
 */
export interface Signal {
  id: string;
  type: SignalType;
  topic: string;
  state: SignalState;
  stateHistory: StateTransition[];
  sourceEntries: string[];
  metadata: SignalMetadata;
  exclusions: SignalExclusions;
  userFeedback: SignalUserFeedback;
  createdAt: Timestamp;
  lastUpdated: Timestamp;
}

/**
 * Goal signal (specialized)
 */
export interface GoalSignal extends Signal {
  type: 'goal';
  state: GoalState;
  metadata: SignalMetadata & {
    targetDate?: Timestamp;
    progress?: number; // 0-100
    milestones?: GoalMilestone[];
  };
}

/**
 * Goal milestone
 */
export interface GoalMilestone {
  id: string;
  description: string;
  completed: boolean;
  completedAt?: Timestamp;
}

/**
 * Insight signal (specialized)
 */
export interface InsightSignal extends Signal {
  type: 'insight';
  state: InsightState;
  metadata: SignalMetadata & {
    insightCategory?: 'behavioral' | 'emotional' | 'cognitive' | 'relational';
    actionSuggestions?: string[];
  };
}

/**
 * Pattern signal (specialized)
 */
export interface PatternSignal extends Signal {
  type: 'pattern';
  state: PatternState;
  metadata: SignalMetadata & {
    patternType: string;
    occurrences?: number;
    correlation?: number;
  };
}

/**
 * Contradiction signal (specialized)
 */
export interface ContradictionSignal extends Signal {
  type: 'contradiction';
  state: PatternState;
  metadata: SignalMetadata & {
    conflictingGoals?: string[];
    conflictingBehaviors?: string[];
  };
}

/**
 * Input data for creating a new signal
 */
export interface CreateSignalInput {
  type: SignalType;
  topic: string;
  initialState: SignalState;
  context?: TransitionContext;
  sourceEntries?: string[];
  metadata?: SignalMetadata;
}

/**
 * Insight exclusion record
 */
export interface InsightExclusion {
  id: string;
  patternType: string;
  context: Record<string, unknown>;
  reason: string;
  permanent: boolean;
  excludedAt: Timestamp;
  expiresAt: Timestamp | null;
}

/**
 * Valid state transitions map
 */
export type ValidTransitionsMap = {
  [K in SignalState]: SignalState[];
};
