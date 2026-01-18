# Implementation Plan: Retroactive Health/Geolocation Data + Insight Reassessment

## Executive Summary

This plan implements retroactive application of health and geolocation data to existing journal entries, followed by automated reassessment of all insights, baselines, and correlations. The goal is to enrich historical entries and unlock deeper insights that weren't available when entries were originally created.

---

## Primary Readiness Metric Strategy

A key requirement is providing users with a single, prominent "readiness" metric based on their health data source:

| Source | Primary Metric | Display Priority | Card Display |
|--------|---------------|------------------|--------------|
| **HealthKit-only** | **Sleep Score** (calculated) | Sleep Score prominently shown | `Sleep 85` with color coding |
| **Whoop-only** | **Recovery Score** | Recovery Score prominently shown | `Recovery 72%` with color coding |
| **Whoop + HealthKit** | **Recovery Score** (from Whoop) | Recovery as primary, Sleep as secondary | `Recovery 72%` + `7.2h sleep` |

### Sleep Score Calculation (HealthKit)

The sleep score is already calculated in `healthKit.js` using a weighted formula:

```javascript
// Weights:
// - Duration: 30% (optimal 7-9 hours)
// - Efficiency: 20% (time asleep / time in bed)
// - Deep sleep: 20% (optimal 13-23% of total)
// - REM: 15% (optimal 18-28% of total)
// - Continuity: 15% (penalize wake-ups)
```

### Data Source Prioritization (Both Connected)

When both Whoop and HealthKit are connected, use this merge strategy:

| Data Type | Source | Reason |
|-----------|--------|--------|
| **Sleep hours/quality** | Whoop | 24/7 tracking, more accurate |
| **Recovery score** | Whoop | Proprietary algorithm, primary readiness metric |
| **HRV** | Whoop | Better overnight tracking |
| **Steps** | HealthKit | Whoop doesn't track steps natively |
| **Workouts** | Whoop (primary) + HealthKit (non-overlapping) | Whoop has better strain/calorie data |
| **Resting heart rate** | Whoop | Better overnight averaging |

### Workout Deduplication

When merging workouts from both sources:
1. Use Whoop workouts as the primary list
2. Only add HealthKit workouts that don't overlap (check within 30-minute window)
3. If same workout type on same day, prefer Whoop version

---

## Current State Analysis

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| Health Backfill | `src/services/health/healthBackfill.js` | ✅ Works with HealthKit only |
| Environment Backfill | `src/services/environment/environmentBackfill.js` | ✅ 7-day API limitation |
| Pattern Detector | `src/services/nexus/layer1/patternDetector.js` | ✅ Consumes health/env context |
| Nexus Orchestrator | `src/services/nexus/orchestrator.js` | ✅ Generates insights |
| Health-Mood Correlation | `src/services/health/healthMoodCorrelation.js` | ✅ Statistical correlation |
| Baseline Manager | `src/services/nexus/layer2/baselineManager.js` | ✅ Personal baselines |
| Cloud Function `onEntryUpdate` | `functions/index.js:2020` | ⚠️ Exists but limited |
| Cloud Function `reprocessEntriesForGoals` | `functions/index.js:3905` | ✅ Pattern for batch reprocessing |

### Gaps Identified

1. **No Whoop historical backfill** - healthBackfill.js only uses HealthKit
2. **No unified backfill orchestration** - Health and environment run independently
3. **No automatic insight reassessment** - Backfill doesn't trigger insight regeneration
4. **No baseline recalculation after backfill** - Baselines use stale data
5. **No correlation refresh** - Health-mood correlations not recalculated
6. **No progress UI** - User can't see backfill + reassessment status
7. **Environment 7-day limit** - Open-Meteo API constraint for historical weather
8. **Primary readiness metric not prominent on entry cards** - Sleep Score / Recovery not highlighted
9. **No source-aware metric surfacing** - Cards don't adapt display based on connected sources

---

## Implementation Plan

### Phase 1: Extend Health Backfill with Whoop Support

**Goal:** Enable backfilling health data from Whoop API (has richer historical data than HealthKit)

**Files to modify:**
- `src/services/health/healthBackfill.js`
- `src/services/health/whoop.js` (add historical query)

**Implementation:**

```javascript
// In healthBackfill.js - add Whoop as a data source
export const backfillHealthData = async (onProgress, signal, options = {}) => {
  const { preferredSource = 'auto' } = options;

  // Check available sources
  const whoopLinked = await isWhoopLinked();
  const healthKitAvailable = await checkHealthKitAvailability();

  // Choose best source (Whoop has longer history)
  const source = preferredSource === 'auto'
    ? (whoopLinked ? 'whoop' : 'healthkit')
    : preferredSource;

  // Fetch entries without health context
  const entries = await getEntriesWithoutHealth();

  // Process based on source
  for (const entry of entries) {
    const healthContext = source === 'whoop'
      ? await fetchWhoopDataForDate(entry.createdAt)
      : await fetchHealthKitDataForDate(entry.createdAt);

    if (healthContext) {
      await updateEntryHealth(entry.id, healthContext);
    }
  }
};
```

**Whoop API addition:**
```javascript
// In whoop.js - add historical day query
export const getWhoopDataForDate = async (date) => {
  // Whoop API can query historical cycles by date range
  const dateStr = date.toISOString().split('T')[0];
  const response = await whoopApiCall(`/v1/cycle?start=${dateStr}&end=${dateStr}`);
  // ... format response
};
```

---

### Phase 2: Create Unified Backfill Service

**Goal:** Single service to orchestrate health + environment backfill together

**New file:** `src/services/backfill/unifiedBackfill.js`

```javascript
/**
 * Unified Backfill Service
 *
 * Coordinates retroactive application of:
 * 1. Health data (Whoop/HealthKit)
 * 2. Environment data (weather/location)
 * 3. Triggers insight reassessment after completion
 */

import { backfillHealthData, getBackfillCount as getHealthBackfillCount } from '../health/healthBackfill';
import { backfillEnvironmentData, getEnvironmentBackfillCount } from '../environment/environmentBackfill';
import { triggerInsightReassessment } from './insightReassessment';

export const BACKFILL_STAGES = {
  IDLE: 'idle',
  HEALTH: 'health',
  ENVIRONMENT: 'environment',
  REASSESSMENT: 'reassessment',
  COMPLETE: 'complete',
  ERROR: 'error'
};

/**
 * Run complete backfill pipeline
 */
export const runFullBackfill = async (onProgress, signal) => {
  const results = {
    health: null,
    environment: null,
    reassessment: null,
    startedAt: new Date(),
    completedAt: null,
    totalEntriesUpdated: 0
  };

  try {
    // Stage 1: Health data backfill
    onProgress?.({ stage: BACKFILL_STAGES.HEALTH, progress: 0 });
    results.health = await backfillHealthData(
      (p) => onProgress?.({ stage: BACKFILL_STAGES.HEALTH, ...p }),
      signal
    );

    if (signal?.aborted) return results;

    // Stage 2: Environment data backfill
    onProgress?.({ stage: BACKFILL_STAGES.ENVIRONMENT, progress: 0 });
    results.environment = await backfillEnvironmentData(
      (p) => onProgress?.({ stage: BACKFILL_STAGES.ENVIRONMENT, ...p }),
      signal
    );

    if (signal?.aborted) return results;

    // Stage 3: Insight reassessment (only if data was updated)
    const totalUpdated = (results.health?.updated || 0) + (results.environment?.updated || 0);
    if (totalUpdated > 0) {
      onProgress?.({ stage: BACKFILL_STAGES.REASSESSMENT, progress: 0 });
      results.reassessment = await triggerInsightReassessment(
        (p) => onProgress?.({ stage: BACKFILL_STAGES.REASSESSMENT, ...p }),
        signal
      );
    }

    results.totalEntriesUpdated = totalUpdated;
    results.completedAt = new Date();
    onProgress?.({ stage: BACKFILL_STAGES.COMPLETE, results });

    return results;

  } catch (error) {
    onProgress?.({ stage: BACKFILL_STAGES.ERROR, error: error.message });
    throw error;
  }
};

/**
 * Get summary of what needs backfilling
 */
export const getBackfillSummary = async () => {
  const [healthCount, envCount] = await Promise.all([
    getHealthBackfillCount(),
    getEnvironmentBackfillCount()
  ]);

  return {
    entriesNeedingHealth: healthCount,
    entriesNeedingEnvironment: envCount,
    totalEntriesNeedingBackfill: Math.max(healthCount, envCount),
    estimatedTimeMinutes: Math.ceil((healthCount + envCount) * 0.5 / 60)
  };
};
```

---

### Phase 3: Implement Insight Reassessment Service

**Goal:** After backfill, recalculate all insights, baselines, and correlations

**New file:** `src/services/backfill/insightReassessment.js`

