/**
 * Guided Sessions Service
 *
 * Defines structured journaling sessions that guide users through
 * reflection, check-ins, and memory exploration.
 *
 * Session Types:
 * - Morning Check-in: Start the day with intention
 * - Evening Reflection: End the day with gratitude and learning
 * - Guided Entry: AI-assisted exploration of what's on your mind
 * - Memory Exploration: Reflect on patterns and growth
 */

/**
 * Session prompt types
 */
export const PROMPT_TYPES = {
  OPEN: 'open',           // Free text response
  SCALE: 'scale',         // 1-10 scale
  MULTIPLE: 'multiple',   // Multiple choice
  GRATITUDE: 'gratitude', // Gratitude-focused
  INTENTION: 'intention', // Goal/intention setting
  LEARNING: 'learning',   // What did you learn
  DYNAMIC: 'dynamic',     // AI generates based on context
  MEMORY_QUERY: 'memory_query', // Query journal memories
  PATTERN_SHARE: 'pattern_share', // Share discovered patterns
  REFLECTION: 'reflection', // Reflect on what was shared
  INSIGHT_OFFER: 'insight_offer', // Offer insight
  SUMMARY: 'summary'      // Summarize session
};

/**
 * Guided session definitions
 */
export const GUIDED_SESSIONS = {
  morning_checkin: {
    id: 'morning_checkin',
    name: 'Morning Check-in',
    description: 'Start your day with clarity and intention',
    duration: '5 min',
    icon: 'sunrise',
    timeOfDay: ['morning'],
    memoryAware: true,
    savesAsEntry: true,
    prompts: [
      {
        id: 'mood',
        type: PROMPT_TYPES.SCALE,
        question: 'How are you feeling this morning?',
        subtext: 'Rate your current mood',
        min: 1,
        max: 10,
        labels: { 1: 'Struggling', 5: 'Okay', 10: 'Great' }
      },
      {
        id: 'energy',
        type: PROMPT_TYPES.SCALE,
        question: 'What\'s your energy level?',
        min: 1,
        max: 10,
        labels: { 1: 'Exhausted', 5: 'Normal', 10: 'Energized' }
      },
      {
        id: 'mind',
        type: PROMPT_TYPES.OPEN,
        question: 'What\'s on your mind as you start the day?',
        placeholder: 'Share whatever comes to mind...'
      },
      {
        id: 'intention',
        type: PROMPT_TYPES.INTENTION,
        question: 'What\'s one intention for today?',
        subtext: 'It can be simple - "be patient" or "take a lunch break"',
        placeholder: 'Today I will...'
      }
    ],
    completionMessage: 'Have a wonderful day! Your intention has been noted.'
  },

  evening_reflection: {
    id: 'evening_reflection',
    name: 'Evening Reflection',
    description: 'End your day with gratitude and self-compassion',
    duration: '8 min',
    icon: 'moon',
    timeOfDay: ['evening', 'night'],
    memoryAware: true,
    savesAsEntry: true,
    prompts: [
      {
        id: 'day_summary',
        type: PROMPT_TYPES.OPEN,
        question: 'How did today go?',
        placeholder: 'Share the highlights and lowlights...'
      },
      {
        id: 'gratitude',
        type: PROMPT_TYPES.GRATITUDE,
        question: 'What are you grateful for today?',
        subtext: 'It can be big or small',
        placeholder: 'I\'m grateful for...'
      },
      {
        id: 'learning',
        type: PROMPT_TYPES.LEARNING,
        question: 'What did you learn about yourself today?',
        placeholder: 'Today I noticed that I...'
      },
      {
        id: 'release',
        type: PROMPT_TYPES.OPEN,
        question: 'Anything you want to let go of before sleep?',
        subtext: 'Worries, frustrations, or unfinished thoughts',
        placeholder: 'I\'m releasing...',
        optional: true
      }
    ],
    completionMessage: 'Rest well. You showed up for yourself today.'
  },

  guided_entry: {
    id: 'guided_entry',
    name: 'Guided Journal Entry',
    description: 'Let me help you explore what\'s on your mind',
    duration: '10 min',
    icon: 'pen-tool',
    timeOfDay: ['morning', 'afternoon', 'evening', 'night'],
    memoryAware: true,
    savesAsEntry: true,
    prompts: [
      {
        id: 'topic',
        type: PROMPT_TYPES.OPEN,
        question: 'What would you like to journal about?',
        placeholder: 'A situation, feeling, or thought on your mind...'
      },
      {
        id: 'explore_1',
        type: PROMPT_TYPES.DYNAMIC,
        instruction: 'Generate a thoughtful follow-up question based on the topic',
        depth: 1
      },
      {
        id: 'explore_2',
        type: PROMPT_TYPES.DYNAMIC,
        instruction: 'Go deeper into the emotion or situation',
        depth: 2
      },
      {
        id: 'explore_3',
        type: PROMPT_TYPES.DYNAMIC,
        instruction: 'Help them find insight or resolution',
        depth: 3
      },
      {
        id: 'summary',
        type: PROMPT_TYPES.SUMMARY,
        instruction: 'Reflect back what you heard and offer gentle insight'
      }
    ],
    completionMessage: 'Thank you for exploring this with me.'
  },

  memory_exploration: {
    id: 'memory_exploration',
    name: 'Explore Your Journey',
    description: 'Reflect on patterns and growth in your journal',
    duration: '10 min',
    icon: 'compass',
    timeOfDay: ['morning', 'afternoon', 'evening', 'night'],
    memoryAware: true,
    savesAsEntry: false,
    requiresEntryHistory: true,
    minEntriesRequired: 10,
    prompts: [
      {
        id: 'query',
        type: PROMPT_TYPES.MEMORY_QUERY,
        question: 'What would you like to explore from your journal?',
        subtext: 'Ask about a person, topic, time period, or pattern',
        placeholder: 'e.g., "How have I felt about work lately?" or "What helps when I\'m stressed?"'
      },
      {
        id: 'pattern',
        type: PROMPT_TYPES.PATTERN_SHARE,
        instruction: 'Share relevant patterns discovered from their journal'
      },
      {
        id: 'reflection',
        type: PROMPT_TYPES.REFLECTION,
        question: 'How does that resonate with you?',
        placeholder: 'Share your thoughts...'
      },
      {
        id: 'insight',
        type: PROMPT_TYPES.INSIGHT_OFFER,
        instruction: 'Offer a gentle insight based on the patterns and their reflection'
      }
    ],
    completionMessage: 'I hope this helped you see your journey more clearly.'
  },

  weekly_review: {
    id: 'weekly_review',
    name: 'Weekly Review',
    description: 'Look back on your week and set intentions for the next',
    duration: '12 min',
    icon: 'calendar',
    timeOfDay: ['morning', 'afternoon', 'evening'],
    dayOfWeek: [0, 6], // Sunday or Saturday
    memoryAware: true,
    savesAsEntry: true,
    requiresEntryHistory: true,
    prompts: [
      {
        id: 'week_highlight',
        type: PROMPT_TYPES.OPEN,
        question: 'What was the highlight of your week?',
        placeholder: 'The best part was...'
      },
      {
        id: 'week_challenge',
        type: PROMPT_TYPES.OPEN,
        question: 'What was challenging this week?',
        placeholder: 'I struggled with...'
      },
      {
        id: 'week_patterns',
        type: PROMPT_TYPES.PATTERN_SHARE,
        instruction: 'Share mood and activity patterns from this week'
      },
      {
        id: 'next_week_intention',
        type: PROMPT_TYPES.INTENTION,
        question: 'What\'s one thing you want to focus on next week?',
        placeholder: 'Next week I want to...'
      }
    ],
    completionMessage: 'Well done on reflecting on your week!'
  },

  stress_release: {
    id: 'stress_release',
    name: 'Stress Release',
    description: 'Process and release what\'s weighing on you',
    duration: '8 min',
    icon: 'wind',
    timeOfDay: ['morning', 'afternoon', 'evening', 'night'],
    memoryAware: true,
    savesAsEntry: true,
    therapeutic: true,
    prompts: [
      {
        id: 'stress_source',
        type: PROMPT_TYPES.OPEN,
        question: 'What\'s causing you stress right now?',
        placeholder: 'Get it all out...'
      },
      {
        id: 'body_check',
        type: PROMPT_TYPES.MULTIPLE,
        question: 'Where do you feel this stress in your body?',
        options: [
          { value: 'head', label: 'Head / tension headache' },
          { value: 'shoulders', label: 'Shoulders / neck' },
          { value: 'chest', label: 'Chest / tight breathing' },
          { value: 'stomach', label: 'Stomach / gut' },
          { value: 'other', label: 'Somewhere else' },
          { value: 'not_sure', label: 'Not sure' }
        ],
        multiSelect: true
      },
      {
        id: 'control',
        type: PROMPT_TYPES.OPEN,
        question: 'What part of this can you control, and what can\'t you control?',
        subtext: 'Sometimes naming this helps',
        placeholder: 'I can control... I can\'t control...'
      },
      {
        id: 'one_step',
        type: PROMPT_TYPES.OPEN,
        question: 'What\'s one small step you could take right now?',
        subtext: 'Even tiny steps count',
        placeholder: 'I could...'
      }
    ],
    completionMessage: 'You\'ve acknowledged what\'s hard. That takes courage.'
  }
};

