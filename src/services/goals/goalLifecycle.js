/**
 * Goal Lifecycle Service
 *
 * Manages the full lifecycle of goals from detection to completion/abandonment.
 * Fixes the "Ghost Goal" problem by treating goals as stateful entities.
 *
 * Goal States:
 * - proposed: AI detected goal, awaiting user confirmation
 * - active: User confirmed, currently pursuing
 * - achieved: User marked complete
 * - abandoned: User explicitly cancelled
 * - paused: Temporarily deprioritized
 */

import {
  SIGNAL_STATES,
  createSignalState,
  getSignalState,
  transitionSignalState,
  getActiveGoals,
  findSignalByTopic
} from '../signals/signalLifecycle';
import { callGemini } from '../ai/gemini';

// ============================================
// GOAL DETECTION PATTERNS
// ============================================

// Patterns that indicate goal intention
const GOAL_PATTERNS = [
  /I want to\s+(.+)/i,
  /I('m| am) going to\s+(.+)/i,
  /planning to\s+(.+)/i,
  /my goal is to\s+(.+)/i,
  /I('m| am) working on\s+(.+)/i,
  /trying to\s+(.+)/i,
  /hoping to\s+(.+)/i,
  /I need to\s+(.+)/i,
  /I should\s+(.+)/i
];

// Patterns that indicate goal termination
const TERMINATION_PATTERNS = [
  /I('m| am) (no longer|not) (interested in|pursuing|going after)/i,
  /decided (against|not to)/i,
  /giving up on/i,
  /moving on from/i,
  /that('s| is) (not|no longer) (a priority|important)/i,
  /changed my mind about/i,
  /I don't want to anymore/i,
  /not going to happen/i,
  /abandoning/i,
  /letting go of/i
];

// Patterns that indicate goal achievement
const ACHIEVEMENT_PATTERNS = [
  /I (did it|made it|got it|achieved|accomplished)/i,
  /finally\s+(.+)ed/i,
  /succeeded in/i,
  /completed/i,
  /finished/i,
  /reached my goal/i,
  /mission accomplished/i,
  /it happened/i,
  /got the (job|offer|promotion)/i
];

// Patterns that indicate progress
const PROGRESS_PATTERNS = [
  /making progress on/i,
  /step closer to/i,
  /working towards/i,
  /getting better at/i,
  /improving/i,
  /on track/i
];

// ============================================
// GOAL EXTRACTION
// ============================================

/**
 * Extract goal topic from text
 */
const extractGoalTopic = (text) => {
  // Try to extract @goal: tags first
  const goalTagMatch = text.match(/@goal:([a-z_]+)/i);
  if (goalTagMatch) {
    return goalTagMatch[1].replace(/_/g, ' ');
  }

  // Try pattern matching
  for (const pattern of GOAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      // Get the captured group (the goal description)
      const goalText = match[1] || match[2] || match[0];
      // Truncate and clean up
      return goalText
        .replace(/[.!?,;:].*$/, '') // Remove after punctuation
        .trim()
        .slice(0, 100); // Limit length
    }
  }

  return null;
};

/**
 * Detect if text contains termination language for a goal
 */
export const detectsTerminationLanguage = (text) => {
  return TERMINATION_PATTERNS.some(p => p.test(text));
};

/**
 * Detect if text contains achievement language
 */
export const detectsAchievementLanguage = (text) => {
  return ACHIEVEMENT_PATTERNS.some(p => p.test(text));
};

/**
 * Detect if text contains progress language
 */
export const detectsProgressLanguage = (text) => {
  return PROGRESS_PATTERNS.some(p => p.test(text));
};

/**
 * Use AI to classify goal update type
 */
const classifyGoalUpdateWithAI = async (entryText, existingGoal) => {
  const prompt = `Given this journal entry and an existing goal, classify the update type.

EXISTING GOAL: "${existingGoal.topic}"
Goal was created on: ${existingGoal.createdAt?.toDate?.()?.toLocaleDateString?.() || 'unknown'}

JOURNAL ENTRY:
"${entryText}"

Classify the relationship between this entry and the goal. Return ONLY one of these words:
- TERMINATION: User is abandoning or cancelling this goal
- ACHIEVEMENT: User has achieved or completed this goal
- PROGRESS: User is making progress on this goal
- MENTION: User mentions the goal but no status change
- UNRELATED: Entry is not about this goal

Response (one word only):`;

  try {
    const result = await callGemini(prompt, entryText);
    const classification = result?.trim()?.toUpperCase();

    if (['TERMINATION', 'ACHIEVEMENT', 'PROGRESS', 'MENTION', 'UNRELATED'].includes(classification)) {
      return classification.toLowerCase();
    }
  } catch (e) {
    console.error('AI goal classification failed:', e);
  }

  // Fallback to pattern matching
  if (detectsTerminationLanguage(entryText)) return 'termination';
  if (detectsAchievementLanguage(entryText)) return 'achievement';
  if (detectsProgressLanguage(entryText)) return 'progress';

  return 'mention';
};

// ============================================
// GOAL LIFECYCLE OPERATIONS
// ============================================

/**
 * Process an entry for goal signals
 * This is called after entry analysis to detect/update goals
 */
export const processEntryForGoals = async (userId, entry) => {
  const entryText = entry.text || '';
  const goalUpdate = entry.analysis?.extractEnhancedContext?.goal_update;
  const goalTag = entry.tags?.find(t => t.startsWith('@goal:'));

  // Method 1: Check if entry analysis already extracted goal_update
  if (goalUpdate) {
    return await handleExtractedGoalUpdate(userId, entry, goalUpdate);
  }

  // Method 2: Check for explicit @goal: tag
  if (goalTag) {
    const goalTopic = goalTag.replace('@goal:', '').replace(/_/g, ' ');
    return await handleGoalMention(userId, entry, goalTopic);
  }

  // Method 3: Pattern-based goal extraction
  const extractedTopic = extractGoalTopic(entryText);
  if (extractedTopic) {
    // Check if this relates to an existing goal
    const existingGoal = await findRelatedGoal(userId, extractedTopic);

    if (existingGoal) {
      return await handleGoalMention(userId, entry, existingGoal.topic, existingGoal);
    }

    // Check if this is a termination of something
    if (detectsTerminationLanguage(entryText)) {
      // Look for any goal that might be terminated
      const potentialGoal = await findGoalByKeywords(userId, extractedTopic);
      if (potentialGoal) {
        return await terminateGoal(userId, potentialGoal.id, entry.id, 'pattern_detected');
      }
    }

    // New goal detected - create in proposed state
    return await proposeNewGoal(userId, entry, extractedTopic);
  }

  // Method 4: Check if entry terminates any active goals
  if (detectsTerminationLanguage(entryText)) {
    const activeGoals = await getActiveGoals(userId);
    for (const goal of activeGoals) {
      // Check if entry text references this goal
      if (entryMentionsGoal(entryText, goal.topic)) {
        return await terminateGoal(userId, goal.id, entry.id, 'termination_language');
      }
    }
  }

  return null;
};

/**
 * Handle a goal_update from extractEnhancedContext
 */
const handleExtractedGoalUpdate = async (userId, entry, goalUpdate) => {
  const goalTopic = goalUpdate.tag?.replace('@goal:', '').replace(/_/g, ' ') || 'unknown';
  const status = goalUpdate.status;

  // Find existing goal
  const existingGoal = await findSignalByTopic(userId, 'goal', goalTopic);

  if (existingGoal) {
    // Update based on status
    switch (status) {
      case 'achieved':
        return await achieveGoal(userId, existingGoal.id, entry.id);
      case 'abandoned':
        return await terminateGoal(userId, existingGoal.id, entry.id, 'user_abandoned');
      case 'progress':
        return await recordGoalProgress(userId, existingGoal.id, entry.id);
      case 'struggling':
        return await recordGoalProgress(userId, existingGoal.id, entry.id, { struggling: true });
      default:
        return await recordGoalProgress(userId, existingGoal.id, entry.id);
    }
  } else if (status !== 'abandoned' && status !== 'achieved') {
    // New goal
    return await proposeNewGoal(userId, entry, goalTopic);
  }

  return null;
};

/**
 * Handle a mention of a goal topic
 */
const handleGoalMention = async (userId, entry, topic, existingGoal = null) => {
  const entryText = entry.text || '';

  // Find or use provided existing goal
  const goal = existingGoal || await findSignalByTopic(userId, 'goal', topic);

  if (!goal) {
    // New goal
    return await proposeNewGoal(userId, entry, topic);
  }

  // Determine update type
  if (detectsTerminationLanguage(entryText)) {
    return await terminateGoal(userId, goal.id, entry.id, 'termination_language');
  }

  if (detectsAchievementLanguage(entryText)) {
    return await achieveGoal(userId, goal.id, entry.id);
  }

  // Default to progress
  return await recordGoalProgress(userId, goal.id, entry.id);
};

/**
 * Propose a new goal (requires user confirmation)
 */
export const proposeNewGoal = async (userId, entry, topic) => {
  const goalState = await createSignalState(userId, {
    type: 'goal',
    topic: topic,
    initialState: SIGNAL_STATES.GOAL_PROPOSED,
    sourceEntries: [entry.id],
    context: { detectedFrom: entry.id },
    metadata: {
      originalText: entry.text?.slice(0, 500),
      detectedAt: new Date().toISOString()
    }
  });

  console.log(`Proposed new goal: "${topic}" from entry ${entry.id}`);
  return goalState;
};

/**
 * Confirm a proposed goal (user action)
 */
export const confirmGoal = async (userId, goalId) => {
  return await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_ACTIVE, {
    confirmedByUser: true,
    confirmedAt: new Date().toISOString()
  });
};

/**
 * Achieve a goal
 */
export const achieveGoal = async (userId, goalId, entryId) => {
  return await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_ACHIEVED, {
    achievementEntry: entryId,
    achievedAt: new Date().toISOString()
  });
};

/**
 * Terminate (abandon) a goal
 */
export const terminateGoal = async (userId, goalId, entryId, reason) => {
  return await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_ABANDONED, {
    terminationEntry: entryId,
    terminatedAt: new Date().toISOString(),
    reason: reason
  });
};

