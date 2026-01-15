/**
 * Local Goal Detector
 *
 * Extracts goals and intentions from journal entry text
 * using pattern matching. Designed for on-device processing
 * without server AI dependency.
 *
 * Goal Types:
 * - aspiration: "I want to...", "I'd like to..."
 * - habit_start: "I need to start...", "I should start..."
 * - habit_stop: "I need to stop...", "I should quit..."
 * - commitment: "I'm going to...", "I will..."
 * - recurring: "every day", "daily", "weekly"
 */

/**
 * Goal pattern definitions with type classification
 */
const GOAL_PATTERNS = [
  // Aspirations - wants and wishes
  {
    regex: /\b(?:i\s+(?:want|wanna)\s+to|i(?:'d|\s+would)\s+(?:like|love)\s+to|my\s+goal\s+is\s+to)\s+(.+?)(?:[.!?]|,\s*(?:but|and|so)|$)/gi,
    type: 'aspiration',
    extract: 1
  },
  {
    regex: /\b(?:i\s+wish\s+(?:i\s+could|to)|i\s+hope\s+to)\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'aspiration',
    extract: 1
  },

  // Habit starts - beginning new behaviors
  {
    regex: /\b(?:i\s+(?:need|have)\s+to\s+start|i\s+should\s+(?:start|begin)|going\s+to\s+start)\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'habit_start',
    extract: 1
  },
  {
    regex: /\b(?:time\s+to\s+start|need\s+to\s+begin)\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'habit_start',
    extract: 1
  },

  // Habit stops - ending behaviors
  {
    regex: /\b(?:i\s+(?:need|have)\s+to\s+(?:stop|quit)|i\s+should\s+(?:stop|quit)|going\s+to\s+(?:stop|quit))\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'habit_stop',
    extract: 1
  },
  {
    regex: /\b(?:no\s+more|done\s+with|cutting\s+out)\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'habit_stop',
    extract: 1
  },

  // Commitments - firm intentions
  {
    regex: /\b(?:i(?:'m|\s+am)\s+going\s+to|i\s+will|i(?:'ll))\s+(.+?)(?:[.!?]|,\s*(?:but|because)|$)/gi,
    type: 'commitment',
    extract: 1
  },
  {
    regex: /\b(?:decided\s+to|committed\s+to|planning\s+to)\s+(.+?)(?:[.!?]|,|$)/gi,
    type: 'commitment',
    extract: 1
  },

  // Frequency indicators (modifies other goals)
  {
    regex: /\b(every\s+(?:day|morning|evening|night|week|month)|daily|weekly|monthly|(?:once|twice|three\s+times)\s+a\s+(?:day|week|month))\b/gi,
    type: 'frequency',
    extract: 0 // Full match
  }
];

/**
 * Negative patterns that indicate NOT a goal
 */
const NEGATIVE_PATTERNS = [
  /\bi\s+(?:used\s+to|wanted\s+to\s+but|tried\s+to\s+but)/i,
  /\bi\s+(?:couldn't|can't|won't\s+be\s+able\s+to)/i,
  /\bif\s+only\s+i\s+(?:could|had)/i,
  /\bi\s+(?:gave\s+up|stopped)\s+trying/i
];

/**
 * Clean and normalize extracted goal text
 */
const cleanGoalText = (text) => {
  if (!text) return null;

  let cleaned = text
    .trim()
    // Remove leading articles
    .replace(/^(?:to\s+)?(?:a|an|the)\s+/i, '')
    // Remove trailing punctuation and filler
    .replace(/[.,!?]+$/, '')
    // Remove common suffixes
    .replace(/\s+(?:now|today|soon|anymore|again)$/i, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Must be at least 3 chars and max 100
  if (cleaned.length < 3 || cleaned.length > 100) return null;

  return cleaned;
};

/**
 * Detect frequency modifier from text
 */
const detectFrequency = (text) => {
  const freqMatch = text.match(/\b(every\s+(?:day|morning|evening|night|week|month)|daily|weekly|monthly|(?:once|twice|three\s+times)\s+a\s+(?:day|week|month))\b/i);

  if (!freqMatch) return null;

  const freq = freqMatch[1].toLowerCase();

  if (/daily|every\s*day|every\s*morning|every\s*evening|every\s*night/.test(freq)) {
    return { type: 'daily', label: 'Daily' };
  }
  if (/weekly|every\s*week|once\s*a\s*week/.test(freq)) {
    return { type: 'weekly', label: 'Weekly' };
  }
  if (/monthly|every\s*month|once\s*a\s*month/.test(freq)) {
    return { type: 'monthly', label: 'Monthly' };
  }
  if (/twice\s*a\s*day/.test(freq)) {
    return { type: 'twice_daily', label: 'Twice daily' };
  }
  if (/twice\s*a\s*week/.test(freq)) {
    return { type: 'twice_weekly', label: 'Twice weekly' };
  }
  if (/three\s*times\s*a\s*week/.test(freq)) {
    return { type: 'three_weekly', label: '3x weekly' };
  }

  return { type: 'recurring', label: freq };
};

/**
 * Extract goals from entry text
 *
 * @param {string} text - Entry text to analyze
 * @returns {Object} Extraction result
 */
export const extractGoals = (text) => {
  if (!text || typeof text !== 'string') {
    return { goals: [], hasGoals: false };
  }

  const normalizedText = text.trim();

  // Check for negative patterns first
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(normalizedText)) {
      // Still extract but mark as tentative
      break;
    }
  }

  const extractedGoals = [];
  const seenGoals = new Set();

  for (const pattern of GOAL_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;

    let match;
    while ((match = pattern.regex.exec(normalizedText)) !== null) {
      const rawGoal = pattern.extract === 0 ? match[0] : match[pattern.extract];
      const cleanedGoal = cleanGoalText(rawGoal);

      if (cleanedGoal && !seenGoals.has(cleanedGoal.toLowerCase())) {
        seenGoals.add(cleanedGoal.toLowerCase());

        const goal = {
          text: cleanedGoal,
          type: pattern.type,
          confidence: 0.7 + (cleanedGoal.length > 10 ? 0.1 : 0),
          sourcePhrase: match[0].trim().substring(0, 80)
        };

        // Check for frequency modifier
        const frequency = detectFrequency(normalizedText);
        if (frequency) {
          goal.frequency = frequency;
          goal.type = 'recurring';
          goal.confidence += 0.1;
        }

        extractedGoals.push(goal);
      }
    }
  }

  // Sort by confidence
  extractedGoals.sort((a, b) => b.confidence - a.confidence);

  return {
    goals: extractedGoals,
    hasGoals: extractedGoals.length > 0,
    goalCount: extractedGoals.length
  };
};

/**
 * Check if text contains goal-like language
 * Quick check without full extraction
 *
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export const hasGoalIndicators = (text) => {
  if (!text || typeof text !== 'string') return false;

  const quickPatterns = [
    /\bi\s+(?:want|need|have)\s+to/i,
    /\bi(?:'m|'ll|\s+will|\s+am)\s+going\s+to/i,
    /\bmy\s+goal/i,
    /\bi\s+should\s+(?:start|stop)/i,
    /\bevery\s+(?:day|week|morning)/i,
    /\bdaily|weekly/i
  ];

  return quickPatterns.some(p => p.test(text));
};

/**
 * Categorize a goal for display
 *
 * @param {Object} goal - Extracted goal object
 * @returns {string} Category label
 */
export const categorizeGoal = (goal) => {
  switch (goal.type) {
    case 'aspiration':
      return 'Want to do';
    case 'habit_start':
      return 'Start doing';
    case 'habit_stop':
      return 'Stop doing';
    case 'commitment':
      return 'Committed to';
    case 'recurring':
      return goal.frequency?.label || 'Recurring';
    case 'frequency':
      return 'Recurring';
    default:
      return 'Goal';
  }
};

export default {
  extractGoals,
  hasGoalIndicators,
  categorizeGoal
};