```javascript
/**
 * Insight Reassessment Service
 *
 * Recalculates insights after retroactive data enrichment:
 * 1. Recalculate personal baselines
 * 2. Re-run pattern detection on enriched entries
 * 3. Refresh health-mood correlations
 * 4. Regenerate Nexus insights
 * 5. Update thread sentiment with new context
 */

import { auth, db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { collection, query, orderBy, limit, getDocs, doc, setDoc, Timestamp } from 'firebase/firestore';
import { calculateAndSaveBaselines } from '../nexus/layer2/baselineManager';
import { detectPatternsInPeriod } from '../nexus/layer1/patternDetector';
import { analyzeHealthMoodCorrelations } from '../health/healthMoodCorrelation';
import { generateInsights, markInsightsStale } from '../nexus/orchestrator';
import { getWhoopHistory } from '../health/whoop';

export const REASSESSMENT_STEPS = {
  BASELINES: 'baselines',
  PATTERNS: 'patterns',
  CORRELATIONS: 'correlations',
  INSIGHTS: 'insights',
  CLEANUP: 'cleanup'
};

/**
 * Trigger full insight reassessment after backfill
 */
export const triggerInsightReassessment = async (onProgress, signal) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const results = {
    baselines: null,
    patterns: null,
    correlations: null,
    insights: null,
    startedAt: new Date()
  };

  console.log('[InsightReassessment] Starting reassessment pipeline...');

  // Fetch all recent entries (now enriched with health/env data)
  const entries = await fetchRecentEntries(user.uid, 90); // 90 days for baseline calc
  const whoopHistory = await getWhoopHistory(90).catch(() => ({ available: false, days: [] }));

  // Step 1: Recalculate personal baselines
  onProgress?.({ step: REASSESSMENT_STEPS.BASELINES, progress: 0 });
  if (entries.length >= 10) {
    await calculateAndSaveBaselines(user.uid, entries);
    results.baselines = { recalculated: true, entryCount: entries.length };
    console.log('[InsightReassessment] Baselines recalculated');
  }

  if (signal?.aborted) return results;

  // Step 2: Re-run pattern detection with enriched data
  onProgress?.({ step: REASSESSMENT_STEPS.PATTERNS, progress: 25 });
  const patterns = await detectPatternsInPeriod(user.uid, entries, whoopHistory);
  results.patterns = {
    totalDetected: patterns.totalPatternsDetected,
    byType: patterns.patternTypeCounts
  };
  console.log('[InsightReassessment] Patterns detected:', patterns.patternTypeCounts);

  // Save pattern analysis for later use
  await savePatternAnalysis(user.uid, patterns);

  if (signal?.aborted) return results;

  // Step 3: Refresh health-mood correlations
  onProgress?.({ step: REASSESSMENT_STEPS.CORRELATIONS, progress: 50 });
  const correlations = analyzeHealthMoodCorrelations(entries, whoopHistory?.days || []);
  results.correlations = {
    available: correlations.available,
    pairsAnalyzed: correlations.pairsAnalyzed,
    insightCount: correlations.insights?.length || 0
  };
  console.log('[InsightReassessment] Correlations analyzed');

  // Save correlations
  await saveCorrelationAnalysis(user.uid, correlations);

  if (signal?.aborted) return results;

  // Step 4: Regenerate Nexus insights
  onProgress?.({ step: REASSESSMENT_STEPS.INSIGHTS, progress: 75 });

  // First mark existing insights as stale
  await markInsightsStale(user.uid);

  // Then regenerate
  const insightResult = await generateInsights(user.uid, { forceRegenerate: true });
  results.insights = {
    generated: insightResult.insights?.length || 0,
    success: insightResult.success
  };
  console.log('[InsightReassessment] Insights regenerated:', insightResult.insights?.length);

  // Step 5: Cleanup and finalize
  onProgress?.({ step: REASSESSMENT_STEPS.CLEANUP, progress: 100 });

  results.completedAt = new Date();
  console.log('[InsightReassessment] Reassessment complete');

  return results;
};

/**
 * Save pattern analysis to Firestore for caching
 */
const savePatternAnalysis = async (userId, patterns) => {
  const patternRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'patterns'
  );

  await setDoc(patternRef, {
    aggregated: patterns.aggregated,
    byType: patterns.byType,
    totalEntries: patterns.totalEntries,
    totalPatternsDetected: patterns.totalPatternsDetected,
    analyzedAt: Timestamp.now()
  }, { merge: true });
};

/**
 * Save correlation analysis to Firestore
 */
const saveCorrelationAnalysis = async (userId, correlations) => {
  const corrRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'correlations'
  );

  await setDoc(corrRef, {
    ...correlations,
    savedAt: Timestamp.now()
  }, { merge: true });
};

/**
 * Fetch recent entries
 */
const fetchRecentEntries = async (userId, days = 30) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const entriesRef = collection(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries'
  );

  const q = query(
    entriesRef,
    orderBy('createdAt', 'desc'),
    limit(500) // Cap for performance
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};
```

---

### Phase 4: Cloud Function for Background Reassessment

**Goal:** Heavy processing should run server-side to avoid mobile timeouts

**Add to:** `functions/index.js`

```javascript
/**
 * Triggered after backfill to recalculate insights server-side
 * Can handle large datasets without mobile timeout issues
 */
export const reassessInsightsAfterBackfill = onCall(
  {
    timeoutSeconds: 540, // 9 minutes
    memory: '1GiB'
  },
  async (request) => {
    const { auth: authContext } = request;
    if (!authContext) {
      throw new HttpsError('unauthenticated', 'Must be authenticated');
    }

    const uid = authContext.uid;
    console.log(`[reassessInsights] Starting for user: ${uid}`);

    const results = {
      baselines: null,
      patterns: null,
      correlations: null,
      insights: null
    };

    try {
      // Fetch all entries with new health/env context
      const entriesRef = db
        .collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(uid)
        .collection('entries');

      const snapshot = await entriesRef
        .orderBy('createdAt', 'desc')
        .limit(500)
        .get();

      const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`[reassessInsights] Processing ${entries.length} entries`);

      // Count entries with health/env context
      const withHealth = entries.filter(e => e.healthContext).length;
      const withEnv = entries.filter(e => e.environmentContext).length;
      console.log(`[reassessInsights] Entries with health: ${withHealth}, with env: ${withEnv}`);

      // Step 1: Recalculate baselines
      const baselines = await calculateBaselinesServer(uid, entries);
      results.baselines = { calculated: true, metrics: Object.keys(baselines.global || {}) };

      // Step 2: Re-run pattern detection
      const patterns = detectPatternsServer(entries);
      results.patterns = {
        total: Object.keys(patterns.aggregated || {}).length,
        byType: patterns.patternTypeCounts
      };

      // Save patterns
      await db
        .collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(uid)
        .collection('nexus')
        .doc('patterns')
        .set({
          ...patterns,
          analyzedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      // Step 3: Recalculate correlations
      const correlations = calculateCorrelationsServer(entries);
      results.correlations = {
        pairsAnalyzed: correlations.pairsAnalyzed || 0,
        available: correlations.available
      };

      // Save correlations
      await db
        .collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(uid)
        .collection('nexus')
        .doc('correlations')
        .set({
          ...correlations,
          savedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      // Step 4: Mark insights as stale (client will regenerate on next view)
      await db
        .collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(uid)
        .collection('nexus')
        .doc('insights')
        .set({
          stale: true,
          staleReason: 'backfill_reassessment',
          staleAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      results.insights = { markedStale: true };

      console.log(`[reassessInsights] Complete:`, results);
      return { success: true, results };

    } catch (error) {
      console.error(`[reassessInsights] Error:`, error);
      throw new HttpsError('internal', error.message);
    }
  }
);
```

---

### Phase 5: UI Components for Backfill

**Goal:** User-facing UI to trigger and monitor backfill progress

**New file:** `src/components/settings/BackfillPanel.jsx`

```jsx
/**
 * Backfill Panel Component
 *
 * Shows backfill status and allows user to trigger retroactive
 * health/environment data enrichment.
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Heart, Cloud, Brain, CheckCircle,
  AlertCircle, Loader, X, ChevronRight
} from 'lucide-react';
import { runFullBackfill, getBackfillSummary, BACKFILL_STAGES } from '../../services/backfill/unifiedBackfill';

const STAGE_INFO = {
  [BACKFILL_STAGES.IDLE]: { label: 'Ready', icon: RefreshCw, color: 'text-gray-400' },
  [BACKFILL_STAGES.HEALTH]: { label: 'Adding Health Data', icon: Heart, color: 'text-red-400' },
  [BACKFILL_STAGES.ENVIRONMENT]: { label: 'Adding Weather Data', icon: Cloud, color: 'text-blue-400' },
  [BACKFILL_STAGES.REASSESSMENT]: { label: 'Recalculating Insights', icon: Brain, color: 'text-purple-400' },
  [BACKFILL_STAGES.COMPLETE]: { label: 'Complete', icon: CheckCircle, color: 'text-green-400' },
  [BACKFILL_STAGES.ERROR]: { label: 'Error', icon: AlertCircle, color: 'text-red-500' }
};

export const BackfillPanel = ({ onComplete }) => {
  const [summary, setSummary] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState(BACKFILL_STAGES.IDLE);
  const [progress, setProgress] = useState({});
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const abortController = useRef(null);

  // Load summary on mount
  useEffect(() => {
    loadSummary();
  }, []);

  const loadSummary = async () => {
    try {
      const data = await getBackfillSummary();
      setSummary(data);
    } catch (err) {
      console.error('Failed to load backfill summary:', err);
    }
  };

  const handleStart = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    abortController.current = new AbortController();

    try {
      const result = await runFullBackfill(
        (update) => {
          setStage(update.stage);
          setProgress(update);
          if (update.results) setResults(update.results);
        },
        abortController.current.signal
      );

      setResults(result);
      setStage(BACKFILL_STAGES.COMPLETE);
      onComplete?.(result);

    } catch (err) {
      setError(err.message);
      setStage(BACKFILL_STAGES.ERROR);
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancel = () => {
    abortController.current?.abort();
    setIsRunning(false);
    setStage(BACKFILL_STAGES.IDLE);
  };

  const StageIcon = STAGE_INFO[stage]?.icon || RefreshCw;
  const stageColor = STAGE_INFO[stage]?.color || 'text-gray-400';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Enrich Historical Entries
        </h3>
        {isRunning && (
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Add health metrics and weather data to past journal entries, then recalculate your insights.
      </p>

      {/* Summary */}
      {summary && !isRunning && stage === BACKFILL_STAGES.IDLE && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.entriesNeedingHealth}
              </div>
              <div className="text-xs text-gray-500">entries need health data</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.entriesNeedingEnvironment}
              </div>
              <div className="text-xs text-gray-500">entries need weather data</div>
            </div>
          </div>
          {summary.estimatedTimeMinutes > 0 && (
            <div className="mt-3 text-xs text-gray-500">
              Estimated time: ~{summary.estimatedTimeMinutes} minutes
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ rotate: isRunning ? 360 : 0 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <StageIcon className={`${stageColor}`} size={24} />
            </motion.div>
            <div>
              <div className="font-medium text-gray-900 dark:text-white">
                {STAGE_INFO[stage]?.label}
              </div>
              {progress.processed !== undefined && (
                <div className="text-sm text-gray-500">
                  {progress.processed} / {progress.total} entries
                </div>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {progress.total > 0 && (
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <motion.div
                className="bg-purple-500 h-2 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${(progress.processed / progress.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {results && stage === BACKFILL_STAGES.COMPLETE && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-2">
            <CheckCircle size={20} />
            <span className="font-medium">Backfill Complete</span>
          </div>
          <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            {results.health?.updated > 0 && (
              <li>• {results.health.updated} entries enriched with health data</li>
            )}
            {results.environment?.updated > 0 && (
              <li>• {results.environment.updated} entries enriched with weather data</li>
            )}
            {results.reassessment?.insights?.generated > 0 && (
              <li>• {results.reassessment.insights.generated} insights regenerated</li>
            )}
          </ul>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Action button */}
      <button
        onClick={handleStart}
        disabled={isRunning || (summary?.totalEntriesNeedingBackfill === 0)}
        className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300
                   dark:disabled:bg-gray-700 text-white rounded-lg font-medium
                   transition-colors flex items-center justify-center gap-2"
      >
        {isRunning ? (
          <>
            <Loader className="animate-spin" size={20} />
            Processing...
          </>
        ) : (
          <>
            <RefreshCw size={20} />
            {summary?.totalEntriesNeedingBackfill > 0
              ? 'Start Enrichment'
              : 'All Entries Up to Date'}
          </>
        )}
      </button>
    </div>
  );
};

export default BackfillPanel;
```

