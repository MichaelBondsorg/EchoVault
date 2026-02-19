/**
 * Periodic Rollup Cloud Function
 *
 * Scheduled function that runs hourly to reconcile analytics data,
 * compute health trends, refresh recency scores, and clean up stale data.
 */
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';

const HALF_LIFE_DAYS = 14;
const STALE_ENTITY_DAYS = 90;
const MAX_PROCESSED_IDS = 100;

const LIFE_DOMAINS = [
  'work', 'relationships', 'health', 'creativity',
  'spirituality', 'personal-growth', 'family', 'finances',
];

function computeRecencyWeight(daysAgo) {
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

/**
 * Computes period keys for a given date across all cadences.
 */
function getPeriodKeys(date) {
  const d = new Date(date);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + mondayOffset));
  const weekKey = `weekly-${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`;
  const monthKey = `monthly-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const quarter = Math.floor(d.getUTCMonth() / 3);
  const quarterMonth = String(quarter * 3 + 1).padStart(2, '0');
  const quarterKey = `quarterly-${d.getUTCFullYear()}-${quarterMonth}-01`;
  const annualKey = `annual-${d.getUTCFullYear()}-01-01`;
  return { weekly: weekKey, monthly: monthKey, quarterly: quarterKey, annual: annualKey };
}

/**
 * Main handler for the periodic analytics rollup.
 * Processes users with recent activity to refresh analytics data.
 */
export async function handlePeriodicRollup() {
  const db = getFirestore();
  const usersPath = `artifacts/${APP_COLLECTION_ID}/users`;

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 24);

  const now = new Date();
  let usersProcessed = 0;

  try {
    const usersSnapshot = await db.collection(usersPath).listDocuments();

    for (const userDoc of usersSnapshot) {
      const userId = userDoc.id;
      const analyticsPath = `${usersPath}/${userId}/analytics`;
      const entriesPath = `${usersPath}/${userId}/entries`;

      try {
        const coverageRef = db.doc(`${analyticsPath}/topic_coverage`);
        const coverageSnap = await coverageRef.get();

        if (!coverageSnap.exists) continue;

        const coverageData = coverageSnap.data();
        const lastUpdated = coverageData?.lastUpdated?.toDate?.();

        if (lastUpdated && lastUpdated < cutoff) continue;

        // 1. Reconcile entry_stats against actual entries
        await reconcileEntryStats(db, analyticsPath, entriesPath, now);

        // 2. Compute health trend aggregations
        await computeHealthTrends(db, analyticsPath, entriesPath, now);

        // 3. Refresh topic coverage recency scores
        await refreshTopicCoverageRecency(db, analyticsPath, now);

        // 4. Refresh entity activity recency scores
        await refreshEntityRecency(db, analyticsPath, now);

        // 5. Clean up stale entities
        await cleanupStaleEntities(db, analyticsPath, now);

        // 6. Trim processed entry ID sets
        await trimProcessedIds(db, analyticsPath);

        usersProcessed++;
      } catch (userError) {
        console.error(`Error processing rollup for user ${userId}:`, userError);
      }
    }

    console.log(`Periodic rollup complete: ${usersProcessed} users processed`);
    return { success: true, usersProcessed };
  } catch (error) {
    console.error('Periodic rollup failed:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Reconciles entry_stats by querying actual entries for the current week
 * and comparing against stored stats. Fixes discrepancies.
 */
async function reconcileEntryStats(db, analyticsPath, entriesPath, now) {
  const periodKeys = getPeriodKeys(now);
  const weeklyKey = periodKeys.weekly;

  // Parse the weekly key to get the Monday date for querying
  const weekParts = weeklyKey.replace('weekly-', '').split('-');
  const weekStart = new Date(Date.UTC(
    parseInt(weekParts[0]), parseInt(weekParts[1]) - 1, parseInt(weekParts[2])
  ));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  // Query entries for the current week
  const entriesSnap = await db.collection(entriesPath)
    .where('createdAt', '>=', weekStart)
    .where('createdAt', '<', weekEnd)
    .get();

  if (entriesSnap.empty) return;

  // Compute actual stats from entries
  let entryCount = 0;
  let moodSum = 0;
  let moodMin = Infinity;
  let moodMax = -Infinity;
  let moodCount = 0;
  const categoryBreakdown = {};
  const entryTypeDistribution = {};

  for (const doc of entriesSnap.docs) {
    const entry = doc.data();
    // Only count analyzed entries
    if (entry.analysisStatus !== 'complete') continue;

    entryCount++;

    const moodScore = entry.analysis?.mood_score ?? entry.localAnalysis?.mood_score ?? null;
    if (moodScore != null && !isNaN(moodScore)) {
      moodSum += moodScore;
      moodMin = Math.min(moodMin, moodScore);
      moodMax = Math.max(moodMax, moodScore);
      moodCount++;
    }

    const category = entry.localAnalysis?.category || entry.category || 'personal';
    categoryBreakdown[category] = (categoryBreakdown[category] || 0) + 1;

    const entryType = entry.localAnalysis?.entry_type || 'mixed';
    entryTypeDistribution[entryType] = (entryTypeDistribution[entryType] || 0) + 1;
  }

  if (entryCount === 0) return;

  // Compare with stored stats and fix if different
  const statsRef = db.doc(`${analyticsPath}/entry_stats`);
  const statsSnap = await statsRef.get();
  const stored = statsSnap.exists ? statsSnap.data() : {};
  const storedWeekly = stored?.periods?.[weeklyKey] || {};

  const needsUpdate =
    storedWeekly.entryCount !== entryCount ||
    storedWeekly.moodCount !== moodCount ||
    Math.abs((storedWeekly.moodSum || 0) - moodSum) > 0.001;

  if (needsUpdate) {
    const weeklyStats = {
      entryCount,
      moodSum,
      moodMin: moodCount > 0 ? moodMin : 0,
      moodMax: moodCount > 0 ? moodMax : 0,
      moodCount,
      categoryBreakdown,
      entryTypeDistribution,
    };

    await statsRef.set({
      [`periods.${weeklyKey}`]: weeklyStats,
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`Reconciled entry_stats for ${weeklyKey}: ${entryCount} entries`);
  }
}

/**
 * Computes health trend aggregations from entries with healthContext.
 * Aggregates sleep quality, HRV, recovery, and mood-health correlations.
 */
async function computeHealthTrends(db, analyticsPath, entriesPath, now) {
  const periodKeys = getPeriodKeys(now);
  const weeklyKey = periodKeys.weekly;

  // Parse week start
  const weekParts = weeklyKey.replace('weekly-', '').split('-');
  const weekStart = new Date(Date.UTC(
    parseInt(weekParts[0]), parseInt(weekParts[1]) - 1, parseInt(weekParts[2])
  ));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  // Query entries with health data for the current week
  const entriesSnap = await db.collection(entriesPath)
    .where('createdAt', '>=', weekStart)
    .where('createdAt', '<', weekEnd)
    .get();

  const sleepScores = [];
  const hrvValues = [];
  const recoveryScores = [];
  const moodScores = [];
  const moodWithSleep = [];
  const moodWithHrv = [];

  for (const doc of entriesSnap.docs) {
    const entry = doc.data();
    const health = entry.healthContext;
    const mood = entry.analysis?.mood_score ?? entry.localAnalysis?.mood_score ?? null;

    if (mood != null) moodScores.push(mood);

    if (!health) continue;

    // Extract sleep data
    const sleepScore = health.sleep?.score;
    if (sleepScore != null) {
      sleepScores.push(sleepScore);
      if (mood != null) moodWithSleep.push({ sleep: sleepScore, mood });
    }

    // Extract HRV data
    const hrv = health.heart?.hrv;
    if (hrv != null) {
      hrvValues.push(hrv);
      if (mood != null) moodWithHrv.push({ hrv, mood });
    }

    // Extract recovery data
    const recovery = health.recovery?.score;
    if (recovery != null) {
      recoveryScores.push(recovery);
    }
  }

  // Only compute trends if we have health data
  if (sleepScores.length === 0 && hrvValues.length === 0 && recoveryScores.length === 0) {
    return;
  }

  const weeklyTrends = {};

  if (sleepScores.length > 0) {
    weeklyTrends.sleepQuality = {
      mean: average(sleepScores),
      min: Math.min(...sleepScores),
      max: Math.max(...sleepScores),
      dataPoints: sleepScores.length,
    };
  }

  if (hrvValues.length > 0) {
    weeklyTrends.hrv = {
      mean: average(hrvValues),
      min: Math.min(...hrvValues),
      max: Math.max(...hrvValues),
      dataPoints: hrvValues.length,
    };
  }

  if (recoveryScores.length > 0) {
    weeklyTrends.recovery = {
      mean: average(recoveryScores),
      min: Math.min(...recoveryScores),
      max: Math.max(...recoveryScores),
      dataPoints: recoveryScores.length,
    };
  }

  // Compute mood correlations if we have enough data
  const correlations = [];
  if (moodWithSleep.length >= 3) {
    const corr = pearsonCorrelation(
      moodWithSleep.map(d => d.sleep),
      moodWithSleep.map(d => d.mood)
    );
    if (corr !== null) {
      correlations.push({
        metric: 'sleepQuality',
        correlation: Math.round(corr * 100) / 100,
        direction: corr > 0 ? 'positive' : 'negative',
        sampleSize: moodWithSleep.length,
      });
    }
  }

  if (moodWithHrv.length >= 3) {
    const corr = pearsonCorrelation(
      moodWithHrv.map(d => d.hrv),
      moodWithHrv.map(d => d.mood)
    );
    if (corr !== null) {
      correlations.push({
        metric: 'hrv',
        correlation: Math.round(corr * 100) / 100,
        direction: corr > 0 ? 'positive' : 'negative',
        sampleSize: moodWithHrv.length,
      });
    }
  }

  if (correlations.length > 0) {
    weeklyTrends.moodCorrelations = correlations;
  }

  // Detect trend direction by comparing with previous week
  const trendsRef = db.doc(`${analyticsPath}/health_trends`);
  const trendsSnap = await trendsRef.get();
  const existing = trendsSnap.exists ? trendsSnap.data() : {};

  // Find previous weekly key
  const prevWeekStart = new Date(weekStart);
  prevWeekStart.setUTCDate(prevWeekStart.getUTCDate() - 7);
  const prevWeekKey = `weekly-${prevWeekStart.getUTCFullYear()}-${String(prevWeekStart.getUTCMonth() + 1).padStart(2, '0')}-${String(prevWeekStart.getUTCDate()).padStart(2, '0')}`;
  const prevWeek = existing?.periods?.[prevWeekKey];

  if (prevWeek) {
    if (weeklyTrends.sleepQuality && prevWeek.sleepQuality) {
      weeklyTrends.sleepQuality.trend = computeTrend(weeklyTrends.sleepQuality.mean, prevWeek.sleepQuality.mean);
    }
    if (weeklyTrends.hrv && prevWeek.hrv) {
      weeklyTrends.hrv.trend = computeTrend(weeklyTrends.hrv.mean, prevWeek.hrv.mean);
    }
    if (weeklyTrends.recovery && prevWeek.recovery) {
      weeklyTrends.recovery.trend = computeTrend(weeklyTrends.recovery.mean, prevWeek.recovery.mean);
    }
  }

  await trendsRef.set({
    [`periods.${weeklyKey}`]: weeklyTrends,
    lastUpdated: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`Computed health trends for ${weeklyKey}: sleep=${sleepScores.length}, hrv=${hrvValues.length}, recovery=${recoveryScores.length}`);
}

/**
 * Refreshes topic coverage recency scores by applying time-based decay.
 */
async function refreshTopicCoverageRecency(db, analyticsPath, now) {
  const coverageRef = db.doc(`${analyticsPath}/topic_coverage`);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(coverageRef);
    if (!snap.exists) return;

    const data = snap.data();
    const rawScores = data.rawScores || {};
    let hasChanges = false;

    const lastUpdated = data.lastUpdated?.toDate?.() || now;
    const hoursSinceUpdate = Math.max(0, (now - lastUpdated) / (1000 * 60 * 60));

    if (hoursSinceUpdate < 1) return;

    const daysSinceUpdate = hoursSinceUpdate / 24;
    const decayFactor = computeRecencyWeight(daysSinceUpdate);

    for (const domain of LIFE_DOMAINS) {
      if (rawScores[domain] && rawScores[domain].weightedCount > 0) {
        rawScores[domain].weightedCount *= decayFactor;
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    let totalWeight = 0;
    for (const d of LIFE_DOMAINS) {
      totalWeight += rawScores[d]?.weightedCount || 0;
    }

    const domains = {};
    for (const d of LIFE_DOMAINS) {
      domains[d] = totalWeight > 0 ? (rawScores[d]?.weightedCount || 0) / totalWeight : 0;
    }

    transaction.set(coverageRef, {
      domains,
      rawScores,
      lastUpdated: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

/**
 * Refreshes recency scores for all entities based on their last mention date.
 */
async function refreshEntityRecency(db, analyticsPath, now) {
  const entityRef = db.doc(`${analyticsPath}/entity_activity`);
  const entitySnap = await entityRef.get();

  if (!entitySnap.exists) return;

  const data = entitySnap.data();
  const entities = data.entities || {};
  const updates = {};
  let hasUpdates = false;

  for (const [entityId, entity] of Object.entries(entities)) {
    const lastMention = entity.lastMentionDate?.toDate?.();
    if (!lastMention) continue;

    const daysAgo = Math.max(0, (now - lastMention) / (1000 * 60 * 60 * 24));
    const newScore = computeRecencyWeight(daysAgo);

    if (Math.abs(newScore - (entity.recencyScore || 0)) > 0.01) {
      updates[`entities.${entityId}.recencyScore`] = newScore;
      hasUpdates = true;
    }
  }

  if (hasUpdates) {
    updates.lastUpdated = FieldValue.serverTimestamp();
    await entityRef.set(updates, { merge: true });
  }
}

/**
 * Removes entities not mentioned in the last 90 days.
 */
async function cleanupStaleEntities(db, analyticsPath, now) {
  const entityRef = db.doc(`${analyticsPath}/entity_activity`);
  const entitySnap = await entityRef.get();

  if (!entitySnap.exists) return;

  const data = entitySnap.data();
  const entities = data.entities || {};
  const staleIds = [];

  for (const [entityId, entity] of Object.entries(entities)) {
    const lastMention = entity.lastMentionDate?.toDate?.();
    if (!lastMention) continue;

    const daysAgo = (now - lastMention) / (1000 * 60 * 60 * 24);
    if (daysAgo > STALE_ENTITY_DAYS) {
      staleIds.push(entityId);
    }
  }

  if (staleIds.length > 0) {
    const updates = { lastUpdated: FieldValue.serverTimestamp() };
    for (const id of staleIds) {
      updates[`entities.${id}`] = FieldValue.delete();
    }
    await entityRef.update(updates);
    console.log(`Cleaned up ${staleIds.length} stale entities`);
  }
}

/**
 * Trims processed entry ID sets to stay within bounds.
 */
async function trimProcessedIds(db, analyticsPath) {
  const coverageRef = db.doc(`${analyticsPath}/topic_coverage`);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(coverageRef);
    if (!snap.exists) return;

    const data = snap.data();
    const processedIds = data.processedEntryIds || [];

    if (processedIds.length > MAX_PROCESSED_IDS) {
      transaction.update(coverageRef, {
        processedEntryIds: processedIds.slice(-MAX_PROCESSED_IDS),
        lastUpdated: FieldValue.serverTimestamp(),
      });
    }
  });
}

// --- Utility functions ---

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function computeTrend(current, previous) {
  const diff = current - previous;
  const threshold = previous * 0.05; // 5% change threshold
  if (diff > threshold) return 'improving';
  if (diff < -threshold) return 'declining';
  return 'stable';
}

/**
 * Computes Pearson correlation coefficient between two arrays.
 * Returns null if insufficient data or zero variance.
 */
function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return null;

  return numerator / denom;
}
