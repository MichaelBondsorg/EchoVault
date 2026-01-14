/**
 * Pattern Detector
 *
 * Identifies correlations between narrative content and biometric data.
 * This is the foundation layer that feeds into temporal and causal analysis.
 */

// ============================================================
// PATTERN DEFINITIONS
// ============================================================

/**
 * Core narrative patterns to detect
 * These patterns map narrative content to expected biometric signatures
 */
export const NARRATIVE_PATTERNS = {
  // Career & Work
  CAREER_ANTICIPATION: {
    id: 'career_anticipation',
    triggers: ['interview', 'offer', 'application', 'recruiter', 'hiring'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed' }
  },
  CAREER_WAITING: {
    id: 'career_waiting',
    triggers: ['waiting', 'haven\'t heard', 'no response', 'following up'],
    category: 'career',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', strain: 'normal' }
  },
  CAREER_OUTCOME_POSITIVE: {
    id: 'career_outcome_positive',
    triggers: ['got the job', 'offer accepted', 'moving forward', 'next round'],
    category: 'career',
    biometricSignature: { mood: 'elevated', hrv: 'improved' }
  },
  CAREER_OUTCOME_NEGATIVE: {
    id: 'career_outcome_negative',
    triggers: ['rejected', 'didn\'t get', 'passed on', 'not moving forward'],
    category: 'career',
    biometricSignature: { mood: 'depressed', rhr: 'elevated', sleep: 'disrupted' }
  },

  // Relationships
  RELATIONSHIP_CONNECTION: {
    id: 'relationship_connection',
    triggers: ['spencer', 'together', 'cuddled', 'talked', 'connected'],
    category: 'relationship',
    biometricSignature: { hrv: 'improved', mood: 'stabilized' }
  },
  RELATIONSHIP_STRAIN: {
    id: 'relationship_strain',
    triggers: ['argued', 'frustrated with', 'annoyed', 'tension between'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', mood: 'volatile' }
  },
  CAREGIVING_STRESS: {
    id: 'caregiving_stress',
    triggers: ['kobe', 'psychosis', 'worried about', 'checking on'],
    category: 'relationship',
    biometricSignature: { rhr: 'elevated', mood: 'anxious' }
  },

  // Physical Activity
  EXERCISE_COMPLETION: {
    id: 'exercise_completion',
    triggers: ['workout', 'barrys', 'yoga', 'pilates', 'gym', 'lifted'],
    category: 'health',
    biometricSignature: { strain: 'elevated', nextDayRecovery: 'variable' }
  },
  EXERCISE_AVOIDANCE: {
    id: 'exercise_avoidance',
    triggers: ['skipped', 'didn\'t go', 'too tired', 'took a rest'],
    category: 'health',
    biometricSignature: { strain: 'low', mood: 'variable' }
  },

  // Somatic Signals
  PHYSICAL_DISCOMFORT: {
    id: 'physical_discomfort',
    triggers: ['pain', 'sore', 'hurt', 'ache', 'tight', 'injury'],
    category: 'somatic',
    biometricSignature: { strain: 'elevated', sleep: 'disrupted' }
  },
  FATIGUE: {
    id: 'fatigue',
    triggers: ['tired', 'exhausted', 'drained', 'no energy', 'groggy'],
    category: 'somatic',
    biometricSignature: { recovery: 'low', hrv: 'depressed' }
  },

  // Emotional States
  ANXIETY_SIGNAL: {
    id: 'anxiety_signal',
    triggers: ['anxious', 'worried', 'nervous', 'stressed', 'overwhelmed'],
    category: 'emotional',
    biometricSignature: { rhr: 'elevated', hrv: 'depressed', sleep: 'disrupted' }
  },
  POSITIVE_MOMENTUM: {
    id: 'positive_momentum',
    triggers: ['happy', 'excited', 'great', 'amazing', 'fantastic', 'proud'],
    category: 'emotional',
    biometricSignature: { hrv: 'improved', recovery: 'elevated' }
  },

  // Stabilizers
  PET_INTERACTION: {
    id: 'pet_interaction',
    triggers: ['sterling', 'luna', 'walked', 'dog', 'grooming'],
    category: 'stabilizer',
    biometricSignature: { hrv: 'recovery', mood: 'stabilized' }
  },
  CREATIVE_ACTIVITY: {
    id: 'creative_activity',
    triggers: ['painting', 'built', 'created', 'working on', 'echovault'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'stable' }
  },
  SOCIAL_CONNECTION: {
    id: 'social_connection',
    triggers: ['dinner with', 'hung out', 'met up', 'friends', 'called'],
    category: 'stabilizer',
    biometricSignature: { mood: 'improved', hrv: 'improved' }
  }
};

// ============================================================
// DETECTION FUNCTIONS
// ============================================================

/**
 * Detect patterns in a single entry
 * @param {Object} entry - Journal entry
 * @param {Object} whoopData - Same-day Whoop data
 * @returns {Array} Detected patterns with confidence scores
 */
export const detectPatternsInEntry = (entry, whoopData = null) => {
  const text = (entry.text || '').toLowerCase();
  const detectedPatterns = [];

  for (const [key, pattern] of Object.entries(NARRATIVE_PATTERNS)) {
    const matches = pattern.triggers.filter(trigger =>
      text.includes(trigger.toLowerCase())
    );

    if (matches.length > 0) {
      detectedPatterns.push({
        patternId: pattern.id,
        category: pattern.category,
        triggers: matches,
        confidence: Math.min(0.5 + (matches.length * 0.15), 0.95),
        entryId: entry.id,
        entryDate: getEntryDate(entry),
        mood: entry.analysis?.mood_score,
        whoopData: whoopData ? {
          rhr: whoopData.heartRate?.resting,
          hrv: whoopData.hrv?.average,
          strain: whoopData.strain?.score,
          recovery: whoopData.recovery?.score,
          sleep: whoopData.sleep?.totalHours
        } : null
      });
    }
  }

  return detectedPatterns;
};

/**
 * Detect patterns across a time period
 * @param {string} userId - User ID
 * @param {Array} entries - Journal entries
 * @param {Object} whoopHistory - Whoop data keyed by date (from getWhoopHistory().days)
 * @returns {Object} Pattern analysis results
 */
export const detectPatternsInPeriod = async (userId, entries, whoopHistory = null) => {
  const allPatterns = [];

  // Convert whoopHistory array to date-keyed object if needed
  const whoopByDate = {};
  if (whoopHistory?.days) {
    for (const day of whoopHistory.days) {
      if (day.date) {
        whoopByDate[day.date] = day;
      }
    }
  } else if (whoopHistory && typeof whoopHistory === 'object') {
    Object.assign(whoopByDate, whoopHistory);
  }

  for (const entry of entries) {
    const entryDate = getEntryDate(entry);
    const whoopData = whoopByDate[entryDate] || null;

    const patterns = detectPatternsInEntry(entry, whoopData);
    allPatterns.push(...patterns);
  }

  // Aggregate patterns
  const patternCounts = {};
  const patternMoods = {};
  const patternBiometrics = {};

  for (const pattern of allPatterns) {
    const id = pattern.patternId;

    if (!patternCounts[id]) {
      patternCounts[id] = 0;
      patternMoods[id] = [];
      patternBiometrics[id] = [];
    }

    patternCounts[id]++;
    if (pattern.mood != null) patternMoods[id].push(pattern.mood);
    if (pattern.whoopData) patternBiometrics[id].push(pattern.whoopData);
  }

  // Calculate aggregates
  const patternAnalysis = {};

  for (const [id, count] of Object.entries(patternCounts)) {
    const moods = patternMoods[id];
    const biometrics = patternBiometrics[id];

    // Find the pattern definition
    const patternDef = Object.values(NARRATIVE_PATTERNS).find(p => p.id === id);

    patternAnalysis[id] = {
      patternId: id,
      category: patternDef?.category,
      occurrences: count,
      mood: {
        mean: moods.length > 0 ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
        min: moods.length > 0 ? Math.min(...moods) : null,
        max: moods.length > 0 ? Math.max(...moods) : null
      },
      biometrics: biometrics.length > 0 ? {
        avgRHR: average(biometrics.map(b => b.rhr).filter(Boolean)),
        avgHRV: average(biometrics.map(b => b.hrv).filter(Boolean)),
        avgStrain: average(biometrics.map(b => b.strain).filter(Boolean)),
        avgRecovery: average(biometrics.map(b => b.recovery).filter(Boolean))
      } : null
    };
  }

  return {
    rawPatterns: allPatterns,
    aggregated: patternAnalysis,
    totalEntries: entries.length,
    totalPatternsDetected: allPatterns.length
  };
};

/**
 * Calculate correlation between pattern presence and a biometric
 * @param {Array} dataPoints - Array of {patternPresent: boolean, biometricValue: number}
 * @returns {number|null} Pearson correlation coefficient or null if insufficient data
 */
export const calculateCorrelation = (dataPoints) => {
  if (dataPoints.length < 5) return null;

  const n = dataPoints.length;
  const sumX = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0), 0);
  const sumY = dataPoints.reduce((sum, d) => sum + d.biometricValue, 0);
  const sumXY = dataPoints.reduce((sum, d) => sum + (d.patternPresent ? 1 : 0) * d.biometricValue, 0);
  const sumX2 = sumX; // Since X is binary
  const sumY2 = dataPoints.reduce((sum, d) => sum + d.biometricValue ** 2, 0);

  const numerator = (n * sumXY) - (sumX * sumY);
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

  if (denominator === 0) return 0;
  return numerator / denominator;
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Get date string from entry (handles various date formats)
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

/**
 * Calculate average of numeric array
 */
const average = (arr) => {
  const filtered = arr.filter(v => v != null && !isNaN(v));
  return filtered.length > 0 ? filtered.reduce((a, b) => a + b, 0) / filtered.length : null;
};
