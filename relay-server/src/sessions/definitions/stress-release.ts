import type { GuidedSessionDefinition } from '../schema.js';

export const stressRelease: GuidedSessionDefinition = {
  id: 'stress_release',
  name: 'Stress Release',
  description: 'Let go of tension and find calm',
  icon: 'wind',
  estimatedMinutes: 8,

  suggestWhen: {
    moodBelow: 0.5,
    patterns: ['stressed', 'overwhelmed', 'busy'],
  },

  contextNeeds: {
    recentEntries: 3,
    relevantGoals: false,
    openSituations: true,
    recurringPatterns: false,
    yesterdayHighlight: false,
  },

  openingMessage: "Let's take a few minutes to release some stress. Find a comfortable position and take a deep breath with me.",

  prompts: [
    {
      id: 'breath_check',
      type: 'open',
      prompt: "Take three slow, deep breaths. In through your nose, out through your mouth. How does that feel?",
    },
    {
      id: 'stress_source',
      type: 'open',
      prompt: "What's been causing you the most stress lately? Just let it out, no judgment here.",
      followUpTriggers: [
        {
          keywords: ['work', 'job', 'boss', 'deadline', 'project'],
          followUpPrompt: "Work stress can really pile up. What part of it feels most pressing right now?",
        },
        {
          keywords: ['family', 'kids', 'partner', 'parents', 'home'],
          followUpPrompt: "Home life can be a lot. What's the main thing you wish was different?",
        },
        {
          keywords: ['money', 'bills', 'financial', 'expensive'],
          followUpPrompt: "Financial stress is tough to carry. What would help you feel more secure?",
        },
        {
          keywords: ['health', 'sick', 'tired', 'exhausted'],
          followUpPrompt: "Your health is so important. What's your body trying to tell you?",
        },
      ],
    },
    {
      id: 'body_tension',
      type: 'open',
      prompt: "Scan your body for a moment. Where are you holding tension? Maybe your shoulders, jaw, or back?",
    },
    {
      id: 'release_exercise',
      type: 'open',
      prompt: "Try tensing that area for 5 seconds, then releasing. Let's do it together. Tense... and release. How does that feel?",
    },
    {
      id: 'control_check',
      type: 'reflection',
      prompt: "Of everything stressing you out, what's actually within your control? And what do you need to let go of?",
    },
    {
      id: 'support_system',
      type: 'open',
      prompt: "Who or what helps you feel supported when things get hard? Have you reached out to them lately?",
    },
    {
      id: 'one_thing_less',
      type: 'open',
      prompt: "What's one thing on your plate that you could remove, delegate, or postpone this week?",
      followUpTriggers: [
        {
          keywords: ['nothing', 'can\'t', 'have to', 'must'],
          followUpPrompt: "Sometimes we feel trapped by obligations. Is there anything you're doing out of habit rather than necessity?",
        },
      ],
    },
    {
      id: 'self_care_action',
      type: 'open',
      prompt: "What's one small act of self-care you can do today? Something just for you.",
    },
    {
      id: 'final_breath',
      type: 'open',
      prompt: "Let's take one more deep breath together. In... and out. How are you feeling now?",
    },
  ],

  closingMessage: "Remember, you don't have to carry everything at once. Take things one step at a time, and be kind to yourself.",

  outputProcessing: {
    summaryPrompt: `Summarize this stress release session:
- What the main sources of stress were
- Any insights about control and letting go
- The self-care action they committed to
- Any noticeable shift in how they felt
Keep the tone calming and encouraging.`,
    extractSignals: true,
    therapeuticFramework: 'general',
  },
};
