/**
 * Nexus Compatibility Layer
 *
 * Provides backwards-compatible functions for code that previously
 * imported from the old patterns system. These are temporary bridges
 * that will be removed once all consumers migrate to Nexus directly.
 */

import { detectPatternsInPeriod, NARRATIVE_PATTERNS } from './layer1/patternDetector';

/**
 * Compute activity sentiment patterns (compatibility wrapper)
 *
 * Replaces: patterns/index.js computeActivitySentiment
 * This is a simplified version that maps to Nexus pattern detection.
 */
export const computeActivitySentiment = (entries, category = null) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;
  const entityMoods = new Map();

  // Extract entities and mood correlations from entries
  filtered.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const tags = entry.tags?.filter(t =>
      t.startsWith('@activity:') ||
      t.startsWith('@place:') ||
      t.startsWith('@person:') ||
      t.startsWith('@event:') ||
      t.startsWith('@media:')
    ) || [];

    tags.forEach(tag => {
      if (!entityMoods.has(tag)) {
        entityMoods.set(tag, { moods: [], entries: [], lastMentioned: null });
      }
      entityMoods.get(tag).moods.push(mood);
      entityMoods.get(tag).entries.push({
        id: entry.id,
        date: entry.effectiveDate || entry.createdAt,
        mood,
        text: entry.text?.substring(0, 100)
      });
      entityMoods.get(tag).lastMentioned = entry.effectiveDate || entry.createdAt;
    });
  });

  // Calculate patterns
  const patterns = [];

  // Get baseline mood
  const allMoods = filtered
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const baselineMood = allMoods.length > 0
    ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
    : 0.5;

  entityMoods.forEach((data, tag) => {
    if (data.moods.length < 2) return;

    const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
    const moodDelta = avgMood - baselineMood;
    const moodDeltaPercent = Math.round(moodDelta * 100);

    let sentiment = 'neutral';
    if (moodDelta > 0.1) sentiment = 'positive';
    else if (moodDelta < -0.1) sentiment = 'negative';

    let insight = null;
    const entityName = tag.split(':')[1]?.replace(/_/g, ' ');
    const entityType = tag.split(':')[0].replace('@', '');

    if (sentiment === 'positive' && moodDeltaPercent > 10) {
      insight = `${entityName} tends to boost your mood by ${moodDeltaPercent}%`;
    } else if (sentiment === 'negative' && moodDeltaPercent < -10) {
      insight = `Your mood tends to dip ${Math.abs(moodDeltaPercent)}% around ${entityName}`;
    } else if (data.moods.length >= 5) {
      insight = `You've mentioned ${entityName} ${data.moods.length} times`;
    }

    patterns.push({
      type: 'activity_sentiment',
      entity: tag,
      entityName,
      entityType,
      avgMood: Number(avgMood.toFixed(2)),
      baselineMood: Number(baselineMood.toFixed(2)),
      moodDelta: Number(moodDelta.toFixed(2)),
      moodDeltaPercent,
      sentiment,
      entryCount: data.moods.length,
      insight,
      entries: data.entries,
      lastMentioned: data.lastMentioned
    });
  });

  return patterns
    .sort((a, b) => Math.abs(b.moodDeltaPercent) - Math.abs(a.moodDeltaPercent));
};

/**
 * Generate proactive context (compatibility wrapper)
 *
 * Replaces: patterns/index.js generateProactiveContext
 */
