/**
 * EchoVault Cloud Functions
 *
 * Phase 4: Pattern Index
 * - Computes patterns on new entry creation
 * - Daily scheduled refresh for full recomputation
 * - Stores pre-computed patterns for instant dashboard loads
 *
 * Firestore Schema:
 *
 * users/{userId}/patterns/{patternType}
 *   - activity_sentiment: Entity mood correlations
 *   - temporal: Day-of-week and time patterns
 *   - triggers: What precedes mood changes
 *   - contradictions: Goal vs behavior conflicts
 *   - summary: Top insights for quick display
 *
 * Each pattern doc has:
 *   - data: The computed pattern data
 *   - updatedAt: Timestamp of last computation
 *   - entryCount: Number of entries used in computation
 *   - version: Schema version for future migrations
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
const PATTERN_VERSION = 1;

// ============================================
// PATTERN COMPUTATION FUNCTIONS
// ============================================

/**
 * Compute activity sentiment patterns
 * Which entities correlate with mood changes?
 */
function computeActivitySentiment(entries) {
  const entityMoods = new Map();

  entries.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const tags = (entry.tags || []).filter(t =>
      t.startsWith('@activity:') ||
      t.startsWith('@place:') ||
      t.startsWith('@person:') ||
      t.startsWith('@event:') ||
      t.startsWith('@media:') ||
      t.startsWith('@food:')
    );

    tags.forEach(tag => {
      if (!entityMoods.has(tag)) {
        entityMoods.set(tag, { moods: [], dates: [] });
      }
      entityMoods.get(tag).moods.push(mood);
      entityMoods.get(tag).dates.push(entry.effectiveDate || entry.createdAt);
    });
  });

  // Calculate baseline
  const allMoods = entries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const baselineMood = allMoods.length > 0
    ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
    : 0.5;

  // Build patterns
  const patterns = [];
  entityMoods.forEach((data, tag) => {
    if (data.moods.length < 2) return;

    const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
    const moodDelta = avgMood - baselineMood;
    const moodDeltaPercent = Math.round(moodDelta * 100);

    let sentiment = 'neutral';
    if (moodDelta > 0.1) sentiment = 'positive';
    else if (moodDelta < -0.1) sentiment = 'negative';

    const entityName = tag.split(':')[1]?.replace(/_/g, ' ') || tag;
    const entityType = tag.split(':')[0].replace('@', '');

    let insight = null;
    if (sentiment === 'positive' && moodDeltaPercent > 10) {
      insight = `${entityName} boosts your mood by ${moodDeltaPercent}%`;
    } else if (sentiment === 'negative' && moodDeltaPercent < -10) {
      insight = `Your mood dips ${Math.abs(moodDeltaPercent)}% around ${entityName}`;
    }

    patterns.push({
      entity: tag,
      entityName,
      entityType,
      avgMood: Number(avgMood.toFixed(2)),
      baselineMood: Number(baselineMood.toFixed(2)),
      moodDelta: Number(moodDelta.toFixed(2)),
      moodDeltaPercent,
      entryCount: data.moods.length,
      sentiment,
      insight,
      lastMentioned: data.dates[data.dates.length - 1]
    });
  });

  return patterns.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));
}

/**
 * Compute temporal patterns (day-of-week, time-of-day)
 */
