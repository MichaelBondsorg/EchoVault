/**
 * Follow-up Service
 *
 * Provides morning check-ins and evening reflection prompts based on
 * signals that target the current day.
 *
 * Morning: "You mentioned having a doctor appointment today. How are you feeling about it?"
 * Evening: "How did your doctor appointment go?"
 */

import { getSignalsForDate, getFutureSignals } from '../signals';
import { formatDateKey } from '../scoring/dayScore';

/**
 * Get morning check-in prompts for today
 *
 * Returns signals that:
 * - Target today
 * - Are plans or events scheduled for today
 * - Haven't been followed up on yet
 *
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Check-in prompts
 */
export const getMorningCheckins = async (userId) => {
  const today = new Date();

  try {
    // Get signals targeting today
    const todaySignals = await getSignalsForDate(userId, today, true);

    // Filter to plans (things scheduled for today)
    const plans = todaySignals.filter(s =>
      s.type === 'plan' &&
      s.status !== 'dismissed'
    );

    // Build check-in prompts
    return plans.map(signal => ({
      signalId: signal.id,
      entryId: signal.entryId,
      type: 'morning_checkin',
      content: signal.content,
      sentiment: signal.sentiment,
      prompt: buildMorningPrompt(signal),
      originalPhrase: signal.originalPhrase
    }));
  } catch (error) {
    console.error('Failed to get morning check-ins:', error);
    return [];
  }
};

/**
 * Build a morning check-in prompt based on signal sentiment
 */
const buildMorningPrompt = (signal) => {
  const content = signal.content;

  switch (signal.sentiment) {
    case 'anxious':
    case 'dreading':
      return `You mentioned ${content} coming up. How are you feeling about it?`;
    case 'excited':
    case 'hopeful':
      return `Today's the day for ${content}! How's it going?`;
    case 'negative':
      return `You have ${content} today. How are you holding up?`;
    default:
      return `You have ${content} scheduled for today. How's it going?`;
  }
};

/**
 * Get evening reflection prompts for today
 *
 * Returns signals that:
 * - Target today
 * - Are plans that were scheduled for today
 * - Haven't been reflected on yet
 *
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Reflection prompts
 */
export const getEveningReflections = async (userId) => {
  const today = new Date();

  try {
    // Get signals targeting today
    const todaySignals = await getSignalsForDate(userId, today, true);

    // Filter to plans (things that were scheduled for today)
    const completedPlans = todaySignals.filter(s =>
      s.type === 'plan' &&
      s.status !== 'dismissed'
    );

    // Build reflection prompts
    return completedPlans.map(signal => ({
      signalId: signal.id,
      entryId: signal.entryId,
      type: 'evening_reflection',
      content: signal.content,
      sentiment: signal.sentiment,
      prompt: buildEveningPrompt(signal),
      allowSkip: true
    }));
  } catch (error) {
    console.error('Failed to get evening reflections:', error);
    return [];
  }
};

/**
 * Build an evening reflection prompt
 */
const buildEveningPrompt = (signal) => {
  const content = signal.content;
  return `How did ${content} go?`;
};

/**
 * Get upcoming plans for the next N days
 *
 * Useful for showing a "coming up" section in the dashboard
 *
 * @param {string} userId - User ID
 * @param {number} days - Number of days to look ahead (default 7)
 * @returns {Promise<Array>} Upcoming signals grouped by day
 */
export const getUpcomingPlans = async (userId, days = 7) => {
  try {
    const futureSignals = await getFutureSignals(userId);

    // Filter to plans only and within the next N days
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const upcoming = futureSignals.filter(s => {
      if (s.type !== 'plan') return false;
      if (s.status === 'dismissed') return false;

      const targetDate = s.targetDate instanceof Date
        ? s.targetDate
        : s.targetDate?.toDate?.() || new Date(s.targetDate);

      return targetDate <= endDate;
    });

    // Group by day
    const grouped = {};
    upcoming.forEach(signal => {
      const targetDate = signal.targetDate instanceof Date
        ? signal.targetDate
        : signal.targetDate?.toDate?.() || new Date(signal.targetDate);

      const dateKey = formatDateKey(targetDate);
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(signal);
    });

    return grouped;
  } catch (error) {
    console.error('Failed to get upcoming plans:', error);
    return {};
  }
};

/**
 * Get today's signal summary for dashboard display
 *
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Summary of today's signals
 */
export const getTodaySignalSummary = async (userId) => {
  const today = new Date();

  try {
    const todaySignals = await getSignalsForDate(userId, today, true);

    const plans = todaySignals.filter(s => s.type === 'plan' && s.status !== 'dismissed');
    const feelings = todaySignals.filter(s => s.type === 'feeling' && s.status !== 'dismissed');
    const events = todaySignals.filter(s => s.type === 'event' && s.status !== 'dismissed');
    const reflections = todaySignals.filter(s => s.type === 'reflection' && s.status !== 'dismissed');

    return {
      total: todaySignals.length,
      plans: plans.length,
      feelings: feelings.length,
      events: events.length,
      reflections: reflections.length,
      plansList: plans.map(p => p.content),
      hasUpcoming: plans.length > 0
    };
  } catch (error) {
    console.error('Failed to get today signal summary:', error);
    return {
      total: 0,
      plans: 0,
      feelings: 0,
      events: 0,
      reflections: 0,
      plansList: [],
      hasUpcoming: false
    };
  }
};

export default {
  getMorningCheckins,
  getEveningReflections,
  getUpcomingPlans,
  getTodaySignalSummary
};
