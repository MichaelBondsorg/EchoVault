/**
 * Leadership Threads Service
 *
 * Tracks longitudinal mentee/team member growth over time.
 * Links feedback conversations to follow-up mentions.
 *
 * Example: Gave Jason feedback in December -> Noticed his growth in February
 *
 * Thread Lifecycle:
 * 1. Feedback session detected -> Create thread
 * 2. Same person mentioned later -> Link as follow-up
 * 3. Progress indicators extracted -> Track growth
 * 4. User marks complete -> Archive thread
 */

import { db } from '../../config/firebase';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  arrayUnion,
  serverTimestamp
} from 'firebase/firestore';

const APP_COLLECTION_ID = 'echo-journal';

// Thread types
export const THREAD_TYPES = {
  GROWTH_TRACKING: 'growth_tracking',
  CONFLICT_RESOLUTION: 'conflict_resolution',
  MENTORSHIP: 'mentorship',
  ONBOARDING: 'onboarding'
};

// Progress indicator patterns
const PROGRESS_PATTERNS = [
  { pattern: /showed initiative/i, indicator: 'showed_initiative' },
  { pattern: /improved (their |his |her )?communication/i, indicator: 'improved_communication' },
  { pattern: /took ownership/i, indicator: 'took_ownership' },
  { pattern: /led (the |a )?meeting/i, indicator: 'led_meeting' },
  { pattern: /stepped up/i, indicator: 'stepped_up' },
  { pattern: /made progress/i, indicator: 'made_progress' },
  { pattern: /growing/i, indicator: 'growing' },
  { pattern: /more confident/i, indicator: 'more_confident' },
  { pattern: /handled.*well/i, indicator: 'handled_well' },
  { pattern: /impressed/i, indicator: 'impressed' },
  { pattern: /proud of/i, indicator: 'proud_of' },
  { pattern: /turned around/i, indicator: 'turned_around' }
];

// Concern patterns (for tracking regression)
const CONCERN_PATTERNS = [
  { pattern: /still struggling/i, indicator: 'still_struggling' },
  { pattern: /hasn't improved/i, indicator: 'no_improvement' },
  { pattern: /same issue/i, indicator: 'recurring_issue' },
  { pattern: /frustrated with/i, indicator: 'frustrated' },
  { pattern: /disappointed/i, indicator: 'disappointed' }
];

/**
 * Get leadership threads collection reference
 */
const getThreadsRef = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'leadership_threads');
};

/**
 * Extract progress indicators from entry text
 * @param {string} text - Entry text
 * @returns {Object} { positive: string[], concerns: string[] }
 */
export const extractProgressIndicators = (text) => {
  const positive = [];
  const concerns = [];

  for (const { pattern, indicator } of PROGRESS_PATTERNS) {
    if (pattern.test(text)) {
      positive.push(indicator);
    }
  }

  for (const { pattern, indicator } of CONCERN_PATTERNS) {
    if (pattern.test(text)) {
      concerns.push(indicator);
    }
  }

  return { positive, concerns };
};

/**
 * Extract feedback topics from entry text
 * @param {string} text - Entry text
 * @returns {Array} List of feedback topics
 */
export const extractFeedbackTopics = (text) => {
  const topics = [];
  const lowerText = text.toLowerCase();

  // Common feedback topic patterns
  const topicPatterns = [
    { pattern: /communication/i, topic: 'communication' },
    { pattern: /time management/i, topic: 'time_management' },
    { pattern: /ownership|accountability/i, topic: 'ownership' },
    { pattern: /collaboration|teamwork/i, topic: 'collaboration' },
    { pattern: /attention to detail/i, topic: 'attention_to_detail' },
    { pattern: /proactive|initiative/i, topic: 'initiative' },
    { pattern: /deadline|deliverables/i, topic: 'delivery' },
    { pattern: /code quality|technical/i, topic: 'technical_skills' },
    { pattern: /presentation|speaking/i, topic: 'presentation' },
    { pattern: /leadership|leading/i, topic: 'leadership' }
  ];

  for (const { pattern, topic } of topicPatterns) {
    if (pattern.test(lowerText)) {
      topics.push(topic);
    }
  }

  return topics;
};

/**
 * Generate a brief summary of the entry
 * @param {string} text - Entry text
 * @returns {string} Brief summary (max 200 chars)
 */
