/**
 * Event Follow-Up Service (CBT Loop Closure)
 *
 * Closes the CBT loop by helping users reflect on whether their
 * anticipatory anxiety matched reality. This provides powerful
 * evidence against catastrophizing patterns.
 *
 * Key insight: "Your anxiety was 8/10 before, but after it was 4/10.
 * This shows your mind overestimated the threat."
 */

import { collection, query, where, getDocs, doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';

/**
 * Save a morning check-in for an upcoming event
 *
 * @param {string} userId
 * @param {Object} checkIn - Check-in data
 * @returns {Object} Saved check-in with ID
 */
export const saveMorningCheckIn = async (userId, checkIn) => {
  const checkInRef = doc(collection(db, `users/${userId}/anticipatory_checkins`));

  const checkInData = {
    id: checkInRef.id,
    eventId: checkIn.eventId,
    eventContent: checkIn.eventContent,
    eventTime: checkIn.eventTime,
    anxietyLevel: checkIn.anxietyLevel, // 1-10
    worstCaseThought: checkIn.worstCaseThought,
    bodyLocation: checkIn.bodyLocation, // Where they feel anxiety
    groundingToolUsed: checkIn.groundingToolUsed,
    groundingToolCompleted: checkIn.groundingToolCompleted,
    microCommitment: checkIn.microCommitment,
    reframeAttempted: checkIn.reframeAttempted,
    createdAt: new Date(),
    eveningReflectionCompleted: false
  };

  await setDoc(checkInRef, checkInData);

  return checkInData;
};

/**
 * Get morning check-in by ID
 */
export const getMorningCheckIn = async (userId, checkInId) => {
  const checkInRef = doc(db, `users/${userId}/anticipatory_checkins/${checkInId}`);
  const snapshot = await getDoc(checkInRef);

  if (!snapshot.exists()) return null;

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
};

/**
 * Get morning check-ins that need evening reflection
 *
 * Looks back 48 hours to catch cases where:
 * - User checked in yesterday but didn't open the app until today
 * - Event occurred late in the day and user forgot to reflect
 *
 * @param {string} userId
 * @returns {Array} Pending follow-ups
 */
export const checkForPendingFollowUps = async (userId) => {
  try {
    const now = new Date();
    // Look back 48 hours instead of just today
    const lookbackStart = new Date(now.getTime() - (48 * 60 * 60 * 1000));

    const checkInsRef = collection(db, `users/${userId}/anticipatory_checkins`);
    const checkInsQuery = query(
      checkInsRef,
      where('createdAt', '>=', lookbackStart),
      where('eveningReflectionCompleted', '==', false)
    );

    const snapshot = await getDocs(checkInsQuery);
    const checkIns = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      eventTime: doc.data().eventTime?.toDate?.() || new Date(doc.data().eventTime),
      createdAt: doc.data().createdAt?.toDate?.() || new Date(doc.data().createdAt)
    }));

    // Filter to only events that have already occurred
    // (at least 1 hour ago to give user time to decompress)
    const reflectionBuffer = new Date(now.getTime() - (60 * 60 * 1000)); // 1 hour ago
    const pendingFollowUps = checkIns.filter(checkIn => {
      const eventTime = checkIn.eventTime instanceof Date
        ? checkIn.eventTime
        : new Date(checkIn.eventTime);
      return eventTime < reflectionBuffer;
    });

    // Sort by how long ago the event occurred (most recent first)
    pendingFollowUps.sort((a, b) => {
      const aTime = a.eventTime instanceof Date ? a.eventTime : new Date(a.eventTime);
      const bTime = b.eventTime instanceof Date ? b.eventTime : new Date(b.eventTime);
      return bTime - aTime;
    });

    return pendingFollowUps.map(checkIn => {
      const eventTime = checkIn.eventTime instanceof Date
        ? checkIn.eventTime
        : new Date(checkIn.eventTime);
      const hoursSince = Math.floor((now - eventTime) / (1000 * 60 * 60));

      return {
        checkInId: checkIn.id,
        eventId: checkIn.eventId,
        eventDescription: checkIn.eventContent,
        anticipatedAnxiety: checkIn.anxietyLevel,
        worstCaseThought: checkIn.worstCaseThought,
        groundingToolUsed: checkIn.groundingToolUsed,
        groundingToolCompleted: checkIn.groundingToolCompleted,
        promptType: 'event_reflection',
        hoursSinceEvent: hoursSince,
        isStale: hoursSince > 24 // Mark if reflection is getting old
      };
    });
  } catch (error) {
    console.error('Failed to check for pending follow-ups:', error);
    return [];
  }
};

/**
 * Record evening reflection and compute CBT insight
 *
 * @param {string} userId
 * @param {string} checkInId
 * @param {Object} reflection - User's reflection data
 * @returns {Object} CBT insight generated
 */
