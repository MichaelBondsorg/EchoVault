/**
 * Dashboard State Caching Service
 *
 * Handles caching of dashboard summaries and prompts in Firestore
 * to avoid regenerating on every page load.
 *
 * Cache structure: artifacts/{APP_COLLECTION_ID}/users/{uid}/dashboardCache/{date}
 */

import { db, doc, setDoc, Timestamp } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

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