/**
 * Get sessions appropriate for the current time of day
 */
export const getSessionsForTimeOfDay = () => {
  const hour = new Date().getHours();

  let timeOfDay;
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  else timeOfDay = 'night';

  return Object.values(GUIDED_SESSIONS).filter(session =>
    session.timeOfDay.includes(timeOfDay)
  );
};

/**
 * Get sessions appropriate for user's current state
 */
export const getRecommendedSessions = (userState = {}) => {
  const { recentMood, entryCount, dayOfWeek, timeOfDay } = userState;
  const sessions = [];

  // Always include time-appropriate sessions
  const timeAppropriate = Object.values(GUIDED_SESSIONS).filter(s =>
    s.timeOfDay.includes(timeOfDay || 'morning')
  );
  sessions.push(...timeAppropriate);

  // If low mood, prioritize stress release
  if (recentMood !== undefined && recentMood < 0.4) {
    const stressRelease = GUIDED_SESSIONS.stress_release;
    if (!sessions.includes(stressRelease)) {
      sessions.unshift(stressRelease);
    }
  }

  // If it's Sunday or Saturday, suggest weekly review
  if ((dayOfWeek === 0 || dayOfWeek === 6) && entryCount >= 5) {
    const weeklyReview = GUIDED_SESSIONS.weekly_review;
    if (!sessions.includes(weeklyReview)) {
      sessions.push(weeklyReview);
    }
  }

  // If they have enough entries, suggest memory exploration
  if (entryCount >= 10) {
    const memoryExploration = GUIDED_SESSIONS.memory_exploration;
    if (!sessions.includes(memoryExploration)) {
      sessions.push(memoryExploration);
    }
  }

  // Deduplicate and return
  return [...new Set(sessions)];
};