export const recordEventReflection = async (userId, checkInId, reflection) => {
  const checkIn = await getMorningCheckIn(userId, checkInId);

  if (!checkIn) {
    throw new Error('Check-in not found');
  }

  // Calculate anxiety accuracy and generate insights
  const cbtInsight = generateCBTInsight(checkIn, reflection);

  // Update the check-in with reflection data
  const checkInRef = doc(db, `users/${userId}/anticipatory_checkins/${checkInId}`);
  await updateDoc(checkInRef, {
    eveningReflectionCompleted: true,
    reflection: {
      actualAnxiety: reflection.actualAnxiety,
      whatHappened: reflection.whatHappened,
      surprises: reflection.surprises,
      copingWorked: reflection.copingWorked,
      wouldDoAgain: reflection.wouldDoAgain,
      completedAt: new Date()
    },
    cbtInsight
  });

  // Store insight for pattern tracking
  await storeAnxietyAccuracyData(userId, checkIn, reflection, cbtInsight);

  return cbtInsight;
};

/**
 * Generate CBT insight from before/after comparison
 */
const generateCBTInsight = (checkIn, reflection) => {
  const beforeAnxiety = checkIn.anxietyLevel;
  const afterAnxiety = reflection.actualAnxiety;
  const anxietyDrop = beforeAnxiety - afterAnxiety;

  let insightType;
  let message;
  let futureReframe;
  let pattern;

  if (anxietyDrop >= 4) {
    // Significant overestimation - classic catastrophizing
    insightType = 'catastrophizing_evidence';
    pattern = 'strong_overestimate';
    message = `Your anxiety before "${checkIn.eventContent}" was ${beforeAnxiety}/10, but afterward it was only ${afterAnxiety}/10. This is strong evidence that your mind significantly overestimated the threat.`;
    futureReframe = `Next time you feel anxious about something similar, remember: you predicted ${beforeAnxiety}/10 fear, but reality was ${afterAnxiety}/10. Your predictions tend to be much worse than reality.`;
  } else if (anxietyDrop >= 2) {
    // Moderate overestimation
    insightType = 'mild_catastrophizing';
    pattern = 'moderate_overestimate';
    message = `Your anxiety dropped from ${beforeAnxiety}/10 to ${afterAnxiety}/10 after the event. The anticipation was harder than the reality.`;
    futureReframe = `The anticipation is often the worst part. When you notice similar anxiety building, remind yourself: "I've been here before, and it wasn't as bad as I expected."`;
  } else if (anxietyDrop < 0) {
    // It was worse than expected (rare but important to validate)
    insightType = 'validation';
    pattern = 'underestimate';
    message = `This one was genuinely tough - your anxiety increased from ${beforeAnxiety}/10 to ${afterAnxiety}/10. Your feelings were valid, and you got through it.`;
    futureReframe = `Sometimes difficult events are as hard as we fear. The fact that you faced it and came out the other side is an accomplishment.`;
  } else {
    // Roughly accurate prediction
    insightType = 'accurate_prediction';
    pattern = 'accurate';
    message = `Your prediction was pretty accurate - ${beforeAnxiety}/10 before and ${afterAnxiety}/10 after. You knew what you were getting into.`;
    futureReframe = `You have good insight into what challenges you. Trust that awareness going forward.`;
  }

  // Check if grounding tool helped
  let groundingInsight = null;
  if (checkIn.groundingToolCompleted && anxietyDrop >= 2) {
    groundingInsight = {
      message: `The ${checkIn.groundingToolUsed} exercise you did this morning may have helped you approach this with a calmer baseline.`,
      recommendation: `Consider using ${checkIn.groundingToolUsed} before similar events in the future.`
    };
  }

  // Check if worst-case thought came true
  let worstCaseReality = null;
  if (checkIn.worstCaseThought && reflection.whatHappened) {
    worstCaseReality = {
      feared: checkIn.worstCaseThought,
      actual: reflection.whatHappened,
      worstCaseHappened: afterAnxiety >= 8 // Proxy for "it was really bad"
    };
  }

  return {
    type: insightType,
    pattern,
    beforeAnxiety,
    afterAnxiety,
    anxietyDrop,
    message,
    futureReframe,
    groundingInsight,
    worstCaseReality,
    generatedAt: new Date().toISOString()
  };
};

/**
 * Store anxiety accuracy data for pattern tracking over time
 */
const storeAnxietyAccuracyData = async (userId, checkIn, reflection, insight) => {
  const dataRef = doc(collection(db, `users/${userId}/anxiety_accuracy`));

  await setDoc(dataRef, {
    eventType: categorizeEventType(checkIn.eventContent),
    predictedAnxiety: checkIn.anxietyLevel,
    actualAnxiety: reflection.actualAnxiety,
    accuracy: Math.abs(checkIn.anxietyLevel - reflection.actualAnxiety),
    pattern: insight.pattern,
    groundingToolUsed: checkIn.groundingToolUsed,
    groundingHelped: checkIn.groundingToolCompleted && insight.anxietyDrop >= 2,
    date: new Date()
  });
};

