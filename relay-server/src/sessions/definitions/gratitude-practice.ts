import type { GuidedSessionDefinition } from '../schema.js';

export const gratitudePractice: GuidedSessionDefinition = {
  id: 'gratitude_practice',
  name: 'Gratitude Practice',
  description: 'Cultivate appreciation for the good in your life',
  icon: 'heart',
  estimatedMinutes: 5,

  suggestWhen: {
    timeOfDay: ['morning', 'evening'],
    moodBelow: 0.5, // Suggest when mood is lower
  },

  contextNeeds: {
    recentEntries: 3,
    relevantGoals: false,
    openSituations: false,
    recurringPatterns: false,
    yesterdayHighlight: false,
  },

  openingMessage: "Let's take a few moments to notice the good things in your life, big or small.",

  prompts: [
    {
      id: 'warmup',
      type: 'open',
      prompt: "To start, what's something simple that brought you a moment of peace or comfort recently?",
    },
    {
      id: 'person',
      type: 'open',
      prompt: "Is there someone in your life you're grateful for right now? It could be anyone, past or present.",
      followUpTriggers: [
        {
          keywords: ['mom', 'dad', 'parent', 'mother', 'father', 'family'],
          followUpPrompt: "Family can mean so much. What's something specific about them you appreciate?",
        },
        {
          keywords: ['friend', 'partner', 'spouse', 'husband', 'wife'],
          followUpPrompt: "Those close relationships are special. What do they bring to your life?",
        },
      ],
    },
    {
      id: 'experience',
      type: 'open',
      prompt: "What's a recent experience or moment that made you feel good, even briefly?",
    },
    {
      id: 'self',
      type: 'open',
      prompt: "What's something about yourself that you're grateful for? It could be a quality, skill, or something you did.",
      followUpTriggers: [
        {
          keywords: ['I don\'t know', 'nothing', 'hard to say', 'can\'t think'],
          followUpPrompt: "That's okay, it can be hard to acknowledge ourselves. How about something small, like getting through a tough day or being here right now?",
        },
      ],
    },
    {
      id: 'often_overlooked',
      type: 'open',
      prompt: "What's something in your daily life that you often take for granted but are actually thankful for?",
    },
    {
      id: 'closing',
      type: 'open',
      prompt: "Taking a breath, how do you feel after reflecting on these things?",
    },
  ],

  closingMessage: "Thank you for practicing gratitude. Research shows this can genuinely shift how we feel over time. You're doing something good for yourself.",

  outputProcessing: {
    summaryPrompt: `Create a warm summary of this gratitude practice in 2-3 sentences that:
- Highlights the main things they expressed gratitude for
- Reflects the positive tone of the practice
- Could serve as a reminder of good things in their life
Keep it uplifting but genuine.`,
    extractSignals: true,
    therapeuticFramework: 'general', // Positive psychology/gratitude practice
  },
};