/**
 * Get session by ID
 */
export const getSessionById = (sessionId) => {
  return GUIDED_SESSIONS[sessionId] || null;
};

/**
 * Format session responses as journal entry text
 */
export const formatSessionAsEntry = (session, responses) => {
  const parts = [];

  parts.push(`[${session.name}]`);
  parts.push('');

  session.prompts.forEach(prompt => {
    const response = responses[prompt.id];
    if (response === undefined || response === null) return;

    if (prompt.type === PROMPT_TYPES.SCALE) {
      parts.push(`${prompt.question}: ${response}/10`);
    } else if (prompt.type === PROMPT_TYPES.MULTIPLE) {
      const selected = Array.isArray(response) ? response : [response];
      const options = prompt.options.filter(o => selected.includes(o.value));
      parts.push(`${prompt.question}: ${options.map(o => o.label).join(', ')}`);
    } else if (typeof response === 'string' && response.trim()) {
      parts.push(`${prompt.question}`);
      parts.push(response.trim());
      parts.push('');
    }
  });

  return parts.join('\n').trim();
};

/**
 * Generate dynamic prompt based on context
 */
export const generateDynamicPrompt = async (session, promptIndex, responses, generateFn) => {
  const prompt = session.prompts[promptIndex];
  if (prompt.type !== PROMPT_TYPES.DYNAMIC) {
    return prompt;
  }

  const context = {
    sessionType: session.id,
    previousResponses: responses,
    depth: prompt.depth,
    instruction: prompt.instruction
  };

  const systemPrompt = `You are a thoughtful journaling companion. Based on the user's responses so far, generate a follow-up question.

INSTRUCTION: ${prompt.instruction}
DEPTH LEVEL: ${prompt.depth} (1=initial exploration, 2=going deeper, 3=finding resolution)

Previous responses:
${Object.entries(responses).map(([k, v]) => `${k}: ${v}`).join('\n')}

Generate ONE thoughtful follow-up question. Be warm, curious, and non-judgmental. Don't repeat questions they've already answered.

Return JSON: { "question": "your question", "subtext": "optional helpful subtext" }`;

  try {
    const result = await generateFn(systemPrompt);
    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());

    return {
      id: prompt.id,
      type: PROMPT_TYPES.OPEN,
      question: parsed.question,
      subtext: parsed.subtext,
      placeholder: 'Share your thoughts...'
    };
  } catch (e) {
    // Fallback questions by depth
    const fallbacks = {
      1: { question: 'Tell me more about that.', subtext: 'Take your time' },
      2: { question: 'How does that make you feel?', subtext: 'There\'s no wrong answer' },
      3: { question: 'What might help with this situation?', subtext: 'Even small steps count' }
    };

    const fallback = fallbacks[prompt.depth] || fallbacks[1];
    return {
      id: prompt.id,
      type: PROMPT_TYPES.OPEN,
      ...fallback,
      placeholder: 'Share your thoughts...'
    };
  }
};

export default {
  GUIDED_SESSIONS,
  PROMPT_TYPES,
  getSessionsForTimeOfDay,
  getRecommendedSessions,
  getSessionById,
  formatSessionAsEntry,
  generateDynamicPrompt
};
