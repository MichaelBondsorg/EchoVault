/**
 * Somatic Signal Extractor
 *
 * Identifies body-related signals in journal entries.
 * Maintains a taxonomy of physical manifestations of emotional states.
 */

// ============================================================
// SOMATIC TAXONOMY
// ============================================================

export const SOMATIC_TAXONOMY = {
  PAIN: {
    id: 'pain',
    category: 'physical',
    triggers: [
      'pain', 'hurt', 'sore', 'ache', 'aching',
      'sharp', 'throbbing', 'stabbing'
    ],
    bodyParts: [
      'knee', 'back', 'lower back', 'shoulder', 'neck',
      'head', 'headache', 'migraine', 'stomach', 'chest'
    ],
    severity: {
      mild: ['slight', 'little', 'minor', 'bit of'],
      moderate: ['noticeable', 'uncomfortable', 'bothering'],
      severe: ['terrible', 'awful', 'excruciating', 'unbearable']
    }
  },

  TENSION: {
    id: 'tension',
    category: 'physical',
    triggers: [
      'tense', 'tight', 'tension', 'clenched', 'stiff',
      'holding', 'gripping', 'locked up'
    ],
    associations: ['stress', 'anxiety', 'worry', 'work'],
    releaseActivities: ['yoga', 'stretch', 'massage', 'bath']
  },

  FATIGUE: {
    id: 'fatigue',
    category: 'energy',
    triggers: [
      'tired', 'exhausted', 'drained', 'fatigued', 'wiped',
      'no energy', 'low energy', 'sluggish', 'lethargic',
      'groggy', 'sleepy', 'drowsy'
    ],
    temporalPatterns: {
      morning: ['woke up tired', 'didn\'t sleep well'],
      afternoon: ['afternoon slump', 'crash'],
      evening: ['worn out', 'beat']
    }
  },

  RESPIRATORY: {
    id: 'respiratory',
    category: 'physical',
    triggers: [
      'breath', 'breathing', 'cough', 'congested', 'stuffy',
      'runny nose', 'sinus', 'chest tight', 'hard to breathe'
    ],
    illnessIndicators: ['cold', 'flu', 'sick', 'covid', 'allergies']
  },

  DIGESTIVE: {
    id: 'digestive',
    category: 'physical',
    triggers: [
      'stomach', 'nausea', 'nauseous', 'bloated', 'bloating',
      'gas', 'indigestion', 'heartburn', 'appetite'
    ],
    stressIndicators: ['nervous stomach', 'butterflies', 'queasy']
  },

  COGNITIVE: {
    id: 'cognitive',
    category: 'mental',
    triggers: [
      'brain fog', 'foggy', 'can\'t focus', 'distracted',
      'scattered', 'fuzzy', 'unclear', 'hard to think',
      'concentration', 'focus issues'
    ],
    associations: ['sleep', 'stress', 'add', 'medication']
  },

  SLEEP_DISTURBANCE: {
    id: 'sleep_disturbance',
    category: 'sleep',
    triggers: [
      'couldn\'t sleep', 'insomnia', 'woke up', 'restless',
      'tossing and turning', 'racing thoughts', 'nightmares',
      'sleep issues'
    ],
    qualityIndicators: {
      poor: ['terrible sleep', 'awful night', 'barely slept'],
      disrupted: ['woke up multiple times', 'light sleep'],
      good: ['slept well', 'great sleep', 'solid night']
    }
  },

  CARDIOVASCULAR: {
    id: 'cardiovascular',
    category: 'physical',
    triggers: [
      'heart racing', 'pounding', 'palpitations', 'pulse',
      'heart rate', 'chest', 'dizzy', 'lightheaded'
    ],
    anxietyIndicators: ['panic', 'anxiety attack', 'nervous']
  }
};

// ============================================================
// EXTRACTION FUNCTIONS
// ============================================================

/**
 * Extract somatic signals from entry text
 * @param {string} text - Entry content
 * @returns {Array} Extracted somatic signals with metadata
 */
export const extractSomaticSignals = (text) => {
  if (!text) return [];

  const normalizedText = text.toLowerCase();
  const signals = [];

  for (const [key, signal] of Object.entries(SOMATIC_TAXONOMY)) {
    // Check for trigger words
    const matchedTriggers = signal.triggers.filter(trigger =>
      normalizedText.includes(trigger)
    );

    if (matchedTriggers.length > 0) {
      const signalData = {
        signalId: signal.id,
        category: signal.category,
        triggers: matchedTriggers,
        confidence: Math.min(0.5 + (matchedTriggers.length * 0.2), 0.95)
      };

      // Extract body part if applicable
      if (signal.bodyParts) {
        const matchedBodyParts = signal.bodyParts.filter(part =>
          normalizedText.includes(part)
        );
        if (matchedBodyParts.length > 0) {
          signalData.bodyParts = matchedBodyParts;
          signalData.confidence = Math.min(signalData.confidence + 0.1, 0.98);
        }
      }

      // Extract severity if applicable
      if (signal.severity) {
        for (const [level, indicators] of Object.entries(signal.severity)) {
          if (indicators.some(ind => normalizedText.includes(ind))) {
            signalData.severity = level;
            break;
          }
        }
      }

      signals.push(signalData);
    }
  }

  return signals;
};

