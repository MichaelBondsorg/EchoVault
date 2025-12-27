import type { GuidedSessionDefinition } from '../schema.js';

export const weeklyReview: GuidedSessionDefinition = {
  id: 'weekly_review',
  name: 'Weekly Review',
  description: 'Reflect on your week and prepare for the next',
  icon: 'calendar',
  estimatedMinutes: 10,

  suggestWhen: {
    timeOfDay: ['afternoon', 'evening'],
    dayOfWeek: [0, 6], // Sunday or Saturday
  },

  contextNeeds: {
    recentEntries: 7,
    relevantGoals: true,
    openSituations: true,
    recurringPatterns: true,
    yesterdayHighlight: false,
  },

  openingMessage: "Let's take some time to look back at your week and think about what's ahead.",

  prompts: [
    {
      id: 'week_overview',
      type: 'open',
      prompt: "Looking back at this past week, what stands out to you? It could be anything, good or challenging.",
    },
    {
      id: 'wins',
      type: 'open',
      prompt: "What's something you accomplished or are proud of this week, even if it seems small?",
      followUpTriggers: [
        {
          keywords: ['nothing', 'didn\'t', 'failed'],
          followUpPrompt: "Sometimes we overlook our own progress. Did you show up somewhere difficult? Handle something hard? That counts too.",
        },
      ],
    },
    {
      id: 'challenges',
      type: 'open',
      prompt: "What was the most challenging part of your week? How did you handle it?",
      followUpTriggers: [
        {
          keywords: ['struggle', 'hard', 'difficult', 'couldn\'t'],
          followUpPrompt: "Challenges teach us a lot. What did you learn about yourself from this experience?",
        },
      ],
    },
    {
      id: 'goal_progress',
      type: 'reflection',
      prompt: "You've been working on {activeGoal}. How did you make progress on that this week?",
      contextInjection: {
        includeOpenGoals: true,
      },
      skipConditions: ['no_open_goals'],
    },
    {
      id: 'mood_reflection',
      type: 'reflection',
      prompt: "Your mood this week has been {moodTrend}. What do you think influenced that?",
      contextInjection: {
        includeRecentMood: true,
      },
    },
    {
      id: 'gratitude',
      type: 'open',
      prompt: "What's something or someone you're grateful for from this week?",
    },
    {
      id: 'letting_go',
      type: 'open',
      prompt: "Is there anything from this week you want to let go of, so you don't carry it forward?",
    },
    {
      id: 'next_week_intention',
      type: 'open',
      prompt: "What's one intention or focus you'd like to carry into next week?",
    },
    {
      id: 'self_care_plan',
      type: 'open',
      prompt: "What's one way you'll take care of yourself next week?",
    },
    {
      id: 'closing_thought',
      type: 'open',
      prompt: "Any final thoughts or anything else you want to capture before we wrap up?",
    },
  ],

  closingMessage: "You've done a great job reflecting on your week. Use these insights to guide you forward. See you next week!",

  outputProcessing: {
    summaryPrompt: `Create a comprehensive weekly review summary:
- Key highlights and wins from the week
- Main challenges faced and how they were handled
- Progress on goals
- The user's intention for next week
- Self-care plans
Format as a meaningful reflection that the user can look back on.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
