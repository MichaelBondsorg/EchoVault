import type { GuidedSessionDefinition } from '../schema.js';

export const eveningReflection: GuidedSessionDefinition = {
  id: 'evening_reflection',
  name: 'Evening Reflection',
  description: 'Process your day and prepare for restful sleep',
  icon: 'moon',
  estimatedMinutes: 7,

  suggestWhen: {
    timeOfDay: ['evening', 'night'],
  },

  contextNeeds: {
    recentEntries: 5,
    relevantGoals: true,
    openSituations: true,
    recurringPatterns: false,
    yesterdayHighlight: false,
  },

  openingMessage: "Hey there. Let's take a few minutes to reflect on your day before winding down.",

  prompts: [
    {
      id: 'day_overview',
      type: 'open',
      prompt: "How would you describe your day in a few words?",
    },
    {
      id: 'highlight',
      type: 'open',
      prompt: "What was the best part of your day, even if it was something small?",
    },
    {
      id: 'challenge',
      type: 'open',
      prompt: "Was there anything that felt challenging or difficult today?",
      followUpTriggers: [
        {
          keywords: ['argument', 'fight', 'conflict', 'upset', 'frustrated'],
          followUpPrompt: "That sounds tough. How are you feeling about it now?",
        },
        {
          keywords: ['nothing', 'not really', 'nope', 'no'],
          followUpPrompt: "That's good to hear. Sounds like it was a relatively smooth day.",
        },
      ],
    },
    {
      id: 'situation_update',
      type: 'reflection',
      prompt: "You've been dealing with {openSituation}. Any updates on that?",
      contextInjection: {
        includeOpenSituations: true,
      },
      skipConditions: ['no_open_situations'],
    },
    {
      id: 'learned',
      type: 'open',
      prompt: "Did you learn anything about yourself today, or notice anything new?",
    },
    {
      id: 'grateful',
      type: 'open',
      prompt: "What's one thing you're grateful for from today?",
    },
    {
      id: 'tomorrow',
      type: 'open',
      prompt: "Is there anything you want to carry forward or let go of for tomorrow?",
    },
    {
      id: 'closing',
      type: 'open',
      prompt: "Anything else you want to get off your chest before bed?",
    },
  ],

  closingMessage: "Thanks for reflecting with me. Sleep well, and I'll be here whenever you need to talk.",

  outputProcessing: {
    summaryPrompt: `Summarize this evening reflection in 2-3 sentences, capturing:
- The overall tone of their day (good, challenging, mixed)
- The highlight they mentioned
- Any challenges or things they're processing
- What they're grateful for
Keep it empathetic and supportive.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
