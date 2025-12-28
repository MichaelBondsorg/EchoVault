/**
 * Burnout Risk Score Service
 *
 * Computes a burnout risk score (0-1) based on multiple factors:
 * - Mood trajectory (declining trends)
 * - Fatigue/exhaustion language
 * - Overwork indicators (late nights, weekends)
 * - Physical symptoms
 * - Work tag density
 * - Low mood streaks
 *
 * Uses the Maslach Burnout Inventory dimensions:
 * 1. Emotional Exhaustion
 * 2. Depersonalization/Cynicism
 * 3. Reduced Personal Accomplishment
 */

import {
  FATIGUE_KEYWORDS,
  OVERWORK_KEYWORDS,
  PHYSICAL_SYMPTOMS,
  EMOTIONAL_EXHAUSTION,
  CYNICISM_KEYWORDS,
  RECOVERY_KEYWORDS,
  findKeywordMatches,
  hasWorkStressTags,
  checkTimeRisk
} from './burnoutIndicators';

// Weight configuration for risk factors
const FACTOR_WEIGHTS = {
  moodTrajectory: 0.25,      // 25% - Declining mood is strong signal
  fatigueKeywords: 0.20,     // 20% - Explicit exhaustion language
  overworkIndicators: 0.20,  // 20% - Late nights, weekend work
  physicalSymptoms: 0.15,    // 15% - Body is speaking
  workTagDensity: 0.10,      // 10% - Work dominating journal
  lowMoodStreak: 0.10        // 10% - Consecutive bad days
};

// Risk level thresholds
export const RISK_LEVELS = {
  LOW: { min: 0, max: 0.3, label: 'low', color: 'green' },
  MODERATE: { min: 0.3, max: 0.5, label: 'moderate', color: 'yellow' },
  HIGH: { min: 0.5, max: 0.7, label: 'high', color: 'orange' },
  CRITICAL: { min: 0.7, max: 1.0, label: 'critical', color: 'red' }
};

/**
 * Compute burnout risk score from recent entries
 *
 * @param {Array} entries - Recent 14 entries (newest first)
 * @param {Object} options - Optional configuration
 * @returns {Object} Risk assessment result
 */
export const computeBurnoutRiskScore = (entries, options = {}) => {
  if (!entries || entries.length < 3) {
    return {
      riskScore: 0,
      riskLevel: 'low',
      signals: [],
      factors: {},
      recommendation: null,
      triggerShelterMode: false,
      insufficientData: true
    };
  }

  const recentEntries = entries.slice(0, 14);
  const signals = [];
  const factors = {};

  // Factor 1: Mood Trajectory (25%)
  const moodFactor = calculateMoodTrajectoryFactor(recentEntries);
  factors.moodTrajectory = moodFactor;
  if (moodFactor.signal) signals.push(moodFactor.signal);

  // Factor 2: Fatigue Keywords (20%)
  const fatigueFactor = calculateKeywordFactor(
    recentEntries,
    [...FATIGUE_KEYWORDS, ...EMOTIONAL_EXHAUSTION],
    'fatigue'
  );
  factors.fatigueKeywords = fatigueFactor;
  if (fatigueFactor.signal) signals.push(fatigueFactor.signal);

  // Factor 3: Overwork Indicators (20%)
  const overworkFactor = calculateOverworkFactor(recentEntries);
  factors.overworkIndicators = overworkFactor;
  if (overworkFactor.signal) signals.push(overworkFactor.signal);

  // Factor 4: Physical Symptoms (15%)
  const physicalFactor = calculateKeywordFactor(
    recentEntries,
    PHYSICAL_SYMPTOMS,
    'physical_symptoms'
  );
  factors.physicalSymptoms = physicalFactor;
  if (physicalFactor.signal) signals.push(physicalFactor.signal);

  // Factor 5: Work Tag Density (10%)
  const workDensityFactor = calculateWorkTagDensity(recentEntries);
  factors.workTagDensity = workDensityFactor;
  if (workDensityFactor.signal) signals.push(workDensityFactor.signal);

  // Factor 6: Low Mood Streak (10%)
  const lowStreakFactor = calculateLowMoodStreak(recentEntries);
  factors.lowMoodStreak = lowStreakFactor;
  if (lowStreakFactor.signal) signals.push(lowStreakFactor.signal);

  // Calculate weighted score
  let rawScore =
    (factors.moodTrajectory.score * FACTOR_WEIGHTS.moodTrajectory) +
    (factors.fatigueKeywords.score * FACTOR_WEIGHTS.fatigueKeywords) +
    (factors.overworkIndicators.score * FACTOR_WEIGHTS.overworkIndicators) +
    (factors.physicalSymptoms.score * FACTOR_WEIGHTS.physicalSymptoms) +
    (factors.workTagDensity.score * FACTOR_WEIGHTS.workTagDensity) +
    (factors.lowMoodStreak.score * FACTOR_WEIGHTS.lowMoodStreak);

  // Apply recovery discount (recent breaks reduce risk)
  const recoveryDiscount = calculateRecoveryDiscount(recentEntries);
  const adjustedScore = Math.max(0, rawScore - recoveryDiscount);

  // Clamp to 0-1
  const riskScore = Math.min(1, Math.max(0, adjustedScore));

  // Determine risk level
  const riskLevel = getRiskLevel(riskScore);

  // Generate recommendation
  const recommendation = generateRecommendation(riskScore, riskLevel, signals);

  // Determine if shelter mode should be suggested
  const triggerShelterMode = shouldTriggerShelterMode(riskScore, riskLevel, factors);

  return {
    riskScore: Number(riskScore.toFixed(3)),
    riskLevel,
    signals,
    factors,
    recommendation,
    triggerShelterMode,
    recoveryDiscount: recoveryDiscount > 0 ? recoveryDiscount : undefined,
    entryCount: recentEntries.length,
    assessedAt: new Date().toISOString()
  };
};

