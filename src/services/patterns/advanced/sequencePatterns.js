/**
 * Sequence Pattern Mining Service
 *
 * Finds patterns in sequences of events that lead to mood changes:
 * - "Conflict with Sarah -> isolation -> rumination -> low mood"
 * - Recovery patterns: What helps you bounce back
 *
 * Uses event-based windows (entries between mood events) instead
 * of fixed time windows for more accurate detection.
 */

import { extractFeatures, extractEntitiesByType } from './featureExtraction';

/**
 * Calculate average of array
 */
const average = (arr) => {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

/**
 * Calculate days between two dates
 */
const daysBetween = (date1, date2) => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(d2 - d1) / (1000 * 60 * 60 * 24);
};

/**
 * Extract topics from entry tags
 */
const extractTopics = (tags) => {
  if (!tags?.length) return [];
  return tags
    .filter(t => t.startsWith('@topic:') || t.startsWith('@activity:') || t.startsWith('@person:'))
    .map(t => t.replace(/@\w+:/, '').replace(/_/g, ' '));
};

/**
 * Extract coping mechanism mentions from text
 */
const extractCopingMentions = (text) => {
  if (!text) return [];

  const copingPatterns = [
    { pattern: /\b(went for a walk|took a walk|walking)\b/gi, coping: 'walking' },
    { pattern: /\b(exercise|workout|gym|ran|running)\b/gi, coping: 'exercise' },
    { pattern: /\b(meditat|mindful)\w*/gi, coping: 'meditation' },
    { pattern: /\b(journal|writ(e|ing)|wrote)\b/gi, coping: 'journaling' },
    { pattern: /\b(talk(ed|ing)? to|called|messaged|texted)\b/gi, coping: 'social_support' },
    { pattern: /\b(breath(e|ing)|deep breath)\b/gi, coping: 'breathing' },
    { pattern: /\b(nap|sleep|rest)\b/gi, coping: 'rest' },
    { pattern: /\b(shower|bath)\b/gi, coping: 'self_care' },
    { pattern: /\b(tea|coffee|meal|eat)\b/gi, coping: 'nourishment' },
    { pattern: /\b(music|listen|podcast|audio)\b/gi, coping: 'audio_comfort' },
    { pattern: /\b(outside|outdoors|nature|park|garden)\b/gi, coping: 'nature' },
    { pattern: /\b(pet|dog|cat)\b/gi, coping: 'pet_comfort' }
  ];

  const found = [];
  copingPatterns.forEach(({ pattern, coping }) => {
    if (pattern.test(text)) {
      found.push(coping);
    }
  });

  return [...new Set(found)];
};

/**
 * Find mood events (significant highs and lows) as window boundaries
 * These act as markers for sequence analysis
 */
export const findMoodEvents = (entries) => {
  const events = [];

  // Sort by date
  const sorted = [...entries]
    .filter(e => e.analysis?.mood_score !== undefined)
    .sort((a, b) => {
      const dateA = new Date(a.effectiveDate || a.createdAt);
      const dateB = new Date(b.effectiveDate || b.createdAt);
      return dateA - dateB;
    });

  if (sorted.length < 5) return events;

  const windowSize = 3; // Look at 3 entries to determine local min/max

  for (let i = windowSize; i < sorted.length - windowSize; i++) {
    const currentMood = sorted[i].analysis.mood_score;

    const prevMoods = sorted
      .slice(i - windowSize, i)
      .map(e => e.analysis.mood_score);

    const nextMoods = sorted
      .slice(i + 1, i + windowSize + 1)
      .map(e => e.analysis.mood_score);

    const avgPrev = average(prevMoods);
    const avgNext = average(nextMoods);

    // Local minimum (low point) - mood significantly lower than surroundings
    if (currentMood < avgPrev - 0.15 && currentMood < avgNext - 0.15) {
      events.push({
        type: 'low',
        date: new Date(sorted[i].effectiveDate || sorted[i].createdAt),
        mood: currentMood,
        entryId: sorted[i].id,
        index: i
      });
    }
    // Local maximum (high point)
    else if (currentMood > avgPrev + 0.15 && currentMood > avgNext + 0.15) {
      events.push({
        type: 'high',
        date: new Date(sorted[i].effectiveDate || sorted[i].createdAt),
        mood: currentMood,
        entryId: sorted[i].id,
        index: i
      });
    }
  }

  return events.sort((a, b) => a.date - b.date);
};

