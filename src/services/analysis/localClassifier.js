/**
 * Local Entry Classifier
 *
 * Rule-based classification for journal entries without AI dependency.
 * Classifies entries into: task, mixed, reflection, or vent
 *
 * Performance target: <50ms for classification
 */

// Entry types (matching server classification)
export const ENTRY_TYPES = {
  TASK: 'task',
  MIXED: 'mixed',
  REFLECTION: 'reflection',
  VENT: 'vent'
};

// ============================================
// TASK DETECTION PATTERNS
// ============================================

// Strong task indicators - explicit action items
const STRONG_TASK_PATTERNS = [
  /\b(need to|have to|gotta|got to|must)\s+\w+/gi,
  /\b(should|ought to)\s+\w+/gi,
  /\b(todo|to-do|to do):/gi,
  /\b(reminder|reminders):/gi,
  /•\s*\w+/g,           // Bullet points
  /^\s*[-*]\s+\w+/gm,   // Markdown list items
  /^\s*\d+\.\s+\w+/gm,  // Numbered lists
];

// Action verbs at start of sentence/entry
const ACTION_VERB_STARTS = [
  /^(buy|get|pick up|grab|order)\b/i,
  /^(call|email|text|message|contact|reach out)\b/i,
  /^(schedule|book|reserve|set up)\b/i,
  /^(submit|send|deliver|return)\b/i,
  /^(finish|complete|wrap up|finalize)\b/i,
  /^(clean|organize|sort|tidy)\b/i,
  /^(make|prepare|cook|bake)\b/i,
  /^(fix|repair|replace|update)\b/i,
  /^(pay|transfer|deposit|renew)\b/i,
  /^(cancel|reschedule|postpone)\b/i,
];

// Task-specific nouns
const TASK_NOUNS = /\b(appointment|meeting|deadline|due date|errand|chore|task|tasks)\b/gi;

// ============================================
// VENT DETECTION PATTERNS
// ============================================

// Strong negative emotion words
const VENT_EMOTION_WORDS = [
  /\b(hate|hating|hated)\b/gi,
  /\b(angry|furious|enraged|livid|pissed|pissed off)\b/gi,
  /\b(frustrated|frustrating|frustration)\b/gi,
  /\b(overwhelmed|overwhelming)\b/gi,
  /\b(can't take|cannot take|can't stand|cannot stand)\b/gi,
  /\b(sick of|tired of|fed up|had enough)\b/gi,
  /\b(ugh+|argh+|gah+)\b/gi,
  /\b(wtf|omfg|ffs)\b/gi,
];

