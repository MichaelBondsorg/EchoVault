/**
 * Future Event Monitor Service
 *
 * Monitors upcoming plan signals for stressful events.
 * Identifies events that may trigger anticipatory anxiety and
 * enables proactive support through grounding tools.
 *
 * Integration: Works with signal extraction system to find
 * plan signals with anxious/nervous sentiment.
 */

import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';

// Keywords that often indicate stressful events
const STRESSFUL_EVENT_KEYWORDS = [
  // Professional
  'interview', 'presentation', 'meeting with', 'performance review',
  'review', 'deadline', 'client meeting', 'pitch', 'demo',
  'first day', 'new job', 'confrontation', 'difficult conversation',
  'firing', 'layoff', 'negotiation', 'salary',

  // Medical
  'doctor', 'dentist', 'hospital', 'surgery', 'test results',
  'appointment', 'check-up', 'procedure', 'therapy session',

  // Personal
  'first date', 'meeting parents', 'wedding', 'funeral',
  'moving', 'court', 'hearing', 'test', 'exam', 'flight',
  'travel', 'public speaking', 'speech'
];

// Sentiment values that indicate anxiety
const ANXIOUS_SENTIMENTS = ['anxious', 'nervous', 'dreading', 'worried'];

/**
 * Get upcoming stressful events from plan signals
 *
 * @param {string} userId
 * @param {Object} options - { daysAhead: number }
 * @returns {Object} { today, upcoming, mostUrgent }
 */
export const getUpcomingStressfulEvents = async (userId, options = {}) => {
  const { daysAhead = 3 } = options;

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const futureLimit = new Date(today);
    futureLimit.setDate(futureLimit.getDate() + daysAhead);

    // Query plan signals for today through daysAhead
    const signalsRef = collection(db, `users/${userId}/signals`);
    const signalsQuery = query(
      signalsRef,
      where('type', '==', 'plan'),
      where('targetDate', '>=', today),
      where('targetDate', '<=', futureLimit),
      where('status', 'in', ['active', 'verified']),
      orderBy('targetDate', 'asc')
    );

    const snapshot = await getDocs(signalsQuery);
    const allPlans = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      targetDate: doc.data().targetDate?.toDate?.() || new Date(doc.data().targetDate)
    }));

    // Filter for stressful events
    const stressfulEvents = allPlans.filter(plan => isStressfulEvent(plan));

    // Separate today's events from upcoming
    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);

    const todayEvents = stressfulEvents.filter(e =>
      e.targetDate >= today && e.targetDate <= todayEnd
    );

    const upcomingEvents = stressfulEvents.filter(e =>
      e.targetDate > todayEnd
    );

    // Determine most urgent event
    const mostUrgent = todayEvents[0] || upcomingEvents[0] || null;

    return {
      today: todayEvents,
      upcoming: upcomingEvents,
      mostUrgent,
      totalCount: stressfulEvents.length,
      hasImmediateEvent: todayEvents.length > 0
    };
  } catch (error) {
    console.error('Failed to get upcoming stressful events:', error);
    return {
      today: [],
      upcoming: [],
      mostUrgent: null,
      totalCount: 0,
      hasImmediateEvent: false,
      error: error.message
    };
  }
};

/**
 * Check if a plan signal represents a stressful event
 */
const isStressfulEvent = (plan) => {
  const content = (plan.content || '').toLowerCase();
  const originalPhrase = (plan.originalPhrase || '').toLowerCase();

  // Check sentiment
  if (ANXIOUS_SENTIMENTS.includes(plan.sentiment)) {
    return true;
  }

  // Check keywords in content or original phrase
  const textToCheck = `${content} ${originalPhrase}`;
  return STRESSFUL_EVENT_KEYWORDS.some(keyword =>
    textToCheck.includes(keyword.toLowerCase())
  );
};

/**
 * Get the anxiety level for an event (1-10)
 * Based on sentiment and keyword intensity
 */
export const estimateAnxietyLevel = (event) => {
  let level = 5; // Default moderate

  // Adjust based on sentiment
  const sentimentScores = {
    dreading: 8,
    anxious: 7,
    nervous: 6,
    worried: 5,
    neutral: 4
  };
  level = sentimentScores[event.sentiment] || level;

  // Adjust based on keywords
  const content = (event.content || '').toLowerCase();

  // High-anxiety keywords
  if (['surgery', 'court', 'firing', 'layoff', 'funeral'].some(k => content.includes(k))) {
    level = Math.min(10, level + 2);
  }

  // Moderate-anxiety keywords
  if (['interview', 'presentation', 'exam', 'test results'].some(k => content.includes(k))) {
    level = Math.min(10, level + 1);
  }

  return level;
};