---

### Phase 5.5: Update Entry Cards with Primary Readiness Metric

**Goal:** Surface the appropriate readiness metric (Sleep Score or Recovery) prominently on entry cards based on the user's connected health sources.

**Files to modify:**
- `src/components/entries/EntryCard.jsx`
- `src/services/health/healthDataService.js` (ensure proper source tracking)

**Implementation:**

#### 5.5.1 Add Primary Readiness Metric Component

```jsx
// In EntryCard.jsx - New component for primary readiness display

/**
 * Determine and display the primary readiness metric based on data source
 * - HealthKit-only: Sleep Score (calculated)
 * - Whoop: Recovery Score
 * - Both: Recovery Score (Whoop takes priority)
 */
const PrimaryReadinessMetric = ({ healthContext }) => {
  if (!healthContext) return null;

  const source = healthContext.source;
  const hasWhoop = source === 'whoop' || source === 'merged';
  const hasRecovery = healthContext.recovery?.score > 0;
  const hasSleepScore = healthContext.sleep?.score > 0;

  // Whoop users (or merged): Show Recovery as primary
  if (hasWhoop && hasRecovery) {
    const score = healthContext.recovery.score;
    const colorClass = score >= 67 ? 'bg-green-100 text-green-700 border-green-200' :
                       score >= 34 ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                                     'bg-red-100 text-red-700 border-red-200';
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${colorClass}`}>
        <Battery size={14} />
        <span className="font-semibold text-sm">Recovery {score}%</span>
      </div>
    );
  }

  // HealthKit-only users: Show Sleep Score as primary
  if (hasSleepScore) {
    const score = healthContext.sleep.score;
    const colorClass = score >= 80 ? 'bg-green-100 text-green-700 border-green-200' :
                       score >= 60 ? 'bg-purple-100 text-purple-700 border-purple-200' :
                                     'bg-orange-100 text-orange-700 border-orange-200';
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${colorClass}`}>
        <Moon size={14} />
        <span className="font-semibold text-sm">Sleep {score}</span>
      </div>
    );
  }

  return null;
};
```

#### 5.5.2 Update Health Context Display in EntryCard

```jsx
// Replace current health context section with source-aware display

{/* Health Context - Source Aware */}
{entry.healthContext && (() => {
  const health = entry.healthContext;
  const source = health.source;
  const hasWhoop = source === 'whoop' || source === 'merged';

  return (
    <>
      {/* Primary Readiness Metric - Always show first */}
      <PrimaryReadinessMetric healthContext={health} />

      {/* Secondary metrics based on source */}

      {/* Sleep hours (show for all sources, but NOT the score if already shown as primary) */}
      {health.sleep?.totalHours > 0 && (
        <span className="flex items-center gap-1 bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">
          <BedDouble size={10} />
          {health.sleep.totalHours.toFixed(1)}h
          {/* Only show score in parentheses if Whoop user (where Recovery is primary) */}
          {hasWhoop && health.sleep.score && (
            <span className="hidden sm:inline opacity-75">({health.sleep.score})</span>
          )}
        </span>
      )}

      {/* HRV - show for both sources */}
      {health.heart?.hrv > 0 && (
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full ${
          health.heart.stressIndicator === 'low' ? 'bg-green-50 text-green-700' :
          health.heart.stressIndicator === 'high' ? 'bg-orange-50 text-orange-700' :
          'bg-warm-50 text-warm-600'
        }`}>
          <Activity size={10} />
          HRV {health.heart.hrv}ms
        </span>
      )}

      {/* Strain - Whoop only */}
      {hasWhoop && health.strain?.score > 0 && (
        <span className="flex items-center gap-1 bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full">
          Strain {health.strain.score.toFixed(1)}
        </span>
      )}

      {/* Steps - preferably from HealthKit */}
      {health.activity?.stepsToday > 0 && (
        <span className="flex items-center gap-1 bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full hidden sm:flex">
          {health.activity.stepsToday.toLocaleString()} steps
        </span>
      )}
    </>
  );
})()}
```

#### 5.5.3 Update healthDataService.js Smart Merge

Ensure the merge function properly handles deduplication and source tracking:

```javascript
// In healthDataService.js - Enhanced smartMergeHealthData

const smartMergeHealthData = (whoopData, nativeData) => {
  return {
    available: true,
    source: 'merged',  // Explicitly mark as merged
    sources: ['whoop', nativeData.source || 'healthkit'],
    date: whoopData.date || nativeData.date,

    // ===== SLEEP: Always from Whoop (better 24/7 tracking) =====
    sleep: whoopData.sleep || nativeData.sleep,

    // ===== RECOVERY: Whoop only (this IS the primary readiness metric) =====
    recovery: whoopData.recovery,

    // ===== STRAIN: Whoop only =====
    strain: whoopData.strain,

    // ===== HEART: Merge - Whoop for overnight metrics =====
    heart: {
      restingRate: whoopData.heart?.restingRate || nativeData.heart?.restingRate,
      currentRate: nativeData.heart?.currentRate || whoopData.heart?.currentRate,
      hrv: whoopData.heart?.hrv || nativeData.heart?.hrv,
      hrvTrend: whoopData.heart?.hrvTrend || nativeData.heart?.hrvTrend,
      stressIndicator: whoopData.heart?.stressIndicator || nativeData.heart?.stressIndicator,
    },

    // ===== ACTIVITY: Steps from HealthKit, workout metrics from Whoop =====
    activity: {
      // Steps: HealthKit (Whoop doesn't track steps)
      stepsToday: nativeData.activity?.stepsToday || null, // Don't use Whoop's estimated steps
      stepsGoalMet: nativeData.activity?.stepsGoalMet || false,

      // Calories/Exercise: Whoop (better strain tracking)
      totalCaloriesBurned: whoopData.activity?.totalCaloriesBurned || nativeData.activity?.totalCaloriesBurned,
      activeCaloriesBurned: whoopData.activity?.activeCaloriesBurned || nativeData.activity?.activeCaloriesBurned,
      totalExerciseMinutes: whoopData.activity?.totalExerciseMinutes || nativeData.activity?.totalExerciseMinutes,
      hasWorkout: whoopData.activity?.hasWorkout || nativeData.activity?.hasWorkout,

      // Workouts: Merge with deduplication (Whoop preferred)
      workouts: mergeWorkoutsWithDeduplication(
        whoopData.activity?.workouts || [],
        nativeData.activity?.workouts || []
      ),
    },

    queriedAt: new Date().toISOString(),
  };
};

/**
 * Merge workouts from multiple sources, avoiding duplicates
 * Whoop workouts take priority; HealthKit workouts only added if no overlap
 */
const mergeWorkoutsWithDeduplication = (whoopWorkouts = [], healthKitWorkouts = []) => {
  // Whoop workouts are the base (have better strain/calorie data)
  const merged = whoopWorkouts.map(w => ({ ...w, source: 'whoop' }));

  // Add HealthKit workouts that don't overlap with Whoop
  for (const hkWorkout of healthKitWorkouts) {
    const hasOverlap = whoopWorkouts.some(whoopW => {
      // Check time overlap (within 30 minutes)
      if (hkWorkout.startTime && whoopW.startTime) {
        const timeDiff = Math.abs(
          new Date(hkWorkout.startTime).getTime() - new Date(whoopW.startTime).getTime()
        );
        if (timeDiff < 30 * 60 * 1000) return true; // 30 minute window
      }

      // Check same type on same day
      if (hkWorkout.type?.toLowerCase() === whoopW.type?.toLowerCase()) {
        return true;
      }

      return false;
    });

    if (!hasOverlap) {
      merged.push({ ...hkWorkout, source: 'healthkit' });
    }
  }

  return merged;
};
```

#### 5.5.4 Update Health Context Schema for Backfill

When backfilling, ensure the context includes proper source information:

```javascript
// Structure for HealthKit-only backfilled data
{
  sleep: {
    totalHours: 7.2,
    quality: 'good',
    score: 82,  // <-- Calculated sleep score is the primary metric
    stages: { deep: 1.2, core: 4.0, rem: 1.8, awake: 0.2 }
  },
  heart: { restingRate: 58, hrv: 45, stressIndicator: 'moderate' },
  activity: { stepsToday: 8500, hasWorkout: true, workouts: [...] },
  source: 'healthkit',  // <-- Important for UI to determine primary metric
  backfilled: true,
  backfilledAt: '2026-01-16T...'
}

// Structure for Whoop backfilled data
{
  sleep: { totalHours: 7.5, quality: 'good', score: null },
  recovery: { score: 72, status: 'yellow' },  // <-- Primary metric for Whoop
  strain: { score: 12.4, calories: 2100 },
  heart: { restingRate: 55, hrv: 52, stressIndicator: 'low' },
  activity: { totalCaloriesBurned: 2100, hasWorkout: true, workouts: [...] },
  source: 'whoop',  // <-- Important for UI to determine primary metric
  backfilled: true,
  backfilledAt: '2026-01-16T...'
}

// Structure for merged (both connected) backfilled data
{
  sleep: { totalHours: 7.5, quality: 'good', score: null },  // From Whoop
  recovery: { score: 72, status: 'yellow' },  // From Whoop - PRIMARY METRIC
  strain: { score: 12.4, calories: 2100 },  // From Whoop
  heart: { restingRate: 55, hrv: 52, stressIndicator: 'low' },  // From Whoop
  activity: {
    stepsToday: 8500,  // From HealthKit
    totalCaloriesBurned: 2100,  // From Whoop
    hasWorkout: true,
    workouts: [...]  // Merged with deduplication
  },
  source: 'merged',  // <-- Indicates both sources used
  sources: ['whoop', 'healthkit'],
  backfilled: true,
  backfilledAt: '2026-01-16T...'
}
```

---

### Phase 5.6: Insight Fatigue Mitigation (Drip-Feed)

**Problem:** When reassessing all insights at once, the system may find dozens of "new" correlations. Showing 50 new insights immediately is overwhelming.

**Solution:** Mark backfilled insights and drip-feed them over 7 days.

**Files to modify:**
- `src/services/backfill/insightReassessment.js`
- `src/services/nexus/insightRotation.js` (or create if doesn't exist)

**Implementation:**

```javascript
// When generating insights from backfill, mark them specially
const generateBackfilledInsights = async (userId, patterns, correlations) => {
  const insights = await synthesizeInsights(patterns, correlations);

  // Mark each insight as backfilled with a scheduled reveal date
  const now = new Date();
  const markedInsights = insights.map((insight, index) => ({
    ...insight,
    isBackfilled: true,
    backfilledAt: now.toISOString(),
    // Drip-feed: reveal 5-7 insights per day over 7 days
    scheduledRevealDate: addDays(now, Math.floor(index / 7)).toISOString(),
    revealed: false
  }));

  return markedInsights;
};