/**
 * Calculate mood trajectory factor
 */
const calculateMoodTrajectoryFactor = (entries) => {
  const moodScores = entries
    .filter(e => e.analysis?.mood_score !== null && e.analysis?.mood_score !== undefined)
    .map(e => e.analysis.mood_score);

  if (moodScores.length < 2) {
    return { score: 0, signal: null, details: 'insufficient_data' };
  }

  // Calculate trend (latest vs oldest)
  const latest = moodScores.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, moodScores.length);
  const oldest = moodScores.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, moodScores.length);
  const trend = latest - oldest;

  // Calculate average
  const avgMood = moodScores.reduce((a, b) => a + b, 0) / moodScores.length;

  // Score: declining trend + low average = high risk
  let score = 0;

  // Trend component (0-0.5)
  if (trend < -0.2) score += 0.5;       // Strong decline
  else if (trend < -0.1) score += 0.3;  // Moderate decline
  else if (trend < 0) score += 0.1;     // Slight decline

  // Average component (0-0.5)
  if (avgMood < 0.3) score += 0.5;      // Very low average
  else if (avgMood < 0.4) score += 0.3; // Low average
  else if (avgMood < 0.5) score += 0.1; // Below neutral

  const signal = score > 0.3 ? 'declining_mood' : null;

  return {
    score: Math.min(1, score),
    signal,
    details: {
      trend: trend.toFixed(2),
      average: avgMood.toFixed(2),
      trendLabel: trend < -0.1 ? 'declining' : trend > 0.1 ? 'improving' : 'stable'
    }
  };
};

/**
 * Calculate keyword-based factor
 */
const calculateKeywordFactor = (entries, keywords, signalName) => {
  let totalMatches = 0;
  let entriesWithMatches = 0;
  const allMatches = [];

  entries.forEach(entry => {
    const result = findKeywordMatches(entry.text, keywords);
    if (result.found) {
      totalMatches += result.count;
      entriesWithMatches++;
      allMatches.push(...result.matches);
    }
  });

  // Score based on frequency (0-1)
  // High frequency = > 50% of entries have matches
  const frequency = entries.length > 0 ? entriesWithMatches / entries.length : 0;
  const score = Math.min(1, frequency * 1.5); // Scale up slightly

  const signal = score > 0.3 ? signalName : null;

  return {
    score,
    signal,
    details: {
      matchCount: totalMatches,
      entriesAffected: entriesWithMatches,
      frequency: frequency.toFixed(2),
      topMatches: [...new Set(allMatches)].slice(0, 5)
    }
  };
};

/**
 * Calculate overwork factor (late nights, weekends, overwork language)
 */
const calculateOverworkFactor = (entries) => {
  let lateNightCount = 0;
  let weekendCount = 0;
  let overworkKeywordCount = 0;

  entries.forEach(entry => {
    // Check time-based risks
    const timeRisk = checkTimeRisk(entry.createdAt?.toDate?.() || entry.createdAt);
    if (timeRisk.risks.includes('late_night_entry')) lateNightCount++;
    if (timeRisk.risks.includes('weekend_entry')) weekendCount++;

    // Check overwork keywords
    const keywordResult = findKeywordMatches(entry.text, OVERWORK_KEYWORDS);
    if (keywordResult.found) overworkKeywordCount++;
  });

  const entryCount = entries.length;
  const lateNightRatio = entryCount > 0 ? lateNightCount / entryCount : 0;
  const weekendRatio = entryCount > 0 ? weekendCount / entryCount : 0;
  const keywordRatio = entryCount > 0 ? overworkKeywordCount / entryCount : 0;

  // Combined score
  const score = Math.min(1,
    (lateNightRatio * 0.4) +
    (weekendRatio * 0.3) +
    (keywordRatio * 0.3)
  );

  const signals = [];
  if (lateNightRatio > 0.3) signals.push('frequent_late_nights');
  if (weekendRatio > 0.3) signals.push('weekend_overwork');

  return {
    score,
    signal: score > 0.3 ? 'overwork_pattern' : null,
    details: {
      lateNightEntries: lateNightCount,
      weekendEntries: weekendCount,
      overworkMentions: overworkKeywordCount,
      subSignals: signals
    }
  };
};