function computeTemporalPatterns(entries) {
  const dayOfWeekMoods = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const timeOfDayMoods = { morning: [], afternoon: [], evening: [], night: [] };
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  entries.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const dateField = entry.effectiveDate || entry.createdAt;
    const date = dateField?.toDate ? dateField.toDate() : new Date(dateField);

    dayOfWeekMoods[date.getDay()].push(mood);

    const hour = date.getHours();
    const timeBlock = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    timeOfDayMoods[timeBlock].push(mood);
  });

  // Calculate day patterns
  const dayPatterns = [];
  for (let day = 0; day < 7; day++) {
    const moods = dayOfWeekMoods[day];
    if (moods.length < 2) continue;

    const avg = moods.reduce((a, b) => a + b, 0) / moods.length;
    dayPatterns.push({
      day,
      dayName: dayNames[day],
      avgMood: Number(avg.toFixed(2)),
      entryCount: moods.length
    });
  }

  // Find extremes
  const sortedDays = [...dayPatterns].sort((a, b) => a.avgMood - b.avgMood);
  const worstDay = sortedDays[0];
  const bestDay = sortedDays[sortedDays.length - 1];

  // Calculate time patterns
  const timePatterns = Object.entries(timeOfDayMoods)
    .filter(([_, moods]) => moods.length >= 2)
    .map(([time, moods]) => ({
      time,
      avgMood: Number((moods.reduce((a, b) => a + b, 0) / moods.length).toFixed(2)),
      entryCount: moods.length
    }));

  return {
    dayOfWeek: dayPatterns,
    timeOfDay: timePatterns,
    insights: {
      worstDay: worstDay && worstDay.avgMood < 0.45 ? {
        day: worstDay.dayName,
        mood: worstDay.avgMood,
        insight: `${worstDay.dayName}s tend to be tougher (${Math.round(worstDay.avgMood * 100)}% avg mood)`
      } : null,
      bestDay: bestDay && bestDay.avgMood > 0.6 ? {
        day: bestDay.dayName,
        mood: bestDay.avgMood,
        insight: `${bestDay.dayName}s are your best days (${Math.round(bestDay.avgMood * 100)}% avg mood)`
      } : null
    }
  };
}

/**
 * Detect contradictions between stated intentions and actual behavior
 *
 * Type 1: Goal vs Behavior
 * "I want to exercise more" but hasn't mentioned exercise in 2+ weeks
 *
 * Type 2: Stated Negative vs Actual Positive
 * "I hate meetings" but mood is actually higher when meetings are mentioned
 */