/**
 * Pause a goal
 */
export const pauseGoal = async (userId, goalId, reason = null) => {
  return await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_PAUSED, {
    pausedAt: new Date().toISOString(),
    reason: reason
  });
};

/**
 * Resume a paused goal
 */
export const resumeGoal = async (userId, goalId) => {
  return await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_ACTIVE, {
    resumedAt: new Date().toISOString()
  });
};

/**
 * Record progress on a goal
 */
export const recordGoalProgress = async (userId, goalId, entryId, metadata = {}) => {
  const goal = await getSignalState(userId, goalId);
  if (!goal) return null;

  // If goal is proposed, auto-confirm it (user is actively working on it)
  if (goal.state === SIGNAL_STATES.GOAL_PROPOSED) {
    await transitionSignalState(userId, goalId, SIGNAL_STATES.GOAL_ACTIVE, {
      autoConfirmed: true,
      confirmedVia: 'progress_entry'
    });
  }

  // Update sourceEntries to include this progress entry
  // Note: This is a simplified version - could be expanded to track all progress entries
  console.log(`Recorded progress on goal ${goalId} from entry ${entryId}`);

  return { goalId, entryId, ...metadata };
};

// ============================================
// GOAL LOOKUP
// ============================================

/**
 * Find a related goal by topic similarity
 */