/**
 * Calculate work tag density
 */
const calculateWorkTagDensity = (entries) => {
  let totalTags = 0;
  let workTags = 0;

  entries.forEach(entry => {
    const tags = entry.tags || [];
    totalTags += tags.length;

    const workResult = hasWorkStressTags(tags);
    workTags += workResult.workTags?.length || 0;
  });

  const density = totalTags > 0 ? workTags / totalTags : 0;

  // High work tag density (> 60%) indicates work-dominated journaling
  const score = Math.min(1, density * 1.5);

  return {
    score,
    signal: score > 0.4 ? 'work_dominated_entries' : null,
    details: {
      totalTags,
      workTags,
      density: density.toFixed(2)
    }
  };
};

/**
 * Calculate low mood streak
 */
const calculateLowMoodStreak = (entries) => {
  let currentStreak = 0;

  for (const entry of entries) {
    const mood = entry.analysis?.mood_score;
    if (mood !== null && mood !== undefined && mood < 0.4) {
      currentStreak++;
    } else {
      break; // Streak broken
    }
  }

  // Score based on streak length
  // 3+ consecutive low days = concerning
  let score = 0;
  if (currentStreak >= 5) score = 1.0;
  else if (currentStreak >= 4) score = 0.8;
  else if (currentStreak >= 3) score = 0.5;
  else if (currentStreak >= 2) score = 0.2;

  return {
    score,
    signal: currentStreak >= 3 ? `${currentStreak}_day_low_streak` : null,
    details: {
      streakLength: currentStreak,
      threshold: 0.4
    }
  };
};

/**
 * Calculate recovery discount (recent breaks reduce risk)
 */
const calculateRecoveryDiscount = (entries) => {
  // Only look at most recent 5 entries
  const recent = entries.slice(0, 5);

  let recoverySignals = 0;
  recent.forEach(entry => {
    const result = findKeywordMatches(entry.text, RECOVERY_KEYWORDS);
    if (result.found) recoverySignals++;
  });

  // Each recovery signal reduces score by 0.05 (max 0.15 discount)
  return Math.min(0.15, recoverySignals * 0.05);
};

/**
 * Get risk level from score
 */
const getRiskLevel = (score) => {
  if (score >= RISK_LEVELS.CRITICAL.min) return 'critical';
  if (score >= RISK_LEVELS.HIGH.min) return 'high';
  if (score >= RISK_LEVELS.MODERATE.min) return 'moderate';
  return 'low';
};

/**
 * Generate recommendation based on risk
 */
const generateRecommendation = (score, level, signals) => {
  if (level === 'critical') {
    return {
      priority: 'urgent',
      message: 'Your burnout indicators are at critical levels. We strongly recommend taking a break.',
      actions: [
        { type: 'shelter_mode', label: 'Enter Shelter Mode', priority: 'high' },
        { type: 'breathing', label: 'Try Breathing Exercise', priority: 'medium' },
        { type: 'contact', label: 'Reach out to someone', priority: 'medium' }
      ]
    };
  }

  if (level === 'high') {
    return {
      priority: 'high',
      message: 'You\'re showing signs of burnout. Consider taking some time to decompress.',
      actions: [
        { type: 'break', label: 'Take a short break', priority: 'high' },
        { type: 'grounding', label: 'Try grounding exercise', priority: 'medium' }
      ]
    };
  }

  if (level === 'moderate') {
    return {
      priority: 'medium',
      message: 'Some burnout signals detected. Keep an eye on your energy levels.',
      actions: [
        { type: 'check_in', label: 'Check in with yourself', priority: 'low' }
      ]
    };
  }

  return null;
};

/**
 * Determine if shelter mode should be suggested
 */
const shouldTriggerShelterMode = (score, level, factors) => {
  // Critical level always triggers
  if (level === 'critical') return true;

  // High level with multiple severe factors
  if (level === 'high') {
    const severeFactors = Object.values(factors).filter(f => f.score > 0.6);
    return severeFactors.length >= 2;
  }

  return false;
};

/**
 * Get risk level details for UI display
 */
export const getRiskLevelInfo = (level) => {
  return Object.values(RISK_LEVELS).find(l => l.label === level) || RISK_LEVELS.LOW;
};

export default {
  computeBurnoutRiskScore,
  getRiskLevelInfo,
  RISK_LEVELS,
  FACTOR_WEIGHTS
};
