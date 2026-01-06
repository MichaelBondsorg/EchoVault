/**
 * Association Rule Mining Service
 *
 * Implements the Apriori algorithm to find multi-factor patterns:
 * - "Work stress + poor sleep + no exercise = mood drop"
 * - "Morning + yoga + alone = peak mood"
 *
 * Features:
 * - Confidence threshold 0.75 for confirmed insights
 * - Pending validation (0.5-0.75) for question-style insights
 * - Clinical plausibility filter to avoid spurious correlations
 * - User feedback integration
 */

import { extractFeatures, categorizeSleep } from './featureExtraction';

/**
 * Convert entry to transaction (set of items)
 * Each transaction represents features present in an entry
 */
const entryToTransaction = (entry, features) => {
  const items = new Set();

  // Temporal items
  items.add(`day:${features.temporal.dayOfWeek}`);
  items.add(`weekend:${features.temporal.isWeekend}`);
  items.add(`season:${features.temporal.season}`);
  if (features.temporal.isHolidayPeriod) {
    items.add('holiday:true');
  }

  // Time of day buckets
  const hour = features.temporal.hourOfDay;
  if (hour >= 5 && hour < 12) items.add('time:morning');
  else if (hour >= 12 && hour < 17) items.add('time:afternoon');
  else if (hour >= 17 && hour < 21) items.add('time:evening');
  else items.add('time:night');

  // Entity items
  items.add(`alone:${features.entities.isAlone}`);
  features.entities.people.forEach(p => items.add(`person:${p.toLowerCase()}`));
  features.entities.activities.forEach(a => items.add(`activity:${a.toLowerCase()}`));
  features.entities.places.forEach(p => items.add(`place:${p.toLowerCase()}`));
  features.entities.topics.forEach(t => items.add(`topic:${t.toLowerCase()}`));

  // Context items
  if (features.context.weather) {
    items.add(`weather:${features.context.weather.toLowerCase()}`);
  }
  if (features.context.sleepHours !== undefined) {
    items.add(`sleep:${categorizeSleep(features.context.sleepHours)}`);
  }
  if (features.context.hadWorkout !== undefined) {
    items.add(`workout:${features.context.hadWorkout}`);
  }

  // Sequential items
  if (features.sequential.isMoodShift) {
    items.add('moodshift:true');
  }
  if (features.sequential.entriesThisWeek !== null) {
    if (features.sequential.entriesThisWeek === 0) items.add('frequency:first_of_week');
    else if (features.sequential.entriesThisWeek >= 5) items.add('frequency:daily_journaler');
  }

  // Entry type
  if (features.target.entryType) {
    items.add(`type:${features.target.entryType}`);
  }

  return {
    id: entry.id,
    items,
    mood: features.target.moodScore,
    date: features.meta.date
  };
};

/**
 * Check if a set is subset of another
 */
const isSubset = (subset, superset) => {
  for (const item of subset) {
    if (!superset.has(item)) return false;
  }
  return true;
};

/**
 * Find frequent itemsets using Apriori algorithm
 */
const findFrequentItemsets = (transactions, minSupport) => {
  const minCount = Math.ceil(transactions.length * minSupport);
  const frequentItemsets = [];

  // Get all unique items
  const allItems = new Set();
  transactions.forEach(t => t.items.forEach(item => allItems.add(item)));

  // Find frequent 1-itemsets
  const itemCounts = new Map();
  transactions.forEach(t => {
    t.items.forEach(item => {
      itemCounts.set(item, (itemCounts.get(item) || 0) + 1);
    });
  });

  const frequent1 = [];
  itemCounts.forEach((count, item) => {
    if (count >= minCount) {
      frequent1.push(new Set([item]));
    }
  });

  frequentItemsets.push(...frequent1);

  // Generate larger itemsets
  let currentLevel = frequent1;
  let k = 2;

  while (currentLevel.length > 0 && k <= 4) { // Max 4-item combinations
    const candidates = generateCandidates(currentLevel, k);
    const frequentK = [];

    candidates.forEach(candidate => {
      const count = transactions.filter(t => isSubset(candidate, t.items)).length;
      if (count >= minCount) {
        frequentK.push(candidate);
      }
    });

    frequentItemsets.push(...frequentK);
    currentLevel = frequentK;
    k++;
  }

  return frequentItemsets;
};

