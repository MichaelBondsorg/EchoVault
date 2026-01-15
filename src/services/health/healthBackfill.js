/**
 * Health Data Backfill Service
 *
 * Retroactively applies health data to existing journal entries
 * that were created before health integration or when sources weren't connected.
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getHealthKitSummary } from './healthKit';
import { collection, query, orderBy, limit, getDocs, doc, updateDoc } from 'firebase/firestore';

/**
 * Get entries that don't have health context
 * @param {number} maxEntries - Maximum entries to fetch
 * @returns {Array} Entries without health context
 */
export const getEntriesWithoutHealth = async (maxEntries = 200) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const entriesRef = collection(
    db,
    'artifacts',
    APP_COLLECTION_ID,
    'users',
    user.uid,
    'entries'
  );

  // Query all entries, we'll filter client-side for missing healthContext
  // Firestore doesn't support "field does not exist" queries well
  const q = query(
    entriesRef,
    orderBy('createdAt', 'desc'),
    limit(maxEntries)
  );

  const snapshot = await getDocs(q);
  const entriesWithoutHealth = [];

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    // Skip entries that already have health context
    if (!data.healthContext) {
      entriesWithoutHealth.push({
        id: docSnap.id,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        content: data.content?.substring(0, 50) + '...' // Preview for UI
      });
    }
  });

  return entriesWithoutHealth;
};

/**
 * Fetch health data for a specific date from HealthKit
 * @param {Date} date - The date to fetch health for
 * @returns {Object|null} Health context or null if unavailable
 */
const fetchHealthForDate = async (date) => {
  try {
    const summary = await getHealthKitSummary(date);

    if (!summary.available) {
      return null;
    }

    // Check if we actually got meaningful data
    const hasData = summary.sleep?.totalHours ||
                    summary.activity?.stepsToday ||
                    summary.heart?.restingRate;

    if (!hasData) {
      return null;
    }

    // Build health context in the standard format
    return {
      sleep: {
        totalHours: summary.sleep?.totalHours || null,
        quality: summary.sleep?.quality || null,
        score: summary.sleep?.score || null,
        stages: summary.sleep?.stages || null
      },
      heart: {
        restingRate: summary.heart?.restingRate || null,
        currentRate: summary.heart?.currentRate || null,
        hrv: summary.heart?.hrv || null,
        hrvTrend: summary.heart?.hrvTrend || null,
        stressIndicator: summary.heart?.stressIndicator || null
      },
      activity: {
        stepsToday: summary.activity?.stepsToday || null,
        totalCaloriesBurned: summary.activity?.totalCaloriesBurned || null,
        activeCaloriesBurned: summary.activity?.activeCaloriesBurned || null,
        totalExerciseMinutes: summary.activity?.totalExerciseMinutes || null,
        hasWorkout: summary.activity?.hasWorkout || false,
        workouts: summary.activity?.workouts || []
      },
      source: 'healthkit',
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: date.toISOString()
    };
  } catch (error) {
    console.warn(`Failed to fetch health for ${date.toDateString()}:`, error);
    return null;
  }
};

/**
 * Update an entry with backfilled health context
 * @param {string} entryId - Entry document ID
 * @param {Object} healthContext - Health context to add
 */
const updateEntryHealth = async (entryId, healthContext) => {
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
    healthContext,
    updatedAt: new Date()
  });
};

/**
 * Main backfill function - processes entries and adds health data
 * @param {Function} onProgress - Callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal to cancel
 * @returns {Object} Results summary
 */
export const backfillHealthData = async (onProgress, signal) => {
  console.log('[HealthBackfill] Starting backfill...');

  // Get entries that need health data
  const entries = await getEntriesWithoutHealth();
  console.log(`[HealthBackfill] Found ${entries.length} entries without health context`);

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
      console.log('[HealthBackfill] Cancelled by user');
      break;
    }

    try {
      // Report progress
      onProgress?.({
        total: entries.length,
        processed,
        updated,
        skipped,
        currentEntry: entry
      });

      // Fetch health data for the entry's date
      const healthContext = await fetchHealthForDate(entry.createdAt);

      if (healthContext) {
        await updateEntryHealth(entry.id, healthContext);
        updated++;
        console.log(`[HealthBackfill] Updated entry ${entry.id} (${entry.createdAt.toDateString()})`);
      } else {
        skipped++;
        console.log(`[HealthBackfill] No health data for ${entry.createdAt.toDateString()}`);
      }
    } catch (error) {
      console.error(`[HealthBackfill] Failed to process entry ${entry.id}:`, error);
      failed++;
    }

    processed++;

    // Small delay to avoid overwhelming HealthKit
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Final progress update
  onProgress?.({
    total: entries.length,
    processed,
    updated,
    skipped,
    complete: true
  });

  console.log(`[HealthBackfill] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);

  return {
    total: entries.length,
    processed,
    updated,
    skipped,
    failed
  };
};

/**
 * Get count of entries that need backfill (quick check for UI)
 * @returns {number} Count of entries without health context
 */
export const getBackfillCount = async () => {
  try {
    const entries = await getEntriesWithoutHealth(500); // Check up to 500
    return entries.length;
  } catch (error) {
    console.error('[HealthBackfill] Failed to get backfill count:', error);
    return 0;
  }
};

export default {
  getEntriesWithoutHealth,
  backfillHealthData,
  getBackfillCount
};