/**
 * Categorize event type for pattern analysis
 */
const categorizeEventType = (eventContent) => {
  const content = eventContent.toLowerCase();

  if (['interview', 'presentation', 'meeting', 'review', 'client'].some(k => content.includes(k))) {
    return 'professional';
  }
  if (['doctor', 'dentist', 'hospital', 'surgery', 'medical'].some(k => content.includes(k))) {
    return 'medical';
  }
  if (['date', 'party', 'wedding', 'family', 'parents'].some(k => content.includes(k))) {
    return 'social';
  }
  if (['exam', 'test', 'deadline', 'assignment'].some(k => content.includes(k))) {
    return 'academic';
  }
  if (['flight', 'travel', 'trip'].some(k => content.includes(k))) {
    return 'travel';
  }

  return 'other';
};

/**
 * Get anxiety accuracy patterns over time
 * Used to show users their prediction accuracy trends
 *
 * @param {string} userId
 * @param {number} days - Days to analyze
 * @returns {Object} Pattern analysis
 */
export const getAnxietyAccuracyPatterns = async (userId, days = 30) => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const accuracyRef = collection(db, `users/${userId}/anxiety_accuracy`);
    const accuracyQuery = query(
      accuracyRef,
      where('date', '>=', cutoff)
    );

    const snapshot = await getDocs(accuracyQuery);
    const records = snapshot.docs.map(doc => doc.data());

    if (records.length < 3) {
      return { available: false, reason: 'insufficient_data' };
    }

    // Calculate overall accuracy
    const avgOverestimate = records.reduce((sum, r) =>
      sum + (r.predictedAnxiety - r.actualAnxiety), 0) / records.length;

    // Count patterns
    const patterns = {
      strongOverestimate: records.filter(r => r.pattern === 'strong_overestimate').length,
      moderateOverestimate: records.filter(r => r.pattern === 'moderate_overestimate').length,
      accurate: records.filter(r => r.pattern === 'accurate').length,
      underestimate: records.filter(r => r.pattern === 'underestimate').length
    };

    // By event type
    const byEventType = {};
    for (const record of records) {
      if (!byEventType[record.eventType]) {
        byEventType[record.eventType] = { count: 0, totalOverestimate: 0 };
      }
      byEventType[record.eventType].count++;
      byEventType[record.eventType].totalOverestimate += (record.predictedAnxiety - record.actualAnxiety);
    }

    // Calculate average overestimate per event type
    for (const type of Object.keys(byEventType)) {
      byEventType[type].avgOverestimate = byEventType[type].totalOverestimate / byEventType[type].count;
    }

    // Find most catastrophized event type
    const mostCatastrophized = Object.entries(byEventType)
      .filter(([_, data]) => data.count >= 2)
      .sort((a, b) => b[1].avgOverestimate - a[1].avgOverestimate)[0];

    return {
      available: true,
      recordCount: records.length,
      avgOverestimate: Math.round(avgOverestimate * 10) / 10,
      patterns,
      byEventType,
      mostCatastrophized: mostCatastrophized ? {
        type: mostCatastrophized[0],
        avgOverestimate: Math.round(mostCatastrophized[1].avgOverestimate * 10) / 10
      } : null,
      insight: generatePatternInsight(avgOverestimate, patterns)
    };
  } catch (error) {
    console.error('Failed to get anxiety accuracy patterns:', error);
    return { available: false, error: error.message };
  }
};

/**
 * Generate insight from overall patterns
 */
const generatePatternInsight = (avgOverestimate, patterns) => {
  const totalEvents = Object.values(patterns).reduce((a, b) => a + b, 0);
  const overestimatePercent = Math.round(
    ((patterns.strongOverestimate + patterns.moderateOverestimate) / totalEvents) * 100
  );

  if (avgOverestimate >= 3) {
    return {
      type: 'chronic_catastrophizing',
      message: `On average, your anxiety predictions are ${avgOverestimate.toFixed(1)} points higher than reality. ${overestimatePercent}% of the time, things turn out better than you expect.`,
      actionable: 'When you notice anxiety rising, remind yourself of this pattern. Your brain is wired to overestimate threats.'
    };
  }

  if (avgOverestimate >= 1.5) {
    return {
      type: 'mild_overestimate',
      message: `You tend to slightly overestimate anxiety by about ${avgOverestimate.toFixed(1)} points. This is common and shows healthy caution.`,
      actionable: 'Your predictions are close to reality. Trust your assessment while remembering things usually aren\'t quite as bad.'
    };
  }

  return {
    type: 'accurate_predictor',
    message: `Your anxiety predictions are quite accurate. You have good insight into what challenges you.`,
    actionable: 'You can trust your gut feelings about what will be difficult.'
  };
};

export default {
  saveMorningCheckIn,
  getMorningCheckIn,
  checkForPendingFollowUps,
  recordEventReflection,
  getAnxietyAccuracyPatterns
};
