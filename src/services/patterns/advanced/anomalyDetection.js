/**
 * Anomaly Detection Service
 *
 * Identifies entries that stand out from the user's normal patterns:
 * - Unusual mood scores (too high or too low for context)
 * - Unusual entry length
 * - Sentiment/mood mismatch (negative language but reported good mood)
 * - Sudden changes in journaling behavior
 */

import { extractFeatures, calculateBaselines } from './featureExtraction';

/**
 * Calculate z-score (standard deviations from mean)
 */
const calculateZScore = (value, mean, std) => {
  if (std === 0) return 0;
  return (value - mean) / std;
};

/**
 * Determine anomaly type based on scores
 */
const determineAnomalyType = (scores) => {
  const types = [];

  if (scores.mood) {
    types.push(scores.mood > 0 ? 'unusually_positive' : 'unusually_negative');
  }

  if (scores.length) {
    types.push(scores.length > 0 ? 'unusually_long' : 'unusually_short');
  }

  if (scores.sentimentMismatch) {
    types.push('sentiment_mismatch');
  }

  if (scores.behaviorChange) {
    types.push('behavior_change');
  }

  if (types.length === 0) return 'general_anomaly';
  if (types.length === 1) return types[0];
  return 'multiple_anomalies';
};

/**
 * Generate explanation for detected anomaly
 */
const generateAnomalyExplanation = (scores, baselines, features) => {
  const parts = [];

  if (scores.mood) {
    const direction = scores.mood > 0 ? 'higher' : 'lower';
    const stdDev = Math.abs(scores.mood).toFixed(1);
    const moodPercent = Math.round(features.target.moodScore * 100);
    const avgPercent = Math.round(baselines.mood.mean * 100);
    parts.push(`Your mood (${moodPercent}%) is ${stdDev} standard deviations ${direction} than your average (${avgPercent}%).`);
  }

  if (scores.length) {
    const direction = scores.length > 0 ? 'longer' : 'shorter';
    parts.push(`This entry is significantly ${direction} than your typical entries.`);
  }

  if (scores.sentimentMismatch) {
    if (scores.sentimentMismatch > 0) {
      parts.push(`The language in this entry seems more negative than your reported mood suggests.`);
    } else {
      parts.push(`You reported feeling down, but the language seems more positive than expected.`);
    }
  }

  if (scores.behaviorChange) {
    parts.push(`Your journaling pattern has changed noticeably.`);
  }

  return parts.length > 0
    ? parts.join(' ')
    : 'This entry stands out from your typical patterns.';
};

/**
 * Detect anomalies in entries
 *
 * @param {Object[]} entries - Journal entries
 * @returns {Object[]} Array of detected anomalies
 */
