import { z } from 'zod';

/**
 * Guided Session Type IDs
 */
export const GuidedSessionTypeSchema = z.enum([
  'morning_checkin',
  'evening_reflection',
  'gratitude_practice',
  'goal_setting',
  'emotional_processing',
  'stress_release',
  'weekly_review',
  'celebration',
  'situation_processing',
  'insight_exploration',
  'custom',
]);

export type GuidedSessionType = z.infer<typeof GuidedSessionTypeSchema>;

/**
 * Time of day for session suggestions
 */
export const TimeOfDaySchema = z.enum(['morning', 'afternoon', 'evening', 'night']);
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;

/**
 * Prompt types within a session
 */
export const PromptTypeSchema = z.enum(['open', 'rating', 'choice', 'reflection']);
export type PromptType = z.infer<typeof PromptTypeSchema>;

/**
 * Context injection options for dynamic prompts
 */
export const ContextInjectionSchema = z.object({
  includeRecentMood: z.boolean().optional(),
  includeOpenGoals: z.boolean().optional(),
  includeYesterdayHighlight: z.boolean().optional(),
  includeOpenSituations: z.boolean().optional(),
  customRagQuery: z.string().optional(),
});

export type ContextInjection = z.infer<typeof ContextInjectionSchema>;

/**
 * A single prompt in a guided session
 */
export const GuidedPromptSchema = z.object({
  id: z.string(),
  type: PromptTypeSchema,
  prompt: z.string(),
  // Dynamic prompt generation based on context
  contextInjection: ContextInjectionSchema.optional(),
  // Conditions for skipping this prompt
  skipConditions: z.array(z.enum([
    'no_yesterday_highlight',
    'no_open_goals',
    'no_open_situations',
    'mood_above_7',
    'mood_below_3',
    'no_second_insight',
  ])).optional(),
  // Follow-up prompts based on keywords in response
  followUpTriggers: z.array(z.object({
    keywords: z.array(z.string()),
    followUpPrompt: z.string(),
  })).optional(),
});

export type GuidedPrompt = z.infer<typeof GuidedPromptSchema>;

/**
 * Session suggestion conditions
 */
export const SuggestWhenSchema = z.object({
  timeOfDay: z.array(TimeOfDaySchema).optional(),
  moodBelow: z.number().min(0).max(1).optional(),
  moodAbove: z.number().min(0).max(1).optional(),
  patterns: z.array(z.string()).optional(),
  dayOfWeek: z.array(z.number().min(0).max(6)).optional(),
});

export type SuggestWhen = z.infer<typeof SuggestWhenSchema>;

/**
 * Context needed for a session
 */
export const ContextNeedsSchema = z.object({
  recentEntries: z.number().default(5),
  relevantGoals: z.boolean().default(false),
  openSituations: z.boolean().default(false),
  recurringPatterns: z.boolean().default(false),
  yesterdayHighlight: z.boolean().default(false),
});

export type ContextNeeds = z.infer<typeof ContextNeedsSchema>;

/**
 * Output processing configuration
 */
export const OutputProcessingSchema = z.object({
  summaryPrompt: z.string(),
  extractSignals: z.boolean().default(true),
  therapeuticFramework: z.enum(['cbt', 'act', 'general']).optional(),
});

export type OutputProcessing = z.infer<typeof OutputProcessingSchema>;

/**
 * Complete guided session definition
 */
export const GuidedSessionDefinitionSchema = z.object({
  id: GuidedSessionTypeSchema,
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  estimatedMinutes: z.number().positive(),

  // When to suggest this session
  suggestWhen: SuggestWhenSchema.optional(),

  // What context to load
  contextNeeds: ContextNeedsSchema,

  // The prompts in order
  prompts: z.array(GuidedPromptSchema).min(1),

  // Opening message (before first prompt)
  openingMessage: z.string().optional(),

  // Closing message template
  closingMessage: z.string().optional(),

  // How to process the output
  outputProcessing: OutputProcessingSchema,
});

export type GuidedSessionDefinition = z.infer<typeof GuidedSessionDefinitionSchema>;

/**
 * Session state during a guided session
 */
export interface GuidedSessionState {
  definition: GuidedSessionDefinition;
  currentPromptIndex: number;
  responses: Record<string, string>;
  startedAt: number;
  context: SessionContext;
  waitingForFollowUp: boolean;
  currentFollowUp?: string;
}

/**
 * Context available during session
 */
export interface SessionContext {
  recentEntries: Array<{
    id: string;
    date: string;
    title: string;
    text: string;
    moodScore?: number;
  }>;
  activeGoals: string[];
  openSituations: string[];
  yesterdayHighlight?: string;
  moodTrajectory: {
    trend: 'improving' | 'stable' | 'declining';
    recentAverage: number;
  };
  insightSummaries?: string[];
}

/**
 * Validate a session definition
 */
export const validateSessionDefinition = (def: unknown): GuidedSessionDefinition => {
  return GuidedSessionDefinitionSchema.parse(def);
};

/**
 * Get current time of day
 */
export const getCurrentTimeOfDay = (): TimeOfDay => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
};
