/**
 * Mindfulness Exercises Service
 *
 * Defines guided mindfulness exercises with:
 * - Breathing exercises (box breathing, 4-7-8, etc.)
 * - Grounding techniques (5-4-3-2-1)
 * - Body scan meditation
 * - Loving kindness meditation (memory-aware)
 */

/**
 * Exercise types
 */
export const EXERCISE_TYPES = {
  BREATHING: 'breathing',
  GROUNDING: 'grounding',
  BODY_SCAN: 'body_scan',
  MEDITATION: 'meditation'
};

/**
 * Mindfulness exercise definitions
 */
export const MINDFULNESS_EXERCISES = {
  box_breathing: {
    id: 'box_breathing',
    name: 'Box Breathing',
    type: EXERCISE_TYPES.BREATHING,
    description: 'Calm your nervous system with rhythmic breathing',
    duration: '4 min',
    icon: 'square',
    difficulty: 'beginner',
    benefits: ['Reduces anxiety', 'Calms nervous system', 'Improves focus'],
    tags: ['stress', 'anxiety', 'quick'],
    steps: [
      {
        action: 'inhale',
        duration: 4,
        instruction: 'Breathe in slowly through your nose...',
        visual: 'expanding'
      },
      {
        action: 'hold',
        duration: 4,
        instruction: 'Hold gently, feeling the fullness...',
        visual: 'steady'
      },
      {
        action: 'exhale',
        duration: 4,
        instruction: 'Release slowly through your mouth...',
        visual: 'contracting'
      },
      {
        action: 'hold',
        duration: 4,
        instruction: 'Rest empty, comfortable...',
        visual: 'steady'
      }
    ],
    cycles: 6,
    audioGuided: true,
    hapticFeedback: true,
    intro: 'Box breathing is used by Navy SEALs to stay calm under pressure. We\'ll breathe in a square pattern: in, hold, out, hold - each for 4 seconds.',
    outro: 'Well done. Take a moment to notice how you feel.'
  },

  breathing_478: {
    id: 'breathing_478',
    name: '4-7-8 Breathing',
    type: EXERCISE_TYPES.BREATHING,
    description: 'A natural tranquilizer for the nervous system',
    duration: '5 min',
    icon: 'wind',
    difficulty: 'beginner',
    benefits: ['Promotes sleep', 'Reduces anxiety', 'Calms racing thoughts'],
    tags: ['sleep', 'anxiety', 'evening'],
    steps: [
      {
        action: 'exhale',
        duration: 0,
        instruction: 'First, exhale completely through your mouth...',
        visual: 'empty'
      },
      {
        action: 'inhale',
        duration: 4,
        instruction: 'Breathe in quietly through your nose...',
        visual: 'expanding'
      },
      {
        action: 'hold',
        duration: 7,
        instruction: 'Hold your breath...',
        visual: 'steady'
      },
      {
        action: 'exhale',
        duration: 8,
        instruction: 'Exhale completely through your mouth, making a whoosh sound...',
        visual: 'contracting'
      }
    ],
    cycles: 4,
    audioGuided: true,
    hapticFeedback: true,
    intro: 'This breathing pattern was developed by Dr. Andrew Weil. It acts as a natural tranquilizer for the nervous system.',
    outro: 'This technique gets more powerful with practice. Use it whenever you feel stressed or before sleep.'
  },

  grounding_54321: {
    id: 'grounding_54321',
    name: '5-4-3-2-1 Grounding',
    type: EXERCISE_TYPES.GROUNDING,
    description: 'Connect to the present moment through your senses',
    duration: '5 min',
    icon: 'hand',
    difficulty: 'beginner',
    benefits: ['Reduces anxiety', 'Stops spiraling thoughts', 'Anchors to present'],
    tags: ['anxiety', 'panic', 'grounding', 'quick'],
    steps: [
      {
        sense: 'see',
        count: 5,
        prompt: 'Name 5 things you can see around you.',
        instruction: 'Look around slowly. Notice colors, textures, shapes.',
        inputType: 'voice_or_text'
      },
      {
        sense: 'touch',
        count: 4,
        prompt: 'Name 4 things you can physically feel.',
        instruction: 'Your feet on the floor, clothes on your skin, the air...',
        inputType: 'voice_or_text'
      },
      {
        sense: 'hear',
        count: 3,
        prompt: 'Name 3 things you can hear.',
        instruction: 'Listen carefully. Near sounds, far sounds, subtle sounds.',
        inputType: 'voice_or_text'
      },
      {
        sense: 'smell',
        count: 2,
        prompt: 'Name 2 things you can smell.',
        instruction: 'If you can\'t smell anything, name 2 smells you like.',
        inputType: 'voice_or_text'
      },
      {
        sense: 'taste',
        count: 1,
        prompt: 'Name 1 thing you can taste.',
        instruction: 'Or one taste that brings you comfort.',
        inputType: 'voice_or_text'
      }
    ],
    interactive: true,
    voiceEnabled: true,
    intro: 'When anxiety takes over, this technique helps ground you in the present moment using your five senses.',
    outro: 'You\'re here, you\'re safe, you\'re grounded. How do you feel now?'
  },

  body_scan: {
    id: 'body_scan',
    name: 'Body Scan',
    type: EXERCISE_TYPES.BODY_SCAN,
    description: 'Release tension by scanning through your body',
    duration: '8 min',
    icon: 'user',
    difficulty: 'intermediate',
    benefits: ['Releases physical tension', 'Mind-body connection', 'Promotes relaxation'],
    tags: ['tension', 'relaxation', 'sleep', 'stress'],
    regions: [
      {
        name: 'feet',
        label: 'Feet',
        instruction: 'Bring your attention to your feet. Notice any sensations - warmth, pressure, tingling. Let them relax.',
        duration: 30
      },
      {
        name: 'legs',
        label: 'Lower legs and knees',
        instruction: 'Move your awareness up to your calves and knees. Release any tension you find.',
        duration: 30
      },
      {
        name: 'thighs',
        label: 'Thighs and hips',
        instruction: 'Notice your thighs and hips. Let them sink heavy and relaxed.',
        duration: 30
      },
      {
        name: 'stomach',
        label: 'Stomach and lower back',
        instruction: 'Bring attention to your belly and lower back. Let your breath soften this area.',
        duration: 35
      },
      {
        name: 'chest',
        label: 'Chest and upper back',
        instruction: 'Feel your chest rise and fall with each breath. Release tension between your shoulder blades.',
        duration: 35
      },
      {
        name: 'hands',
        label: 'Hands and arms',
        instruction: 'Notice your fingers, hands, forearms, and upper arms. Let them feel heavy and warm.',
        duration: 30
      },
      {
        name: 'shoulders',
        label: 'Shoulders and neck',
        instruction: 'Common tension areas. Gently roll your shoulders back and let them drop.',
        duration: 40
      },
      {
        name: 'face',
        label: 'Face and jaw',
        instruction: 'Unclench your jaw. Soften your brow. Let your face be expressionless and relaxed.',
        duration: 35
      },
      {
        name: 'head',
        label: 'Scalp and whole body',
        instruction: 'Feel your scalp relax. Now sense your whole body as one, relaxed and present.',
        duration: 35
      }
    ],
    audioGuided: true,
    backgroundAudio: 'ambient',
    intro: 'Find a comfortable position. We\'ll slowly scan through your body, releasing tension as we go.',
    outro: 'Take a moment to feel your whole body, relaxed and at ease. When you\'re ready, gently open your eyes.'
  },

  loving_kindness: {
    id: 'loving_kindness',
    name: 'Loving Kindness',
    type: EXERCISE_TYPES.MEDITATION,
    description: 'Cultivate compassion for yourself and others',
    duration: '7 min',
    icon: 'heart',
    difficulty: 'intermediate',
    benefits: ['Increases self-compassion', 'Reduces self-criticism', 'Improves relationships'],
    tags: ['compassion', 'self-love', 'relationships'],
    memoryAware: true, // Will include actual people from memory graph
    targets: [
      {
        id: 'self',
        label: 'Yourself',
        instruction: 'Begin by directing loving kindness to yourself. You deserve compassion.',
        duration: 60
      },
      {
        id: 'loved_one',
        label: 'Someone you love',
        instruction: 'Think of someone you love deeply. Picture them clearly.',
        duration: 60,
        memorySource: 'people', // Pull from memory graph
        sentimentFilter: 'positive'
      },
      {
        id: 'neutral_person',
        label: 'A neutral person',
        instruction: 'Think of someone you neither like nor dislike. A stranger you passed today.',
        duration: 50
      },
      {
        id: 'difficult_person',
        label: 'A difficult person',
        instruction: 'If you\'re ready, think of someone you find difficult. Start small.',
        duration: 50,
        optional: true
      },
      {
        id: 'all_beings',
        label: 'All beings',
        instruction: 'Extend your loving kindness to all beings everywhere.',
        duration: 50
      }
    ],
    phrases: [
      'May you be happy',
      'May you be healthy',
      'May you be safe',
      'May you live with ease'
    ],
    audioGuided: true,
    backgroundAudio: 'gentle',
    intro: 'Loving kindness meditation cultivates compassion, starting with yourself and extending outward.',
    outro: 'Carry this sense of kindness with you. You can return to these phrases anytime.'
  },

  quick_calm: {
    id: 'quick_calm',
    name: 'Quick Calm',
    type: EXERCISE_TYPES.BREATHING,
    description: 'One minute to reset when you\'re overwhelmed',
    duration: '1 min',
    icon: 'zap',
    difficulty: 'beginner',
    benefits: ['Immediate stress relief', 'Can do anywhere', 'Resets nervous system'],
    tags: ['quick', 'panic', 'anxiety', 'anytime'],
    steps: [
      {
        action: 'pause',
        duration: 3,
        instruction: 'Stop. Put your hand on your chest.',
        visual: 'steady'
      },
      {
        action: 'exhale',
        duration: 6,
        instruction: 'Exhale slowly, like you\'re blowing through a straw.',
        visual: 'contracting'
      },
      {
        action: 'inhale',
        duration: 4,
        instruction: 'Breathe in through your nose.',
        visual: 'expanding'
      },
      {
        action: 'exhale',
        duration: 6,
        instruction: 'Long exhale through your mouth.',
        visual: 'contracting'
      },
      {
        action: 'inhale',
        duration: 4,
        instruction: 'In through your nose.',
        visual: 'expanding'
      },
      {
        action: 'exhale',
        duration: 8,
        instruction: 'One last long exhale. Let it all go.',
        visual: 'contracting'
      }
    ],
    cycles: 1,
    audioGuided: true,
    hapticFeedback: true,
    intro: 'Just one minute. Let\'s reset.',
    outro: 'Better. You\'ve got this.'
  }
};