/**
 * Analyze somatic patterns over time
 * @param {Array} entries - Journal entries with extracted somatic signals
 * @returns {Object} Somatic pattern analysis
 */
export const analyzeSomaticPatterns = (entries) => {
  const signalHistory = {};
  const temporalPatterns = {};

  for (const entry of entries) {
    const signals = entry.somaticSignals || extractSomaticSignals(entry.text || '');
    const date = getEntryDate(entry);
    const dayOfWeek = date ? new Date(date).getDay() : null;

    for (const signal of signals) {
      const id = signal.signalId;

      if (!signalHistory[id]) {
        signalHistory[id] = {
          occurrences: 0,
          dates: [],
          associatedMoods: [],
          bodyParts: {},
          severityDistribution: { mild: 0, moderate: 0, severe: 0 }
        };
      }

      signalHistory[id].occurrences++;
      signalHistory[id].dates.push(date);

      if (entry.analysis?.mood_score != null) {
        signalHistory[id].associatedMoods.push(entry.analysis.mood_score);
      }

      if (signal.bodyParts) {
        for (const part of signal.bodyParts) {
          signalHistory[id].bodyParts[part] = (signalHistory[id].bodyParts[part] || 0) + 1;
        }
      }

      if (signal.severity) {
        signalHistory[id].severityDistribution[signal.severity]++;
      }

      // Track day-of-week patterns
      if (dayOfWeek !== null) {
        if (!temporalPatterns[id]) temporalPatterns[id] = Array(7).fill(0);
        temporalPatterns[id][dayOfWeek]++;
      }
    }
  }

  // Calculate statistics
  const analysis = {};

  for (const [id, history] of Object.entries(signalHistory)) {
    const moods = history.associatedMoods;

    analysis[id] = {
      signalId: id,
      totalOccurrences: history.occurrences,
      frequencyPerWeek: entries.length > 0 ? history.occurrences / (entries.length / 7) : 0,

      moodCorrelation: {
        mean: moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        moodDeltaFromBaseline: null // Calculated with baseline data
      },

      bodyPartDistribution: history.bodyParts,
      mostCommonBodyPart: Object.entries(history.bodyParts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] || null,

      severityDistribution: history.severityDistribution,

      temporalPattern: temporalPatterns[id] ? {
        byDayOfWeek: temporalPatterns[id],
        peakDay: temporalPatterns[id].indexOf(Math.max(...temporalPatterns[id]))
      } : null
    };
  }

  return analysis;
};

/**
 * Detect somatic-emotional clusters
 * @param {Array} entries - Entries with mood and somatic data
 * @returns {Array} Identified clusters
 */
export const detectSomaticEmotionalClusters = (entries) => {
  const clusters = [];

  // Look for patterns where somatic signals co-occur with emotional states
  const emotionalSomaticPairs = {};

  for (const entry of entries) {
    const signals = entry.somaticSignals || extractSomaticSignals(entry.text || '');
    const mood = entry.analysis?.mood_score;
    const text = (entry.text || '').toLowerCase();

    // Detect emotional context
    const emotionalContext = [];
    if (text.match(/anxious|worried|nervous|stressed/)) emotionalContext.push('anxiety');
    if (text.match(/sad|down|depressed|low/)) emotionalContext.push('sadness');
    if (text.match(/angry|frustrated|irritated|annoyed/)) emotionalContext.push('anger');
    if (text.match(/happy|excited|great|amazing/)) emotionalContext.push('positive');

    for (const signal of signals) {
      for (const emotion of emotionalContext) {
        const pairKey = `${emotion}_${signal.signalId}`;
        if (!emotionalSomaticPairs[pairKey]) {
          emotionalSomaticPairs[pairKey] = {
            emotion,
            somaticSignal: signal.signalId,
            occurrences: 0,
            moods: []
          };
        }
        emotionalSomaticPairs[pairKey].occurrences++;
        if (mood != null) emotionalSomaticPairs[pairKey].moods.push(mood);
      }
    }
  }

  // Identify significant clusters
  for (const [key, pair] of Object.entries(emotionalSomaticPairs)) {
    if (pair.occurrences >= 3) { // Minimum threshold
      clusters.push({
        cluster: key,
        emotion: pair.emotion,
        somaticSignal: pair.somaticSignal,
        occurrences: pair.occurrences,
        averageMood: pair.moods.length > 0
          ? pair.moods.reduce((a, b) => a + b, 0) / pair.moods.length
          : null,
        interpretation: `${pair.emotion} tends to manifest as ${pair.somaticSignal} in your body`
      });
    }
  }

  return clusters.sort((a, b) => b.occurrences - a.occurrences);
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Get date string from entry
 */
const getEntryDate = (entry) => {
  const date = entry.effectiveDate || entry.createdAt;
  if (!date) return null;

  if (typeof date === 'string') {
    return date.split('T')[0];
  }
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  if (date.toDate) {
    return date.toDate().toISOString().split('T')[0];
  }
  return null;
};
