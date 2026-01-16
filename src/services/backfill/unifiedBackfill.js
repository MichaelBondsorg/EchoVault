/**
 * Unified Backfill Service
 *
 * Coordinates retroactive application of:
 * 1. Health data (Whoop/HealthKit)
 * 2. Environment data (weather/location)
 * 3. Triggers insight reassessment after completion
 *
 * Features:
 * - State persistence for resume after interruption
 * - Batched Firestore writes for performance
 * - Progress callbacks with stage tracking
 * - Abort signal support for cancellation
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { backfillHealthData, getBackfillCount as getHealthBackfillCount } from '../health/healthBackfill';
import { backfillEnvironmentData, getEnvironmentBackfillCount } from '../environment/environmentBackfill';
import { triggerInsightReassessment } from './insightReassessment';
import { doc, getDoc, setDoc, deleteDoc, Timestamp } from 'firebase/firestore';

export const BACKFILL_STAGES = {
  IDLE: 'idle',
  HEALTH: 'health',
  ENVIRONMENT: 'environment',
  REASSESSMENT: 'reassessment',
  COMPLETE: 'complete',
  ERROR: 'error'
};

const CHECKPOINT_INTERVAL = 50;
const BACKFILL_STATE_KEY = 'backfill_state';

/**
 * Load backfill state (for resume)
 */
const loadBackfillState = async (userId) => {
  try {
    const stateRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', BACKFILL_STATE_KEY
    );
    const stateDoc = await getDoc(stateRef);

    if (stateDoc.exists()) {
      const data = stateDoc.data();
      // Check if state is stale (> 24 hours old)
      const lastCheckpoint = data.lastCheckpointAt?.toDate?.();
      if (lastCheckpoint && Date.now() - lastCheckpoint.getTime() > 24 * 60 * 60 * 1000) {
        console.log('[Backfill] State is stale (>24h), starting fresh');
        return null;
      }
      return data;
    }
    return null;
  } catch (error) {
    console.error('[Backfill] Failed to load state:', error);
    return null;
  }
};

/**
 * Save backfill state (checkpoint)
 */
const saveBackfillState = async (userId, state) => {
  const stateRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', BACKFILL_STATE_KEY
  );

  await setDoc(stateRef, {
    ...state,
    lastCheckpointAt: Timestamp.now()
  });

  console.log(`[Backfill] Checkpoint saved: ${state.stats?.processed || 0} processed`);
};

/**
 * Clear backfill state (on completion)
 */
const clearBackfillState = async (userId) => {
  const stateRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', BACKFILL_STATE_KEY
  );
  try {
    await deleteDoc(stateRef);
  } catch {
    // Ignore errors during cleanup
  }
};

/**
 * Run complete backfill pipeline
 * @param {Function} onProgress - Callback for progress updates
 * @param {AbortSignal} signal - Optional abort signal
 * @param {Object} options - Optional configuration
 * @returns {Object} Results summary
 */