/**
 * Get exercises by tag
 */
export const getExercisesByTag = (tag) => {
  return Object.values(MINDFULNESS_EXERCISES).filter(ex =>
    ex.tags.includes(tag)
  );
};

/**
 * Get exercises by type
 */
export const getExercisesByType = (type) => {
  return Object.values(MINDFULNESS_EXERCISES).filter(ex =>
    ex.type === type
  );
};

/**
 * Get exercises by difficulty
 */
export const getExercisesByDifficulty = (difficulty) => {
  return Object.values(MINDFULNESS_EXERCISES).filter(ex =>
    ex.difficulty === difficulty
  );
};

/**
 * Get exercise by ID
 */
export const getExerciseById = (exerciseId) => {
  return MINDFULNESS_EXERCISES[exerciseId] || null;
};

/**
 * Get recommended exercises based on user state
 */
export const getRecommendedExercises = (userState = {}) => {
  const { mood, anxiety, hasTime, bedtime } = userState;
  const recommended = [];

  // High anxiety - prioritize grounding and quick calm
  if (anxiety === 'high') {
    recommended.push(MINDFULNESS_EXERCISES.quick_calm);
    recommended.push(MINDFULNESS_EXERCISES.grounding_54321);
    recommended.push(MINDFULNESS_EXERCISES.box_breathing);
  }

  // Low mood - loving kindness
  if (mood !== undefined && mood < 0.4) {
    recommended.push(MINDFULNESS_EXERCISES.loving_kindness);
  }

  // Near bedtime - sleep-friendly exercises
  if (bedtime) {
    recommended.push(MINDFULNESS_EXERCISES.breathing_478);
    recommended.push(MINDFULNESS_EXERCISES.body_scan);
  }

  // Limited time - quick exercises
  if (hasTime === 'limited') {
    recommended.push(MINDFULNESS_EXERCISES.quick_calm);
    recommended.push(MINDFULNESS_EXERCISES.box_breathing);
  }

  // Default recommendations
  if (recommended.length === 0) {
    recommended.push(MINDFULNESS_EXERCISES.box_breathing);
    recommended.push(MINDFULNESS_EXERCISES.grounding_54321);
    recommended.push(MINDFULNESS_EXERCISES.body_scan);
  }

  // Deduplicate and limit
  return [...new Set(recommended)].slice(0, 4);
};

