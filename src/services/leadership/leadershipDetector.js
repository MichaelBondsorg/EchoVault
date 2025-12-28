/**
 * Leadership Context Detection Service
 *
 * Detects management/leadership scenarios in journal entries.
 * Only activates for work-category entries to avoid false positives.
 *
 * Trigger Conditions:
 * 1. Entry must have category === 'work'
 * 2. Must match leadership keyword patterns
 * 3. Optionally: Must mention a person (@person:X tag)
 */

// Leadership context patterns - grouped by scenario type
export const LEADERSHIP_CONTEXTS = {
  performance_review: {
    keywords: ['performance review', 'feedback session', 'pip', 'annual review', 'quarterly review', 'review meeting'],
    emotionalLabor: 'high',
    suggestPostMortem: true
  },
  one_on_one: {
    keywords: ['1:1', 'one-on-one', '1 on 1', 'direct report', 'skip level', 'check-in with'],
    emotionalLabor: 'moderate',
    suggestPostMortem: false
  },
  conflict_resolution: {
    keywords: ['mediate', 'conflict between', 'team drama', 'tension between', 'intervene', 'defuse'],
    emotionalLabor: 'high',
    suggestPostMortem: true
  },
  delegation: {
    keywords: ['delegate', 'hand off', 'handoff', 'assign task', 'gave them the', 'asked them to take'],
    emotionalLabor: 'low',
    suggestPostMortem: false
  },
  difficult_conversation: {
    keywords: ['hard conversation', 'tough conversation', 'let go', 'termination', 'bad news', 'firing', 'laid off', 'layoff'],
    emotionalLabor: 'high',
    suggestPostMortem: true
  },
  mentorship: {
    keywords: ['mentor', 'coaching', 'career advice', 'growth conversation', 'developing', 'helping them grow'],
    emotionalLabor: 'moderate',
    suggestPostMortem: false
  },
  burnout_support: {
    keywords: ['their burnout', 'team stress', 'workload concern', 'overwhelmed team', 'supporting through'],
    emotionalLabor: 'high',
    suggestPostMortem: false
  },
  hiring: {
    keywords: ['interview', 'hiring', 'candidate', 'offer letter', 'recruiting', 'new hire'],
    emotionalLabor: 'moderate',
    suggestPostMortem: false
  },
  team_building: {
    keywords: ['team building', 'offsite', 'team morale', 'culture', 'team dynamic'],
    emotionalLabor: 'moderate',
    suggestPostMortem: false
  }
};

// Patterns indicating user is GIVING (not receiving) feedback
const GIVING_FEEDBACK_PATTERNS = [
  /i (gave|provided|delivered|shared) (feedback|review|assessment)/i,
  /told (him|her|them) (about|that)/i,
  /had to (tell|inform|let.*know)/i,
  /my (direct report|team member|mentee)/i,
  /coached (him|her|them)/i,
  /gave (him|her|them) (a|the) heads up/i,
  /as (a|their) manager/i,
  /managing (this|the) situation/i
];

// Patterns indicating user is RECEIVING (not giving)
const RECEIVING_FEEDBACK_PATTERNS = [
  /my (manager|boss|supervisor) (told|said|gave)/i,
  /i received feedback/i,
  /they told me/i,
  /got feedback from/i,
  /my review (was|went)/i
];

/**
 * Extract person mentions from entry
 * @param {Object} entry - Journal entry
 * @returns {Array} List of @person:X tags
 */
const extractPersonMentions = (entry) => {
  const tags = entry.tags || [];
  return tags.filter(t => t.startsWith('@person:'));
};

/**
 * Detect leadership direction (giving vs receiving)
 * @param {string} text - Entry text
 * @returns {'giving' | 'receiving' | 'ambiguous'}
 */
const detectDirection = (text) => {
  const isGiving = GIVING_FEEDBACK_PATTERNS.some(p => p.test(text));
  const isReceiving = RECEIVING_FEEDBACK_PATTERNS.some(p => p.test(text));

  if (isGiving && !isReceiving) return 'giving';
  if (isReceiving && !isGiving) return 'receiving';
  return 'ambiguous';
};

/**
 * Calculate emotional labor score based on detected contexts
 * @param {Array} contexts - Detected leadership contexts
 * @returns {number} 0-1 score
 */
