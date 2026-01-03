/**
 * Pattern Index Service
 *
 * Computes and stores patterns from journal entries for:
 * - Activity sentiment tracking ("yoga boosts your mood by 23%")
 * - Recurring themes with sentiment over time
 * - Proactive context triggers
 *
 * Pattern Types:
 * - activity_sentiment: How activities correlate with mood
 * - entity_frequency: How often entities appear
 * - temporal_patterns: Day-of-week or time-based patterns
 * - mood_triggers: What precedes mood changes
 */

import { getEntityIndex } from '../rag';

/**
 * Compute activity sentiment patterns
 * Finds entities that correlate with mood changes
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Category filter
 * @returns {Object[]} Array of activity patterns with sentiment data
 */
export const computeActivitySentiment = (entries, category = null) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;
  const entityMoods = new Map();

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
        entityMoods.set(tag, { moods: [], entries: [] });
      }
      entityMoods.get(tag).moods.push(mood);
      entityMoods.get(tag).entries.push({
        id: entry.id,
        date: entry.effectiveDate || entry.createdAt,
        mood,
        text: entry.text?.substring(0, 100)
      });
    });
  });

  // Calculate patterns
  const patterns = [];

  // Get baseline mood (average of all entries)
  const allMoods = filtered
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const baselineMood = allMoods.length > 0
    ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
    : 0.5;

  entityMoods.forEach((data, tag) => {
    if (data.moods.length < 2) return; // Need at least 2 data points

    const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
    const moodDelta = avgMood - baselineMood;
    const moodDeltaPercent = Math.round(moodDelta * 100);

    // Determine sentiment
    let sentiment = 'neutral';
    if (moodDelta > 0.1) sentiment = 'positive';
    else if (moodDelta < -0.1) sentiment = 'negative';

    // Generate insight
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
      entryCount: data.moods.length,
      sentiment,
      insight,
      lastMentioned: data.entries[data.entries.length - 1]?.date,
      recentEntries: data.entries.slice(-3) // Last 3 mentions
    });
  });

  // Sort by absolute impact
  return patterns.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));
};

/**
 * Compute temporal patterns (day-of-week, time-of-day)
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Category filter
 * @returns {Object} Temporal pattern data
 */
export const computeTemporalPatterns = (entries, category = null) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;

  const dayOfWeekMoods = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const hourOfDayMoods = {};
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  filtered.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const dateField = entry.effectiveDate || entry.createdAt;
    const date = dateField instanceof Date ? dateField : dateField?.toDate?.() || new Date();

    dayOfWeekMoods[date.getDay()].push(mood);

    const hour = date.getHours();
    const timeBlock = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    if (!hourOfDayMoods[timeBlock]) hourOfDayMoods[timeBlock] = [];
    hourOfDayMoods[timeBlock].push(mood);
  });

  // Calculate day-of-week patterns
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

  // Find best and worst days
  const sortedDays = [...dayPatterns].sort((a, b) => a.avgMood - b.avgMood);
  const worstDay = sortedDays[0];
  const bestDay = sortedDays[sortedDays.length - 1];

  // Calculate time-of-day patterns
  const timePatterns = Object.entries(hourOfDayMoods).map(([time, moods]) => ({
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
        insight: `${worstDay.dayName}s tend to be harder for you (avg mood: ${Math.round(worstDay.avgMood * 100)}%)`
      } : null,
      bestDay: bestDay && bestDay.avgMood > 0.6 ? {
        day: bestDay.dayName,
        mood: bestDay.avgMood,
        insight: `${bestDay.dayName}s are usually your best days (avg mood: ${Math.round(bestDay.avgMood * 100)}%)`
      } : null
    }
  };
};

/**
 * Compute mood trigger patterns
 * Find what typically precedes mood changes
 *
 * @param {Object[]} entries - All entries (should be sorted by date)
 * @param {string} category - Category filter
 * @returns {Object} Mood trigger patterns
 */
