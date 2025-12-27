import type { GuidedSessionDefinition } from '../schema.js';

export const goalSetting: GuidedSessionDefinition = {
  id: 'goal_setting',
  name: 'Goal Setting',
  description: 'Set meaningful goals and create action plans',
  icon: 'target',
  estimatedMinutes: 7,

  suggestWhen: {
    timeOfDay: ['morning', 'afternoon'],
    dayOfWeek: [0, 1], // Sunday, Monday - good for weekly planning
  },

  contextNeeds: {
    recentEntries: 5,
    relevantGoals: true,
    openSituations: false,
    recurringPatterns: true,
    yesterdayHighlight: false,
  },

  openingMessage: "Let's spend some time thinking about what you want to achieve. This can be anything, big or small.",

  prompts: [
    {
      id: 'current_goals_check',
      type: 'reflection',
      prompt: "You've been working on {activeGoal}. How's that going? Do you want to continue with it or shift focus?",
      contextInjection: {
        includeOpenGoals: true,
      },
      skipConditions: ['no_open_goals'],
    },
    {
      id: 'area_of_focus',
      type: 'open',
      prompt: "What area of your life would you like to focus on? This could be health, relationships, work, personal growth, or anything else.",
      followUpTriggers: [
        {
          keywords: ['work', 'career', 'job', 'professional'],
          followUpPrompt: "Work goals can be really motivating. What specifically about your work life would you like to improve?",
        },
        {
          keywords: ['health', 'fitness', 'exercise', 'weight', 'sleep'],
          followUpPrompt: "Health is such an important foundation. What does success in this area look like for you?",
        },
        {
          keywords: ['relationship', 'family', 'friends', 'partner'],
          followUpPrompt: "Relationships really matter. Who or what relationship would you like to nurture?",
        },
      ],
    },
    {
      id: 'specific_goal',
      type: 'open',
      prompt: "What's a specific goal you'd like to set? Try to be as concrete as you can.",
      followUpTriggers: [
        {
          keywords: ['maybe', 'not sure', 'I think', 'kind of'],
          followUpPrompt: "It's okay to start vague. What would achieving this look like? How would you know you succeeded?",
        },
      ],
    },
    {
      id: 'why_matters',
      type: 'reflection',
      prompt: "Why does this goal matter to you? What will be different when you achieve it?",
    },
    {
      id: 'first_step',
      type: 'open',
      prompt: "What's one small step you could take this week to move toward this goal?",
      followUpTriggers: [
        {
          keywords: ['don\'t know', 'not sure', 'hard', 'difficult'],
          followUpPrompt: "Sometimes the first step is just thinking about it more. What would make it feel more doable?",
        },
      ],
    },
    {
      id: 'obstacles',
      type: 'open',
      prompt: "What might get in the way? And how could you handle that if it comes up?",
    },
    {
      id: 'timeline',
      type: 'choice',
      prompt: "When would you like to check back in on this goal? Would you say in a few days, next week, or in a month?",
    },
  ],

  closingMessage: "You've set a meaningful goal. Remember, progress matters more than perfection. I'll help you track this.",

  outputProcessing: {
    summaryPrompt: `Summarize this goal-setting session, extracting:
- The specific goal the user set
- Why it matters to them
- Their planned first step
- Any obstacles they identified
Keep it actionable and encouraging.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