const calculateEmotionalLabor = (contexts) => {
  if (contexts.length === 0) return 0;

  const laborMap = { high: 1, moderate: 0.6, low: 0.3 };
  const scores = contexts.map(ctx => laborMap[LEADERSHIP_CONTEXTS[ctx]?.emotionalLabor] || 0);

  // Return max score (most demanding context sets the tone)
  return Math.max(...scores);
};

/**
 * Detect leadership context in an entry
 *
 * @param {Object} entry - Journal entry with text, category, tags
 * @param {Object} options - Detection options
 * @param {boolean} options.requirePersonMention - Require @person:X tag for detection
 * @returns {Object} Leadership context detection result
 */
export const detectLeadershipContext = (entry, options = {}) => {
  const { requirePersonMention = false } = options;

  // CRITICAL: Only process work entries
  if (entry.category !== 'work') {
    return {
      isLeadershipEntry: false,
      reason: 'not_work_category'
    };
  }

  const text = (entry.text || '').toLowerCase();
  const mentionedPeople = extractPersonMentions(entry);

  // If requiring person mention, check first
  if (requirePersonMention && mentionedPeople.length === 0) {
    return {
      isLeadershipEntry: false,
      reason: 'no_person_mentioned'
    };
  }

  // Detect which contexts match
  const detectedContexts = [];

  for (const [contextType, config] of Object.entries(LEADERSHIP_CONTEXTS)) {
    const hasMatch = config.keywords.some(keyword => text.includes(keyword.toLowerCase()));
    if (hasMatch) {
      detectedContexts.push(contextType);
    }
  }

  // No leadership context detected
  if (detectedContexts.length === 0) {
    return {
      isLeadershipEntry: false,
      reason: 'no_leadership_keywords'
    };
  }

  // Check direction (giving vs receiving feedback)
  const direction = detectDirection(entry.text || '');

  // If user is receiving feedback, not giving, this isn't a leadership entry
  if (direction === 'receiving') {
    return {
      isLeadershipEntry: false,
      reason: 'receiving_not_giving',
      detectedContexts // Still return for debugging
    };
  }

  // Calculate emotional labor
  const emotionalLabor = calculateEmotionalLabor(detectedContexts);

  // Determine if post-mortem should be suggested
  const suggestPostMortem = detectedContexts.some(
    ctx => LEADERSHIP_CONTEXTS[ctx]?.suggestPostMortem && emotionalLabor >= 0.6
  );

  return {
    isLeadershipEntry: true,
    contexts: detectedContexts,
    primaryContext: detectedContexts[0],
    mentionedPeople,
    direction,
    emotionalLabor,
    emotionalLaborLevel: emotionalLabor >= 0.8 ? 'high' : emotionalLabor >= 0.5 ? 'moderate' : 'low',
    suggestPostMortem,
    // Metadata for tracking
    detectedAt: new Date().toISOString(),
    keywordsMatched: detectedContexts.length
  };
};

/**
 * Get human-readable label for a leadership context
 * @param {string} context - Context type key
 * @returns {string} Human-readable label
 */
export const getContextLabel = (context) => {
  const labels = {
    performance_review: 'Performance Review',
    one_on_one: '1:1 Meeting',
    conflict_resolution: 'Conflict Resolution',
    delegation: 'Delegation',
    difficult_conversation: 'Difficult Conversation',
    mentorship: 'Mentorship',
    burnout_support: 'Supporting Team Burnout',
    hiring: 'Hiring',
    team_building: 'Team Building'
  };
  return labels[context] || context;
};

/**
 * Get icon name for a leadership context (for UI)
 * @param {string} context - Context type key
 * @returns {string} Lucide icon name
 */
export const getContextIcon = (context) => {
  const icons = {
    performance_review: 'ClipboardCheck',
    one_on_one: 'Users',
    conflict_resolution: 'Scale',
    delegation: 'GitBranch',
    difficult_conversation: 'MessageCircle',
    mentorship: 'GraduationCap',
    burnout_support: 'Heart',
    hiring: 'UserPlus',
    team_building: 'Users'
  };
  return icons[context] || 'Briefcase';
};

export default {
  LEADERSHIP_CONTEXTS,
  detectLeadershipContext,
  getContextLabel,
  getContextIcon
};
