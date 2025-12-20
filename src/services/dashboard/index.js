/**
 * Dashboard State Caching Service
 *
 * Handles caching of dashboard summaries and prompts in Firestore
 * to avoid regenerating on every page load.
 *
 * Cache structure: artifacts/{APP_COLLECTION_ID}/users/{uid}/dashboardCache/{date}
 */

import { db, doc, setDoc, Timestamp, deleteDoc } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getDateString, getISOYearWeek } from '../../utils/date';

// For client-side imports (getDoc isn't re-exported from firebase.js)
import { getDoc } from 'firebase/firestore';

/**
 * Get today's date string in YYYY-MM-DD format (LOCAL timezone)
 * Important: Use local time to match user's "day" perspective
 */
export const getTodayDateString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get a date string in YYYY-MM-DD format (LOCAL timezone)
 */
export const getLocalDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Get the start of today as a Date object
 */
export const getTodayStart = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
};

/**
 * Check if we've crossed midnight since the given timestamp
 */
export const hasCrossedMidnight = (lastTimestamp) => {
  if (!lastTimestamp) return true;

  const lastDate = lastTimestamp instanceof Date
    ? lastTimestamp
    : lastTimestamp.toDate?.() || new Date(lastTimestamp);

  const todayStart = getTodayStart();
  return lastDate < todayStart;
};

/**
 * Get the dashboard cache document reference
 */
const getDashboardCacheRef = (userId, category, dateString = null) => {
  const date = dateString || getTodayDateString();
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'dashboardCache', `${date}_${category}`);
};

/**
 * Get reference to weekly digest cache document
 */
const getWeeklyDigestRef = (userId, category, weekStr) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'weekly_digest', `${category}_${weekStr}`);
};

/**
 * Load cached dashboard state from Firestore
 * Returns null if no cache exists or cache is stale
 *
 * @param {string} userId - User ID
 * @param {string} category - 'personal' or 'work'
 * @param {number} currentEntryCount - Current count of today's entries
 * @param {number} latestEntryTimestamp - Timestamp of most recently modified entry (optional)
 */
export const loadDashboardCache = async (userId, category, currentEntryCount, latestEntryTimestamp = null) => {
  try {
    const cacheRef = getDashboardCacheRef(userId, category);
    const cacheSnap = await getDoc(cacheRef);

    if (!cacheSnap.exists()) {
      return null;
    }

    const cache = cacheSnap.data();

    // Check if cache is stale (entry count changed)
    if (cache.entryCount !== currentEntryCount) {
      console.log('Dashboard cache stale - entry count changed');
      return null;
    }

    // Check if any entry was modified after the cache was saved
    // This catches edits to existing entries
    if (latestEntryTimestamp && cache.lastUpdated) {
      const cacheTime = cache.lastUpdated instanceof Date
        ? cache.lastUpdated.getTime()
        : cache.lastUpdated.toDate?.()?.getTime() || 0;

      if (latestEntryTimestamp > cacheTime) {
        console.log('Dashboard cache stale - entry modified after cache');
        return null;
      }
    }

    // Check if cache has crossed midnight
    if (hasCrossedMidnight(cache.lastUpdated)) {
      console.log('Dashboard cache stale - crossed midnight');
      return null;
    }

    console.log('Dashboard cache hit');
    return {
      summary: cache.summary || null,
      prompts: cache.prompts || [],
      lastUpdated: cache.lastUpdated
    };
  } catch (e) {
    console.error('Failed to load dashboard cache:', e);
    return null;
  }
};

/**
 * Save dashboard state to Firestore cache
 */
export const saveDashboardCache = async (userId, category, data) => {
  try {
    const cacheRef = getDashboardCacheRef(userId, category);

    await setDoc(cacheRef, {
      summary: data.summary || null,
      prompts: data.prompts || [],
      entryCount: data.entryCount,
      lastUpdated: Timestamp.now(),
      version: 1 // For future schema migrations
    });

    console.log('Dashboard cache saved');
  } catch (e) {
    console.error('Failed to save dashboard cache:', e);
  }
};

/**
 * Get incomplete action items from a summary to carry forward
 */
export const getCarryForwardItems = (summary) => {
  if (!summary?.action_items) return [];

  const items = [];

  // Combine today's items and already carried items
  if (summary.action_items.today) {
    items.push(...summary.action_items.today);
  }
  if (summary.action_items.carried_forward) {
    items.push(...summary.action_items.carried_forward);
  }

  return items;
};