export const runFullBackfill = async (onProgress, signal, options = {}) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const { skipReassessment = false } = options;

  const results = {
    health: null,
    environment: null,
    reassessment: null,
    startedAt: new Date(),
    completedAt: null,
    totalEntriesUpdated: 0,
    resumed: false
  };

  try {
    // Try to resume from previous state
    const savedState = await loadBackfillState(user.uid);
    if (savedState) {
      console.log('[Backfill] Resuming from checkpoint:', savedState.phase);
      results.resumed = true;
    }

    const startPhase = savedState?.phase || BACKFILL_STAGES.HEALTH;

    // Stage 1: Health data backfill
    if (startPhase === BACKFILL_STAGES.HEALTH || startPhase === BACKFILL_STAGES.IDLE) {
      onProgress?.({ stage: BACKFILL_STAGES.HEALTH, progress: 0 });

      // Save state before starting
      await saveBackfillState(user.uid, {
        phase: BACKFILL_STAGES.HEALTH,
        startedAt: Timestamp.now(),
        stats: { processed: 0, updated: 0 }
      });

      results.health = await backfillHealthData(
        (p) => {
          onProgress?.({ stage: BACKFILL_STAGES.HEALTH, ...p });
          // Checkpoint every N entries
          if (p.processed > 0 && p.processed % CHECKPOINT_INTERVAL === 0) {
            saveBackfillState(user.uid, {
              phase: BACKFILL_STAGES.HEALTH,
              stats: p
            }).catch(console.error);
          }
        },
        signal
      );

      if (signal?.aborted) {
        console.log('[Backfill] Aborted during health phase');
        return results;
      }
    }

    // Stage 2: Environment data backfill
    if (startPhase !== BACKFILL_STAGES.REASSESSMENT) {
      onProgress?.({ stage: BACKFILL_STAGES.ENVIRONMENT, progress: 0 });

      await saveBackfillState(user.uid, {
        phase: BACKFILL_STAGES.ENVIRONMENT,
        healthResults: results.health,
        stats: { processed: 0, updated: 0 }
      });

      results.environment = await backfillEnvironmentData(
        (p) => {
          onProgress?.({ stage: BACKFILL_STAGES.ENVIRONMENT, ...p });
          if (p.processed > 0 && p.processed % CHECKPOINT_INTERVAL === 0) {
            saveBackfillState(user.uid, {
              phase: BACKFILL_STAGES.ENVIRONMENT,
              healthResults: results.health,
              stats: p
            }).catch(console.error);
          }
        },
        signal
      );

      if (signal?.aborted) {
        console.log('[Backfill] Aborted during environment phase');
        return results;
      }
    }

    // Stage 3: Insight reassessment (only if data was updated)
    const totalUpdated = (results.health?.updated || 0) + (results.environment?.updated || 0);
    results.totalEntriesUpdated = totalUpdated;

    if (totalUpdated > 0 && !skipReassessment) {
      onProgress?.({ stage: BACKFILL_STAGES.REASSESSMENT, progress: 0 });

      await saveBackfillState(user.uid, {
        phase: BACKFILL_STAGES.REASSESSMENT,
        healthResults: results.health,
        environmentResults: results.environment
      });

      results.reassessment = await triggerInsightReassessment(
        (p) => onProgress?.({ stage: BACKFILL_STAGES.REASSESSMENT, ...p }),
        signal
      );
    }

    // Complete
    results.completedAt = new Date();
    onProgress?.({ stage: BACKFILL_STAGES.COMPLETE, results });

    // Clear saved state on success
    await clearBackfillState(user.uid);

    console.log('[Backfill] Pipeline complete:', {
      healthUpdated: results.health?.updated || 0,
      envUpdated: results.environment?.updated || 0,
      insightsGenerated: results.reassessment?.insights?.generated || 0
    });

    return results;

  } catch (error) {
    console.error('[Backfill] Pipeline error:', error);
    onProgress?.({ stage: BACKFILL_STAGES.ERROR, error: error.message });

    // Save error state for debugging
    await saveBackfillState(user.uid, {
      phase: BACKFILL_STAGES.ERROR,
      error: error.message,
      partialResults: results
    }).catch(console.error);

    throw error;
  }
};

/**
 * Get summary of what needs backfilling
 * @returns {Object} Summary with counts and estimates
 */
export const getBackfillSummary = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const [healthCount, envCount] = await Promise.all([
    getHealthBackfillCount(),
    getEnvironmentBackfillCount()
  ]);

  // Check for existing state (resume available)
  const savedState = await loadBackfillState(user.uid);

  return {
    entriesNeedingHealth: healthCount,
    entriesNeedingEnvironment: envCount,
    totalEntriesNeedingBackfill: Math.max(healthCount, envCount),
    // Estimate: ~0.5s per entry (API calls + processing)
    estimatedTimeMinutes: Math.ceil((healthCount + envCount) * 0.5 / 60),
    canResume: savedState !== null,
    savedPhase: savedState?.phase || null
  };
};

/**
 * Check if a backfill is resumable
 * @returns {Object|null} Saved state if resumable, null otherwise
 */
export const getResumableBackfill = async () => {
  const user = auth.currentUser;
  if (!user) return null;

  return await loadBackfillState(user.uid);
};

/**
 * Clear any saved backfill state (start fresh)
 */
export const resetBackfillState = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  await clearBackfillState(user.uid);
  console.log('[Backfill] State reset');
};

export default {
  BACKFILL_STAGES,
  runFullBackfill,
  getBackfillSummary,
  getResumableBackfill,
  resetBackfillState
};
