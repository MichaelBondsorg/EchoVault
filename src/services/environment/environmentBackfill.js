/**
 * Environment Data Backfill Service
 *
 * Retroactively applies environment data to existing journal entries.
 *
 * LIMITATION: Historical weather requires past data from Open-Meteo.
 * We can backfill entries from the past 7 days reliably.
 * Older entries will be marked as "unavailable" but won't error.
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getDailyWeatherHistory } from './apis/weather';
import { Preferences } from '@capacitor/preferences';
import { collection, query, orderBy, limit, getDocs, doc, updateDoc } from 'firebase/firestore';

const LOCATION_CACHE_KEY = 'env_location_cache';

/**
 * Get entries that don't have environment context
 * @param {number} maxEntries - Maximum entries to fetch
 * @param {number} daysBack - How many days back to look (API limitation)
 * @returns {Array} Entries without environment context
 */
export const getEntriesWithoutEnvironment = async (maxEntries = 200, daysBack = 7) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const entriesRef = collection(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    user.uid,
    'entries'
  );

  const q = query(
    entriesRef,
    orderBy('createdAt', 'desc'),
    limit(maxEntries)
  );

  const snapshot = await getDocs(q);
  const entriesWithoutEnv = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const createdAt = data.createdAt?.toDate?.() || new Date(data.createdAt);

    // Only backfill recent entries (API limitation) and those without environment
    if (!data.environmentContext && createdAt >= cutoffDate) {
      entriesWithoutEnv.push({
        id: docSnap.id,
        createdAt,
        content: data.text?.substring(0, 50) + '...'
      });
    }
  });

  return entriesWithoutEnv;
};

/**
 * Get cached location for backfill
 */
const getCachedLocation = async () => {
  try {
    const { value } = await Preferences.get({ key: LOCATION_CACHE_KEY });
    if (!value) return null;

    const cached = JSON.parse(value);
    return {
      latitude: cached.latitude,
      longitude: cached.longitude
    };
  } catch {
    return null;
  }
};

/**
 * Fetch environment data for a specific date
 * @param {Date} date - The date to fetch environment for
 * @param {Object} location - { latitude, longitude }
 * @returns {Object|null} Environment context or null if unavailable
 */
const fetchEnvironmentForDate = async (date, location) => {
  try {
    if (!location) return null;

    const { latitude, longitude } = location;

    // Get weather history for the specific date
    const daysAgo = Math.ceil((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    const history = await getDailyWeatherHistory(latitude, longitude, daysAgo + 1);

    if (!history || history.length === 0) {
      return null;
    }

    // Find the day that matches our target date
    const dateStr = date.toISOString().split('T')[0];
    const dayData = history.find(d => d.date === dateStr);

    if (!dayData) {
      return null;
    }

    // Build environment context
    return {
      weather: dayData.condition,
      weatherLabel: dayData.conditionLabel,
      temperature: dayData.tempMax, // Use high temp as representative
      temperatureUnit: '°F',
      cloudCover: null, // Not available in daily history

      daySummary: {
        condition: dayData.condition,
        conditionLabel: dayData.conditionLabel,
        tempHigh: dayData.tempMax,
        tempLow: dayData.tempMin,
        sunshineMinutes: dayData.sunshineDuration,
        sunshinePercent: dayData.sunshinePercent,
        isLowSunshine: dayData.isLowLight
      },

      // Sun times not available in backfill
      sunsetTime: null,
      sunriseTime: null,
      daylightHours: dayData.daylightHours || null,

      isAfterDark: false, // Can't determine for historical entries
      lightContext: dayData.isLowLight ? 'low_light' : 'daylight',
      daylightRemaining: null,

      // Metadata
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: date.toISOString()
    };
  } catch (error) {
    console.warn(`Failed to fetch environment for ${date.toDateString()}:`, error);
    return null;
  }
};

/**
 * Update an entry with backfilled environment context
 */
const updateEntryEnvironment = async (entryId, environmentContext) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const entryRef = doc(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    user.uid,
    'entries',
    entryId
  );

  await updateDoc(entryRef, {
    environmentContext,
    updatedAt: new Date()
  });
};

/**
 * Main backfill function - processes entries and adds environment data
 * @param {Function} onProgress - Callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal to cancel
 * @returns {Object} Results summary
 */
export const backfillEnvironmentData = async (onProgress, signal) => {
  console.log('[EnvironmentBackfill] Starting backfill...');

  // Get cached location (we need this for weather API)
  const location = await getCachedLocation();
  if (!location) {
    console.log('[EnvironmentBackfill] No cached location available');
    return {
      total: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: 'No location available. Open the app with location enabled first.'
    };
  }

  // Get entries that need environment data
  const entries = await getEntriesWithoutEnvironment();
  console.log(`[EnvironmentBackfill] Found ${entries.length} entries without environment context`);

  if (entries.length === 0) {
    return {
      total: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    // Check for cancellation
    if (signal?.aborted) {
      console.log('[EnvironmentBackfill] Cancelled by user');
      break;
    }

    try {
      onProgress?.({
        total: entries.length,
        processed,
        updated,
        skipped,
        currentEntry: entry
      });

      const environmentContext = await fetchEnvironmentForDate(entry.createdAt, location);

      if (environmentContext) {
        await updateEntryEnvironment(entry.id, environmentContext);
        updated++;
        console.log(`[EnvironmentBackfill] Updated entry ${entry.id} (${entry.createdAt.toDateString()})`);
      } else {
        skipped++;
        console.log(`[EnvironmentBackfill] No environment data for ${entry.createdAt.toDateString()}`);
      }
    } catch (error) {
      console.error(`[EnvironmentBackfill] Failed to process entry ${entry.id}:`, error);
      failed++;
    }

    processed++;

    // Rate limiting for API
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  onProgress?.({
    total: entries.length,
    processed,
    updated,
    skipped,
    complete: true
  });

  console.log(`[EnvironmentBackfill] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);

  return {
    total: entries.length,
    processed,
    updated,
    skipped,
    failed
  };
};

/**
 * Get count of entries that need backfill
 */
export const getEnvironmentBackfillCount = async () => {
  try {
    const entries = await getEntriesWithoutEnvironment(500);
    return entries.length;
  } catch (error) {
    console.error('[EnvironmentBackfill] Failed to get backfill count:', error);
    return 0;
  }
};

export default {
  getEntriesWithoutEnvironment,
  backfillEnvironmentData,
  getEnvironmentBackfillCount
};
