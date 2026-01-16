/**
 * Health Data Backfill Service
 *
 * Retroactively applies health data to existing journal entries
 * that were created before health integration or when sources weren't connected.
 *
 * Features:
 * - Supports both Whoop and HealthKit data sources
 * - Intelligent source selection (Whoop preferred for longer history)
 * - Batched Firestore writes for performance (up to 500 docs per batch)
 * - Smart merge when both sources connected
 * - Source tracking for UI display (source: 'whoop' | 'healthkit' | 'merged')
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getHealthKitSummary, checkHealthKitPermissions } from './healthKit';
import { getWhoopSummary, isWhoopLinked } from './whoop';
import { collection, query, orderBy, limit, getDocs, doc, writeBatch } from 'firebase/firestore';

const BATCH_SIZE = 500; // Firestore limit

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
 * Determine available health sources
 * @returns {Object} Available sources info
 */
const detectAvailableSources = async () => {
  const [whoopConnected, healthKitResult] = await Promise.all([
    isWhoopLinked().catch(() => false),
    checkHealthKitPermissions().catch(() => ({ available: false }))
  ]);

  const healthKitAvailable = healthKitResult?.authorized || healthKitResult?.available || false;

  return {
    whoop: whoopConnected,
    healthkit: healthKitAvailable,
    hasBoth: whoopConnected && healthKitAvailable,
    hasAny: whoopConnected || healthKitAvailable
  };
};

/**
 * Fetch health data for a specific date from Whoop
 * @param {Date} date - The date to fetch health for
 * @returns {Object|null} Health context or null if unavailable
 */
const fetchWhoopForDate = async (date) => {
  try {
    const summary = await getWhoopSummary(date);

    if (!summary.available) {
      return null;
    }

    // Check if we actually got meaningful data
    const hasData = summary.sleep?.totalHours ||
                    summary.recovery?.score ||
                    summary.heart?.restingRate;

    if (!hasData) {
      return null;
    }

    return {
      sleep: {
        totalHours: summary.sleep?.totalHours || null,
        quality: summary.sleep?.quality || null,
        score: null, // Whoop doesn't have a sleep score
        stages: null
      },
      recovery: summary.recovery ? {
        score: summary.recovery.score,
        status: summary.recovery.status
      } : null,
      strain: summary.strain ? {
        score: summary.strain.score,
        calories: summary.strain.calories
      } : null,
      heart: {
        restingRate: summary.heart?.restingRate || null,
        currentRate: null,
        hrv: summary.heart?.hrv || null,
        hrvTrend: summary.heart?.hrvTrend || null,
        stressIndicator: summary.heart?.stressIndicator || null
      },
      activity: {
        stepsToday: null, // Whoop doesn't track steps natively
        totalCaloriesBurned: summary.activity?.totalCaloriesBurned || null,
        activeCaloriesBurned: summary.activity?.activeCaloriesBurned || null,
        totalExerciseMinutes: summary.activity?.totalExerciseMinutes || null,
        hasWorkout: summary.activity?.hasWorkout || false,
        workouts: (summary.activity?.workouts || []).map(w => ({ ...w, source: 'whoop' }))
      },
      source: 'whoop',
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: date.toISOString()
    };
  } catch (error) {
    console.warn(`Failed to fetch Whoop for ${date.toDateString()}:`, error);
    return null;
  }
};

/**
 * Fetch health data for a specific date from HealthKit
 * @param {Date} date - The date to fetch health for
 * @returns {Object|null} Health context or null if unavailable
 */
const fetchHealthKitForDate = async (date) => {
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
        score: summary.sleep?.score || null, // HealthKit sleep score
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
        workouts: (summary.activity?.workouts || []).map(w => ({ ...w, source: 'healthkit' }))
      },
      source: 'healthkit',
      backfilled: true,
      backfilledAt: new Date().toISOString(),
      originalDate: date.toISOString()
    };
  } catch (error) {
    console.warn(`Failed to fetch HealthKit for ${date.toDateString()}:`, error);
    return null;
  }
};

/**
 * Smart merge health data from both Whoop and HealthKit
 * Whoop: recovery, strain, sleep quality, HRV
 * HealthKit: steps, sleep score, detailed sleep stages
 */
