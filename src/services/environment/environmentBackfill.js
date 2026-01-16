/**
 * Environment Data Backfill Service
 *
 * Retroactively applies environment data to existing journal entries.
 *
 * IMPORTANT: Only backfills entries that have their own location metadata.
 * Does NOT use current device location - that would create dirty data
 * (user may have been in a different location when the entry was created).
 *
 * Features:
 * - Location requirement: Only backfills if entry has location metadata
 * - Weather caching: Avoids redundant API calls for same day/location
 * - Batched writes: Uses Firestore batched writes for performance
 *
 * LIMITATION: Historical weather requires past data from Open-Meteo.
 * We can backfill entries from the past 7 days reliably.
 * Older entries will be marked as "unavailable" but won't error.
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getDailyWeatherHistory } from './apis/weather';
import { collection, query, orderBy, limit, getDocs, doc, writeBatch } from 'firebase/firestore';

// Weather cache by date + location (approximate city)
// Key format: "2026-01-15|37.8|-122.4" (date|lat|lng rounded to ~10km)
const weatherCache = new Map();
const BATCH_SIZE = 500;

/**
 * Get cache key for weather data
 * Rounds lat/lng to ~10km precision to group nearby locations
 */
const getCacheKey = (date, lat, lng) => {
  const dateStr = date.toISOString().split('T')[0];
  const latRounded = Math.round(lat * 10) / 10;
  const lngRounded = Math.round(lng * 10) / 10;
  return `${dateStr}|${latRounded}|${lngRounded}`;
};

/**
 * Get entries that don't have environment context
 * Now includes location metadata for proper backfill
 *
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
      // Include location metadata if available
      // Location can be on the entry itself or in existing partial environmentContext
      const location = data.location || data.environmentContext?.location || null;

      entriesWithoutEnv.push({
        id: docSnap.id,
        createdAt,
        content: data.text?.substring(0, 50) + '...',
        location // May be null - will be checked during backfill
      });
    }
  });

  return entriesWithoutEnv;
};

/**
 * Fetch environment data for a specific entry
 * CRITICAL: Only backfills if entry has its own location metadata
 * Does NOT use current device location - that creates dirty data
 *
 * @param {Object} entry - Entry with createdAt and optional location
 * @returns {Object|null} Environment context or null if unavailable
 */
const fetchEnvironmentForEntry = async (entry) => {
  // CRITICAL: Only backfill if entry has its own location metadata
  // Do NOT use current device location - that creates dirty data
  const entryLocation = entry.location;

  if (!entryLocation?.latitude || !entryLocation?.longitude) {
    console.log(`[EnvironmentBackfill] Skipping entry ${entry.id} - no location metadata`);
    return { skipped: true, reason: 'no_location' };
  }

  const { latitude, longitude } = entryLocation;
  const entryDate = entry.createdAt;

  // Check cache first (avoid redundant API calls for same day/location)
  const cacheKey = getCacheKey(entryDate, latitude, longitude);
  if (weatherCache.has(cacheKey)) {
    console.log(`[EnvironmentBackfill] Cache hit for ${cacheKey}`);
    const cachedData = weatherCache.get(cacheKey);
    return {
      ...cachedData,
      location: entryLocation, // Use entry's original location
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: entryDate.toISOString()
    };
  }

  // Check 7-day API limit
  const daysAgo = Math.ceil((Date.now() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysAgo > 7) {
    console.log(`[EnvironmentBackfill] Entry ${entry.id} is ${daysAgo} days old - outside API limit`);
    return { skipped: true, reason: 'too_old' };
  }

  try {
    // Get weather history for the specific date
    const history = await getDailyWeatherHistory(latitude, longitude, daysAgo + 1);

    if (!history || history.length === 0) {
      return null;
    }

    // Find the day that matches our target date
    const dateStr = entryDate.toISOString().split('T')[0];
    const dayData = history.find(d => d.date === dateStr);

    if (!dayData) {
      return null;
    }

    // Build environment context
    const environmentContext = {
      weather: dayData.condition,
      weatherLabel: dayData.conditionLabel,
      temperature: dayData.tempMax,
      temperatureUnit: '°F',
      cloudCover: null,

      daySummary: {
        condition: dayData.condition,
        conditionLabel: dayData.conditionLabel,
        tempHigh: dayData.tempMax,
        tempLow: dayData.tempMin,
        sunshineMinutes: dayData.sunshineDuration,
        sunshinePercent: dayData.sunshinePercent,
        isLowSunshine: dayData.isLowLight
      },

      sunsetTime: null,
      sunriseTime: null,
      daylightHours: dayData.daylightHours || null,

      isAfterDark: false,
      lightContext: dayData.isLowLight ? 'low_light' : 'daylight',
      daylightRemaining: null,

      // Preserve original location
      location: entryLocation,

      // Metadata
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: entryDate.toISOString()
    };

    // Cache for other entries on same day/location
    weatherCache.set(cacheKey, {
      weather: environmentContext.weather,
      weatherLabel: environmentContext.weatherLabel,
      temperature: environmentContext.temperature,
      temperatureUnit: environmentContext.temperatureUnit,
      daySummary: environmentContext.daySummary,
      daylightHours: environmentContext.daylightHours,
      lightContext: environmentContext.lightContext
    });

    return environmentContext;
  } catch (error) {
    console.warn(`Failed to fetch environment for ${entryDate.toDateString()}:`, error);
    return null;
  }
};

/**
 * Batch update entries with environment context using Firestore batched writes
 * @param {Array} updates - Array of { entryId, environmentContext }
 * @returns {Object} Result with count of updates
 */
const batchUpdateEnvironmentContext = async (updates) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const batches = [];
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batchUpdates = updates.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const { entryId, environmentContext } of batchUpdates) {
      const entryRef = doc(
        db,
        'artifacts',
        APP_COLLECTION_ID,
        'users',
        user.uid,
        'entries',
        entryId
      );
      batch.update(entryRef, {
        environmentContext,
        updatedAt: new Date()
      });
    }

    batches.push(batch);
  }

  console.log(`[EnvironmentBackfill] Executing ${batches.length} batches (${updates.length} total updates)`);

  for (let i = 0; i < batches.length; i++) {
    await batches[i].commit();
    console.log(`[EnvironmentBackfill] Batch ${i + 1}/${batches.length} committed`);
  }

  return { success: true, updated: updates.length };
};