export const generateProactiveContext = (entries, category, currentMood = null, currentEntities = []) => {
  const insights = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const activityPatterns = computeActivitySentiment(entries, category);

  // 1. Entity-triggered insights
  if (currentEntities.length > 0) {
    currentEntities.forEach(entity => {
      const pattern = activityPatterns.find(p => p.entity === entity);
      if (pattern && pattern.insight && pattern.entryCount >= 2) {
        insights.push({
          type: 'entity_history',
          priority: pattern.sentiment === 'positive' ? 'encouragement' : 'awareness',
          entity: pattern.entity,
          message: pattern.insight,
          data: {
            avgMood: pattern.avgMood,
            entryCount: pattern.entryCount,
            sentiment: pattern.sentiment
          }
        });
      }
    });
  }

  // 2. Day-of-week insights (simplified)
  const filteredEntries = category ? entries.filter(e => e.category === category) : entries;
  const dayMoods = Array(7).fill(null).map(() => []);

  filteredEntries.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood == null) return;

    const date = entry.effectiveDate || entry.createdAt;
    const entryDate = date instanceof Date ? date : date?.toDate?.();
    if (entryDate) {
      dayMoods[entryDate.getDay()].push(mood);
    }
  });

  // Find best and worst days
  const dayStats = dayMoods.map((moods, i) => ({
    day: dayNames[i],
    dayIndex: i,
    avgMood: moods.length >= 2 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
    count: moods.length
  })).filter(d => d.avgMood !== null);

  if (dayStats.length >= 3) {
    const sorted = [...dayStats].sort((a, b) => a.avgMood - b.avgMood);
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];

    if (worst.dayIndex === dayOfWeek && worst.avgMood < 0.5) {
      insights.push({
        type: 'temporal_warning',
        priority: 'support',
        message: `${worst.day}s tend to be challenging for you`,
        data: { day: worst.day, avgMood: worst.avgMood }
      });
    } else if (best.dayIndex === dayOfWeek && best.avgMood > 0.6) {
      insights.push({
        type: 'temporal_positive',
        priority: 'celebration',
        message: `${best.day}s are usually your best days!`,
        data: { day: best.day, avgMood: best.avgMood }
      });
    }
  }

  // 3. Mood-based suggestions
  if (currentMood !== null && currentMood < 0.4) {
    const boostActivities = activityPatterns
      .filter(p => p.sentiment === 'positive' && p.moodDeltaPercent > 15)
      .slice(0, 2);

    boostActivities.forEach(activity => {
      insights.push({
        type: 'mood_suggestion',
        priority: 'support',
        message: `${activity.entityName} usually helps lift your mood`,
        data: {
          entity: activity.entity,
          boost: activity.moodDeltaPercent
        }
      });
    });
  }

  return insights;
};

/**
 * Get pattern summary (compatibility wrapper)
 *
 * Replaces: patterns/cached.js getPatternSummary
 */
export const getPatternSummary = async (userId, entries, category) => {
  return {
    activitySentiment: computeActivitySentiment(entries, category).slice(0, 10),
    source: 'nexus_compat'
  };
};

/**
 * Get all patterns (compatibility wrapper)
 *
 * Replaces: patterns/cached.js getAllPatterns
 */
export const getAllPatterns = async (userId, entries, category) => {
  return {
    activitySentiment: computeActivitySentiment(entries, category),
    source: 'nexus_compat'
  };
};

/**
 * Get contradictions (compatibility wrapper - stub)
 *
 * Replaces: patterns/cached.js getContradictions
 */
export const getContradictions = async (userId, entries, category) => {
  return [];
};

/**
 * Invalidate pattern cache (compatibility wrapper - no-op)
 *
 * Replaces: patterns/cached.js invalidatePatternCache
 */
export const invalidatePatternCache = async (userId) => {
  // No-op - Nexus handles freshness differently
  console.log('[Nexus Compat] invalidatePatternCache called (no-op)');
};

/**
 * Get rotated insights (compatibility wrapper)
 *
 * Replaces: patterns/insightRotation.js getRotatedInsights
 */
export const getRotatedInsights = (userId, category, insights, limit = 5) => {
  // Simple rotation based on current time
  // Full insight rotation will be handled by Nexus orchestrator
  return insights.slice(0, limit);
};

/**
 * Get next insight (compatibility wrapper)
 *
 * Replaces: patterns/insightRotation.js getNextInsight
 */
export const getNextInsight = async (userId, category, insights) => {
  if (!insights || insights.length === 0) return null;
  return insights[0];
};

/**
 * Mark insight shown (compatibility wrapper - no-op)
 *
 * Replaces: patterns/insightRotation.js markInsightShown
 */
export const markInsightShown = async (userId, category, insightId) => {
  // No-op - Nexus handles insight history differently
  console.log('[Nexus Compat] markInsightShown called (no-op)');
};
