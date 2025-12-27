import type { GuidedSessionDefinition } from '../schema.js';

export const emotionalProcessing: GuidedSessionDefinition = {
  id: 'emotional_processing',
  name: 'Emotional Processing',
  description: 'Work through difficult feelings with gentle guidance',
  icon: 'heart',
  estimatedMinutes: 10,

  suggestWhen: {
    moodBelow: 0.4, // Suggest when mood is low
  },

  contextNeeds: {
    recentEntries: 5,
    relevantGoals: false,
    openSituations: true,
    recurringPatterns: true,
    yesterdayHighlight: false,
  },

  openingMessage: "I'm here to listen. Whatever you're feeling is valid, and we can work through it together.",

  prompts: [
    {
      id: 'current_feeling',
      type: 'open',
      prompt: "What are you feeling right now? Take your time, there's no rush.",
      followUpTriggers: [
        {
          keywords: ['angry', 'frustrated', 'furious', 'mad'],
          followUpPrompt: "Anger often comes from feeling hurt or unheard. What's underneath that anger?",
        },
        {
          keywords: ['sad', 'down', 'depressed', 'hopeless'],
          followUpPrompt: "I hear you. Sadness is heavy. What do you think is weighing on you the most?",
        },
        {
          keywords: ['anxious', 'worried', 'scared', 'panicking'],
          followUpPrompt: "Anxiety can feel overwhelming. What's the worry that keeps coming back?",
        },
        {
          keywords: ['numb', 'empty', 'nothing', 'disconnected'],
          followUpPrompt: "Feeling numb can be a protective response. When did you start feeling this way?",
        },
        {
          keywords: ['overwhelmed', 'too much', 'can\'t handle'],
          followUpPrompt: "When everything feels like too much, let's break it down. What's the one thing weighing on you most right now?",
        },
      ],
    },
    {
      id: 'situation_check',
      type: 'reflection',
      prompt: "You mentioned dealing with {openSituation}. Is that connected to how you're feeling now?",
      contextInjection: {
        includeOpenSituations: true,
      },
      skipConditions: ['no_open_situations'],
    },
    {
      id: 'body_check',
      type: 'open',
      prompt: "Take a moment to notice your body. Where do you feel this emotion? In your chest, stomach, shoulders?",
    },
    {
      id: 'trigger',
      type: 'open',
      prompt: "What happened that brought this feeling up? Or has it been building over time?",
      followUpTriggers: [
        {
          keywords: ['always', 'every time', 'never changes'],
          followUpPrompt: "It sounds like this is a pattern. When did you first notice feeling this way?",
        },
      ],
    },
    {
      id: 'unmet_need',
      type: 'reflection',
      prompt: "Sometimes big emotions point to something we need. What might you be needing right now? Maybe rest, connection, validation, or something else?",
    },
    {
      id: 'helpful_perspective',
      type: 'open',
      prompt: "If a close friend were feeling this way, what would you say to them?",
    },
    {
      id: 'one_small_thing',
      type: 'open',
      prompt: "What's one small thing that might help you feel a little better right now? Even something tiny counts.",
    },
    {
      id: 'closing_check',
      type: 'open',
      prompt: "How are you feeling now compared to when we started? Anything else you want to share?",
    },
  ],

  closingMessage: "Thank you for being so open. Working through feelings takes courage. Be gentle with yourself today.",

  outputProcessing: {
    summaryPrompt: `Summarize this emotional processing session with care:
- The main emotion(s) the user explored
- What triggered or contributed to these feelings
- Any insights they had about their needs
- What small step they identified to help
Keep the tone compassionate and validating.`,
    extractSignals: true,
    therapeuticFramework: 'act',
  },
};