function detectContradictions(entries, activityPatterns) {
  const contradictions = [];
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Find goal-related entries
  const goalEntries = entries.filter(e =>
    e.tags?.some(t => t.startsWith('@goal:')) ||
    e.text?.toLowerCase().match(/\b(want to|going to|need to|should|plan to|trying to)\b.*\b(more|less|start|stop|better)\b/)
  );

  // Type 1: Goal abandonment detection
  goalEntries.forEach(entry => {
    const goalTags = (entry.tags || []).filter(t => t.startsWith('@goal:'));

    goalTags.forEach(goalTag => {
      const goalName = goalTag.replace('@goal:', '').replace(/_/g, ' ');

      // Find related activity mentions
      const relatedActivity = `@activity:${goalTag.replace('@goal:', '')}`;
      const recentMentions = entries.filter(e => {
        const entryDate = e.effectiveDate?.toDate?.() || e.createdAt?.toDate?.() || new Date(e.effectiveDate || e.createdAt);
        return entryDate >= twoWeeksAgo && e.tags?.includes(relatedActivity);
      });

      if (recentMentions.length === 0) {
        const entryDate = entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.() || new Date(entry.effectiveDate || entry.createdAt);
        const daysSince = Math.floor((now - entryDate) / (1000 * 60 * 60 * 24));

        if (daysSince > 7) {
          contradictions.push({
            type: 'goal_abandonment',
            goalTag,
            goalName,
            message: `You mentioned wanting to "${goalName}" ${daysSince} days ago but haven't mentioned it since`,
            severity: daysSince > 21 ? 'high' : 'medium',
            originalEntry: {
              date: entryDate,
              snippet: entry.text?.substring(0, 100)
            }
          });
        }
      }
    });
  });

  // Type 2: Sentiment contradiction
  // Find entities user has expressed negative feelings about
  const negativeStatements = entries.filter(e =>
    e.text?.toLowerCase().match(/\b(hate|dread|can't stand|annoying|terrible|worst)\b/)
  );

  negativeStatements.forEach(entry => {
    const entities = (entry.tags || []).filter(t => t.startsWith('@'));

    entities.forEach(entity => {
      const pattern = activityPatterns.find(p => p.entity === entity);

      if (pattern && pattern.sentiment === 'positive' && pattern.entryCount >= 3) {
        contradictions.push({
          type: 'sentiment_contradiction',
          entity,
          entityName: pattern.entityName,
          message: `You've said negative things about ${pattern.entityName}, but your mood is actually ${pattern.moodDeltaPercent}% higher when you mention it`,
          severity: 'low',
          pattern: {
            avgMood: pattern.avgMood,
            moodDeltaPercent: pattern.moodDeltaPercent,
            entryCount: pattern.entryCount
          }
        });
      }
    });
  });

  // Type 3: Avoidance contradiction
  // User said they'd avoid X but keeps mentioning it positively
  const avoidanceStatements = entries.filter(e =>
    e.text?.toLowerCase().match(/\b(avoid|cut back|quit|stop|less)\b/)
  );

  avoidanceStatements.forEach(entry => {
    const entryDate = entry.effectiveDate?.toDate?.() || entry.createdAt?.toDate?.() || new Date(entry.effectiveDate || entry.createdAt);

    // Look for entities mentioned in avoidance context
    const entities = (entry.tags || []).filter(t =>
      t.startsWith('@food:') || t.startsWith('@activity:') || t.startsWith('@media:')
    );

    entities.forEach(entity => {
      // Count positive mentions after the avoidance statement
      const laterPositiveMentions = entries.filter(e => {
        const eDate = e.effectiveDate?.toDate?.() || e.createdAt?.toDate?.() || new Date(e.effectiveDate || e.createdAt);
        return eDate > entryDate &&
               e.tags?.includes(entity) &&
               e.analysis?.mood_score > 0.6;
      });

      if (laterPositiveMentions.length >= 2) {
        const entityName = entity.split(':')[1]?.replace(/_/g, ' ');
        contradictions.push({
          type: 'avoidance_contradiction',
          entity,
          entityName,
          message: `You said you'd cut back on ${entityName}, but you've mentioned it positively ${laterPositiveMentions.length} times since`,
          severity: 'medium',
          mentionCount: laterPositiveMentions.length
        });
      }
    });
  });

  return contradictions;
}

/**
 * Generate top insights summary for quick display
 */
function generateInsightsSummary(activityPatterns, temporalPatterns, contradictions) {
  const insights = [];

  // Top positive activity
  const topPositive = activityPatterns.find(p => p.sentiment === 'positive' && p.insight);
  if (topPositive) {
    insights.push({
      type: 'positive_activity',
      icon: 'trending-up',
      message: topPositive.insight,
      entity: topPositive.entity
    });
  }

  // Top negative activity
  const topNegative = activityPatterns.find(p => p.sentiment === 'negative' && p.insight);
  if (topNegative) {
    insights.push({
      type: 'negative_activity',
      icon: 'trending-down',
      message: topNegative.insight,
      entity: topNegative.entity
    });
  }

  // Best/worst day
  if (temporalPatterns.insights.bestDay) {
    insights.push({
      type: 'best_day',
      icon: 'sun',
      message: temporalPatterns.insights.bestDay.insight
    });
  }
  if (temporalPatterns.insights.worstDay) {
    insights.push({
      type: 'worst_day',
      icon: 'cloud',
      message: temporalPatterns.insights.worstDay.insight
    });
  }

  // Top contradiction
  const topContradiction = contradictions[0];
  if (topContradiction) {
    insights.push({
      type: 'contradiction',
      icon: 'alert-circle',
      message: topContradiction.message,
      contradictionType: topContradiction.type
    });
  }

  return insights.slice(0, 5);
}

/**
 * Main pattern computation function
 */
async function computeAllPatterns(userId, category = null) {
  // Fetch all entries
  const entriesRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  let query = entriesRef.orderBy('createdAt', 'desc').limit(200);
  if (category) {
    query = entriesRef.where('category', '==', category).orderBy('createdAt', 'desc').limit(200);
  }

  const snapshot = await query.get();
  const entries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (entries.length < 5) {
    console.log(`Not enough entries for user ${userId} (${entries.length})`);
    return null;
  }

  // Compute patterns
  const activitySentiment = computeActivitySentiment(entries);
  const temporalPatterns = computeTemporalPatterns(entries);
  const contradictions = detectContradictions(entries, activitySentiment);
  const summary = generateInsightsSummary(activitySentiment, temporalPatterns, contradictions);

  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const patternBase = {
    updatedAt: timestamp,
    entryCount: entries.length,
    version: PATTERN_VERSION
  };

  // Store patterns
  const patternsRef = db.collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('patterns');

  const batch = db.batch();

  batch.set(patternsRef.doc('activity_sentiment'), {
    ...patternBase,
    data: activitySentiment.slice(0, 50) // Top 50 entities
  });

  batch.set(patternsRef.doc('temporal'), {
    ...patternBase,
    data: temporalPatterns
  });

  batch.set(patternsRef.doc('contradictions'), {
    ...patternBase,
    data: contradictions
  });

  batch.set(patternsRef.doc('summary'), {
    ...patternBase,
    data: summary,
    topPositive: activitySentiment.find(p => p.sentiment === 'positive')?.insight || null,
    topNegative: activitySentiment.find(p => p.sentiment === 'negative')?.insight || null,
    bestDay: temporalPatterns.insights.bestDay?.insight || null,
    worstDay: temporalPatterns.insights.worstDay?.insight || null,
    hasContradictions: contradictions.length > 0
  });

  await batch.commit();

  console.log(`Computed patterns for user ${userId}: ${activitySentiment.length} activities, ${contradictions.length} contradictions`);
  return { activitySentiment, temporalPatterns, contradictions, summary };
}

// ============================================
// CLOUD FUNCTION TRIGGERS
// ============================================

/**
 * Trigger: On new entry creation
 * Incrementally update patterns when a new entry is created
 */
exports.onEntryCreate = functions.firestore
  .document('artifacts/{appId}/users/{userId}/entries/{entryId}')
  .onCreate(async (snap, context) => {
    const { userId, appId } = context.params;

    if (appId !== APP_COLLECTION_ID) {
      console.log(`Skipping pattern update for app ${appId}`);
      return null;
    }

    console.log(`New entry created for user ${userId}, recomputing patterns...`);

    try {
      await computeAllPatterns(userId);
      return { success: true };
    } catch (error) {
      console.error(`Error computing patterns for user ${userId}:`, error);
      return { success: false, error: error.message };
    }
  });

/**
 * Trigger: On entry update (mood analysis complete)
 * Recompute when entry gets mood score
 */
exports.onEntryUpdate = functions.firestore
  .document('artifacts/{appId}/users/{userId}/entries/{entryId}')
  .onUpdate(async (change, context) => {
    const { userId, appId } = context.params;

    if (appId !== APP_COLLECTION_ID) return null;

    const before = change.before.data();
    const after = change.after.data();

    // Only recompute if mood score was just added
    const hadMood = before.analysis?.mood_score !== undefined;
    const hasMood = after.analysis?.mood_score !== undefined;

    if (!hadMood && hasMood) {
      console.log(`Mood score added for user ${userId}, recomputing patterns...`);
      try {
        await computeAllPatterns(userId);
      } catch (error) {
        console.error(`Error computing patterns for user ${userId}:`, error);
      }
    }

    return null;
  });

/**
 * Scheduled: Daily pattern refresh
 * Full recomputation for all active users
 */
exports.dailyPatternRefresh = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('America/Los_Angeles')
  .onRun(async (context) => {
    console.log('Starting daily pattern refresh...');

    try {
      // Get all users with entries
      const usersRef = db.collection('artifacts')
        .doc(APP_COLLECTION_ID)
        .collection('users');

      const usersSnapshot = await usersRef.listDocuments();

      let successCount = 0;
      let errorCount = 0;

      for (const userDoc of usersSnapshot) {
        try {
          await computeAllPatterns(userDoc.id);
          successCount++;
        } catch (error) {
          console.error(`Error refreshing patterns for user ${userDoc.id}:`, error);
          errorCount++;
        }

        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`Daily refresh complete: ${successCount} success, ${errorCount} errors`);
      return { success: true, successCount, errorCount };
    } catch (error) {
      console.error('Daily pattern refresh failed:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * HTTP Callable: Manual pattern refresh
 * Allow users to trigger a refresh from the app
 */
exports.refreshPatterns = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  }

  const userId = context.auth.uid;
  const { category } = data || {};

  console.log(`Manual pattern refresh requested for user ${userId}`);

  try {
    const result = await computeAllPatterns(userId, category);
    return { success: true, insightCount: result?.summary?.length || 0 };
  } catch (error) {
    console.error(`Error refreshing patterns for user ${userId}:`, error);
    throw new functions.https.HttpsError('internal', 'Failed to refresh patterns');
  }
});
