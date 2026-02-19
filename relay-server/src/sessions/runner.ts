import type {
  GuidedSessionDefinition,
  GuidedSessionState,
  GuidedPrompt,
  SessionContext,
  GuidedSessionType,
} from './schema.js';
import { getSessionDefinition } from './definitions/index.js';

/**
 * Create a new guided session state
 */
export const createGuidedSessionState = (
  sessionType: GuidedSessionType,
  context: SessionContext
): GuidedSessionState | null => {
  const definition = getSessionDefinition(sessionType);
  if (!definition) {
    console.error(`No session definition found for: ${sessionType}`);
    return null;
  }

  return {
    definition,
    currentPromptIndex: -1, // Start before first prompt (opening message)
    responses: {},
    startedAt: Date.now(),
    context,
    waitingForFollowUp: false,
  };
};

/**
 * Get the next prompt in the session
 * Returns null if session is complete
 */
export const getNextPrompt = (state: GuidedSessionState): {
  prompt: string;
  isOpening: boolean;
  isClosing: boolean;
  promptId?: string;
} | null => {
  // If waiting for follow-up, return that
  if (state.waitingForFollowUp && state.currentFollowUp) {
    return {
      prompt: state.currentFollowUp,
      isOpening: false,
      isClosing: false,
    };
  }

  // First call: return opening message
  if (state.currentPromptIndex === -1) {
    state.currentPromptIndex = 0;
    if (state.definition.openingMessage) {
      return {
        prompt: state.definition.openingMessage,
        isOpening: true,
        isClosing: false,
      };
    }
  }

  // Find next valid prompt (skip those that should be skipped)
  while (state.currentPromptIndex < state.definition.prompts.length) {
    const prompt = state.definition.prompts[state.currentPromptIndex];

    if (shouldSkipPrompt(prompt, state.context)) {
      state.currentPromptIndex++;
      continue;
    }

    const renderedPrompt = renderPrompt(prompt, state.context);
    return {
      prompt: renderedPrompt,
      isOpening: false,
      isClosing: false,
      promptId: prompt.id,
    };
  }

  // All prompts done: return closing message
  if (state.definition.closingMessage) {
    return {
      prompt: state.definition.closingMessage,
      isOpening: false,
      isClosing: true,
    };
  }

  // Session complete
  return null;
};

/**
 * Process user response and advance session
 */
export const processResponse = (
  state: GuidedSessionState,
  response: string
): {
  hasFollowUp: boolean;
  followUpPrompt?: string;
  sessionComplete: boolean;
} => {
  // If we were waiting for follow-up, clear it
  if (state.waitingForFollowUp) {
    state.waitingForFollowUp = false;
    state.currentFollowUp = undefined;
    state.currentPromptIndex++;
    return {
      hasFollowUp: false,
      sessionComplete: state.currentPromptIndex >= state.definition.prompts.length,
    };
  }

  // Store the response
  const currentPrompt = state.definition.prompts[state.currentPromptIndex];
  if (currentPrompt) {
    state.responses[currentPrompt.id] = response;

    // Check for follow-up triggers
    const followUp = checkFollowUpTriggers(currentPrompt, response);
    if (followUp) {
      state.waitingForFollowUp = true;
      state.currentFollowUp = followUp;
      return {
        hasFollowUp: true,
        followUpPrompt: followUp,
        sessionComplete: false,
      };
    }
  }

  // Advance to next prompt
  state.currentPromptIndex++;

  return {
    hasFollowUp: false,
    sessionComplete: state.currentPromptIndex >= state.definition.prompts.length,
  };
};

/**
 * Check if a prompt should be skipped based on context
 */
const shouldSkipPrompt = (prompt: GuidedPrompt, context: SessionContext): boolean => {
  if (!prompt.skipConditions) return false;

  for (const condition of prompt.skipConditions) {
    switch (condition) {
      case 'no_yesterday_highlight':
        if (!context.yesterdayHighlight) return true;
        break;
      case 'no_open_goals':
        if (context.activeGoals.length === 0) return true;
        break;
      case 'no_open_situations':
        if (context.openSituations.length === 0) return true;
        break;
      case 'mood_above_7':
        if (context.moodTrajectory.recentAverage > 0.7) return true;
        break;
      case 'mood_below_3':
        if (context.moodTrajectory.recentAverage < 0.3) return true;
        break;
      case 'no_second_insight':
        if (!context.insightSummaries || context.insightSummaries.length < 2) return true;
        break;
    }
  }

  return false;
};

/**
 * Render a prompt with context injection
 */
const renderPrompt = (prompt: GuidedPrompt, context: SessionContext): string => {
  return renderPromptWithInsights(prompt, context);
};

/**
 * Render a prompt with context injection including insight placeholders.
 * Exported for testing.
 */
export const renderPromptWithInsights = (prompt: GuidedPrompt, context: SessionContext): string => {
  let text = prompt.prompt;

  // Replace standard placeholders
  text = text.replace('{yesterdayHighlight}', context.yesterdayHighlight || 'something');
  text = text.replace('{activeGoal}', context.activeGoals[0] || 'your goal');
  text = text.replace('{openSituation}', context.openSituations[0] || 'that situation');

  // Replace insight placeholders
  text = text.replace('{insightSummary}', context.insightSummaries?.[0] || 'a pattern in your recent entries');
  text = text.replace('{secondInsightSummary}', context.insightSummaries?.[1] || 'another pattern I noticed');

  return text;
};

/**
 * Check if response triggers a follow-up
 */
const checkFollowUpTriggers = (prompt: GuidedPrompt, response: string): string | null => {
  if (!prompt.followUpTriggers) return null;

  const lowerResponse = response.toLowerCase();

  for (const trigger of prompt.followUpTriggers) {
    for (const keyword of trigger.keywords) {
      if (lowerResponse.includes(keyword.toLowerCase())) {
        return trigger.followUpPrompt;
      }
    }
  }

  return null;
};

/**
 * Generate session summary
 */
export const generateSessionSummary = (state: GuidedSessionState): string => {
  const responses = Object.entries(state.responses)
    .map(([id, response]) => `${id}: ${response}`)
    .join('\n');

  return `Session: ${state.definition.name}
Duration: ${Math.round((Date.now() - state.startedAt) / 1000 / 60)} minutes

Responses:
${responses}

Summary Prompt for AI:
${state.definition.outputProcessing.summaryPrompt}`;
};

/**
 * Get all responses as formatted text for entry
 */
export const getResponsesAsEntryText = (state: GuidedSessionState): string => {
  return Object.entries(state.responses)
    .map(([_, response]) => response)
    .filter((r) => r.trim().length > 0)
    .join('\n\n');
};