export const computeMoodTriggers = (entries, category = null) => {
  const filtered = category
    ? entries.filter(e => e.category === category)
    : entries;

  // Sort by date
  const sorted = [...filtered].sort((a, b) => {
    const dateA = a.effectiveDate || a.createdAt;
    const dateB = b.effectiveDate || b.createdAt;
    const timeA = dateA instanceof Date ? dateA : dateA?.toDate?.() || new Date();
    const timeB = dateB instanceof Date ? dateB : dateB?.toDate?.() || new Date();
    return timeA - timeB;
  });

  const moodDropPrecursors = new Map();
  const moodBoostPrecursors = new Map();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const prevMood = prev.analysis?.mood_score;
    const currMood = curr.analysis?.mood_score;

    if (prevMood === null || prevMood === undefined ||
        currMood === null || currMood === undefined) continue;

    const moodChange = currMood - prevMood;
    const prevTags = prev.tags?.filter(t => t.startsWith('@')) || [];

    // Significant mood drop (>0.2)
    if (moodChange < -0.2) {
      prevTags.forEach(tag => {
        if (!moodDropPrecursors.has(tag)) {
          moodDropPrecursors.set(tag, { count: 0, totalDrop: 0 });
        }
        moodDropPrecursors.get(tag).count++;
        moodDropPrecursors.get(tag).totalDrop += Math.abs(moodChange);
      });
    }

    // Significant mood boost (>0.2)
    if (moodChange > 0.2) {
      prevTags.forEach(tag => {
        if (!moodBoostPrecursors.has(tag)) {
          moodBoostPrecursors.set(tag, { count: 0, totalBoost: 0 });
        }
        moodBoostPrecursors.get(tag).count++;
        moodBoostPrecursors.get(tag).totalBoost += moodChange;
      });
    }
  }

  // Format results
  const formatPrecursors = (map, type) => {
    return Array.from(map.entries())
      .filter(([_, data]) => data.count >= 2) // Need at least 2 occurrences
      .map(([tag, data]) => ({
        entity: tag,
        entityName: tag.split(':')[1]?.replace(/_/g, ' '),
        count: data.count,
        avgChange: type === 'drop'
          ? Number((-data.totalDrop / data.count).toFixed(2))
          : Number((data.totalBoost / data.count).toFixed(2))
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  return {
    moodDropPrecursors: formatPrecursors(moodDropPrecursors, 'drop'),
    moodBoostPrecursors: formatPrecursors(moodBoostPrecursors, 'boost')
  };
};

/**
 * Generate proactive context for the current moment
 * Returns relevant insights based on current context
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Current category
 * @param {number} currentMood - Current mood (optional)
 * @param {string[]} currentEntities - Entities mentioned in current entry
 * @returns {Object[]} Array of proactive insights
 */
export const generateProactiveContext = (entries, category, currentMood = null, currentEntities = []) => {
  const insights = [];
  const now = new Date();
  const dayOfWeek = now.getDay();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  // Get activity sentiment patterns
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

  // 2. Day-of-week insights
  const temporalPatterns = computeTemporalPatterns(entries, category);
  const todayPattern = temporalPatterns.dayOfWeek.find(d => d.day === dayOfWeek);

  if (temporalPatterns.insights.worstDay?.day === dayNames[dayOfWeek]) {
    insights.push({
      type: 'temporal_warning',
      priority: 'support',
      message: temporalPatterns.insights.worstDay.insight,
      data: {
        day: dayNames[dayOfWeek],
        avgMood: todayPattern?.avgMood
      }
    });
  } else if (temporalPatterns.insights.bestDay?.day === dayNames[dayOfWeek]) {
    insights.push({
      type: 'temporal_positive',
      priority: 'celebration',
      message: temporalPatterns.insights.bestDay.insight,
      data: {
        day: dayNames[dayOfWeek],
        avgMood: todayPattern?.avgMood
      }
    });
  }

  // 3. Mood-based suggestions
  if (currentMood !== null && currentMood < 0.4) {
    // User is struggling - find what has helped before
    const boostActivities = activityPatterns
      .filter(p => p.sentiment === 'positive' && p.moodDeltaPercent > 15)
      .slice(0, 2);

    boostActivities.forEach(activity => {
      insights.push({
        type: 'mood_suggestion',
        priority: 'suggestion',
        entity: activity.entity,
        message: `Last time you felt this way, ${activity.entityName} helped lift your mood`,
        data: {
          avgMood: activity.avgMood,
          moodBoost: activity.moodDeltaPercent
        }
      });
    });
  }

  // 4. Pattern contradiction detection
  if (currentMood !== null) {
    currentEntities.forEach(entity => {
      const pattern = activityPatterns.find(p => p.entity === entity);
      if (pattern && pattern.entryCount >= 3) {
        const expectedMood = pattern.avgMood;
        const moodDiff = Math.abs(currentMood - expectedMood);

        if (moodDiff > 0.25) {
          insights.push({
            type: 'pattern_contradiction',
            priority: 'curiosity',
            entity: pattern.entity,
            message: currentMood < expectedMood
              ? `You usually feel better when ${pattern.entityName} comes up. What's different today?`
              : `Interesting - you're feeling better than usual with ${pattern.entityName}!`,
            data: {
              currentMood,
              expectedMood,
              difference: moodDiff
            }
          });
        }
      }
    });
  }

  // Sort by priority
  const priorityOrder = { support: 0, suggestion: 1, awareness: 2, curiosity: 3, encouragement: 4, celebration: 5 };
  return insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
};

/**
 * Get entity history for a specific entity
 *
 * @param {Object[]} entries - All entries
 * @param {string} entity - Entity tag to look up
 * @returns {Object} Entity history with timeline and sentiment
 */
export const getEntityHistory = (entries, entity) => {
  const entityEntries = entries
    .filter(e => e.tags?.includes(entity))
    .sort((a, b) => {
      const dateA = a.effectiveDate || a.createdAt;
      const dateB = b.effectiveDate || b.createdAt;
      const timeA = dateA instanceof Date ? dateA : dateA?.toDate?.() || new Date();
      const timeB = dateB instanceof Date ? dateB : dateB?.toDate?.() || new Date();
      return timeB - timeA;
    });

  if (entityEntries.length === 0) {
    return null;
  }

  const moods = entityEntries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);

  const avgMood = moods.length > 0
    ? moods.reduce((a, b) => a + b, 0) / moods.length
    : null;

  return {
    entity,
    entityName: entity.split(':')[1]?.replace(/_/g, ' '),
    entityType: entity.split(':')[0].replace('@', ''),
    totalMentions: entityEntries.length,
    avgMood,
    firstMentioned: entityEntries[entityEntries.length - 1]?.effectiveDate || entityEntries[entityEntries.length - 1]?.createdAt,
    lastMentioned: entityEntries[0]?.effectiveDate || entityEntries[0]?.createdAt,
    timeline: entityEntries.slice(0, 10).map(e => ({
      id: e.id,
      date: e.effectiveDate || e.createdAt,
      mood: e.analysis?.mood_score,
      snippet: e.text?.substring(0, 150)
    }))
  };
};

/**
 * Compute Shadow Friction patterns
 * Finds entity + context intersections that reveal hidden dynamics
 *
 * Example: "Conversations with Sarah about Work are 40% more stressful
 * than when you discuss Personal Goals"
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Category filter
 * @returns {Object[]} Array of intersection patterns
 */
export const computeShadowFriction = (entries, category = null) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;
  const intersectionMoods = new Map();

  // Get baseline mood for comparison
  const allMoods = filtered
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);
  const baselineMood = allMoods.length > 0
    ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length
    : 0.5;

  // Track individual entity moods for comparison
  const individualEntityMoods = new Map();

  filtered.forEach(entry => {
    const mood = entry.analysis?.mood_score;
    if (mood === null || mood === undefined) return;

    const tags = entry.tags || [];

    // Separate entity types
    const personTags = tags.filter(t => t.startsWith('@person:'));
    const topicTags = tags.filter(t => t.startsWith('@topic:'));
    const activityTags = tags.filter(t => t.startsWith('@activity:'));
    const placeTags = tags.filter(t => t.startsWith('@place:'));

    // Track individual entity moods
    [...personTags, ...topicTags, ...activityTags, ...placeTags].forEach(tag => {
      if (!individualEntityMoods.has(tag)) {
        individualEntityMoods.set(tag, []);
      }
      individualEntityMoods.get(tag).push(mood);
    });

    // Create intersection patterns: person + topic
    personTags.forEach(person => {
      topicTags.forEach(topic => {
        const key = `${person}+${topic}`;
        if (!intersectionMoods.has(key)) {
          intersectionMoods.set(key, {
            moods: [],
            primary: person,
            secondary: topic,
            type: 'person_topic'
          });
        }
        intersectionMoods.get(key).moods.push(mood);
      });

      // person + activity
      activityTags.forEach(activity => {
        const key = `${person}+${activity}`;
        if (!intersectionMoods.has(key)) {
          intersectionMoods.set(key, {
            moods: [],
            primary: person,
            secondary: activity,
            type: 'person_activity'
          });
        }
        intersectionMoods.get(key).moods.push(mood);
      });

      // person + place
      placeTags.forEach(place => {
        const key = `${person}+${place}`;
        if (!intersectionMoods.has(key)) {
          intersectionMoods.set(key, {
            moods: [],
            primary: person,
            secondary: place,
            type: 'person_place'
          });
        }
        intersectionMoods.get(key).moods.push(mood);
      });
    });

    // activity + place
    activityTags.forEach(activity => {
      placeTags.forEach(place => {
        const key = `${activity}+${place}`;
        if (!intersectionMoods.has(key)) {
          intersectionMoods.set(key, {
            moods: [],
            primary: activity,
            secondary: place,
            type: 'activity_place'
          });
        }
        intersectionMoods.get(key).moods.push(mood);
      });
    });
  });

  // Calculate intersection patterns
  const patterns = [];

  intersectionMoods.forEach((data, key) => {
    // Need at least 2 occurrences
    if (data.moods.length < 2) return;

    const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;

    // Get individual entity averages for comparison
    const primaryMoods = individualEntityMoods.get(data.primary) || [];
    const primaryAvg = primaryMoods.length > 0
      ? primaryMoods.reduce((a, b) => a + b, 0) / primaryMoods.length
      : baselineMood;

    // Calculate delta from individual entity baseline
    const deltaFromPrimary = avgMood - primaryAvg;
    const deltaFromBaseline = avgMood - baselineMood;
    const deltaPercent = Math.round(deltaFromPrimary * 100);

    // Only create insight if there's a significant difference from individual entity
    // (at least 15% different from how the person/activity usually affects mood)
    if (Math.abs(deltaFromPrimary) < 0.12) return;

    // Parse entity names
    const primaryName = data.primary.split(':')[1]?.replace(/_/g, ' ');
    const secondaryName = data.secondary.split(':')[1]?.replace(/_/g, ' ');
    const primaryType = data.primary.split(':')[0].replace('@', '');
    const secondaryType = data.secondary.split(':')[0].replace('@', '');

    // Generate contextual insight
    let insight = null;
    if (data.type === 'person_topic') {
      if (deltaFromPrimary < -0.12) {
        insight = `Discussions with ${primaryName} about ${secondaryName} are ${Math.abs(deltaPercent)}% more challenging than other interactions with them`;
      } else if (deltaFromPrimary > 0.12) {
        insight = `Talking with ${primaryName} about ${secondaryName} lifts your mood ${deltaPercent}% more than usual`;
      }
    } else if (data.type === 'person_activity') {
      if (deltaFromPrimary < -0.12) {
        insight = `Doing ${secondaryName} with ${primaryName} tends to be more stressful (${Math.abs(deltaPercent)}% mood dip)`;
      } else if (deltaFromPrimary > 0.12) {
        insight = `${secondaryName} with ${primaryName} is especially enjoyable (+${deltaPercent}% mood boost)`;
      }
    } else if (data.type === 'person_place') {
      if (deltaFromPrimary < -0.12) {
        insight = `Time with ${primaryName} at ${secondaryName} tends to be harder (${Math.abs(deltaPercent)}% lower mood)`;
      } else if (deltaFromPrimary > 0.12) {
        insight = `You're happier with ${primaryName} at ${secondaryName} (+${deltaPercent}%)`;
      }
    } else if (data.type === 'activity_place') {
      if (deltaFromBaseline < -0.12) {
        insight = `${primaryName} at ${secondaryName} is more draining than usual (${Math.abs(Math.round(deltaFromBaseline * 100))}% mood dip)`;
      } else if (deltaFromBaseline > 0.12) {
        insight = `${primaryName} at ${secondaryName} is especially energizing (+${Math.round(deltaFromBaseline * 100)}%)`;
      }
    }

    if (!insight) return;

    patterns.push({
      type: 'shadow_friction',
      intersectionType: data.type,
      key,
      primary: data.primary,
      primaryName,
      primaryType,
      secondary: data.secondary,
      secondaryName,
      secondaryType,
      avgMood: Number(avgMood.toFixed(2)),
      primaryAvgMood: Number(primaryAvg.toFixed(2)),
      baselineMood: Number(baselineMood.toFixed(2)),
      deltaFromPrimary: Number(deltaFromPrimary.toFixed(2)),
      deltaPercent,
      entryCount: data.moods.length,
      sentiment: deltaFromPrimary > 0 ? 'positive' : 'negative',
      insight,
      message: insight
    });
  });

  // Sort by absolute impact
  return patterns.sort((a, b) => Math.abs(b.deltaFromPrimary) - Math.abs(a.deltaFromPrimary));
};

export default {
  computeActivitySentiment,
  computeTemporalPatterns,
  computeMoodTriggers,
  computeShadowFriction,
  generateProactiveContext,
  getEntityHistory
};