// In insightRotation.js - filter by reveal date
export const getVisibleInsights = (insights) => {
  const now = new Date();
  return insights.filter(insight => {
    // Non-backfilled insights are always visible
    if (!insight.isBackfilled) return true;

    // Backfilled insights only visible after scheduled reveal date
    if (!insight.scheduledRevealDate) return true;
    return new Date(insight.scheduledRevealDate) <= now;
  });
};

// Daily check to "reveal" scheduled insights (could be a Cloud Function)
export const revealScheduledInsights = async (userId) => {
  const insights = await getBackfilledInsights(userId);
  const now = new Date();

  const toReveal = insights.filter(i =>
    !i.revealed &&
    i.scheduledRevealDate &&
    new Date(i.scheduledRevealDate) <= now
  );

  // Update revealed status and notify user
  for (const insight of toReveal) {
    await updateInsight(userId, insight.id, { revealed: true });
  }

  return toReveal.length;
};
```

**Insight Schema Addition:**
```javascript
{
  id: string,
  type: 'correlation' | 'pattern' | 'anomaly',
  message: string,
  // ... existing fields

  // Backfill-specific fields
  isBackfilled: boolean,         // true if generated from backfill
  backfilledAt: Timestamp,       // when the backfill ran
  scheduledRevealDate: Timestamp, // when to show to user
  revealed: boolean              // has user seen it yet
}
```

---

### Phase 5.7: Weather Backfill with Location Requirement & Caching

**Problem 1:** Using current location for historical entries creates dirty data (user may have been on vacation).

**Problem 2:** Multiple entries on the same day in the same location would trigger redundant API calls.

**Solution:** Only backfill weather if entry has location metadata; cache by date+city.

**Files to modify:**
- `src/services/environment/environmentBackfill.js`

**Implementation:**

```javascript
// Weather cache by date + location (approximate city)
const weatherCache = new Map(); // Key: "2026-01-15|37.77|-122.42" (date|lat|lng rounded)

const getCacheKey = (date, lat, lng) => {
  const dateStr = date.toISOString().split('T')[0];
  // Round to ~10km precision to group nearby locations
  const latRounded = Math.round(lat * 10) / 10;
  const lngRounded = Math.round(lng * 10) / 10;
  return `${dateStr}|${latRounded}|${lngRounded}`;
};

/**
 * UPDATED: Only backfill weather if entry has location metadata
 * @param {Object} entry - Entry to backfill
 * @returns {Object|null} Environment context or null if no location
 */
const fetchEnvironmentForEntry = async (entry) => {
  // CRITICAL: Only backfill if entry has its own location metadata
  // Do NOT use current device location - that creates dirty data
  const entryLocation = entry.location || entry.environmentContext?.location;

  if (!entryLocation?.latitude || !entryLocation?.longitude) {
    console.log(`[EnvironmentBackfill] Skipping entry ${entry.id} - no location metadata`);
    return null; // Don't guess with current location
  }

  const { latitude, longitude } = entryLocation;
  const entryDate = entry.effectiveDate || entry.createdAt;

  // Check cache first (avoid redundant API calls for same day/location)
  const cacheKey = getCacheKey(entryDate, latitude, longitude);
  if (weatherCache.has(cacheKey)) {
    console.log(`[EnvironmentBackfill] Cache hit for ${cacheKey}`);
    return weatherCache.get(cacheKey);
  }

  // Fetch from API
  const daysAgo = Math.ceil((Date.now() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

  // Check 7-day limit
  if (daysAgo > 7) {
    console.log(`[EnvironmentBackfill] Entry ${entry.id} is ${daysAgo} days old - outside API limit`);
    return null;
  }

  const weatherData = await getDailyWeatherHistory(latitude, longitude, daysAgo + 1);

  if (!weatherData?.length) return null;

  const dayData = weatherData.find(d => d.date === entryDate.toISOString().split('T')[0]);
  if (!dayData) return null;

  const environmentContext = {
    weather: dayData.condition,
    weatherLabel: dayData.conditionLabel,
    temperature: dayData.tempMax,
    // ... rest of context
    location: { latitude, longitude }, // Preserve original location
    backfilled: true,
    backfilledAt: new Date().toISOString()
  };

  // Cache for other entries on same day/location
  weatherCache.set(cacheKey, environmentContext);

  return environmentContext;
};

/**
 * Main backfill - respects location requirement
 */
export const backfillEnvironmentData = async (onProgress, signal) => {
  const entries = await getEntriesWithoutEnvironment();

  let processed = 0;
  let updated = 0;
  let skippedNoLocation = 0;
  let skippedTooOld = 0;

  for (const entry of entries) {
    if (signal?.aborted) break;

    const environmentContext = await fetchEnvironmentForEntry(entry);

    if (environmentContext) {
      await updateEntryEnvironment(entry.id, environmentContext);
      updated++;
    } else if (!entry.location) {
      skippedNoLocation++;
    } else {
      skippedTooOld++;
    }

    processed++;
    onProgress?.({ processed, total: entries.length, updated, skippedNoLocation, skippedTooOld });
  }

  return { processed, updated, skippedNoLocation, skippedTooOld };
};
```

---

### Phase 5.8: Batched Firestore Writes

**Problem:** Individual `.update()` calls are slow and unreliable for bulk operations.

**Solution:** Use Firestore Batched Writes (up to 500 docs per batch).

**Implementation:**

```javascript
// In healthBackfill.js and environmentBackfill.js

import { writeBatch, doc } from 'firebase/firestore';

/**
 * Update multiple entries with health context using batched writes
 * @param {Array} updates - Array of { entryId, healthContext }
 */
export const batchUpdateHealthContext = async (updates) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Firestore limit: 500 operations per batch
  const BATCH_SIZE = 500;
  const batches = [];

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batchUpdates = updates.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);

    for (const { entryId, healthContext } of batchUpdates) {
      const entryRef = doc(
        db, 'artifacts', APP_COLLECTION_ID, 'users', user.uid, 'entries', entryId
      );
      batch.update(entryRef, {
        healthContext,
        updatedAt: new Date()
      });
    }

    batches.push(batch);
  }

  // Execute all batches
  console.log(`[Backfill] Executing ${batches.length} batches (${updates.length} total updates)`);

  for (let i = 0; i < batches.length; i++) {
    await batches[i].commit();
    console.log(`[Backfill] Batch ${i + 1}/${batches.length} committed`);
  }

  return { success: true, updated: updates.length };
};

// Updated backfill flow to collect updates then batch write
export const backfillHealthData = async (onProgress, signal) => {
  const entries = await getEntriesWithoutHealth();
  const updates = [];

  for (const entry of entries) {
    if (signal?.aborted) break;

    const healthContext = await fetchHealthDataForEntry(entry);

    if (healthContext) {
      updates.push({ entryId: entry.id, healthContext });
    }

    onProgress?.({
      processed: updates.length,
      total: entries.length,
      phase: 'collecting'
    });
  }

  // Batch write all collected updates
  if (updates.length > 0) {
    onProgress?.({ phase: 'writing', total: updates.length });
    await batchUpdateHealthContext(updates);
  }

  return { updated: updates.length };
};
```

---

### Phase 5.9: Source Indicator on Mood Heatmap

**Goal:** Show visual indicator (W for Whoop, H for HealthKit) next to readiness scores on the calendar/heatmap.

**Files to modify:**
- `src/components/dashboard/MoodHeatmap.jsx` (or similar)

**Implementation:**

```jsx
// In MoodHeatmap.jsx or calendar component

const SourceIndicator = ({ source }) => {
  if (!source) return null;

  const indicators = {
    whoop: { letter: 'W', color: 'text-blue-500', title: 'Whoop data' },
    healthkit: { letter: 'H', color: 'text-red-500', title: 'HealthKit data' },
    merged: { letter: 'W+H', color: 'text-purple-500', title: 'Whoop + HealthKit' }
  };

  const indicator = indicators[source];
  if (!indicator) return null;

  return (
    <span
      className={`text-[8px] font-bold ${indicator.color} ml-0.5`}
      title={indicator.title}
    >
      {indicator.letter}
    </span>
  );
};

// In the heatmap cell rendering
const HeatmapCell = ({ day, entry }) => {
  const healthSource = entry?.healthContext?.source;
  const readinessScore = getReadinessScore(entry?.healthContext);

  return (
    <div className="...">
      {readinessScore && (
        <div className="flex items-center">
          <span className="text-xs">{readinessScore}</span>
          <SourceIndicator source={healthSource} />
        </div>
      )}
    </div>
  );
};
```

---

### Phase 5.10: Thread Re-Identification & Biometric Enrichment After Backfill

**Goal:** After health data is attached, re-run thread identification so threads gain biometric context. Merge fragmented threads into unified storylines.

**Simplified Thread Model:** All threads live in a single `threads` collection with a `category` field. No separate `leadership_threads` collection.

**Problem:** Fragmented threads about the same topic (e.g., "Career Transition" and "Anthropic Interview") clutter the dashboard.

**Solution:** Detect overlapping threads and merge them. Enrich all threads with biometric context from newly-attached health data.

**Files to modify:**
- `src/services/backfill/insightReassessment.js`
- `src/services/nexus/threadManager.js`

**Implementation:**

```javascript
// In insightReassessment.js - add thread re-identification step

export const triggerInsightReassessment = async (onProgress, signal) => {
  // ... existing steps ...

  // STEP: Merge overlapping threads
  onProgress?.({ step: 'THREAD_MERGE', progress: 55 });

  const mergeResults = await mergeOverlappingThreads(user.uid, entries);
  results.threadMerge = {
    merged: mergeResults.mergedCount,
    storylinesCreated: mergeResults.storylinesCreated
  };

  console.log('[InsightReassessment] Threads merged:', mergeResults);

  // STEP: Re-identify threads with biometric context
  onProgress?.({ step: 'THREADS', progress: 60 });

  const threadResults = await reidentifyThreadsWithBiometrics(user.uid, entries);
  results.threads = {
    updated: threadResults.updatedCount,
    enriched: threadResults.enrichedWithBiometrics
  };

  console.log('[InsightReassessment] Threads re-identified:', threadResults);

  // ... continue with other steps ...
};