/**
 * Find low periods (consecutive entries with low mood)
 */
const findLowPeriods = (entries) => {
  const sorted = [...entries]
    .filter(e => e.analysis?.mood_score !== undefined)
    .sort((a, b) => new Date(a.effectiveDate || a.createdAt) - new Date(b.effectiveDate || b.createdAt));

  const lowPeriods = [];
  let currentPeriod = null;
  const LOW_THRESHOLD = 0.35;

  sorted.forEach(entry => {
    const mood = entry.analysis.mood_score;
    const date = new Date(entry.effectiveDate || entry.createdAt);

    if (mood < LOW_THRESHOLD) {
      if (!currentPeriod) {
        currentPeriod = {
          startDate: date,
          endDate: date,
          entries: [entry],
          avgMood: mood,
          lowestMood: mood
        };
      } else {
        currentPeriod.endDate = date;
        currentPeriod.entries.push(entry);
        currentPeriod.avgMood = average(currentPeriod.entries.map(e => e.analysis.mood_score));
        currentPeriod.lowestMood = Math.min(currentPeriod.lowestMood, mood);
      }
    } else {
      if (currentPeriod && currentPeriod.entries.length >= 2) {
        lowPeriods.push(currentPeriod);
      }
      currentPeriod = null;
    }
  });

  // Don't forget the last period
  if (currentPeriod && currentPeriod.entries.length >= 2) {
    lowPeriods.push(currentPeriod);
  }

  return lowPeriods;
};

/**
 * Find entries in the recovery phase after a low period
 */
const findRecoveryEntries = (entries, lowPeriodEndDate, maxDays = 14) => {
  const sorted = [...entries]
    .filter(e => e.analysis?.mood_score !== undefined)
    .sort((a, b) => new Date(a.effectiveDate || a.createdAt) - new Date(b.effectiveDate || b.createdAt));

  const recoveryEntries = [];
  const endDate = new Date(lowPeriodEndDate);
  const cutoffDate = new Date(endDate);
  cutoffDate.setDate(cutoffDate.getDate() + maxDays);

  let isRecovering = false;
  let previousMood = 0;

  for (const entry of sorted) {
    const date = new Date(entry.effectiveDate || entry.createdAt);
    const mood = entry.analysis.mood_score;

    if (date <= endDate) continue;
    if (date > cutoffDate) break;

    // Track recovery (mood improving)
    if (mood > previousMood || recoveryEntries.length === 0) {
      isRecovering = true;
      entry.moodDeltaFromPrevious = mood - previousMood;
      recoveryEntries.push(entry);
    } else if (isRecovering && mood >= 0.5) {
      // Allow small dips if overall trend is recovering
      entry.moodDeltaFromPrevious = mood - previousMood;
      recoveryEntries.push(entry);
    }

    previousMood = mood;

    // Recovery complete if mood is back to good level
    if (mood >= 0.6) break;
  }

  return recoveryEntries;
};

/**
 * Extract common pattern from sequence cluster
 */
const extractCommonPattern = (cluster) => {
  if (cluster.length === 0) return [];

  // Find topics/activities that appear in most sequences
  const elementCounts = new Map();

  cluster.forEach(seq => {
    const seenInThisSeq = new Set();
    seq.sequence.forEach(entry => {
      entry.topics.forEach(topic => {
        if (!seenInThisSeq.has(topic)) {
          seenInThisSeq.add(topic);
          elementCounts.set(topic, (elementCounts.get(topic) || 0) + 1);
        }
      });
    });
  });

  // Return elements that appear in at least 50% of sequences
  const threshold = cluster.length * 0.5;
  return Array.from(elementCounts.entries())
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([element]) => element);
};

/**
 * Generate explanation for a sequence pattern
 */
const generateSequenceExplanation = (cluster) => {
  const commonPattern = extractCommonPattern(cluster);
  const avgDrop = average(cluster.map(s => s.outcome.drop));

  if (commonPattern.length === 0) {
    return `A pattern of entries often precedes mood drops`;
  }

  const patternStr = commonPattern.slice(0, 3).join(' -> ');
  return `When "${patternStr}" appears in sequence, mood tends to drop by ${Math.round(avgDrop * 100)}%`;
};