/**
 * Load yesterday's incomplete action items
 */
export const loadYesterdayCarryForward = async (userId, category) => {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = getLocalDateString(yesterday);

    const cacheRef = getDashboardCacheRef(userId, category, yesterdayString);
    const cacheSnap = await getDoc(cacheRef);

    if (!cacheSnap.exists()) {
      return [];
    }

    const cache = cacheSnap.data();
    return getCarryForwardItems(cache.summary);
  } catch (e) {
    console.error('Failed to load yesterday carry-forward items:', e);
    return [];
  }
};

/**
 * Hook-friendly time until midnight calculator
 * Returns milliseconds until next midnight
 */
export const getMillisecondsUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  return midnight - now;
};

/**
 * Complete an action item by removing it from the cached summary
 * @param {string} userId - User ID
 * @param {string} category - 'personal' or 'work'
 * @param {string} source - 'today', 'carried_forward', or 'suggested'
 * @param {number} index - Index of the item in the source array
 * @returns {object|null} Updated summary or null on failure
 */
export const completeActionItem = async (userId, category, source, index) => {
  try {
    const cacheRef = getDashboardCacheRef(userId, category);
    const cacheSnap = await getDoc(cacheRef);

    if (!cacheSnap.exists()) {
      console.log('No dashboard cache to update');
      return null;
    }

    const cache = cacheSnap.data();
    const summary = cache.summary;

    if (!summary?.action_items?.[source]) {
      console.log('No action items found for source:', source);
      return null;
    }

    // Remove the item at the given index
    const updatedItems = [...summary.action_items[source]];
    updatedItems.splice(index, 1);

    // Update the summary
    const updatedSummary = {
      ...summary,
      action_items: {
        ...summary.action_items,
        [source]: updatedItems
      }
    };

    // Save back to cache
    await setDoc(cacheRef, {
      ...cache,
      summary: updatedSummary,
      lastUpdated: Timestamp.now()
    });

    console.log('Action item completed and removed from cache');
    return updatedSummary;
  } catch (e) {
    console.error('Failed to complete action item:', e);
    return null;
  }
};

/**
 * Complete a task and add it as a Win
 *
 * Per spec: "A Win is a memory; a Task is a chore. Treat them as separate data points."
 *
 * Flow:
 * 1. Remove task from action_items[source]
 * 2. Add task text to wins.items array
 * 3. Persist updated summary to cache
 *
 * @param {string} userId - User ID
 * @param {string} category - 'personal' or 'work'
 * @param {object|string} task - The task being completed
 * @param {string} source - 'today', 'carried_forward', or 'suggested'
 * @param {number} index - Index of the item in the source array
 * @returns {object|null} Updated summary or null on failure
 */
export const completeTaskAsWin = async (userId, category, task, source, index) => {
  try {
    const cacheRef = getDashboardCacheRef(userId, category);
    const cacheSnap = await getDoc(cacheRef);

    if (!cacheSnap.exists()) {
      console.log('No dashboard cache to update');
      return null;
    }

    const cache = cacheSnap.data();
    const summary = cache.summary;

    if (!summary) {
      console.log('No summary in cache');
      return null;
    }

    // Get task text
    const taskText = typeof task === 'string' ? task : task.text || String(task);

    // Remove from action items
    const updatedActionItems = { ...summary.action_items };
    if (updatedActionItems[source]) {
      const items = [...updatedActionItems[source]];
      items.splice(index, 1);
      updatedActionItems[source] = items;
    }

    // Add to wins
    const currentWins = summary.wins || { items: [], tone: 'acknowledging' };
    const updatedWins = {
      ...currentWins,
      items: [...(currentWins.items || []), taskText]
    };

    // Build updated summary
    const updatedSummary = {
      ...summary,
      action_items: updatedActionItems,
      wins: updatedWins
    };

    // Save back to cache
    await setDoc(cacheRef, {
      ...cache,
      summary: updatedSummary,
      lastUpdated: Timestamp.now()
    });

    console.log('Task completed and added to wins:', taskText);
    return updatedSummary;
  } catch (e) {
    console.error('Failed to complete task as win:', e);
    return null;
  }
};

// ============================================================================
// Date Change Cache Invalidation
// ============================================================================

/**
 * Invalidate daily summary cache for a specific date
 */