/**
 * Get all exercises
 */
export const getAllExercises = () => {
  return Object.values(MINDFULNESS_EXERCISES);
};

/**
 * Calculate total duration of exercise in seconds
 */
export const calculateExerciseDuration = (exercise) => {
  if (exercise.type === EXERCISE_TYPES.BREATHING) {
    const cycleDuration = exercise.steps.reduce((sum, step) => sum + step.duration, 0);
    return cycleDuration * (exercise.cycles || 1);
  }

  if (exercise.type === EXERCISE_TYPES.BODY_SCAN) {
    return exercise.regions.reduce((sum, region) => sum + region.duration, 0);
  }

  if (exercise.type === EXERCISE_TYPES.MEDITATION) {
    return exercise.targets.reduce((sum, target) => sum + target.duration, 0);
  }

  if (exercise.type === EXERCISE_TYPES.GROUNDING) {
    return exercise.steps.length * 30; // ~30 seconds per sense
  }

  return 0;
};

/**
 * Personalize loving kindness exercise with memory graph
 */
export const personalizeLovingKindness = (exercise, memoryPeople = []) => {
  if (!exercise || exercise.id !== 'loving_kindness') return exercise;

  const personalized = { ...exercise, targets: [...exercise.targets] };

  // Find a positive person from memory for "loved one" step
  const lovedOneIndex = personalized.targets.findIndex(t => t.id === 'loved_one');
  if (lovedOneIndex >= 0 && memoryPeople.length > 0) {
    const positivePeople = memoryPeople
      .filter(p => p.sentiment?.overall > 0.3 && p.status !== 'archived')
      .sort((a, b) => b.mentionCount - a.mentionCount);

    if (positivePeople.length > 0) {
      const person = positivePeople[0];
      personalized.targets[lovedOneIndex] = {
        ...personalized.targets[lovedOneIndex],
        label: person.name,
        instruction: `Picture ${person.name}. Let their presence fill your heart.`
      };
    }
  }

  return personalized;
};

export default {
  MINDFULNESS_EXERCISES,
  EXERCISE_TYPES,
  getExercisesByTag,
  getExercisesByType,
  getExercisesByDifficulty,
  getExerciseById,
  getRecommendedExercises,
  getAllExercises,
  calculateExerciseDuration,
  personalizeLovingKindness
};