/**
 * Cluster similar sequences together
 */
const clusterSequences = (sequences) => {
  if (sequences.length < 2) return sequences.length > 0 ? [sequences] : [];

  // Simple clustering: group by common topics
  const clusters = [];

  sequences.forEach(seq => {
    const seqTopics = new Set();
    seq.sequence.forEach(entry => {
      entry.topics.forEach(t => seqTopics.add(t));
    });

    // Find existing cluster with significant overlap
    let foundCluster = false;
    for (const cluster of clusters) {
      const clusterTopics = new Set();
      cluster.forEach(s => {
        s.sequence.forEach(entry => {
          entry.topics.forEach(t => clusterTopics.add(t));
        });
      });

      // Calculate overlap
      const overlap = [...seqTopics].filter(t => clusterTopics.has(t)).length;
      const overlapRatio = overlap / Math.max(seqTopics.size, 1);

      if (overlapRatio > 0.5) {
        cluster.push(seq);
        foundCluster = true;
        break;
      }
    }

    if (!foundCluster) {
      clusters.push([seq]);
    }
  });

  return clusters.filter(c => c.length >= 2);
};

/**
 * Mine sequence patterns that lead to mood drops
 *
 * @param {Object[]} entries - Journal entries
 * @returns {Object[]} Array of sequence patterns
 */
