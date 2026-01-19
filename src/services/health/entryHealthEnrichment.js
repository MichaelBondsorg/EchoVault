/**
 * Entry Health Enrichment Service
 *
 * Retroactively adds health context to entries that were created without it.
 * Called when viewing entries on mobile that were created on web.
 *
 * Design:
 * - Only enriches entries with `needsHealthContext: true` flag
 * - Only runs on native platforms (iOS/Android) where health data is available
 * - Updates entry in Firestore with health context
 * - Marks entry as enriched to prevent repeated attempts
 */

import { Capacitor } from '@capacitor/core';
import { auth, db } from '../../config/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { APP_COLLECTION_ID } from '../../config/constants';
import { getHealthSummary } from './healthDataService';

/**
 * Check if an entry needs health context enrichment
 * @param {Object} entry - The entry to check
 * @returns {boolean} True if entry needs enrichment
 */
export const needsHealthEnrichment = (entry) => {
  // Skip if already has health context
  if (entry.healthContext) {
    return false;
  }

  // Skip if explicitly marked as not needing enrichment
  if (entry.healthEnrichmentAttempted) {
    return false;
  }

  // Check if entry was flagged as needing health context
  if (entry.needsHealthContext === true) {
    return true;
  }

  // Check if entry was created on web (older entries without the flag)
  if (entry.createdOnPlatform === 'web') {
    return true;
  }

  // For older entries without platform info, check if health context is missing
  // but don't aggressively try to backfill everything
  return false;
};

/**
 * Enrich a single entry with health context
 * Only runs on native platforms where health data is available
 *
 * @param {Object} entry - The entry to enrich
 * @returns {Object|null} Health context if added, null otherwise
 */
export const enrichEntryWithHealth = async (entry) => {
  const platform = Capacitor.getPlatform();
  const isNative = platform === 'ios' || platform === 'android';

  // Only enrich on native platforms
  if (!isNative) {
    console.log('[HealthEnrichment] Skipping - not on native platform');
    return null;
  }

  // Check if enrichment is needed
  if (!needsHealthEnrichment(entry)) {
    return null;
  }

  const user = auth.currentUser;
  if (!user) {
    console.log('[HealthEnrichment] Skipping - not authenticated');
    return null;
  }

  console.log(`[HealthEnrichment] Enriching entry ${entry.id} created on ${entry.createdOnPlatform || 'unknown'}`);

  try {
    // Get the entry's creation date
    const entryDate = entry.createdAt?.toDate?.() ||
                      entry.createdAt instanceof Date ? entry.createdAt :
                      new Date(entry.createdAt);

    // Fetch health data for that date
    const healthSummary = await getHealthSummary(entryDate);

    if (!healthSummary?.available) {
      console.log('[HealthEnrichment] No health data available for date:', entryDate.toDateString());
      // Mark as attempted so we don't keep trying
      await markEnrichmentAttempted(user.uid, entry.id);
      return null;
    }

    // Build health context in the standard format
    const healthContext = {
      sleep: {
        totalHours: healthSummary.sleep?.totalHours || null,
        quality: healthSummary.sleep?.quality || null,
        score: healthSummary.sleep?.score || null,
        stages: healthSummary.sleep?.stages || null
      },
      heart: {
        restingRate: healthSummary.heart?.restingRate || null,
        currentRate: healthSummary.heart?.currentRate || null,
        hrv: healthSummary.heart?.hrv || null,
        hrvTrend: healthSummary.heart?.hrvTrend || null,
        stressIndicator: healthSummary.heart?.stressIndicator || null
      },
      activity: {
        stepsToday: healthSummary.activity?.stepsToday || null,
        totalCaloriesBurned: healthSummary.activity?.totalCaloriesBurned || null,
        activeCaloriesBurned: healthSummary.activity?.activeCaloriesBurned || null,
        totalExerciseMinutes: healthSummary.activity?.totalExerciseMinutes || null,
        hasWorkout: healthSummary.activity?.hasWorkout || false,
        workouts: healthSummary.activity?.workouts || []
      },
      // Whoop-specific fields if available
      recovery: healthSummary.recovery || null,
      strain: healthSummary.strain || null,

      source: healthSummary.source || 'enrichment',
      enrichedAt: new Date().toISOString(),
      enrichedOnPlatform: platform,
      originalEntryPlatform: entry.createdOnPlatform || 'unknown'
    };

    // Update the entry in Firestore
    const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entry.id);
    await updateDoc(entryRef, {
      healthContext,
      needsHealthContext: false,
      healthEnrichmentAttempted: true
    });

    console.log(`[HealthEnrichment] Successfully enriched entry ${entry.id} with ${healthContext.source} data`);
    return healthContext;

  } catch (error) {
    console.error(`[HealthEnrichment] Failed to enrich entry ${entry.id}:`, error);
    // Mark as attempted to prevent infinite loops
    try {
      await markEnrichmentAttempted(user.uid, entry.id);
    } catch {
      // Ignore
    }
    return null;
  }
};

/**
 * Mark an entry as having had enrichment attempted
 * Prevents repeated failed attempts
 */
const markEnrichmentAttempted = async (userId, entryId) => {
  try {
    const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries', entryId);
    await updateDoc(entryRef, {
      healthEnrichmentAttempted: true,
      needsHealthContext: false
    });
  } catch (error) {
    console.error('[HealthEnrichment] Failed to mark enrichment attempted:', error);
  }
};

/**
 * Batch enrich multiple entries
 * Called during app initialization on mobile to catch up on web entries
 *
 * @param {Array} entries - Entries to potentially enrich
 * @param {number} limit - Maximum entries to process (default 10)
 * @returns {Object} Results summary
 */
export const batchEnrichEntries = async (entries, limit = 10) => {
  const platform = Capacitor.getPlatform();
  if (platform !== 'ios' && platform !== 'android') {
    return { processed: 0, enriched: 0, skipped: 0, failed: 0 };
  }

  // Filter to entries that need enrichment
  const needsEnrichment = entries.filter(needsHealthEnrichment).slice(0, limit);

  if (needsEnrichment.length === 0) {
    return { processed: 0, enriched: 0, skipped: 0, failed: 0 };
  }

  console.log(`[HealthEnrichment] Batch enriching ${needsEnrichment.length} entries`);

  let enriched = 0;
  let failed = 0;

  for (const entry of needsEnrichment) {
    try {
      const result = await enrichEntryWithHealth(entry);
      if (result) {
        enriched++;
      }
    } catch (error) {
      console.error(`[HealthEnrichment] Batch enrich failed for ${entry.id}:`, error);
      failed++;
    }

    // Small delay between entries to avoid overwhelming APIs
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`[HealthEnrichment] Batch complete: ${enriched} enriched, ${failed} failed`);

  return {
    processed: needsEnrichment.length,
    enriched,
    skipped: needsEnrichment.length - enriched - failed,
    failed
  };
};

export default {
  needsHealthEnrichment,
  enrichEntryWithHealth,
  batchEnrichEntries
};