/**
 * Get appropriate grounding tool based on anxiety level and time available
 *
 * @param {number} anxietyLevel - 1-10
 * @param {number} minutesAvailable - Time until event
 * @returns {Object} Recommended grounding tool
 */
export const recommendGroundingTool = (anxietyLevel, minutesAvailable = 30) => {
  const tools = [
    {
      id: 'box_breathing',
      name: 'Box Breathing',
      duration: 3,
      anxietyRange: [1, 6],
      description: 'Calm your nervous system with 4-4-4-4 breathing'
    },
    {
      id: 'five_senses',
      name: '5-4-3-2-1 Grounding',
      duration: 5,
      anxietyRange: [4, 8],
      description: 'Connect to the present moment through your senses'
    },
    {
      id: 'body_scan',
      name: 'Quick Body Scan',
      duration: 5,
      anxietyRange: [3, 7],
      description: 'Notice and release tension in your body'
    },
    {
      id: 'progressive_muscle',
      name: 'Progressive Muscle Relaxation',
      duration: 10,
      anxietyRange: [6, 10],
      description: 'Systematically tense and release muscle groups'
    },
    {
      id: 'safe_place',
      name: 'Safe Place Visualization',
      duration: 7,
      anxietyRange: [5, 9],
      description: 'Visualize a place where you feel calm and safe'
    }
  ];

  // Filter by time available
  const timeFiltered = tools.filter(t => t.duration <= minutesAvailable);

  // Filter by anxiety level range
  const anxietyFiltered = timeFiltered.filter(t =>
    anxietyLevel >= t.anxietyRange[0] && anxietyLevel <= t.anxietyRange[1]
  );

  // Return best match or default
  if (anxietyFiltered.length > 0) {
    // For high anxiety, prefer more intensive tools
    if (anxietyLevel >= 7) {
      return anxietyFiltered.sort((a, b) => b.duration - a.duration)[0];
    }
    return anxietyFiltered[0];
  }

  // Fallback to box breathing (works for everything)
  return tools[0];
};

/**
 * Format event for display
 */
export const formatEventForDisplay = (event) => {
  const targetDate = event.targetDate instanceof Date
    ? event.targetDate
    : new Date(event.targetDate);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let dateLabel;
  if (targetDate >= today && targetDate < tomorrow) {
    dateLabel = 'Today';
  } else if (targetDate >= tomorrow && targetDate < new Date(tomorrow.getTime() + 86400000)) {
    dateLabel = 'Tomorrow';
  } else {
    dateLabel = targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  const timeLabel = targetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  return {
    ...event,
    dateLabel,
    timeLabel,
    anxietyLevel: estimateAnxietyLevel(event),
    recommendedTool: recommendGroundingTool(estimateAnxietyLevel(event))
  };
};

/**
 * Check if user should see anticipatory support
 * Called when app opens
 *
 * Uses a buffer window approach to handle midnight boundary edge cases.
 * Events within the next 18 hours are considered "imminent" regardless
 * of calendar day boundaries.
 */
export const shouldShowAnticipatorySupport = async (userId) => {
  const events = await getUpcomingStressfulEvents(userId, { daysAhead: 2 });

  // Use 18-hour window for "immediate" events to handle midnight edge case
  // (e.g., user journals at 11:55 PM for an 8 AM event tomorrow)
  const now = new Date();
  const imminentCutoff = new Date(now.getTime() + (18 * 60 * 60 * 1000)); // 18 hours

  const imminentEvents = [...events.today, ...events.upcoming].filter(event => {
    const eventTime = event.targetDate instanceof Date
      ? event.targetDate
      : new Date(event.targetDate);
    return eventTime <= imminentCutoff && eventTime > now;
  });

  const mostImminent = imminentEvents[0] || null;

  return {
    show: imminentEvents.length > 0,
    event: mostImminent ? formatEventForDisplay(mostImminent) : null,
    eventCount: imminentEvents.length,
    // Include traditional "today" count for backwards compatibility
    todayCount: events.today.length
  };
};

export default {
  getUpcomingStressfulEvents,
  estimateAnxietyLevel,
  recommendGroundingTool,
  formatEventForDisplay,
  shouldShowAnticipatorySupport,
  STRESSFUL_EVENT_KEYWORDS
};