const findRelatedGoal = async (userId, topic) => {
  const activeGoals = await getActiveGoals(userId);

  // Exact match first
  const exactMatch = activeGoals.find(g =>
    g.topic.toLowerCase() === topic.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Fuzzy match - check if topics share significant words
  const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  for (const goal of activeGoals) {
    const goalWords = goal.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const overlap = topicWords.filter(w => goalWords.includes(w));

    if (overlap.length >= Math.min(2, topicWords.length)) {
      return goal;
    }
  }

  return null;
};

/**
 * Find a goal by keywords in topic
 */
const findGoalByKeywords = async (userId, keywords) => {
  const activeGoals = await getActiveGoals(userId);
  const keywordList = keywords.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  for (const goal of activeGoals) {
    const goalText = goal.topic.toLowerCase();
    const matchCount = keywordList.filter(kw => goalText.includes(kw)).length;

    if (matchCount >= 1) {
      return goal;
    }
  }

  return null;
};

/**
 * Check if entry text mentions a goal
 */
const entryMentionsGoal = (entryText, goalTopic) => {
  const text = entryText.toLowerCase();
  const topic = goalTopic.toLowerCase();

  // Direct mention
  if (text.includes(topic)) return true;

  // Check key words
  const topicWords = topic.split(/\s+/).filter(w => w.length > 3);
  const matchCount = topicWords.filter(w => text.includes(w)).length;

  return matchCount >= Math.ceil(topicWords.length / 2);
};

// ============================================
// GOAL QUERIES
// ============================================

/**
 * Get all goals with their current states
 */
export const getAllGoalsWithState = async (userId) => {
  const { getAllSignalStates } = await import('../signals/signalLifecycle');
  return getAllSignalStates(userId, 'goal');
};

/**
 * Get goals that need user confirmation
 */
export const getProposedGoals = async (userId) => {
  const { getSignalStatesByState } = await import('../signals/signalLifecycle');
  return getSignalStatesByState(userId, 'goal', [SIGNAL_STATES.GOAL_PROPOSED]);
};

/**
 * Get goals with no recent activity (potential abandonment)
 */
export const getInactiveGoals = async (userId, daysSinceActivity = 14) => {
  const activeGoals = await getActiveGoals(userId);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysSinceActivity);

  return activeGoals.filter(goal => {
    const lastUpdate = goal.lastUpdated?.toDate?.() || new Date(0);
    return lastUpdate < cutoffDate;
  });
};

export default {
  processEntryForGoals,
  detectsTerminationLanguage,
  detectsAchievementLanguage,
  detectsProgressLanguage,
  proposeNewGoal,
  confirmGoal,
  achieveGoal,
  terminateGoal,
  pauseGoal,
  resumeGoal,
  recordGoalProgress,
  getAllGoalsWithState,
  getProposedGoals,
  getInactiveGoals
};
