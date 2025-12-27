import type { GuidedSessionDefinition } from '../schema.js';

export const morningCheckin: GuidedSessionDefinition = {
  id: 'morning_checkin',
  name: 'Morning Check-in',
  description: 'Start your day with clarity and intention',
  icon: 'sunrise',
  estimatedMinutes: 5,

  suggestWhen: {
    timeOfDay: ['morning'],
  },

  contextNeeds: {
    recentEntries: 3,
    relevantGoals: true,
    openSituations: true,
    recurringPatterns: false,
    yesterdayHighlight: true,
  },

  openingMessage: "Good morning! Let's take a few minutes to check in and set your intentions for the day.",

  prompts: [
    {
      id: 'sleep_energy',
      type: 'open',
      prompt: "How did you sleep last night, and how's your energy level this morning?",
    },
    {
      id: 'yesterday_followup',
      type: 'reflection',
      prompt: "Yesterday you mentioned {yesterdayHighlight}. How are you feeling about that today?",
      contextInjection: {
        includeYesterdayHighlight: true,
      },
      skipConditions: ['no_yesterday_highlight'],
    },
    {
      id: 'todays_focus',
      type: 'open',
      prompt: "What's one thing you'd like to focus on or accomplish today?",
      followUpTriggers: [
        {
          keywords: ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'],
          followUpPrompt: "I hear some concern there. What's one small step you could take to feel more prepared?",
        },
        {
          keywords: ['excited', 'looking forward', 'can\'t wait'],
          followUpPrompt: "That sounds exciting! What about it has you most energized?",
        },
      ],
    },
    {
      id: 'goal_checkin',
      type: 'reflection',
      prompt: "You've been working on {activeGoal}. Any thoughts on how that fits into today?",
      contextInjection: {
        includeOpenGoals: true,
      },
      skipConditions: ['no_open_goals'],
    },
    {
      id: 'self_care',
      type: 'open',
      prompt: "What's one small thing you can do for yourself today?",
    },
    {
      id: 'closing',
      type: 'open',
      prompt: "Anything else on your mind before we wrap up?",
    },
  ],

  closingMessage: "Have a great day! Remember, you can always come back to journal if anything comes up.",

  outputProcessing: {
    summaryPrompt: `Summarize this morning check-in in 2-3 sentences, focusing on:
- The user's energy/mood state
- Their main intention or focus for the day
- Any concerns or excitement mentioned
Keep it warm and personal.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
