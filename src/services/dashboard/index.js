import { db, deleteDoc, doc } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getDateString, getISOYearWeek } from '../../utils/date';

/**
 * Get reference to dashboard cache document
 */
const getDashboardCacheRef = (userId, category, dateStr) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'dashboard_cache', `${category}_${dateStr}`);
};

/**
 * Get reference to weekly digest cache document
 */
const getWeeklyDigestRef = (userId, category, weekStr) => {
  return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'weekly_digest', `${category}_${weekStr}`);
};

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