/**
 * Main backfill function - processes entries and adds environment data
 *
 * IMPORTANT: Only backfills entries that have their own location metadata.
 * Does NOT use current device location - that would create dirty data.
 *
 * @param {Function} onProgress - Callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal to cancel
 * @returns {Object} Results summary
 */
export const backfillEnvironmentData = async (onProgress, signal) => {
  console.log('[EnvironmentBackfill] Starting backfill...');

  // Clear weather cache for fresh run
  weatherCache.clear();

  // Get entries that need environment data
  const entries = await getEntriesWithoutEnvironment();
  console.log(`[EnvironmentBackfill] Found ${entries.length} entries without environment context`);

  if (entries.length === 0) {
    return {
      total: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      skippedNoLocation: 0,
      skippedTooOld: 0,
      failed: 0
    };
  }

  let processed = 0;
  let skipped = 0;
  let skippedNoLocation = 0;
  let skippedTooOld = 0;
  let failed = 0;
  const pendingUpdates = [];

  // Phase 1: Collect environment data for entries that have location
  for (const entry of entries) {
    if (signal?.aborted) {
      console.log('[EnvironmentBackfill] Cancelled by user');
      break;
    }

    try {
      onProgress?.({
        total: entries.length,
        processed,
        updated: pendingUpdates.length,
        skipped,
        skippedNoLocation,
        skippedTooOld,
        currentEntry: entry,
        phase: 'collecting'
      });

      const result = await fetchEnvironmentForEntry(entry);

      if (result?.skipped) {
        if (result.reason === 'no_location') {
          skippedNoLocation++;
        } else if (result.reason === 'too_old') {
          skippedTooOld++;
        }
        skipped++;
      } else if (result) {
        pendingUpdates.push({ entryId: entry.id, environmentContext: result });
        console.log(`[EnvironmentBackfill] Collected data for ${entry.id} (${entry.createdAt.toDateString()})`);
      } else {
        skipped++;
        console.log(`[EnvironmentBackfill] No environment data for ${entry.createdAt.toDateString()}`);
      }
    } catch (error) {
      console.error(`[EnvironmentBackfill] Failed to process entry ${entry.id}:`, error);
      failed++;
    }

    processed++;

    // Rate limiting for API (only if not cached)
    if (!weatherCache.has(getCacheKey(entry.createdAt, entry.location?.latitude || 0, entry.location?.longitude || 0))) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Phase 2: Batch write all collected updates
  let updated = 0;
  if (pendingUpdates.length > 0 && !signal?.aborted) {
    onProgress?.({
      total: entries.length,
      processed,
      updated: 0,
      skipped,
      phase: 'writing',
      pendingWrites: pendingUpdates.length
    });

    try {
      await batchUpdateEnvironmentContext(pendingUpdates);
      updated = pendingUpdates.length;
    } catch (batchError) {
      console.error('[EnvironmentBackfill] Batch write failed:', batchError);
      failed += pendingUpdates.length;
    }
  }

  onProgress?.({
    total: entries.length,
    processed,
    updated,
    skipped,
    skippedNoLocation,
    skippedTooOld,
    complete: true
  });

  console.log(`[EnvironmentBackfill] Complete: ${updated} updated, ${skipped} skipped (${skippedNoLocation} no location, ${skippedTooOld} too old), ${failed} failed`);

  return {
    total: entries.length,
    processed,
    updated,
    skipped,
    skippedNoLocation,
    skippedTooOld,
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