// In threadManager.js - thread merging (simplified model)

/**
 * Merge overlapping threads into unified storylines
 * Prevents dashboard clutter from fragmented threads
 *
 * NOTE: Single `threads` collection with `category` field
 * No separate leadership_threads collection
 *
 * Merge criteria:
 * 1. Significant entry overlap (>30% shared entries)
 * 2. Same category (career, health, relationship, personal)
 * 3. Overlapping time period
 * 4. Semantic similarity (if embeddings available)
 */
export const mergeOverlappingThreads = async (userId, entries) => {
  // Get all threads from single collection
  const threads = await getActiveThreads(userId);

  console.log(`[ThreadMerge] Analyzing ${threads.length} threads for overlap`);

  let mergedCount = 0;
  let storylinesCreated = 0;
  const processedIds = new Set();

  for (let i = 0; i < threads.length; i++) {
    const threadA = threads[i];
    if (processedIds.has(threadA.id)) continue;

    const relatedThreads = [threadA];

    for (let j = i + 1; j < threads.length; j++) {
      const threadB = threads[j];
      if (processedIds.has(threadB.id)) continue;

      if (shouldMergeThreads(threadA, threadB, entries)) {
        relatedThreads.push(threadB);
        processedIds.add(threadB.id);
      }
    }

    // If we found related threads, merge them
    if (relatedThreads.length > 1) {
      await mergeThreadsIntoOne(userId, relatedThreads, entries);
      storylinesCreated++;
      mergedCount += relatedThreads.length;

      // Mark secondary threads as merged (keep primary)
      for (let k = 1; k < relatedThreads.length; k++) {
        processedIds.add(relatedThreads[k].id);
        await markThreadAsMerged(userId, relatedThreads[k].id);
      }
    }

    processedIds.add(threadA.id);
  }

  return { mergedCount, storylinesCreated };
};

/**
 * Determine if two threads should be merged
 */
const shouldMergeThreads = (threadA, threadB, entries) => {
  // 1. Check category match
  if (threadA.category !== threadB.category) {
    return false;
  }

  // 2. Check entry overlap (>30% shared entries)
  const entriesA = new Set(threadA.entryIds || []);
  const entriesB = new Set(threadB.entryIds || []);

  const intersection = [...entriesA].filter(id => entriesB.has(id));
  const smallerSet = Math.min(entriesA.size, entriesB.size);

  if (smallerSet > 0 && intersection.length / smallerSet > 0.3) {
    console.log(`[ThreadMerge] Entry overlap: ${threadA.displayName} ↔ ${threadB.displayName}`);
    return true;
  }

  // 3. Check time period overlap
  const timeOverlap = checkTimeOverlap(threadA, threadB);
  if (!timeOverlap) {
    return false;
  }

  // 4. Check semantic similarity (keyword overlap or embedding similarity)
  const semanticScore = calculateSemanticSimilarity(threadA, threadB);
  if (semanticScore > 0.6) {
    console.log(`[ThreadMerge] Semantic match (${semanticScore.toFixed(2)}): ${threadA.displayName} ↔ ${threadB.displayName}`);
    return true;
  }

  // 5. Check for parent-child relationship in names
  // e.g., "Career Transition" and "Anthropic Interview" are related
  if (isSubtheme(threadA.displayName, threadB.displayName)) {
    console.log(`[ThreadMerge] Subtheme match: ${threadA.displayName} ↔ ${threadB.displayName}`);
    return true;
  }

  return false;
};

/**
 * Check if two threads overlap in time
 */
const checkTimeOverlap = (threadA, threadB) => {
  const startA = threadA.startedAt?.toDate?.() || new Date(threadA.startedAt);
  const startB = threadB.startedAt?.toDate?.() || new Date(threadB.startedAt);
  const endA = threadA.lastActivityAt?.toDate?.() || new Date();
  const endB = threadB.lastActivityAt?.toDate?.() || new Date();

  // Check if time ranges overlap
  return startA <= endB && startB <= endA;
};

/**
 * Calculate semantic similarity between threads
 * Uses keyword overlap if embeddings not available
 */
const calculateSemanticSimilarity = (threadA, threadB) => {
  // If we have embeddings, use cosine similarity
  if (threadA.embedding && threadB.embedding) {
    return cosineSimilarity(threadA.embedding, threadB.embedding);
  }

  // Fallback: keyword overlap from display names and topics
  const keywordsA = extractKeywords(threadA);
  const keywordsB = extractKeywords(threadB);

  const intersection = keywordsA.filter(k => keywordsB.includes(k));
  const union = [...new Set([...keywordsA, ...keywordsB])];

  return union.length > 0 ? intersection.length / union.length : 0;
};

/**
 * Check if one thread name is a subtheme of another
 * e.g., "Anthropic Interview" is a subtheme of "Career Transition"
 */
const isSubtheme = (nameA, nameB) => {
  const subthemePatterns = {
    'career': ['interview', 'job', 'application', 'offer', 'rejection', 'transition', 'role'],
    'health': ['fitness', 'diet', 'sleep', 'exercise', 'recovery', 'injury'],
    'relationship': ['dating', 'partner', 'friend', 'family', 'conflict', 'connection'],
    'personal': ['goal', 'habit', 'routine', 'growth', 'learning']
  };

  const lowerA = nameA.toLowerCase();
  const lowerB = nameB.toLowerCase();

  // Check if both names share category keywords
  for (const [category, keywords] of Object.entries(subthemePatterns)) {
    const aHasCategory = keywords.some(k => lowerA.includes(k));
    const bHasCategory = keywords.some(k => lowerB.includes(k));

    if (aHasCategory && bHasCategory) {
      return true;
    }
  }

  return false;
};

/**
 * Merge multiple threads into the primary thread (most entries)
 * Updates primary thread with combined data, marks others as merged
 */
const mergeThreadsIntoOne = async (userId, threads, entries) => {
  // Primary thread = one with most entries
  const sortedByEntries = [...threads].sort((a, b) =>
    (b.entryIds?.length || 0) - (a.entryIds?.length || 0)
  );
  const primaryThread = sortedByEntries[0];
  const secondaryThreads = sortedByEntries.slice(1);

  // Combine all entry IDs
  const allEntryIds = [...new Set(threads.flatMap(t => t.entryIds || []))];

  // Get all entries for biometric calculation
  const threadEntries = entries.filter(e => allEntryIds.includes(e.id));

  // Update primary thread with merged data
  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', primaryThread.id
  );

  await updateDoc(threadRef, {
    // Combined entry IDs
    entryIds: allEntryIds,

    // Track merged threads
    mergedFrom: secondaryThreads.map(t => ({ id: t.id, name: t.displayName })),
    mergedAt: new Date(),

    // Expand time range
    startedAt: new Date(Math.min(...threads.map(t =>
      t.startedAt?.toDate?.()?.getTime() || Date.now()
    ))),
    lastActivityAt: new Date(Math.max(...threads.map(t =>
      t.lastActivityAt?.toDate?.()?.getTime() || Date.now()
    ))),

    // Recalculate biometrics with all entries
    biometricContext: calculateThreadBiometrics(threadEntries)
  });

  console.log(`[ThreadMerge] Merged ${secondaryThreads.length} threads into "${primaryThread.displayName}"`);

  return primaryThread;
};

/**
 * Mark a thread as merged (soft delete, keep for history)
 * Single collection model - no source parameter needed
 */
const markThreadAsMerged = async (userId, threadId) => {
  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );

  await updateDoc(threadRef, {
    status: 'merged',
    mergedAt: new Date(),
    hidden: true // Don't show in dashboard
  });
};

/**
 * Re-identify threads now that entries have health context
 * Adds biometric patterns to existing threads
 */
export const reidentifyThreadsWithBiometrics = async (userId, entries) => {
  // Get active threads (excludes merged ones)
  const threads = await getActiveThreads(userId);

  let updatedCount = 0;
  let enrichedWithBiometrics = 0;

  for (const thread of threads) {
    // Get entries belonging to this thread
    const threadEntries = entries.filter(e =>
      thread.entryIds?.includes(e.id)
    );

    // Calculate biometric patterns
    const biometricPattern = calculateThreadBiometrics(threadEntries);

    if (biometricPattern.hasSignificantPattern) {
      await updateDoc(
        doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', thread.id),
        {
          biometricContext: {
            avgRHR: biometricPattern.avgRHR,
            rhrDelta: biometricPattern.rhrDelta,
            avgHRV: biometricPattern.avgHRV,
            hrvDelta: biometricPattern.hrvDelta,
            avgRecovery: biometricPattern.avgRecovery,
            avgSleepScore: biometricPattern.avgSleepScore,
            pattern: biometricPattern.description
          },
          biometricEnrichedAt: new Date()
        }
      );

      enrichedWithBiometrics++;
    }

    updatedCount++;
  }

  return { updatedCount, enrichedWithBiometrics };
};

/**
 * Calculate biometric patterns for a set of entries
 */