// Dysregulated language patterns
const DYSREGULATION_PATTERNS = [
  /[!]{2,}/g,                    // Multiple exclamation marks
  /[?!]{2,}/g,                   // Multiple mixed punctuation
  /\b(everything is|it's all|nothing ever|nobody ever)\b/gi,
  /\b(always|never)\s+(happens|works|goes)\b/gi,
  /\b(can't believe|cannot believe)\b/gi,
  /\b(what the|why does|why can't)\b/gi,
  /\b(so (stupid|dumb|unfair|ridiculous|annoying))\b/gi,
];

// ============================================
// REFLECTION DETECTION PATTERNS
// ============================================

// Self-reflection language
const REFLECTION_PATTERNS = [
  /\b(i (feel|felt|am feeling|was feeling))\b/gi,
  /\b(i (think|thought|believe|believed|notice|noticed))\b/gi,
  /\b(i (realize|realized|understand|understood))\b/gi,
  /\b(i've been (thinking|wondering|reflecting|considering))\b/gi,
  /\b(thinking about|reflecting on|considering)\b/gi,
  /\b(grateful|thankful|appreciate|appreciating)\b/gi,
  /\b(my goal|my goals|my intention|my intentions)\b/gi,
  /\b(i want to become|i want to be|i'd like to be)\b/gi,
];

// Goal/intention language (NOT tasks)
const GOAL_PATTERNS = [
  /\b(every day|daily|each day|each morning|each night)\b/gi,
  /\b(more often|consistently|regularly|frequently)\b/gi,
  /\b(habit|habits|routine|routines)\b/gi,
  /\b(resolution|resolutions)\b/gi,
  /\b(long-term|long term|in the future)\b/gi,
  /\b(aspire|aspiring|aspiration)\b/gi,
];

// ============================================
// RECURRENCE DETECTION
// ============================================

const RECURRENCE_PATTERNS = {
  daily: [
    /\b(every day|everyday|daily|each day)\b/gi,
    /\b(every morning|every night|every evening)\b/gi,
  ],
  weekly: [
    /\b(every week|weekly|each week)\b/gi,
    /\b(every (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,
  ],
  biweekly: [
    /\b(every (two|2) weeks|biweekly|bi-weekly|fortnightly)\b/gi,
    /\b(every other week)\b/gi,
  ],
  monthly: [
    /\b(every month|monthly|each month)\b/gi,
    /\b(every (first|1st|second|2nd|third|3rd|fourth|4th|last) (of the month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,
  ],
  custom: [
    /\b(every (\d+) (days|weeks|months))\b/gi,
  ],
};

/**
 * Classify a journal entry into type
 *
 * @param {string} text - Entry text to classify
 * @returns {Object} Classification result
 */
export const classify = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      entry_type: ENTRY_TYPES.REFLECTION,
      confidence: 0.3,
      extracted_tasks: [],
      reasoning: 'empty_input'
    };
  }

  const normalizedText = text.trim();
  const lowerText = normalizedText.toLowerCase();

  // Count pattern matches
  const scores = {
    task: 0,
    vent: 0,
    reflection: 0
  };

  const matches = {
    task: [],
    vent: [],
    reflection: []
  };

  // Check task patterns
  for (const pattern of STRONG_TASK_PATTERNS) {
    const found = normalizedText.match(pattern);
    if (found) {
      scores.task += found.length * 2;
      matches.task.push(...found);
    }
  }

  // Check action verb starts (per line)
  const lines = normalizedText.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    for (const pattern of ACTION_VERB_STARTS) {
      if (pattern.test(trimmedLine)) {
        scores.task += 3;
        matches.task.push(trimmedLine.slice(0, 30));
        break;
      }
    }
  }

  // Task nouns
  const taskNounMatches = normalizedText.match(TASK_NOUNS);
  if (taskNounMatches) {
    scores.task += taskNounMatches.length;
    matches.task.push(...taskNounMatches);
  }

  // Check vent patterns
  for (const pattern of VENT_EMOTION_WORDS) {
    const found = normalizedText.match(pattern);
    if (found) {
      scores.vent += found.length * 3;
      matches.vent.push(...found);
    }
  }

  for (const pattern of DYSREGULATION_PATTERNS) {
    const found = normalizedText.match(pattern);
    if (found) {
      scores.vent += found.length * 2;
      matches.vent.push(...found);
    }
  }

  // Check reflection patterns
  for (const pattern of REFLECTION_PATTERNS) {
    const found = normalizedText.match(pattern);
    if (found) {
      scores.reflection += found.length * 2;
      matches.reflection.push(...found);
    }
  }

  // Goal patterns indicate reflection, NOT task
  for (const pattern of GOAL_PATTERNS) {
    const found = normalizedText.match(pattern);
    if (found) {
      scores.reflection += found.length * 2;
      scores.task -= found.length; // Reduce task score
      matches.reflection.push(...found);
    }
  }

  // Determine classification
  let entry_type = ENTRY_TYPES.REFLECTION;
  let confidence = 0.5;
  let reasoning = '';

  const maxScore = Math.max(scores.task, scores.vent, scores.reflection);
  const totalScore = scores.task + scores.vent + scores.reflection;

  if (totalScore === 0) {
    // No clear patterns - default to reflection
    entry_type = ENTRY_TYPES.REFLECTION;
    confidence = 0.4;
    reasoning = 'no_clear_patterns';
  } else if (scores.vent > scores.task && scores.vent > scores.reflection && scores.vent >= 5) {
    // Strong vent signals
    entry_type = ENTRY_TYPES.VENT;
    confidence = Math.min(0.95, 0.5 + (scores.vent / totalScore) * 0.4);
    reasoning = 'strong_vent_signals';
  } else if (scores.task > scores.reflection && scores.task >= 4) {
    // Task-heavy entry
    if (scores.reflection >= 3 || scores.vent >= 2) {
      // Has both task and emotional content
      entry_type = ENTRY_TYPES.MIXED;
      confidence = Math.min(0.9, 0.5 + (scores.task / totalScore) * 0.3);
      reasoning = 'task_with_emotion';
    } else {
      entry_type = ENTRY_TYPES.TASK;
      confidence = Math.min(0.95, 0.5 + (scores.task / totalScore) * 0.4);
      reasoning = 'clear_task_list';
    }
  } else if (scores.reflection >= 3) {
    entry_type = ENTRY_TYPES.REFLECTION;
    confidence = Math.min(0.9, 0.5 + (scores.reflection / totalScore) * 0.35);
    reasoning = 'reflective_content';
  } else {
    // Low signal - default to reflection
    entry_type = ENTRY_TYPES.REFLECTION;
    confidence = 0.5;
    reasoning = 'default_low_signal';
  }

  // Extract tasks if applicable
  const extracted_tasks = (entry_type === ENTRY_TYPES.TASK || entry_type === ENTRY_TYPES.MIXED)
    ? extractTasks(normalizedText)
    : [];

  return {
    entry_type,
    confidence: Math.round(confidence * 100) / 100,
    extracted_tasks,
    scores,
    reasoning
  };
};

/**
 * Extract tasks from entry text
 *
 * @param {string} text - Entry text
 * @returns {Array} Extracted tasks
 */
const extractTasks = (text) => {
  const tasks = [];
  const seenTexts = new Set();

  // Extract from bullet points
  const bulletMatches = text.match(/^[\s]*[-*•]\s*(.+)$/gm);
  if (bulletMatches) {
    for (const match of bulletMatches) {
      const taskText = match.replace(/^[\s]*[-*•]\s*/, '').trim();
      if (isValidTask(taskText) && !seenTexts.has(taskText.toLowerCase())) {
        seenTexts.add(taskText.toLowerCase());
        tasks.push(createTask(taskText));
      }
    }
  }

  // Extract from numbered lists
  const numberedMatches = text.match(/^\s*\d+\.\s*(.+)$/gm);
  if (numberedMatches) {
    for (const match of numberedMatches) {
      const taskText = match.replace(/^\s*\d+\.\s*/, '').trim();
      if (isValidTask(taskText) && !seenTexts.has(taskText.toLowerCase())) {
        seenTexts.add(taskText.toLowerCase());
        tasks.push(createTask(taskText));
      }
    }
  }

  // Extract from "need to" patterns
  const needToMatches = text.match(/\b(need to|have to|gotta|must)\s+([^.,!?]+)/gi);
  if (needToMatches) {
    for (const match of needToMatches) {
      const taskText = match.replace(/^(need to|have to|gotta|must)\s+/i, '').trim();
      if (isValidTask(taskText) && !seenTexts.has(taskText.toLowerCase())) {
        seenTexts.add(taskText.toLowerCase());
        tasks.push(createTask(taskText));
      }
    }
  }

  return tasks.slice(0, 10); // Limit to 10 tasks
};

/**
 * Check if text is a valid task (not a goal or emotional statement)
 *
 * @param {string} text - Task text to validate
 * @returns {boolean}
 */
const isValidTask = (text) => {
  if (!text || text.length < 3 || text.length > 200) return false;

  const lower = text.toLowerCase();

  // Reject goals/intentions
  const goalIndicators = [
    'every day', 'daily', 'each day', 'more often', 'consistently',
    'regularly', 'my goal', 'want to be', 'become', 'habit',
    'i should', 'i need to feel', 'i want to feel'
  ];
  for (const indicator of goalIndicators) {
    if (lower.includes(indicator)) return false;
  }

  // Reject emotional statements
  const emotionalIndicators = [
    'i feel', 'i felt', 'feeling', 'i think', 'i believe',
    'grateful', 'thankful', 'stressed', 'anxious', 'happy', 'sad'
  ];
  for (const indicator of emotionalIndicators) {
    if (lower.includes(indicator)) return false;
  }

  return true;
};

/**
 * Create a task object with recurrence detection
 *
 * @param {string} text - Task text
 * @returns {Object} Task object
 */
const createTask = (text) => {
  const recurrence = detectRecurrence(text);

  return {
    text: cleanTaskText(text),
    completed: false,
    recurrence,
    completedAt: null,
    nextDueDate: recurrence ? new Date().toISOString() : null
  };
};

/**
 * Detect recurrence pattern in task text
 *
 * @param {string} text - Task text
 * @returns {Object|null} Recurrence pattern or null
 */
const detectRecurrence = (text) => {
  for (const [pattern, regexes] of Object.entries(RECURRENCE_PATTERNS)) {
    for (const regex of regexes) {
      const match = text.match(regex);
      if (match) {
        return {
          pattern,
          interval: extractInterval(match[0], pattern),
          unit: getUnitForPattern(pattern),
          description: match[0].toLowerCase()
        };
      }
    }
  }
  return null;
};

/**
 * Extract interval number from recurrence match
 */
const extractInterval = (match, pattern) => {
  if (pattern === 'daily') return 1;
  if (pattern === 'weekly') return 1;
  if (pattern === 'biweekly') return 2;
  if (pattern === 'monthly') return 1;

  const numMatch = match.match(/(\d+)/);
  return numMatch ? parseInt(numMatch[1], 10) : 1;
};

/**
 * Get unit for recurrence pattern
 */
const getUnitForPattern = (pattern) => {
  switch (pattern) {
    case 'daily': return 'days';
    case 'weekly': return 'weeks';
    case 'biweekly': return 'weeks';
    case 'monthly': return 'months';
    default: return 'days';
  }
};

/**
 * Clean task text by removing recurrence phrases
 */
const cleanTaskText = (text) => {
  let cleaned = text;

  // Remove common recurrence phrases
  const recurrencePhrases = [
    /\bevery (day|week|month|morning|night|evening)\b/gi,
    /\bdaily\b/gi,
    /\bweekly\b/gi,
    /\bmonthly\b/gi,
    /\beach (day|week|month)\b/gi,
    /\bevery (\d+) (days|weeks|months)\b/gi,
    /\bbiweekly\b/gi,
    /\bfortnightly\b/gi,
  ];

  for (const phrase of recurrencePhrases) {
    cleaned = cleaned.replace(phrase, '').trim();
  }

  // Capitalize first letter
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

export default { classify, ENTRY_TYPES };