/**
 * Generate candidate itemsets of size k
 */
const generateCandidates = (prevFrequent, k) => {
  const candidates = [];
  const prevArray = prevFrequent.map(set => Array.from(set).sort());

  for (let i = 0; i < prevArray.length; i++) {
    for (let j = i + 1; j < prevArray.length; j++) {
      // Check if first k-2 items are the same
      let canJoin = true;
      for (let x = 0; x < k - 2; x++) {
        if (prevArray[i][x] !== prevArray[j][x]) {
          canJoin = false;
          break;
        }
      }

      if (canJoin) {
        const newSet = new Set([...prevArray[i], ...prevArray[j]]);
        if (newSet.size === k) {
          candidates.push(newSet);
        }
      }
    }
  }

  return candidates;
};

/**
 * Calculate average of array
 */
const average = (arr) => {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

/**
 * Get day name from number
 */
const getDayName = (dayNum) => {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayNum];
};

/**
 * Check if correlation is clinically plausible (ACT/CBT framework)
 * Filters out spurious correlations
 */
const checkClinicalPlausibility = (items, moodDelta) => {
  // Known plausible single-factor patterns (backed by psychology research)
  const plausibleSingleFactors = [
    'sleep:poor', 'sleep:good', 'sleep:fair',
    'workout:true', 'workout:false',
    'alone:true', 'alone:false',
    'type:vent', 'type:reflection',
    'frequency:daily_journaler'
  ];

  // Flag potentially spurious single-factor correlations
  const spuriousIndicators = [
    // Weather alone rarely causes significant mood changes
    items.length === 1 && items[0].startsWith('weather:'),
    // Day of week alone is weak without context
    items.length === 1 && items[0].startsWith('day:'),
    // Time alone is weak
    items.length === 1 && items[0].startsWith('time:'),
    // Season alone needs more context
    items.length === 1 && items[0].startsWith('season:')
  ];

  if (spuriousIndicators.some(Boolean)) {
    return false;
  }

  // Multi-factor patterns are generally more plausible
  if (items.length >= 2) {
    return true;
  }

  // Check single-factor against known plausible patterns
  return plausibleSingleFactors.some(pattern =>
    items.some(item => item === pattern || item.startsWith(pattern.split(':')[0] + ':'))
  );
};

/**
 * Generate human-readable explanation for a rule
 */
const generateRuleExplanation = (items, moodDelta, avgMood) => {
  const direction = moodDelta > 0 ? 'higher' : 'lower';
  const percentage = Math.round(Math.abs(moodDelta) * 100);
  const avgMoodPercent = Math.round(avgMood * 100);

  const conditions = items.map(item => {
    const [type, value] = item.split(':');
    switch (type) {
      case 'day': return `on ${getDayName(parseInt(value))}s`;
      case 'weekend': return value === 'true' ? 'on weekends' : 'on weekdays';
      case 'time': return `in the ${value}`;
      case 'alone': return value === 'true' ? 'when spending time alone' : 'when with others';
      case 'sleep': return `after ${value} sleep`;
      case 'workout': return value === 'true' ? 'on workout days' : 'on rest days';
      case 'weather': return `when the weather is ${value}`;
      case 'person': return `when with ${value}`;
      case 'activity': return `during ${value}`;
      case 'topic': return `when discussing ${value}`;
      case 'place': return `at ${value}`;
      case 'type': return `in ${value} entries`;
      case 'season': return `during ${value}`;
      case 'holiday': return 'during holiday periods';
      case 'frequency': return value === 'daily_journaler' ? 'when journaling regularly' : 'at the start of your journaling week';
      case 'moodshift': return 'after a mood shift';
      default: return item;
    }
  });

  return {
    short: `Your mood is ${percentage}% ${direction} ${conditions.join(' + ')}`,
    detailed: `When ${conditions.join(' and ')}, your mood averages ${avgMoodPercent}% (${percentage}% ${direction} than your baseline).`
  };
};

/**
 * Mine association rules for mood patterns
 *
 * @param {Object[]} entries - Journal entries
 * @param {number} minSupport - Minimum support threshold (default: 0.1 = 10%)
 * @param {number} minConfidence - Minimum confidence for confirmed insights (default: 0.75)
 * @returns {Object[]} Array of association rules
 */