const calculateThreadBiometrics = (entries) => {
  const withHealth = entries.filter(e => e.healthContext);

  if (withHealth.length < 3) {
    return { hasSignificantPattern: false };
  }

  // Calculate averages
  const rhrs = withHealth
    .map(e => e.healthContext.heart?.restingRate)
    .filter(Boolean);
  const hrvs = withHealth
    .map(e => e.healthContext.heart?.hrv)
    .filter(Boolean);
  const recoveries = withHealth
    .map(e => e.healthContext.recovery?.score)
    .filter(Boolean);
  const sleepScores = withHealth
    .map(e => e.healthContext.sleep?.score)
    .filter(Boolean);

  const avgRHR = rhrs.length ? rhrs.reduce((a, b) => a + b, 0) / rhrs.length : null;
  const avgHRV = hrvs.length ? hrvs.reduce((a, b) => a + b, 0) / hrvs.length : null;
  const avgRecovery = recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : null;
  const avgSleepScore = sleepScores.length ? sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length : null;

  // Compare to user baseline (would need baseline data)
  // For now, flag as significant if we have enough data
  const hasSignificantPattern = rhrs.length >= 3 || hrvs.length >= 3;

  // Generate description
  let description = null;
  if (avgRecovery !== null) {
    if (avgRecovery < 40) description = 'low recovery period';
    else if (avgRecovery > 70) description = 'high recovery period';
  }

  return {
    hasSignificantPattern,
    avgRHR: avgRHR ? Math.round(avgRHR) : null,
    avgHRV: avgHRV ? Math.round(avgHRV) : null,
    avgRecovery: avgRecovery ? Math.round(avgRecovery) : null,
    avgSleepScore: avgSleepScore ? Math.round(avgSleepScore) : null,
    description,
    entriesWithHealth: withHealth.length
  };
};
```

**Thread Schema (Simplified - Single Collection)**

Firestore: `users/{userId}/threads/{threadId}`

```javascript
{
  id: string,
  displayName: "Career Transition",
  category: "career" | "health" | "relationship" | "personal",
  status: 'active' | 'merged' | 'resolved',

  // Entry references
  entryIds: ["entry1", "entry2", "entry3"],

  // Time range
  startedAt: Timestamp,
  lastActivityAt: Timestamp,

  // Biometric context (added by backfill)
  biometricContext: {
    avgRHR: 68,           // Average RHR during this thread
    rhrDelta: +5,         // vs user baseline (+5 = elevated)
    avgHRV: 42,           // Average HRV
    hrvDelta: -8,         // vs baseline (-8 = stressed)
    avgRecovery: 58,      // Average Whoop recovery
    avgSleepScore: 72,    // Average sleep score
    pattern: "elevated stress indicators",
    entriesWithHealth: 12
  },
  biometricEnrichedAt: Timestamp,

  // Merge tracking (if this thread absorbed others)
  mergedFrom: [
    { id: "thread_xyz", name: "Anthropic Interview" }
  ],
  mergedAt: Timestamp,

  // Hidden if merged INTO another thread
  hidden: boolean
}
```

**Note:** No separate `leadership_threads` or `storylines` collections. All threads in single `threads` collection with `category` field.

---

### Phase 6: Update onEntryUpdate to Handle Backfilled Entries

**Goal:** When an entry is updated with backfilled data, trigger lightweight reindexing

**Modify:** `functions/index.js` - `onEntryUpdate` function

```javascript
export const onEntryUpdate = onDocumentUpdated(
  `artifacts/${APP_COLLECTION_ID}/users/{userId}/entries/{entryId}`,
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const { userId, entryId } = event.params;

    // Check if this is a backfill update (health or environment context added)
    const healthBackfilled = !before.healthContext && after.healthContext?.backfilled;
    const envBackfilled = !before.environmentContext && after.environmentContext?.backfilled;

    if (healthBackfilled || envBackfilled) {
      console.log(`[onEntryUpdate] Backfill detected for entry ${entryId}`);

      // Mark patterns as needing refresh
      await db
        .collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users')
        .doc(userId)
        .collection('nexus')
        .doc('patterns')
        .set({
          stale: true,
          staleReason: 'entry_backfilled',
          staleAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

      // Don't regenerate insights per-entry (too expensive)
      // Wait for batch reassessment or next dashboard load
      return;
    }

    // ... existing update handling for non-backfill updates
  }
);
```

---

### Phase 7: Integration Points

**Goal:** Wire everything together

#### 7.1 Add to Settings Page

```jsx
// In src/pages/SettingsPage.jsx or similar
import { BackfillPanel } from '../components/settings/BackfillPanel';

// In render:
<section className="mb-8">
  <h2 className="text-xl font-semibold mb-4">Data Enrichment</h2>
  <BackfillPanel onComplete={() => {
    // Optionally refresh dashboard data
    toast.success('Insights updated with enriched data!');
  }} />
</section>
```

#### 7.2 Add Cloud Function to Firebase Config

```javascript
// In src/config/firebase.js
export const reassessInsightsFn = httpsCallable(
  functions,
  'reassessInsightsAfterBackfill',
  { timeout: 540000 } // 9 minute timeout
);
```

#### 7.3 Export from Services Index

```javascript
// In src/services/index.js
export * from './backfill/unifiedBackfill';
export * from './backfill/insightReassessment';
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER TRIGGERS BACKFILL                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     PHASE 1: HEALTH BACKFILL                            │
│                                                                         │
│  1. Query entries without healthContext                                 │
│  2. For each entry date:                                                │
│     - Try Whoop API first (richer data, longer history)                │
│     - Fall back to HealthKit if Whoop unavailable                      │
│  3. Update entry with healthContext { backfilled: true }               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   PHASE 2: ENVIRONMENT BACKFILL                         │
│                                                                         │
│  1. Query entries without environmentContext (7-day limit)             │
│  2. For each entry date:                                                │
│     - Query Open-Meteo historical weather API                          │
│     - Use cached location for coordinates                              │
│  3. Update entry with environmentContext { backfilled: true }          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: INSIGHT REASSESSMENT                        │
│                                                                         │
│  1. BASELINES: Recalculate personal baselines with new data            │
│     - Global baselines (rhr, hrv, mood, sleep)                         │
│     - Contextual baselines (per state, per activity)                   │
│                                                                         │
│  2. PATTERNS: Re-run pattern detection                                  │
│     - Narrative patterns (text-based)                                  │
│     - Health patterns (sleep quality, recovery, strain)                │
│     - Environment patterns (sunshine, weather, daylight)               │
│     - Combined patterns (health + environment)                         │
│                                                                         │
│  3. CORRELATIONS: Recalculate health-mood correlations                 │
│     - Sleep-mood correlation                                           │
│     - Steps-mood correlation                                           │
│     - Workout-mood correlation                                         │
│     - HRV/stress-mood correlation                                      │
│     - Recovery-mood correlation                                        │
│                                                                         │
│  4. INSIGHTS: Regenerate Nexus insights                                │
│     - Layer 1: Updated patterns                                        │
│     - Layer 2: Updated baselines & states                              │
│     - Layer 3: Causal synthesis with new data                          │
│     - Layer 4: Updated recommendations                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE                                      │
│                                                                         │
│  - User sees enriched insights                                         │
│  - New correlations unlocked (e.g., "mood 23% higher with 7+ hrs sleep")│
│  - Patterns detected that weren't visible before                       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

### Modified Files

| File | Changes |
|------|---------|
| `src/services/health/healthBackfill.js` | Add Whoop support, source selection, batched writes, proper source tagging |
| `src/services/health/whoop.js` | Add `getWhoopDataForDate()` for historical queries |
| `src/services/health/healthDataService.js` | Enhanced smart merge with deduplication, source tracking |
| `src/services/environment/environmentBackfill.js` | Location requirement, date+location caching, skip entries without location |
| `src/components/entries/EntryCard.jsx` | Add `PrimaryReadinessMetric` component, source-aware display |
| `src/components/dashboard/MoodHeatmap.jsx` | Add `SourceIndicator` component (W/H badges) |
| `src/services/nexus/threadManager.js` | Add thread merging, `mergeOverlappingThreads()`, `reidentifyThreadsWithBiometrics()` (single collection model) |
| `functions/index.js` | Add `reassessInsightsAfterBackfill`, update `onEntryUpdate` |
| `src/config/firebase.js` | Add `reassessInsightsFn` callable |
| `src/services/index.js` | Export new backfill services |
| Settings page | Add `BackfillPanel` component |

### New Files

| File | Purpose |
|------|---------|
| `src/services/backfill/unifiedBackfill.js` | Orchestrates health + env backfill with batched writes |
| `src/services/backfill/insightReassessment.js` | Reassesses insights after backfill, drip-feed scheduling |
| `src/services/backfill/index.js` | Exports |
| `src/services/nexus/insightRotation.js` | Filters insights by reveal date, manages drip-feed |
| `src/components/settings/BackfillPanel.jsx` | UI component for triggering backfill |

---

## Testing Plan

### Unit Tests

1. **healthBackfill.js**
   - Test source selection logic
   - Test Whoop fallback to HealthKit
   - Test entry update with backfilled flag
   - Test proper `source` field tagging

2. **environmentBackfill.js**
   - Test 7-day limit enforcement
   - Test cached location usage

3. **insightReassessment.js**
   - Test baseline recalculation
   - Test pattern detection with enriched data
   - Test correlation calculation

4. **healthDataService.js (Smart Merge)**
   - Test Whoop-only data returns `source: 'whoop'`
   - Test HealthKit-only data returns `source: 'healthkit'`
   - Test merged data returns `source: 'merged'`
   - Test workout deduplication (30-min window)
   - Test steps come from HealthKit when both connected
   - Test recovery/strain come from Whoop when both connected

5. **PrimaryReadinessMetric component**
   - Test HealthKit-only shows Sleep Score
   - Test Whoop shows Recovery Score
   - Test merged shows Recovery Score
   - Test color coding thresholds

### Integration Tests

1. **Full backfill pipeline**
   - Create entries without health/env context
   - Run full backfill
   - Verify entries updated
   - Verify insights regenerated

2. **Cancellation handling**
   - Start backfill
   - Cancel mid-process
   - Verify partial results saved

3. **Source-aware entry display**
   - Create entry with HealthKit-only data → verify Sleep Score prominent
   - Create entry with Whoop data → verify Recovery Score prominent
   - Create entry with both → verify Recovery Score primary, no duplicate workouts

### Manual Testing

1. **iOS device with HealthKit only**
   - Connect HealthKit (no Whoop)
   - Create entries over several days
   - Run backfill
   - **Verify Sleep Score displayed prominently on cards**
   - Verify sleep hours shown as secondary metric

2. **With Whoop connected (no HealthKit)**
   - Link Whoop account only
   - Run backfill
   - **Verify Recovery Score displayed prominently on cards**
   - Verify strain shown as secondary metric

3. **With both Whoop AND HealthKit connected**
   - Link both sources
   - Run backfill
   - **Verify Recovery Score (from Whoop) displayed as primary**
   - **Verify steps come from HealthKit**
   - **Verify NO duplicate workouts** (same workout shouldn't appear twice)
   - Verify sleep hours shown (from Whoop)

4. **Insight quality**
   - Before backfill: Note insight count and types
   - After backfill: Compare insights
   - Verify new health/environment patterns detected

5. **Insight drip-feed**
   - Run backfill that generates 20+ insights
   - Verify only ~7 insights visible on day 1
   - Check `scheduledRevealDate` on remaining insights
   - Wait 1 day (or mock date), verify more insights revealed

6. **Weather backfill location requirement**
   - Create entry WITH location metadata → verify weather backfilled
   - Create entry WITHOUT location metadata → verify skipped (not dirty data)
   - Verify `skippedNoLocation` count in results

7. **Thread biometric enrichment**
   - Create thread with 5+ entries
   - Run backfill with health data
   - Verify thread has `biometricContext` with avgRHR, avgHRV, etc.

8. **Thread merging (simplified model)**
   - Create thread "Career Transition" (category: career) with entries A, B, C
   - Create thread "Anthropic Interview" (category: career) with entries B, C, D (overlapping)
   - Run backfill reassessment
   - Verify threads merged: primary thread has combined `entryIds: [A, B, C, D]`
   - Verify secondary thread marked as `status: 'merged'`, `hidden: true`
   - Verify primary thread has `mergedFrom` array tracking absorbed thread
   - Dashboard should show 1 thread, not 2

9. **Batched writes performance**
   - Run backfill with 100+ entries
   - Verify batches of 500 are used (check logs)
   - Verify all entries updated correctly

---

## Rollout Plan

### Phase 1: Backend (1-2 days)
- Implement healthBackfill Whoop support
- Add Cloud Function for reassessment
- Test with dev account

### Phase 2: Services (1-2 days)
- Implement unified backfill service
- Implement insight reassessment service
- Unit tests

### Phase 3: UI (1 day)
- Build BackfillPanel component
- Integrate into Settings
- Progress indicators and error handling

### Phase 4: Testing (1-2 days)
- Full integration testing
- Test on iOS device
- Test with Whoop
- Performance testing with large entry counts

### Phase 5: Deploy (1 day)
- Deploy Cloud Functions
- Deploy frontend
- Monitor for errors
- Document in release notes

---

## Constraints & Considerations

### API Limitations
- **Open-Meteo**: 7-day historical weather limit (free tier)
- **HealthKit**: Data availability depends on user's device history
- **Whoop**: Requires OAuth token, 2-year history available

### Performance
- **Use Firestore Batched Writes** - Up to 500 docs per batch for speed/reliability
- Batch processing with delays to avoid rate limits
- Cloud Function has 9-minute timeout
- Mobile should offload heavy processing to server

### User Experience
- Progress indicators essential for long-running backfill
- Allow cancellation at any point
- Partial results should be saved if cancelled
- **Insight Drip-Feed** - Don't show 50 new insights at once (see Insight Fatigue Mitigation)

### Privacy
- All data stays in user's Firestore collection
- Location cached locally, not sent to server
- Weather fetched from public API (no personal data sent)

### Data Integrity
- **Only backfill weather if entry has location metadata** - Don't guess with current location
- Entries without location get `environmentContext: null` (not dirty data)

---

## Success Metrics

1. **Data Coverage**: % of entries with health/env context after backfill
2. **Insight Improvement**: New insight types unlocked by enriched data
3. **Correlation Discovery**: Health-mood correlations with statistical significance
4. **User Engagement**: Users completing full backfill flow

---

## Open Questions

1. Should we auto-run backfill on first app open after enabling health sources?
2. Should insights show "enriched with backfilled data" indicator?
3. How to handle entries older than Whoop/HealthKit data availability?
4. Should we implement periodic background backfill for new health data?

## Resolved Requirements

The following requirements have been clarified and incorporated into this plan:

| Requirement | Decision |
|-------------|----------|
| HealthKit-only users primary metric | **Sleep Score** (calculated) - displayed prominently on cards |
| Whoop users primary metric | **Recovery Score** - displayed prominently on cards |
| Both sources connected | **Recovery Score** as primary (Whoop priority), steps from HealthKit |
| Workout deduplication | 30-minute overlap window, same workout type = duplicate |
| Source tracking | Every `healthContext` must have `source` field (`healthkit`, `whoop`, or `merged`) |
| Thread model | **Single `threads` collection** with `category` field - no separate leadership_threads |

---

## Prioritized Issue List (From Technical Review)

### P0 - Critical (Must Fix Before Launch)

| Issue | Problem | Solution |
|-------|---------|----------|
| **Race Condition** | Backfill writes trigger `onEntryUpdate` which marks staleness, while unified backfill also triggers reassessment → double processing or missed entries | Skip staleness marking in `onEntryUpdate` for backfilled entries (check `backfilled: true` flag) |
| **Insight Regen Failure** | If insight regeneration fails mid-process, user sees blank insights screen | Use **staging → promote** pattern: generate new insights to `_staged` doc, then atomically swap |
| **Workout Deduplication** | Timezone-naive comparison causes false positives/negatives when user travels | Store all workout times in UTC, compare in UTC, use 60-min window for auto-detected workouts |

### P1 - Important (Significant Value)

| Issue | Problem | Solution |
|-------|---------|----------|
| **Lagged Correlations** | Current correlations are same-day only; real insights come from "Day N biometrics → Day N+1 mood" | Add lag-1 and lag-2 correlation analysis |
| **Backfill State Persistence** | If backfill is interrupted (app crash, timeout), must restart from beginning | Checkpoint every 50 entries to `backfill_state` doc |
| **Thread Model Simplification** | Previous leadership_threads collection adds complexity without value | Collapse into single `threads` collection with `category` field |

### P2 - Nice to Have

| Issue | Problem | Solution |
|-------|---------|----------|
| **Heuristic Patterns** | Missing known patterns like "Interview Cascade" (sleep drops before interviews) | Add hardcoded pattern detectors for common scenarios |
| **Drip-Feed Improvements** | Current drip-feed is time-based; should prioritize by insight quality/novelty | Sort by `confidenceScore` before scheduling reveal dates |

### Deferred (v2)

| Issue | Why Defer |
|-------|-----------|
| **Partial Correlations** | Over-engineering for 2-user app; revisit when user base grows |
| **VPN Location Check** | Rare edge case; can add if users report dirty data |
| **Insight Versioning** | Complex schema change; defer to v2 when we have insight editing |

---

## P0 Fix: Race Condition in onEntryUpdate

**Problem:** When unified backfill updates an entry with health/environment context, the `onEntryUpdate` Cloud Function triggers and marks patterns as stale. But the unified backfill service ALSO triggers reassessment at the end. This causes:
1. Double processing (wasted compute)
2. Race conditions (staleness flag set while reassessment is running)

**Solution:** Skip staleness marking for backfilled entries. The unified backfill service handles reassessment at the end.

```javascript
// In functions/index.js - onEntryUpdate

export const onEntryUpdate = onDocumentUpdated(
  `artifacts/${APP_COLLECTION_ID}/users/{userId}/entries/{entryId}`,
  async (event) => {
    const before = event.data.before.data();
    const after = event.data.after.data();
    const { userId, entryId } = event.params;

    // CRITICAL: Skip staleness marking for backfilled entries
    // The unified backfill service handles reassessment at the end
    const isBackfillUpdate = (
      (!before.healthContext && after.healthContext?.backfilled) ||
      (!before.environmentContext && after.environmentContext?.backfilled)
    );

    if (isBackfillUpdate) {
      console.log(`[onEntryUpdate] Backfill update detected for ${entryId} - skipping staleness mark`);
      // Do NOT mark patterns as stale - unified backfill handles this
      return;
    }

    // ... existing logic for non-backfill updates ...
  }
);
```

---

## P0 Fix: Insight Regeneration Failure (Staging Pattern)

**Problem:** If insight regeneration fails mid-process (timeout, error, crash), the user is left with:
- Old insights already marked as stale/deleted
- New insights partially written or missing
- Result: blank insights screen

**Solution:** Use **staging → promote** pattern:
1. Generate new insights to a `_staged` document
2. Validate the staged insights are complete
3. Atomically swap: copy staged → live, then delete old
4. If any step fails, the old insights remain untouched

```javascript
// In insightReassessment.js - updated insight regeneration

const INSIGHTS_DOC = 'insights';
const INSIGHTS_STAGED_DOC = 'insights_staged';

/**
 * Regenerate insights using staging pattern
 * Prevents blank screen if regeneration fails
 */
export const regenerateInsightsWithStaging = async (userId, patterns, correlations) => {
  const nexusRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus');

  try {
    // Step 1: Generate new insights to STAGED document
    console.log('[InsightRegen] Generating insights to staging...');

    const newInsights = await synthesizeInsights(patterns, correlations);

    if (!newInsights || newInsights.length === 0) {
      console.warn('[InsightRegen] No insights generated - keeping existing');
      return { success: false, reason: 'no_insights_generated' };
    }

    // Write to staged document
    await setDoc(doc(nexusRef, INSIGHTS_STAGED_DOC), {
      insights: newInsights,
      generatedAt: Timestamp.now(),
      patternsUsed: patterns.totalPatternsDetected,
      correlationsUsed: correlations.pairsAnalyzed
    });

    console.log(`[InsightRegen] Staged ${newInsights.length} insights`);

    // Step 2: Validate staged insights
    const stagedDoc = await getDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));
    if (!stagedDoc.exists() || !stagedDoc.data().insights?.length) {
      throw new Error('Staged insights validation failed');
    }

    // Step 3: Atomic swap - copy staged to live
    console.log('[InsightRegen] Promoting staged insights to live...');

    const stagedData = stagedDoc.data();
    await setDoc(doc(nexusRef, INSIGHTS_DOC), {
      ...stagedData,
      stale: false,
      promotedAt: Timestamp.now()
    });

    // Step 4: Clean up staged document
    await deleteDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));

    console.log('[InsightRegen] Successfully promoted insights');

    return {
      success: true,
      generated: newInsights.length
    };

  } catch (error) {
    console.error('[InsightRegen] Failed - existing insights preserved:', error);

    // Clean up staged document if it exists
    try {
      await deleteDoc(doc(nexusRef, INSIGHTS_STAGED_DOC));
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }

    return {
      success: false,
      error: error.message,
      // Existing insights are untouched
    };
  }
};
```

---

## P0 Fix: Workout Deduplication with Timezone Awareness

**Problem:** Current deduplication uses local time comparison, which fails when:
- User traveled (workout recorded in different timezone)
- Whoop and HealthKit have different timezone handling

**Solution:** Store all times in UTC, compare in UTC, use wider window for auto-detected workouts.

```javascript
// In healthDataService.js - improved workout deduplication

/**
 * Merge workouts with timezone-aware deduplication
 * All comparisons done in UTC to avoid timezone issues
 */
const mergeWorkoutsWithDeduplication = (whoopWorkouts = [], healthKitWorkouts = []) => {
  // Whoop workouts are the base (have better strain/calorie data)
  const merged = whoopWorkouts.map(w => ({
    ...w,
    source: 'whoop',
    // Normalize to UTC timestamp for comparison
    _startUtc: new Date(w.startTime).getTime()
  }));

  for (const hkWorkout of healthKitWorkouts) {
    const hkStartUtc = new Date(hkWorkout.startTime).getTime();

    const hasOverlap = merged.some(whoopW => {
      // Time comparison in UTC
      const timeDiffMs = Math.abs(hkStartUtc - whoopW._startUtc);

      // Use different windows based on workout detection
      // Auto-detected workouts (like "Workout" type) need wider window
      const isAutoDetected = isGenericWorkoutType(hkWorkout.type) || isGenericWorkoutType(whoopW.type);
      const windowMs = isAutoDetected ? 60 * 60 * 1000 : 30 * 60 * 1000; // 60 or 30 min

      if (timeDiffMs < windowMs) {
        return true;
      }

      // Fuzzy type matching for same-day workouts
      if (isSameDay(hkStartUtc, whoopW._startUtc) &&
          fuzzyWorkoutTypeMatch(hkWorkout.type, whoopW.type)) {
        return true;
      }

      return false;
    });

    if (!hasOverlap) {
      merged.push({
        ...hkWorkout,
        source: 'healthkit',
        _startUtc: hkStartUtc
      });
    }
  }

  // Remove internal comparison field before returning
  return merged.map(({ _startUtc, ...workout }) => workout);
};

/**
 * Check if workout type is generic/auto-detected
 */
const isGenericWorkoutType = (type) => {
  const genericTypes = ['workout', 'other', 'unknown', 'activity', 'exercise'];
  return genericTypes.includes(type?.toLowerCase());
};

/**
 * Check if two timestamps are on the same calendar day (UTC)
 */
const isSameDay = (ts1, ts2) => {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return d1.toISOString().split('T')[0] === d2.toISOString().split('T')[0];
};

/**
 * Fuzzy match workout types
 * "Running" matches "Outdoor Run", "Indoor Run", "Run", etc.
 */
const fuzzyWorkoutTypeMatch = (type1, type2) => {
  const normalize = (t) => t?.toLowerCase().replace(/[^a-z]/g, '') || '';
  const t1 = normalize(type1);
  const t2 = normalize(type2);

  // Direct match
  if (t1 === t2) return true;

  // One contains the other
  if (t1.includes(t2) || t2.includes(t1)) return true;

  // Common synonyms
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
```

---

## P1: Lagged Correlations

**Problem:** Current correlation analysis only compares same-day metrics. But the real insights come from lagged relationships:
- "Poor sleep on Day N → low mood on Day N+1"
- "High strain on Day N → elevated RHR for 2 days"

**Implementation:**

```javascript
// In healthMoodCorrelation.js - add lagged correlation analysis

/**
 * Analyze correlations with time lags
 * Lag-0: Same day (current behavior)
 * Lag-1: Metric on Day N → Mood on Day N+1
 * Lag-2: Metric on Day N → Mood on Day N+2
 */
export const analyzeLaggedCorrelations = (entries, healthDays) => {
  const results = {
    lag0: {},  // Same-day correlations
    lag1: {},  // Next-day correlations
    lag2: {},  // Two-day correlations
    insights: []
  };

  // Sort entries by date
  const sortedEntries = [...entries].sort((a, b) =>
    new Date(a.createdAt) - new Date(b.createdAt)
  );

  // Build date-indexed maps
  const moodByDate = buildMoodByDate(sortedEntries);
  const healthByDate = buildHealthByDate(healthDays);

  // Metrics to correlate
  const metrics = ['sleepHours', 'sleepScore', 'hrv', 'recovery', 'strain', 'steps'];

  for (const metric of metrics) {
    for (const lag of [0, 1, 2]) {
      const pairs = buildLaggedPairs(healthByDate, moodByDate, metric, lag);

      if (pairs.length >= 5) {  // Minimum sample size
        const correlation = calculatePearsonCorrelation(pairs);

        results[`lag${lag}`][metric] = {
          correlation,
          sampleSize: pairs.length,
          significant: Math.abs(correlation) > 0.3 && pairs.length >= 10
        };

        // Generate insight for significant lagged correlations
        if (lag > 0 && Math.abs(correlation) > 0.3 && pairs.length >= 10) {
          results.insights.push({
            type: 'lagged_correlation',
            metric,
            lag,
            correlation,
            message: generateLaggedInsightMessage(metric, lag, correlation),
            confidence: calculateConfidence(correlation, pairs.length)
          });
        }
      }
    }
  }

  return results;
};

/**
 * Build pairs for lagged correlation
 * @param {number} lag - Days of lag (0 = same day, 1 = next day, etc.)
 */
const buildLaggedPairs = (healthByDate, moodByDate, metric, lag) => {
  const pairs = [];

  for (const [dateStr, healthData] of Object.entries(healthByDate)) {
    const metricValue = extractMetricValue(healthData, metric);
    if (metricValue === null) continue;

    // Get mood from date + lag
    const targetDate = addDays(new Date(dateStr), lag);
    const targetDateStr = targetDate.toISOString().split('T')[0];
    const moodValue = moodByDate[targetDateStr];

    if (moodValue !== undefined) {
      pairs.push({ x: metricValue, y: moodValue });
    }
  }

  return pairs;
};

/**
 * Generate human-readable insight for lagged correlation
 */
const generateLaggedInsightMessage = (metric, lag, correlation) => {
  const direction = correlation > 0 ? 'positively' : 'negatively';
  const strength = Math.abs(correlation) > 0.5 ? 'strongly' : 'moderately';

  const metricLabels = {
    sleepHours: 'sleep duration',
    sleepScore: 'sleep quality',
    hrv: 'HRV',
    recovery: 'recovery score',
    strain: 'workout strain',
    steps: 'step count'
  };

  const lagLabels = {
    1: 'the next day',
    2: 'two days later'
  };

  return `Your ${metricLabels[metric] || metric} ${strength} ${direction} affects your mood ${lagLabels[lag]}.`;
};

/**
 * Pearson correlation coefficient
 */
const calculatePearsonCorrelation = (pairs) => {
  if (pairs.length < 2) return 0;

  const n = pairs.length;
  const sumX = pairs.reduce((s, p) => s + p.x, 0);
  const sumY = pairs.reduce((s, p) => s + p.y, 0);
  const sumXY = pairs.reduce((s, p) => s + (p.x * p.y), 0);
  const sumX2 = pairs.reduce((s, p) => s + (p.x * p.x), 0);
  const sumY2 = pairs.reduce((s, p) => s + (p.y * p.y), 0);

  const numerator = (n * sumXY) - (sumX * sumY);
  const denominator = Math.sqrt(
    ((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY))
  );

  return denominator === 0 ? 0 : numerator / denominator;
};
```

---

## P1: Backfill State Persistence

**Problem:** If backfill is interrupted (app crash, timeout, user navigates away), it must restart from the beginning, re-processing entries that were already updated.

**Solution:** Checkpoint progress every 50 entries to a `backfill_state` document. On resume, skip already-processed entries.

```javascript
// In unifiedBackfill.js - add state persistence

const CHECKPOINT_INTERVAL = 50;  // Save state every 50 entries
const BACKFILL_STATE_KEY = 'backfill_state';

/**
 * Backfill state structure stored in Firestore
 */
// users/{userId}/settings/backfill_state
// {
//   phase: 'health' | 'environment' | 'reassessment',
//   lastProcessedEntryId: string,
//   processedEntryIds: string[],  // Set of already-processed IDs
//   startedAt: Timestamp,
//   lastCheckpointAt: Timestamp,
//   stats: { processed, updated, skipped, failed }
// }

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
      const lastCheckpoint = data.lastCheckpointAt?.toDate();
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

  console.log(`[Backfill] Checkpoint saved: ${state.stats.processed} processed`);
};

/**
 * Clear backfill state (on completion)
 */
const clearBackfillState = async (userId) => {
  const stateRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', BACKFILL_STATE_KEY
  );
  await deleteDoc(stateRef);
};

/**
 * Run backfill with state persistence
 */
export const runFullBackfillWithPersistence = async (onProgress, signal) => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  // Try to resume from previous state
  let state = await loadBackfillState(user.uid);
  const isResume = state !== null;

  if (isResume) {
    console.log(`[Backfill] Resuming from checkpoint: phase=${state.phase}, processed=${state.stats.processed}`);
    onProgress?.({
      stage: state.phase,
      resuming: true,
      previousProgress: state.stats
    });
  } else {
    state = {
      phase: 'health',
      processedEntryIds: [],
      startedAt: new Date(),
      stats: { processed: 0, updated: 0, skipped: 0, failed: 0 }
    };
  }

  const processedSet = new Set(state.processedEntryIds);

  try {
    // Phase 1: Health backfill
    if (state.phase === 'health') {
      const entries = await getEntriesWithoutHealth();
      const entriesToProcess = entries.filter(e => !processedSet.has(e.id));

      console.log(`[Backfill] Health phase: ${entriesToProcess.length} entries to process`);

      let checkpointCounter = 0;

      for (const entry of entriesToProcess) {
        if (signal?.aborted) throw new Error('Cancelled');

        const result = await processHealthEntry(entry);
        state.stats.processed++;
        if (result.updated) state.stats.updated++;
        else if (result.skipped) state.stats.skipped++;
        else state.stats.failed++;

        processedSet.add(entry.id);
        state.processedEntryIds = [...processedSet];
        state.lastProcessedEntryId = entry.id;

        checkpointCounter++;

        // Checkpoint every N entries
        if (checkpointCounter >= CHECKPOINT_INTERVAL) {
          await saveBackfillState(user.uid, state);
          checkpointCounter = 0;
        }

        onProgress?.({ stage: 'health', ...state.stats });
      }

      // Move to next phase
      state.phase = 'environment';
      state.processedEntryIds = []; // Reset for environment phase
      await saveBackfillState(user.uid, state);
    }

    // Phase 2: Environment backfill
    if (state.phase === 'environment') {
      // ... similar pattern with checkpointing
      state.phase = 'reassessment';
      await saveBackfillState(user.uid, state);
    }

    // Phase 3: Insight reassessment
    if (state.phase === 'reassessment') {
      await triggerInsightReassessment(onProgress, signal);
    }

    // Complete - clear state
    await clearBackfillState(user.uid);

    return {
      success: true,
      ...state.stats,
      resumed: isResume
    };

  } catch (error) {
    if (error.message === 'Cancelled') {
      // Save state for resume
      await saveBackfillState(user.uid, state);
      return { cancelled: true, canResume: true, ...state.stats };
    }
    throw error;
  }
};
```
