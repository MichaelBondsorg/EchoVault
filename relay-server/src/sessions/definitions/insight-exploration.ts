import type { GuidedSessionDefinition } from '../schema.js';

/**
 * Insight Exploration Session
 *
 * A dedicated guided session for reviewing and discussing Nexus insights.
 * Follows a structured flow: present insight -> ask perspective -> explore
 * connections -> suggest actions.
 *
 * The guided pipeline populates {insightSummary} and {secondInsightSummary}
 * placeholders from the user's conversation_queue at session start.
 */
export const insightExploration: GuidedSessionDefinition = {
  id: 'insight_exploration',
  name: 'Insight Exploration',
  description: 'Review and discuss patterns noticed in your journaling',
  icon: 'lightbulb',
  estimatedMinutes: 10,

  contextNeeds: {
    recentEntries: 5,
    relevantGoals: true,
    openSituations: false,
    recurringPatterns: true,
    yesterdayHighlight: false,
  },

  openingMessage:
    "Let's take some time to explore what I've been noticing in your journal entries. These are patterns and insights that might be helpful to reflect on. There's no pressure to act on anything — this is just for awareness and reflection.",

  prompts: [
    {
      id: 'insight_overview',
      type: 'reflection',
      prompt:
        "I've noticed something interesting about your recent patterns: {insightSummary}. Does that resonate with you?",
      followUpTriggers: [
        {
          keywords: ['no', "don't think so", 'not really', 'disagree'],
          followUpPrompt:
            "That's completely fair — these are observations, not facts. What does your experience tell you instead?",
        },
      ],
    },
    {
      id: 'user_perspective',
      type: 'open',
      prompt:
        "How does that land for you? Do you see this pattern showing up in your day-to-day life?",
      followUpTriggers: [
        {
          keywords: ['yes', 'definitely', 'true', 'absolutely', 'for sure'],
          followUpPrompt:
            "I'm glad that connects. Can you think of a specific recent moment where this showed up?",
        },
        {
          keywords: ['not sure', 'maybe', 'kind of', 'sometimes'],
          followUpPrompt:
            "That's okay — sometimes patterns are subtle. What parts feel true, even a little?",
        },
      ],
    },
    {
      id: 'explore_connections',
      type: 'open',
      prompt:
        'What situations or relationships come to mind when you think about this pattern?',
      followUpTriggers: [
        {
          keywords: ['hurt', 'struggle', 'hard', 'difficult', 'painful'],
          followUpPrompt:
            "It sounds like this touches something important. Thank you for sharing that. What do you need most when you're in that space?",
        },
      ],
    },
    {
      id: 'deeper_meaning',
      type: 'reflection',
      prompt:
        "What do you think this pattern is trying to tell you? Sometimes our habits carry messages about what we need.",
    },
    {
      id: 'second_insight',
      type: 'reflection',
      prompt:
        "Here's another thing I noticed: {secondInsightSummary}. What do you make of this?",
      skipConditions: ['no_second_insight'],
      followUpTriggers: [
        {
          keywords: ['connected', 'related', 'same thing', 'goes together'],
          followUpPrompt:
            'You see a connection between these patterns — that\'s a really powerful observation. How do they fit together for you?',
        },
      ],
    },
    {
      id: 'action_step',
      type: 'open',
      prompt:
        "Based on what we've explored, is there something small you'd like to try or change this week?",
      followUpTriggers: [
        {
          keywords: ["don't know", 'not sure', 'no idea', 'hard to say'],
          followUpPrompt:
            "That's perfectly fine. Awareness itself is valuable. Sometimes just noticing a pattern is enough for now.",
        },
      ],
    },
    {
      id: 'closing_reflection',
      type: 'open',
      prompt:
        "How are you feeling about these insights now? Anything else you'd like to capture before we wrap up?",
    },
  ],

  closingMessage:
    'Thank you for exploring these insights. Awareness is the first step to change, and you\'re doing great work by reflecting on these patterns.',

  outputProcessing: {
    summaryPrompt: `Summarize this insight exploration session:
- Which insights were discussed
- The user's reaction and perspective on each
- Any connections they made to their life
- Action steps they identified
Keep the tone validating and growth-oriented.`,
    extractSignals: true,
    therapeuticFramework: 'act',
  },
};