export const mineAssociationRules = (entries, minSupport = 0.1, minConfidence = 0.75) => {
  // Convert entries to transactions
  const transactions = entries
    .filter(e => e.analysis?.mood_score !== undefined)
    .map(e => entryToTransaction(e, extractFeatures(e, entries)));

  if (transactions.length < 10) {
    return []; // Need minimum data
  }

  // Calculate baseline mood
  const baselineMood = average(transactions.map(t => t.mood));

  // Find frequent itemsets
  const frequentItemsets = findFrequentItemsets(transactions, minSupport);

  // Generate rules
  const rules = [];

  for (const itemset of frequentItemsets) {
    if (itemset.size < 1 || itemset.size > 4) continue;

    const itemArray = Array.from(itemset);
    const antecedent = new Set(itemArray);

    // Find all transactions matching this itemset
    const matchingTransactions = transactions.filter(t =>
      isSubset(antecedent, t.items)
    );

    if (matchingTransactions.length < 5) continue; // Need at least 5 occurrences

    const avgMood = average(matchingTransactions.map(t => t.mood));
    const moodDelta = avgMood - baselineMood;

    // Only consider significant mood differences
    if (Math.abs(moodDelta) < 0.1) continue;

    const confidence = Math.abs(moodDelta);

    // Check clinical plausibility
    const isPlausible = checkClinicalPlausibility(itemArray, moodDelta);

    if (!isPlausible) continue;

    const explanation = generateRuleExplanation(itemArray, moodDelta, avgMood);

    rules.push({
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      antecedent: itemArray,
      consequent: moodDelta > 0 ? 'mood_boost' : 'mood_drop',
      support: matchingTransactions.length / transactions.length,
      confidence,
      moodDelta: Number(moodDelta.toFixed(3)),
      avgMood: Number(avgMood.toFixed(3)),
      baselineMood: Number(baselineMood.toFixed(3)),
      count: matchingTransactions.length,
      totalEntries: transactions.length,

      // Explanation
      explanation: explanation.short,
      detailedExplanation: explanation.detailed,

      // Validation state based on confidence
      // >= 0.75: Show as confirmed insight
      // 0.5-0.75: Show as question ("Does this resonate?")
      // < 0.5: Don't show to user yet
      validationState: confidence >= minConfidence ? 'confirmed' :
                       confidence >= 0.5 ? 'pending_validation' : 'hidden',

      // User feedback tracking
      userFeedback: null, // Will be set to 'confirmed' | 'dismissed' by user
      feedbackAt: null,

      // Timestamps
      createdAt: new Date().toISOString()
    });
  }

  // Sort by absolute mood delta (most impactful first)
  return rules.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));
};

/**
 * Get only confirmed rules (high confidence)
 */
export const getConfirmedRules = (rules) => {
  return rules.filter(r => r.validationState === 'confirmed');
};

/**
 * Get rules pending validation (medium confidence)
 */
export const getPendingValidationRules = (rules) => {
  return rules.filter(r => r.validationState === 'pending_validation');
};

/**
 * Update rule with user feedback
 */
export const updateRuleWithFeedback = (rule, feedback) => {
  return {
    ...rule,
    userFeedback: feedback, // 'confirmed' | 'dismissed'
    feedbackAt: new Date().toISOString(),
    // Adjust confidence based on feedback
    confidence: feedback === 'confirmed'
      ? Math.min(1, rule.confidence + 0.1)
      : rule.confidence - 0.2,
    validationState: feedback === 'confirmed' ? 'confirmed' : 'dismissed'
  };
};

/**
 * Format rules as insights for UI
 */
export const formatRulesAsInsights = (rules) => {
  return rules.map(rule => ({
    id: rule.id,
    type: rule.consequent === 'mood_boost' ? 'positive' : 'negative',
    message: rule.explanation,
    detail: rule.detailedExplanation,
    confidence: Math.round(rule.confidence * 100),
    occurrences: rule.count,
    moodImpact: Math.round(rule.moodDelta * 100),
    factors: rule.antecedent,
    validationState: rule.validationState,
    userFeedback: rule.userFeedback
  }));
};

export default {
  mineAssociationRules,
  getConfirmedRules,
  getPendingValidationRules,
  updateRuleWithFeedback,
  formatRulesAsInsights
};