const generateSummary = (text) => {
  // Take first sentence or first 200 chars
  const firstSentence = text.split(/[.!?]/)[0];
  if (firstSentence.length <= 200) {
    return firstSentence.trim();
  }
  return text.slice(0, 197).trim() + '...';
};

/**
 * Create a new leadership thread
 *
 * @param {string} userId - User ID
 * @param {Object} entry - The entry that triggered thread creation
 * @param {Object} leadershipContext - Leadership context from detector
 * @returns {Object|null} Created thread or null
 */
export const createLeadershipThread = async (userId, entry, leadershipContext) => {
  // Only create threads for feedback sessions, 1:1s, or mentorship
  const threadableContexts = ['performance_review', 'one_on_one', 'mentorship', 'difficult_conversation'];
  const hasThreadableContext = leadershipContext.contexts?.some(ctx => threadableContexts.includes(ctx));

  if (!hasThreadableContext) {
    return null;
  }

  // Need at least one person mentioned
  const person = leadershipContext.mentionedPeople?.[0];
  if (!person) {
    return null;
  }

  // Determine thread type
  let threadType = THREAD_TYPES.GROWTH_TRACKING;
  if (leadershipContext.contexts?.includes('conflict_resolution')) {
    threadType = THREAD_TYPES.CONFLICT_RESOLUTION;
  } else if (leadershipContext.contexts?.includes('mentorship')) {
    threadType = THREAD_TYPES.MENTORSHIP;
  }

  const feedbackTopics = extractFeedbackTopics(entry.text || '');

  const thread = {
    person,
    threadType,
    status: 'active',
    initialEntry: {
      id: entry.id,
      date: entry.createdAt || new Date(),
      summary: generateSummary(entry.text || ''),
      feedbackGiven: feedbackTopics,
      contexts: leadershipContext.contexts
    },
    followUps: [],
    createdAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
    completedAt: null,
    completionNote: null
  };

  try {
    const threadsRef = getThreadsRef(userId);
    const docRef = await addDoc(threadsRef, thread);

    console.log(`Created leadership thread for ${person}: ${docRef.id}`);
    return { id: docRef.id, ...thread };
  } catch (error) {
    console.error('Failed to create leadership thread:', error);
    return null;
  }
};

/**
 * Get active threads for a specific person
 *
 * @param {string} userId - User ID
 * @param {string} personTag - @person:X tag
 * @returns {Array} Active threads for this person
 */