export const detectAnomalies = (entries) => {
  if (entries.length < 10) {
    return []; // Need baseline data
  }

  const anomalies = [];

  // Extract features for all entries
  const allFeatures = entries.map(e => extractFeatures(e, entries));

  // Calculate baselines
  const baselines = calculateBaselines(allFeatures);

  // Analyze each entry
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const features = allFeatures[i];
    const anomalyScores = {};

    // Skip entries without mood scores
    if (features.target.moodScore === undefined) continue;

    // 1. Mood anomaly (z-score > 2)
    const moodZ = calculateZScore(
      features.target.moodScore,
      baselines.mood.mean,
      baselines.mood.std
    );

    if (Math.abs(moodZ) > 2) {
      anomalyScores.mood = moodZ;
    }

    // 2. Entry length anomaly
    const lengthZ = calculateZScore(
      features.linguistic.wordCount,
      baselines.wordCount.mean,
      baselines.wordCount.std
    );

    if (Math.abs(lengthZ) > 2) {
      anomalyScores.length = lengthZ;
    }

    // 3. Sentiment-mood mismatch
    // Calculate sentiment from word counts
    const sentimentRatio = features.linguistic.negativeWords /
      (features.linguistic.positiveWords + 1);

    // Expected sentiment based on mood (low mood = high negative ratio)
    const expectedSentimentRatio = 1 - features.target.moodScore;

    // Significant mismatch (more negative language than mood suggests)
    if (Math.abs(sentimentRatio - expectedSentimentRatio) > 0.5) {
      anomalyScores.sentimentMismatch = sentimentRatio - expectedSentimentRatio;
    }

    // 4. Behavior change detection
    // Check for sudden changes in journaling frequency
    if (i >= 7) {
      const prevWeekEntries = entries.slice(i - 7, i);
      const prevWeekDates = prevWeekEntries.map(e =>
        new Date(e.effectiveDate || e.createdAt)
      );

      const currentDate = new Date(entry.effectiveDate || entry.createdAt);
      const daysSinceLastEntry = features.sequential.daysSinceLastEntry;

      // If they usually journal daily but haven't for 3+ days
      const avgGap = prevWeekEntries.length > 1
        ? prevWeekDates.reduce((sum, d, idx) => {
            if (idx === 0) return sum;
            return sum + (d - prevWeekDates[idx - 1]) / (1000 * 60 * 60 * 24);
          }, 0) / (prevWeekEntries.length - 1)
        : 1;

      if (daysSinceLastEntry && daysSinceLastEntry > avgGap * 3 && avgGap < 2) {
        anomalyScores.behaviorChange = daysSinceLastEntry / avgGap;
      }
    }

    // Create anomaly record if any anomalies detected
    if (Object.keys(anomalyScores).length > 0) {
      const anomalyType = determineAnomalyType(anomalyScores);
      const severity = Math.max(...Object.values(anomalyScores).map(Math.abs));

      anomalies.push({
        id: `anomaly_${entry.id}`,
        entryId: entry.id,
        date: entry.effectiveDate || entry.createdAt,
        scores: anomalyScores,
        type: anomalyType,
        severity: Number(severity.toFixed(2)),
        explanation: generateAnomalyExplanation(anomalyScores, baselines, features),
        mood: features.target.moodScore,
        baselineMood: baselines.mood.mean,
        wordCount: features.linguistic.wordCount,
        baselineWordCount: baselines.wordCount.mean,
        createdAt: new Date().toISOString()
      });
    }
  }

  // Sort by severity (most anomalous first)
  return anomalies.sort((a, b) => b.severity - a.severity);
};

/**
 * Get recent anomalies (last 30 days)
 */
export const getRecentAnomalies = (anomalies, days = 30) => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return anomalies.filter(a => {
    const date = new Date(a.date);
    return date >= cutoff;
  });
};

/**
 * Get anomaly statistics
 */
export const getAnomalyStats = (anomalies) => {
  if (anomalies.length === 0) {
    return {
      totalAnomalies: 0,
      byType: {},
      avgSeverity: 0,
      mostCommonType: null
    };
  }

  const byType = {};
  anomalies.forEach(a => {
    byType[a.type] = (byType[a.type] || 0) + 1;
  });

  const mostCommonType = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])[0][0];

  return {
    totalAnomalies: anomalies.length,
    byType,
    avgSeverity: anomalies.reduce((sum, a) => sum + a.severity, 0) / anomalies.length,
    mostCommonType
  };
};

/**
 * Format anomaly for UI display
 */
export const formatAnomalyForUI = (anomaly) => {
  const typeLabels = {
    unusually_positive: 'Unusually Positive Mood',
    unusually_negative: 'Unusually Low Mood',
    unusually_long: 'Much Longer Entry',
    unusually_short: 'Much Shorter Entry',
    sentiment_mismatch: 'Mixed Signals',
    behavior_change: 'Changed Pattern',
    multiple_anomalies: 'Unusual Entry',
    general_anomaly: 'Unusual Entry'
  };

  const typeIcons = {
    unusually_positive: 'trending-up',
    unusually_negative: 'trending-down',
    unusually_long: 'file-text',
    unusually_short: 'minus',
    sentiment_mismatch: 'alert-circle',
    behavior_change: 'clock',
    multiple_anomalies: 'alert-triangle',
    general_anomaly: 'info'
  };

  return {
    id: anomaly.id,
    entryId: anomaly.entryId,
    date: anomaly.date,
    title: typeLabels[anomaly.type] || 'Unusual Entry',
    icon: typeIcons[anomaly.type] || 'info',
    message: anomaly.explanation,
    severity: anomaly.severity > 3 ? 'high' : anomaly.severity > 2 ? 'medium' : 'low',
    mood: Math.round((anomaly.mood || 0) * 100)
  };
};

export default {
  detectAnomalies,
  getRecentAnomalies,
  getAnomalyStats,
  formatAnomalyForUI
};