export const mineSequencePatterns = (entries) => {
  const sequences = [];

  const sortedEntries = [...entries]
    .filter(e => e.analysis?.mood_score !== undefined)
    .sort((a, b) => new Date(a.effectiveDate || a.createdAt) - new Date(b.effectiveDate || b.createdAt));

  if (sortedEntries.length < 10) return [];

  // Find mood events as window boundaries
  const moodEvents = findMoodEvents(sortedEntries);

  if (moodEvents.length < 2) return [];

  // Analyze sequences between mood events
  for (let i = 1; i < moodEvents.length; i++) {
    const previousEvent = moodEvents[i - 1];
    const currentEvent = moodEvents[i];

    // Get entries between these two mood events
    const windowEntries = sortedEntries.filter(e => {
      const date = new Date(e.effectiveDate || e.createdAt);
      return date > previousEvent.date && date <= currentEvent.date;
    });

    if (windowEntries.length < 2) continue;

    // Only interested in sequences leading to mood drops
    if (currentEvent.type === 'low' && previousEvent.type !== 'low') {
      const sequence = windowEntries.map(e => ({
        date: e.effectiveDate || e.createdAt,
        entities: e.tags || [],
        mood: e.analysis.mood_score,
        entryType: e.analysis.entry_type,
        topics: extractTopics(e.tags)
      }));

      sequences.push({
        sequence,
        outcome: {
          mood: currentEvent.mood,
          drop: previousEvent.mood - currentEvent.mood
        },
        startEvent: previousEvent,
        endEvent: currentEvent
      });
    }
  }

  // Cluster similar sequences
  const clusteredSequences = clusterSequences(sequences);

  // Generate pattern insights
  return clusteredSequences.map(cluster => ({
    id: `seq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'mood_cascade',
    pattern: extractCommonPattern(cluster),
    occurrences: cluster.length,
    avgMoodDrop: average(cluster.map(s => s.outcome.drop)),
    avgDaysToDecline: average(cluster.map(s =>
      daysBetween(s.startEvent.date, s.endEvent.date)
    )),
    confidence: cluster.length >= 3 ? 0.8 : 0.6,
    explanation: generateSequenceExplanation(cluster),
    validationState: cluster.length >= 3 ? 'confirmed' : 'pending_validation',
    examples: cluster.slice(0, 3).map(s => ({
      startDate: s.startEvent.date,
      endDate: s.endEvent.date,
      moodDrop: s.outcome.drop,
      sequence: s.sequence.map(e => e.topics.slice(0, 2)).flat()
    })),
    createdAt: new Date().toISOString()
  }));
};

/**
 * Find common recovery factors from low periods
 */
const findCommonRecoveryFactors = (recoverySequences) => {
  const factorCounts = new Map();

  recoverySequences.forEach(recovery => {
    const factors = recovery.whatHelped;
    factors.forEach(factor => {
      factorCounts.set(factor, (factorCounts.get(factor) || 0) + 1);
    });
  });

  return Array.from(factorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([factor, count]) => ({
      factor,
      count,
      frequency: count / recoverySequences.length
    }));
};

/**
 * Extract what helped during recovery entries
 */
const extractHelpfulFactors = (recoveryEntries) => {
  const factors = [];

  recoveryEntries.forEach(entry => {
    const moodImprovement = entry.moodDeltaFromPrevious > 0.1;

    if (moodImprovement) {
      // Get activities
      const activities = extractEntitiesByType(entry.tags, '@activity:');
      factors.push(...activities);

      // Get people (social support)
      const people = extractEntitiesByType(entry.tags, '@person:');
      if (people.length > 0) {
        factors.push('social_support');
      }

      // Get coping mechanisms from text
      const copingMentions = extractCopingMentions(entry.text);
      factors.push(...copingMentions);
    }
  });

  // Count and return unique factors
  const factorCounts = {};
  factors.forEach(f => {
    factorCounts[f] = (factorCounts[f] || 0) + 1;
  });

  return Object.entries(factorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([factor]) => factor);
};

/**
 * Generate recovery narrative
 */
const generateRecoveryNarrative = (commonFactors) => {
  if (commonFactors.length === 0) {
    return "We're still learning about your recovery patterns.";
  }

  const factorNames = commonFactors.slice(0, 3).map(f => {
    switch (f.factor) {
      case 'social_support': return 'connecting with others';
      case 'exercise': return 'physical activity';
      case 'walking': return 'going for walks';
      case 'meditation': return 'meditation';
      case 'journaling': return 'journaling';
      case 'rest': return 'getting rest';
      case 'nature': return 'spending time in nature';
      default: return f.factor.replace(/_/g, ' ');
    }
  });

  return `Your recovery often involves ${factorNames.join(', ')}. These tend to help you bounce back.`;
};

/**
 * Analyze recovery patterns
 * Discovers what helps the user recover from low periods
 *
 * @param {Object[]} entries - Journal entries
 * @returns {Object} Recovery pattern analysis
 */
export const analyzeRecoveryPatterns = (entries) => {
  const lowPeriods = findLowPeriods(entries);

  if (lowPeriods.length === 0) {
    return {
      type: 'recovery_signature',
      totalRecoveries: 0,
      message: 'Not enough data to analyze recovery patterns yet.',
      insight: null
    };
  }

  const recoverySequences = lowPeriods.map(period => {
    const recoveryEntries = findRecoveryEntries(entries, period.endDate);

    return {
      lowPeriod: period,
      recoveryDuration: recoveryEntries.length > 0
        ? daysBetween(period.endDate, recoveryEntries[recoveryEntries.length - 1].effectiveDate || recoveryEntries[recoveryEntries.length - 1].createdAt)
        : null,
      recoveryPath: recoveryEntries.map(e => ({
        date: e.effectiveDate || e.createdAt,
        mood: e.analysis.mood_score,
        activities: extractEntitiesByType(e.tags, '@activity:'),
        topics: extractTopics(e.tags),
        coping: extractCopingMentions(e.text)
      })),
      whatHelped: extractHelpfulFactors(recoveryEntries)
    };
  }).filter(r => r.recoveryDuration !== null);

  const commonFactors = findCommonRecoveryFactors(recoverySequences);
  const avgRecoveryDays = average(recoverySequences.map(r => r.recoveryDuration).filter(d => d !== null));

  return {
    id: `recovery_${Date.now()}`,
    type: 'recovery_signature',
    totalRecoveries: recoverySequences.length,
    avgRecoveryDays: avgRecoveryDays > 0 ? Number(avgRecoveryDays.toFixed(1)) : null,
    commonFactors,
    yourPattern: generateRecoveryNarrative(commonFactors),
    insight: commonFactors.length > 0
      ? `When you're struggling, ${commonFactors.slice(0, 3).map(f => f.factor.replace(/_/g, ' ')).join(', ')} tend to help you recover.`
      : null,
    validationState: recoverySequences.length >= 3 ? 'confirmed' : 'pending_validation',
    createdAt: new Date().toISOString()
  };
};

export default {
  mineSequencePatterns,
  analyzeRecoveryPatterns,
  findMoodEvents,
  extractCopingMentions
};