export const getActiveThreadsForPerson = async (userId, personTag) => {
  try {
    const threadsRef = getThreadsRef(userId);
    const q = query(
      threadsRef,
      where('person', '==', personTag),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(5)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Failed to get active threads:', error);
    return [];
  }
};

/**
 * Get all active threads for a user
 *
 * @param {string} userId - User ID
 * @returns {Array} All active leadership threads
 */
export const getAllActiveThreads = async (userId) => {
  try {
    const threadsRef = getThreadsRef(userId);
    const q = query(
      threadsRef,
      where('status', '==', 'active'),
      orderBy('lastUpdated', 'desc'),
      limit(20)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Failed to get active threads:', error);
    return [];
  }
};

/**
 * Link a follow-up mention to an existing thread
 *
 * @param {string} userId - User ID
 * @param {Object} entry - The new entry mentioning the person
 * @param {string} personTag - @person:X tag
 * @returns {Object|null} Thread context for AI, or null if no active thread
 */
export const linkFollowUpMention = async (userId, entry, personTag) => {
  const activeThreads = await getActiveThreadsForPerson(userId, personTag);

  if (activeThreads.length === 0) {
    return null;
  }

  // Use most recent active thread
  const thread = activeThreads[0];

  // Extract progress indicators
  const { positive, concerns } = extractProgressIndicators(entry.text || '');

  // Determine sentiment based on indicators
  let sentiment = 'neutral';
  if (positive.length > concerns.length) {
    sentiment = 'positive';
  } else if (concerns.length > positive.length) {
    sentiment = 'concerning';
  }

  const followUp = {
    entryId: entry.id,
    date: entry.createdAt || new Date(),
    sentiment,
    progressIndicators: positive,
    concernIndicators: concerns,
    summary: generateSummary(entry.text || '')
  };

  try {
    const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'leadership_threads', thread.id);
    await updateDoc(threadRef, {
      followUps: arrayUnion(followUp),
      lastUpdated: serverTimestamp()
    });

    // Calculate days since initial feedback
    const initialDate = thread.initialEntry?.date?.toDate?.() || new Date(thread.initialEntry?.date);
    const daysSinceInitial = Math.floor((new Date() - initialDate) / (1000 * 60 * 60 * 24));

    // Return context for AI/UI
    return {
      hasActiveThread: true,
      threadId: thread.id,
      person: personTag,
      threadType: thread.threadType,
      daysSinceFeedback: daysSinceInitial,
      originalFeedback: thread.initialEntry?.feedbackGiven || [],
      observedProgress: thread.followUps?.flatMap(f => f.progressIndicators || []) || [],
      totalFollowUps: (thread.followUps?.length || 0) + 1,
      latestSentiment: sentiment,
      // Suggestion for AI to surface
      reflectionPrompt: generateReflectionPrompt(thread, followUp, daysSinceInitial)
    };
  } catch (error) {
    console.error('Failed to link follow-up:', error);
    return null;
  }
};

/**
 * Generate a reflection prompt based on thread progress
 */
const generateReflectionPrompt = (thread, followUp, daysSince) => {
  const person = thread.person?.replace('@person:', '') || 'this person';
  const topics = thread.initialEntry?.feedbackGiven?.join(' and ') || 'their development';

  if (followUp.sentiment === 'positive' && followUp.progressIndicators.length > 0) {
    return `You gave ${person} feedback on ${topics} ${daysSince} days ago. Based on today's entry, it sounds like they're showing real growth. Consider acknowledging this in your next 1:1.`;
  } else if (followUp.sentiment === 'concerning') {
    return `You spoke with ${person} about ${topics} ${daysSince} days ago. Today's entry suggests there may still be challenges. Would a follow-up conversation be helpful?`;
  } else {
    return `It's been ${daysSince} days since your feedback session with ${person}. How do you feel their progress is going?`;
  }
};

/**
 * Complete (archive) a leadership thread
 *
 * @param {string} userId - User ID
 * @param {string} threadId - Thread ID
 * @param {string} completionNote - Optional note about completion
 */
export const completeThread = async (userId, threadId, completionNote = null) => {
  try {
    const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'leadership_threads', threadId);
    await updateDoc(threadRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      completionNote
    });

    console.log(`Completed leadership thread: ${threadId}`);
    return true;
  } catch (error) {
    console.error('Failed to complete thread:', error);
    return false;
  }
};

/**
 * Calculate thread health/progress score
 * @param {Object} thread - Leadership thread
 * @returns {Object} { score: 0-1, trend: 'improving'|'stable'|'concerning' }
 */
export const calculateThreadHealth = (thread) => {
  if (!thread.followUps || thread.followUps.length === 0) {
    return { score: 0.5, trend: 'stable', reason: 'No follow-ups yet' };
  }

  const totalPositive = thread.followUps.reduce((sum, f) => sum + (f.progressIndicators?.length || 0), 0);
  const totalConcerns = thread.followUps.reduce((sum, f) => sum + (f.concernIndicators?.length || 0), 0);

  const total = totalPositive + totalConcerns;
  if (total === 0) {
    return { score: 0.5, trend: 'stable', reason: 'No clear indicators' };
  }

  const score = totalPositive / total;

  // Check recent trend (last 3 follow-ups)
  const recent = thread.followUps.slice(-3);
  const recentSentiments = recent.map(f => f.sentiment);

  let trend = 'stable';
  if (recentSentiments.filter(s => s === 'positive').length >= 2) {
    trend = 'improving';
  } else if (recentSentiments.filter(s => s === 'concerning').length >= 2) {
    trend = 'concerning';
  }

  return { score, trend, reason: `${totalPositive} positive, ${totalConcerns} concerns across ${thread.followUps.length} check-ins` };
};

export default {
  THREAD_TYPES,
  createLeadershipThread,
  getActiveThreadsForPerson,
  getAllActiveThreads,
  linkFollowUpMention,
  completeThread,
  extractProgressIndicators,
  extractFeedbackTopics,
  calculateThreadHealth
};