export const invalidateDailySummary = async (userId, category, date) => {
  try {
    const dateStr = getDateString(date);
    const cacheRef = getDashboardCacheRef(userId, category, dateStr);
    await deleteDoc(cacheRef);
    console.log(`Invalidated daily summary cache for ${category}/${dateStr}`);
  } catch (error) {
    // Cache document might not exist, which is fine
    console.log(`No cache to invalidate for date: ${getDateString(date)}`);
  }
};

/**
 * Invalidate weekly digest cache for a specific week
 */
export const invalidateWeeklyDigest = async (userId, category, date) => {
  try {
    const weekStr = getISOYearWeek(date);
    const digestRef = getWeeklyDigestRef(userId, category, weekStr);
    await deleteDoc(digestRef);
    console.log(`Invalidated weekly digest cache for ${category}/${weekStr}`);
  } catch (error) {
    // Cache document might not exist, which is fine
    console.log(`No weekly digest to invalidate for week: ${getISOYearWeek(date)}`);
  }
};

/**
 * Handle entry date change - invalidates all affected caches
 * This is the main function to call when an entry's date is changed
 *
 * @param {string} userId - The user's ID
 * @param {string} entryId - The entry ID (for reference)
 * @param {Date} oldDate - The original date of the entry
 * @param {Date} newDate - The new date of the entry
 * @param {string} category - The entry's category (personal/work)
 */
export const handleEntryDateChange = async (userId, entryId, oldDate, newDate, category) => {
  const oldDateStr = getDateString(oldDate);
  const newDateStr = getDateString(newDate);
  const oldWeek = getISOYearWeek(oldDate);
  const newWeek = getISOYearWeek(newDate);

  console.log(`Handling date change for entry ${entryId}: ${oldDateStr} -> ${newDateStr}`);

  // Invalidate daily summaries for both dates
  await Promise.all([
    invalidateDailySummary(userId, category, oldDate),
    invalidateDailySummary(userId, category, newDate)
  ]);

  // Invalidate weekly digests if the week changed
  if (oldWeek !== newWeek) {
    console.log(`Entry moved to different week: ${oldWeek} -> ${newWeek}`);
    await Promise.all([
      invalidateWeeklyDigest(userId, category, oldDate),
      invalidateWeeklyDigest(userId, category, newDate)
    ]);
  }

  // Return information for potential streak recalculation
  return {
    oldDate: oldDateStr,
    newDate: newDateStr,
    weekChanged: oldWeek !== newWeek,
    oldWeek,
    newWeek
  };
};

/**
 * Calculate streak for a user based on entry dates
 * A streak is defined as consecutive days with at least one entry
 *
 * @param {Array} entries - Array of entries with effectiveDate or createdAt
 * @returns {Object} - { currentStreak, longestStreak, lastEntryDate }
 */
export const calculateStreak = (entries) => {
  if (!entries || entries.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastEntryDate: null };
  }

  // Get unique dates (using effectiveDate if available, otherwise createdAt)
  const dates = [...new Set(entries.map(e => {
    const date = e.effectiveDate || e.createdAt;
    return getDateString(date);
  }))].sort().reverse(); // Sort descending (most recent first)

  if (dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastEntryDate: null };
  }

  const today = getDateString(new Date());
  const yesterday = getDateString(new Date(Date.now() - 86400000));

  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 1;

  // Check if most recent entry is today or yesterday to count towards current streak
  const mostRecentDate = dates[0];
  const streakActive = mostRecentDate === today || mostRecentDate === yesterday;

  // Calculate streaks
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      tempStreak = 1;
    } else {
      const prevDate = new Date(dates[i - 1]);
      const currDate = new Date(dates[i]);
      const diffDays = Math.round((prevDate - currDate) / 86400000);

      if (diffDays === 1) {
        tempStreak++;
      } else {
        // Streak broken, update longest if needed
        if (tempStreak > longestStreak) {
          longestStreak = tempStreak;
        }

        // If this is the first streak (from most recent date), save as current
        if (i <= tempStreak && streakActive) {
          currentStreak = tempStreak;
        }

        tempStreak = 1;
      }
    }
  }

  // Final check for the last streak
  if (tempStreak > longestStreak) {
    longestStreak = tempStreak;
  }

  // Set current streak if active and not already set
  if (streakActive && currentStreak === 0) {
    currentStreak = tempStreak;
  }

  return {
    currentStreak,
    longestStreak,
    lastEntryDate: mostRecentDate
  };
};