const mergeHealthSources = (whoopData, healthKitData) => {
  if (!whoopData && !healthKitData) return null;
  if (!whoopData) return healthKitData;
  if (!healthKitData) return whoopData;

  // Merge with source priorities
  return {
    // Sleep: Whoop for hours/quality, HealthKit for score/stages
    sleep: {
      totalHours: whoopData.sleep?.totalHours || healthKitData.sleep?.totalHours,
      quality: whoopData.sleep?.quality || healthKitData.sleep?.quality,
      score: healthKitData.sleep?.score || null, // HealthKit has the calculated score
      stages: healthKitData.sleep?.stages || null
    },
    // Recovery/Strain: Whoop only
    recovery: whoopData.recovery || null,
    strain: whoopData.strain || null,
    // Heart: Prefer Whoop for overnight metrics
    heart: {
      restingRate: whoopData.heart?.restingRate || healthKitData.heart?.restingRate,
      currentRate: healthKitData.heart?.currentRate || null,
      hrv: whoopData.heart?.hrv || healthKitData.heart?.hrv,
      hrvTrend: whoopData.heart?.hrvTrend || healthKitData.heart?.hrvTrend,
      stressIndicator: whoopData.heart?.stressIndicator || healthKitData.heart?.stressIndicator
    },
    // Activity: Steps from HealthKit, calories from Whoop
    activity: {
      stepsToday: healthKitData.activity?.stepsToday || null, // Whoop doesn't track steps
      totalCaloriesBurned: whoopData.activity?.totalCaloriesBurned || healthKitData.activity?.totalCaloriesBurned,
      activeCaloriesBurned: whoopData.activity?.activeCaloriesBurned || healthKitData.activity?.activeCaloriesBurned,
      totalExerciseMinutes: whoopData.activity?.totalExerciseMinutes || healthKitData.activity?.totalExerciseMinutes,
      hasWorkout: whoopData.activity?.hasWorkout || healthKitData.activity?.hasWorkout,
      workouts: mergeWorkouts(whoopData.activity?.workouts, healthKitData.activity?.workouts)
    },
    source: 'merged',
    sources: ['whoop', 'healthkit'],
    backfilled: true,
    backfilledAt: new Date().toISOString(),
    originalDate: whoopData.originalDate || healthKitData.originalDate
  };
};

/**
 * Merge workouts with deduplication
 * Whoop workouts take priority; HealthKit only added if no overlap
 */
const mergeWorkouts = (whoopWorkouts = [], healthKitWorkouts = []) => {
  const merged = [...whoopWorkouts];

  for (const hkWorkout of healthKitWorkouts) {
    const hkStartUtc = hkWorkout.startTime ? new Date(hkWorkout.startTime).getTime() : 0;

    const hasOverlap = merged.some(whoopW => {
      const whoopStartUtc = whoopW.startTime ? new Date(whoopW.startTime).getTime() : 0;
      const timeDiffMs = Math.abs(hkStartUtc - whoopStartUtc);

      // 30-minute overlap window for exact detection
      // 60-minute for generic workout types
      const isGeneric = ['workout', 'other', 'activity', 'exercise']
        .includes(hkWorkout.type?.toLowerCase()) ||
        ['workout', 'other', 'activity', 'exercise']
        .includes(whoopW.type?.toLowerCase());

      const windowMs = isGeneric ? 60 * 60 * 1000 : 30 * 60 * 1000;

      if (timeDiffMs < windowMs) return true;

      // Same type on same day = duplicate
      if (isSameDay(hkStartUtc, whoopStartUtc)) {
        if (fuzzyWorkoutTypeMatch(hkWorkout.type, whoopW.type)) return true;
      }

      return false;
    });

    if (!hasOverlap) {
      merged.push(hkWorkout);
    }
  }

  return merged;
};

const isSameDay = (ts1, ts2) => {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toISOString().split('T')[0] === d2.toISOString().split('T')[0];
};

const fuzzyWorkoutTypeMatch = (type1, type2) => {
  const normalize = (t) => t?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const t1 = normalize(type1);
  const t2 = normalize(type2);

  if (t1 === t2) return true;
  if (t1.includes(t2) || t2.includes(t1)) return true;

  const synonymGroups = [
    ['run', 'running', 'jog', 'jogging'],
    ['walk', 'walking', 'hike', 'hiking'],
    ['bike', 'biking', 'cycle', 'cycling', 'bicycle'],
    ['swim', 'swimming', 'pool'],
    ['strength', 'weights', 'lifting', 'weightlifting', 'resistance'],
    ['yoga', 'stretch', 'stretching', 'flexibility'],
    ['hiit', 'interval', 'circuit', 'crossfit']
  ];

  for (const group of synonymGroups) {
    const t1Match = group.some(s => t1.includes(s));
    const t2Match = group.some(s => t2.includes(s));
    if (t1Match && t2Match) return true;
  }

  return false;
};

