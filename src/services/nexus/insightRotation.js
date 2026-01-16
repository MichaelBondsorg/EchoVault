/**
 * Insight Rotation Service
 *
 * Manages the drip-feed of insights to prevent overwhelming users
 * after backfill operations that generate many new insights at once.
 *
 * Features:
 * - Scheduled reveal dates for backfilled insights
 * - Filters insights by visibility
 * - Sorts insights by confidence score before scheduling
 * - Daily reveal of 5-7 insights over 7 days
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const INSIGHTS_PER_DAY = 7;
const DRIP_FEED_DAYS = 7;

/**
 * Filter insights by their scheduled reveal date
 * Non-backfilled insights are always visible
 * Backfilled insights only visible after their scheduled reveal date
 *
 * @param {Array} insights - Array of insight objects
 * @returns {Array} Insights that should be visible now
 */
export const getVisibleInsights = (insights) => {
  if (!insights || !Array.isArray(insights)) return [];

  const now = new Date();

  return insights.filter(insight => {
    // Non-backfilled insights are always visible
    if (!insight.isBackfilled) return true;

    // Backfilled insights without scheduled date are visible
    if (!insight.scheduledRevealDate) return true;

    // Check if reveal date has passed
    const revealDate = insight.scheduledRevealDate?.toDate?.()
      || new Date(insight.scheduledRevealDate);

    return revealDate <= now;
  });
};

/**
 * Get count of pending (not yet revealed) insights
 * @param {Array} insights - Array of insight objects
 * @returns {Object} Counts of visible and pending insights
 */
export const getInsightCounts = (insights) => {
  if (!insights || !Array.isArray(insights)) {
    return { visible: 0, pending: 0, total: 0 };
  }

  const now = new Date();
  let visible = 0;
  let pending = 0;

  for (const insight of insights) {
    if (!insight.isBackfilled || !insight.scheduledRevealDate) {
      visible++;
      continue;
    }

    const revealDate = insight.scheduledRevealDate?.toDate?.()
      || new Date(insight.scheduledRevealDate);

    if (revealDate <= now) {
      visible++;
    } else {
      pending++;
    }
  }

  return { visible, pending, total: insights.length };
};

/**
 * Schedule reveal dates for backfilled insights
 * Spreads insights over DRIP_FEED_DAYS, revealing INSIGHTS_PER_DAY each day
 * Higher confidence insights are revealed first
 *
 * @param {Array} insights - Array of insight objects from backfill
 * @returns {Array} Insights with scheduledRevealDate set
 */
export const scheduleInsightReveals = (insights) => {
  if (!insights || !Array.isArray(insights)) return [];

  const now = new Date();

  // Sort by confidence score (higher confidence revealed first)
  const sortedInsights = [...insights].sort((a, b) => {
    const confA = a.confidenceScore || a.confidence || 0.5;
    const confB = b.confidenceScore || b.confidence || 0.5;
    return confB - confA;
  });

  return sortedInsights.map((insight, index) => {
    // Calculate which day this insight should be revealed
    const dayNumber = Math.floor(index / INSIGHTS_PER_DAY);
    const revealDate = new Date(now);
    revealDate.setDate(revealDate.getDate() + dayNumber);
    revealDate.setHours(8, 0, 0, 0); // Reveal at 8 AM local

    return {
      ...insight,
      isBackfilled: true,
      backfilledAt: now.toISOString(),
      scheduledRevealDate: revealDate.toISOString(),
      revealed: false
    };
  });
};

/**
 * Add date helper for scheduling
 * @param {Date} date - Base date
 * @param {number} days - Days to add
 * @returns {Date} New date
 */
const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

/**
 * Get the next reveal date and count
 * @param {Array} insights - Array of insight objects
 * @returns {Object|null} Next reveal info or null if none pending
 */
export const getNextRevealInfo = (insights) => {
  if (!insights || !Array.isArray(insights)) return null;

  const now = new Date();
  let nextRevealDate = null;
  let countForNextDate = 0;

  for (const insight of insights) {
    if (!insight.isBackfilled || !insight.scheduledRevealDate) continue;

    const revealDate = insight.scheduledRevealDate?.toDate?.()
      || new Date(insight.scheduledRevealDate);

    if (revealDate <= now) continue;

    // Check if this is the next reveal date
    if (!nextRevealDate || revealDate < nextRevealDate) {
      nextRevealDate = revealDate;
      countForNextDate = 1;
    } else if (revealDate.toDateString() === nextRevealDate.toDateString()) {
      countForNextDate++;
    }
  }

  if (!nextRevealDate) return null;

  return {
    date: nextRevealDate,
    count: countForNextDate,
    isToday: nextRevealDate.toDateString() === now.toDateString(),
    isTomorrow: nextRevealDate.toDateString() === addDays(now, 1).toDateString()
  };
};

/**
 * Mark insights as revealed (called when user views them)
 * @param {string} userId - User ID
 * @param {Array} insightIds - IDs of insights to mark as revealed
 */
export const markInsightsRevealed = async (userId, insightIds) => {
  if (!userId || !insightIds?.length) return;

  const insightRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
  );

  const insightDoc = await getDoc(insightRef);
  if (!insightDoc.exists()) return;

  const data = insightDoc.data();
  const insights = data.active || [];

  const updatedInsights = insights.map(insight => {
    if (insightIds.includes(insight.id)) {
      return { ...insight, revealed: true, revealedAt: Timestamp.now() };
    }
    return insight;
  });

  await setDoc(insightRef, {
    active: updatedInsights
  }, { merge: true });
};

/**
 * Get insights that should be newly revealed today
 * @param {Array} insights - Array of insight objects
 * @returns {Array} Insights being revealed today
 */
export const getTodaysNewInsights = (insights) => {
  if (!insights || !Array.isArray(insights)) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = addDays(today, 1);

  return insights.filter(insight => {
    if (!insight.isBackfilled || !insight.scheduledRevealDate) return false;
    if (insight.revealed) return false;

    const revealDate = insight.scheduledRevealDate?.toDate?.()
      || new Date(insight.scheduledRevealDate);

    return revealDate >= today && revealDate < tomorrow;
  });
};

/**
 * Check if user has pending reveals (for notification badge)
 * @param {string} userId - User ID
 * @returns {Object} Pending reveal info
 */
export const checkPendingReveals = async (userId) => {
  if (!userId) return { hasPending: false, count: 0 };

  try {
    const insightRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'insights'
    );

    const insightDoc = await getDoc(insightRef);
    if (!insightDoc.exists()) return { hasPending: false, count: 0 };

    const data = insightDoc.data();
    const insights = data.active || [];
    const counts = getInsightCounts(insights);

    return {
      hasPending: counts.pending > 0,
      count: counts.pending,
      visibleCount: counts.visible,
      totalCount: counts.total
    };
  } catch (error) {
    console.error('[InsightRotation] Failed to check pending reveals:', error);
    return { hasPending: false, count: 0 };
  }
};

export default {
  getVisibleInsights,
  getInsightCounts,
  scheduleInsightReveals,
  getNextRevealInfo,
  markInsightsRevealed,
  getTodaysNewInsights,
  checkPendingReveals
};
