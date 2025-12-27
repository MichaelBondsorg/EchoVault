import type { ConversationContext, GuidedSessionType } from '../types/index.js';

/**
 * Build system prompt for voice conversation
 */
export const buildSystemPrompt = (
  context: ConversationContext | null,
  sessionType?: GuidedSessionType | 'free'
): string => {
  const contextSection = context
    ? `
## User Context

### Recent Mood
${context.moodTrajectory.description}
${context.moodTrajectory.trend === 'declining' ? "Note: User's mood has been declining. Be especially supportive." : ''}

### Active Goals
${context.activeGoals.length > 0 ? context.activeGoals.map((g) => `- ${g}`).join('\n') : 'No active goals mentioned recently.'}

### Open Situations
${context.openSituations.length > 0 ? context.openSituations.map((s) => `- ${s}`).join('\n') : 'No ongoing situations.'}

### Recent Entries Summary
${context.recentEntries
  .slice(0, 3)
  .map(
    (e) =>
      `- ${e.effectiveDate}: ${e.title} (mood: ${e.moodScore?.toFixed(1) || 'unknown'})`
  )
  .join('\n')}
`
    : '';

  const sessionInstruction = sessionType && sessionType !== 'free'
    ? `This is a ${sessionType.replace(/_/g, ' ')} session. Follow the structured flow for this session type.`
    : 'This is a free conversation. Let the user guide the direction.';

  return `You are a supportive journaling companion helping the user reflect on their thoughts and experiences through voice conversation.

${contextSection}

## Guidelines
- Reference past entries naturally: "You mentioned last week that..."
- Follow up on open situations: "How did that meeting go?"
- Acknowledge patterns: "I notice you often feel this way on Mondays"
- Be warm but not sycophantic
- ${sessionInstruction}

## CRITICAL: Voice-Specific Instructions
- Keep responses SHORT: 2-3 sentences maximum unless asked for more
- Do NOT use markdown formatting (no bullets, no headers, no **bold**)
- Do NOT use lists - speak in flowing sentences
- Speak conversationally, as if talking to a friend
- Use contractions (don't, I'm, you're) - avoid formal language
- Pause naturally between thoughts using commas and periods
- Ask ONE question at a time, then wait for response
- Avoid jargon and clinical terms unless the user uses them first

## Tools Available
You have access to a get_memory tool to look up past journal entries when the user references something from their history. Use it when they mention past events, people, goals, or say things like "remember when" or "like last time".
`;
};

/**
 * Build opening message based on session type
 */
export const buildOpeningMessage = (
  sessionType: GuidedSessionType | 'free',
  context: ConversationContext | null
): string => {
  const timeOfDay = getTimeOfDay();

  switch (sessionType) {
    case 'morning_checkin':
      return `Good ${timeOfDay}! How did you sleep last night, and how are you feeling as you start the day?`;

    case 'evening_reflection':
      return `Hey there. How was your day today? Anything stand out that you'd like to talk about?`;

    case 'gratitude_practice':
      return `Let's take a moment to reflect on what's going well. What's something, big or small, that you're grateful for today?`;

    case 'goal_setting':
      if (context?.activeGoals.length) {
        return `I see you've been working on ${context.activeGoals[0]}. Would you like to check in on that, or set a new goal?`;
      }
      return `What's something you'd like to work towards? It could be anything, big or small.`;

    case 'emotional_processing':
      return `I'm here to listen. What's been on your mind lately?`;

    case 'stress_release':
      return `It sounds like you might need to process some stress. Take a breath, and tell me what's weighing on you.`;

    case 'weekly_review':
      return `Let's look back at your week. What moments stood out to you, good or challenging?`;

    case 'celebration':
      return `I'd love to hear about your wins! What's something you're proud of recently?`;

    case 'situation_processing':
      if (context?.openSituations.length) {
        return `I noticed you've been dealing with ${context.openSituations[0]}. Would you like to talk about how that's going?`;
      }
      return `Is there a specific situation you'd like to work through today?`;

    case 'free':
    default:
      // Personalized based on context
      if (context?.moodTrajectory.trend === 'declining') {
        return `Hey, how are you doing? I've noticed things have been a bit tough lately. I'm here to listen.`;
      }
      if (context?.openSituations.length) {
        return `Hi there! Last time we talked about ${context.openSituations[0]}. How's that going, or is there something else on your mind?`;
      }
      return `Hey! What's on your mind today?`;
  }
};

/**
 * Get time of day for greetings
 */
const getTimeOfDay = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
};

/**
 * Define the get_memory tool for OpenAI
 */
export const getMemoryToolDefinition = () => ({
  type: 'function' as const,
  function: {
    name: 'get_memory',
    description:
      'Retrieve relevant past journal entries when the user references something from their history. Use this when they mention past events, people, goals, or say things like "remember when" or "like last time".',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in past entries',
        },
        date_hint: {
          type: 'string',
          description:
            'Approximate date reference if mentioned (e.g., "last Tuesday", "two weeks ago")',
        },
        entity_type: {
          type: 'string',
          enum: ['person', 'goal', 'situation', 'event', 'place', 'any'],
          description: 'Type of entity to search for',
        },
      },
      required: ['query'],
    },
  },
});