/**
 * Fetch health data for a specific date using available sources
 * @param {Date} date - The date to fetch health for
 * @param {Object} sources - Available sources info
 * @returns {Object|null} Health context or null if unavailable
 */
const fetchHealthForDate = async (date, sources) => {
  // Both sources available: merge for best data
  if (sources.hasBoth) {
    const [whoopData, healthKitData] = await Promise.all([
      fetchWhoopForDate(date),
      fetchHealthKitForDate(date)
    ]);
    return mergeHealthSources(whoopData, healthKitData);
  }

  // Whoop preferred (longer historical data)
  if (sources.whoop) {
    return await fetchWhoopForDate(date);
  }

  // Fallback to HealthKit
  if (sources.healthkit) {
    return await fetchHealthKitForDate(date);
  }

  return null;
};

/**
 * Batch update entries with health context using Firestore batched writes
 * @param {Array} updates - Array of { entryId, healthContext }
 * @returns {Object} Result with count of updates
 */
const batchUpdateHealthContext = async (updates) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Split into batches of BATCH_SIZE
  const batches = [];
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batchUpdates = updates.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const { entryId, healthContext } of batchUpdates) {
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
        healthContext,
        updatedAt: new Date()
      });
    }

    batches.push(batch);
  }

  // Execute all batches
  console.log(`[HealthBackfill] Executing ${batches.length} batches (${updates.length} total updates)`);

  for (let i = 0; i < batches.length; i++) {
    await batches[i].commit();
    console.log(`[HealthBackfill] Batch ${i + 1}/${batches.length} committed`);
  }

  return { success: true, updated: updates.length };
};

/**
 * Main backfill function - processes entries and adds health data
 * Now with multi-source support and batched writes for performance
 *
 * @param {Function} onProgress - Callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal to cancel
 * @returns {Object} Results summary
 */
export const backfillHealthData = async (onProgress, signal) => {
  console.log('[HealthBackfill] Starting backfill...');

  // Detect available health sources
  const sources = await detectAvailableSources();
  console.log('[HealthBackfill] Available sources:', sources);

  if (!sources.hasAny) {
    console.log('[HealthBackfill] No health sources available');
    return {
      total: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      error: 'No health sources available. Connect Whoop or enable HealthKit first.'
    };
  }

  // Get entries that need health data
  const entries = await getEntriesWithoutHealth();
  console.log(`[HealthBackfill] Found ${entries.length} entries without health context`);

  if (entries.length === 0) {
    return {
      total: 0,
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      sources: sources
    };
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const pendingUpdates = [];

  // Phase 1: Collect health data for all entries
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
        updated: pendingUpdates.length,
        skipped,
        currentEntry: entry,
        phase: 'collecting'
      });

      // Fetch health data for the entry's date
      const healthContext = await fetchHealthForDate(entry.createdAt, sources);

      if (healthContext) {
        pendingUpdates.push({ entryId: entry.id, healthContext });
        console.log(`[HealthBackfill] Collected data for ${entry.id} (${entry.createdAt.toDateString()}) - source: ${healthContext.source}`);
      } else {
        skipped++;
        console.log(`[HealthBackfill] No health data for ${entry.createdAt.toDateString()}`);
      }
    } catch (error) {
      console.error(`[HealthBackfill] Failed to fetch health for entry ${entry.id}:`, error);
      failed++;
    }

    processed++;

    // Small delay to avoid overwhelming API
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Phase 2: Batch write all collected updates
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
      await batchUpdateHealthContext(pendingUpdates);
      updated = pendingUpdates.length;
    } catch (batchError) {
      console.error('[HealthBackfill] Batch write failed:', batchError);
      // Fall back to counting as failed
      failed += pendingUpdates.length;
    }
  }

  // Final progress update
  onProgress?.({
    total: entries.length,
    processed,
    updated,
    skipped,
    complete: true,
    sources
  });

  console.log(`[HealthBackfill] Complete: ${updated} updated, ${skipped} skipped, ${failed} failed`);
  console.log(`[HealthBackfill] Source used: ${sources.hasBoth ? 'merged' : sources.whoop ? 'whoop' : 'healthkit'}`);

  return {
    total: entries.length,
    processed,
    updated,
    skipped,
    failed,
    sources
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
