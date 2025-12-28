import { CRISIS_KEYWORDS, WARNING_INDICATORS } from '../../config';

/**
 * Check if text contains crisis keywords
 */
export const checkCrisisKeywords = (text) => CRISIS_KEYWORDS.test(text);

/**
 * Check if text contains warning indicators
 */
export const checkWarningIndicators = (text) => WARNING_INDICATORS.test(text);

/**
 * Longitudinal Risk Configuration
 * 14-day window aligns with Maslach Burnout Inventory recommendation
 * for detecting sustained patterns vs temporary dips
 */
const LONGITUDINAL_CONFIG = {
  windowDays: 14,          // 14-day analysis window for stable burnout detection
  minimumEntries: 5,       // Need at least 5 entries for meaningful trend
  slopeThreshold: -0.03,   // More lenient slope over longer window (-0.03 per entry)
  avgMoodThreshold: 0.30,  // Average mood below this triggers concern
  acuteSlopeThreshold: -0.05, // Steeper slope in 7-day subset indicates acute decline
  acuteWindowDays: 7       // Window for detecting acute (rapid) decline
};

/**
 * Check longitudinal risk based on recent entries
 *
 * Uses a 14-day window with two-tier detection:
 * 1. Sustained decline: Gradual downward trend over 14 days
 * 2. Acute decline: Rapid drop in last 7 days
 *
 * @param {Array} recentEntries - All recent entries (pre-filtered or full array)
 * @returns {Object} Risk assessment with details
 */
export const checkLongitudinalRisk = (recentEntries) => {
  const now = Date.now();

  // Filter to 14-day window
  const last14Days = recentEntries.filter(e => {
    const entryTime = e.createdAt instanceof Date
      ? e.createdAt.getTime()
      : e.createdAt?.toDate?.()?.getTime?.() || new Date(e.createdAt).getTime();
    return entryTime > now - LONGITUDINAL_CONFIG.windowDays * 24 * 60 * 60 * 1000;
  });

  if (last14Days.length < LONGITUDINAL_CONFIG.minimumEntries) {
    console.log('Longitudinal risk check skipped: insufficient data', {
      entriesInWindow: last14Days.length,
      requiredMinimum: LONGITUDINAL_CONFIG.minimumEntries
    });
    return {
      isAtRisk: false,
      reason: 'insufficient_data',
      entriesAnalyzed: last14Days.length,
      windowDays: LONGITUDINAL_CONFIG.windowDays
    };
  }

  // Sort by date (oldest first for slope calculation)
  const sorted = [...last14Days].sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : a.createdAt?.toDate?.()?.getTime?.() || 0;
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : b.createdAt?.toDate?.()?.getTime?.() || 0;
    return aTime - bTime;
  });

  const moodScores = sorted.map(e => e.analysis?.mood_score ?? 0.5);

  // Calculate average mood
  const avgMood = moodScores.reduce((sum, score) => sum + score, 0) / moodScores.length;

  // Calculate linear regression slope (14-day window)
  const n = moodScores.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = moodScores.reduce((a, b) => a + b, 0);
  const sumXY = moodScores.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sustainedSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Check for acute decline (last 7 days)
  const last7Days = sorted.filter(e => {
    const entryTime = e.createdAt instanceof Date
      ? e.createdAt.getTime()
      : e.createdAt?.toDate?.()?.getTime?.() || 0;
    return entryTime > now - LONGITUDINAL_CONFIG.acuteWindowDays * 24 * 60 * 60 * 1000;
  });

  let acuteSlope = 0;
  if (last7Days.length >= 3) {
    const acuteMoods = last7Days.map(e => e.analysis?.mood_score ?? 0.5);
    const an = acuteMoods.length;
    const aSumX = (an * (an - 1)) / 2;
    const aSumY = acuteMoods.reduce((a, b) => a + b, 0);
    const aSumXY = acuteMoods.reduce((sum, y, x) => sum + x * y, 0);
    const aSumX2 = (an * (an - 1) * (2 * an - 1)) / 6;
    acuteSlope = (an * aSumXY - aSumX * aSumY) / (an * aSumX2 - aSumX * aSumX);
  }

  // Determine risk factors
  const isSustainedDecline = sustainedSlope < LONGITUDINAL_CONFIG.slopeThreshold;
  const isAcuteDecline = acuteSlope < LONGITUDINAL_CONFIG.acuteSlopeThreshold;
  const isLowAvgMood = avgMood < LONGITUDINAL_CONFIG.avgMoodThreshold;

  // At risk if any condition is met
  const isAtRisk = isLowAvgMood || isSustainedDecline || isAcuteDecline;

  // Determine primary reason
  let reason = null;
  if (isAtRisk) {
    if (isAcuteDecline && isLowAvgMood) {
      reason = 'acute_decline_with_low_mood';
    } else if (isAcuteDecline) {
      reason = 'acute_decline';
    } else if (isSustainedDecline && isLowAvgMood) {
      reason = 'sustained_decline_with_low_mood';
    } else if (isSustainedDecline) {
      reason = 'sustained_decline';
    } else {
      reason = 'low_average_mood';
    }
  }

  const result = {
    isAtRisk,
    reason,
    entriesAnalyzed: last14Days.length,
    windowDays: LONGITUDINAL_CONFIG.windowDays,
    metrics: {
      avgMood: Math.round(avgMood * 100) / 100,
      sustainedSlope: Math.round(sustainedSlope * 1000) / 1000,
      acuteSlope: Math.round(acuteSlope * 1000) / 1000,
      acuteEntriesCount: last7Days.length
    },
    thresholds: {
      avgMood: LONGITUDINAL_CONFIG.avgMoodThreshold,
      sustainedSlope: LONGITUDINAL_CONFIG.slopeThreshold,
      acuteSlope: LONGITUDINAL_CONFIG.acuteSlopeThreshold
    },
    flags: {
      isSustainedDecline,
      isAcuteDecline,
      isLowAvgMood
    }
  };

  if (isAtRisk) {
    console.log('Longitudinal risk detected:', result);
  }

  return result;
};

/**
 * Analyze longitudinal patterns in entries
 */
export const analyzeLongitudinalPatterns = (entries) => {
  const patterns = [];
  // Filter for valid entries with mood scores and text
  const moodEntries = entries.filter(e =>
    e.entry_type !== 'task' &&
    typeof e.analysis?.mood_score === 'number' &&
    typeof e.text === 'string' &&
    e.createdAt
  );

  if (moodEntries.length < 7) return patterns;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const moodByDay = {};
  dayNames.forEach(d => { moodByDay[d] = []; });

  moodEntries.forEach(e => {
    const day = dayNames[e.createdAt.getDay()];
    moodByDay[day].push(e.analysis.mood_score);
  });

  const dayAverages = {};
  dayNames.forEach(day => {
    if (moodByDay[day].length >= 2) {
      dayAverages[day] = moodByDay[day].reduce((a, b) => a + b, 0) / moodByDay[day].length;
    }
  });

  const avgMood = moodEntries.reduce((sum, e) => sum + e.analysis.mood_score, 0) / moodEntries.length;

  Object.entries(dayAverages).forEach(([day, avg]) => {
    const diff = avg - avgMood;
    if (diff < -0.15) {
      patterns.push({
        type: 'weekly_low',
        day,
        avgMood: avg,
        overallAvg: avgMood,
        message: `Your mood tends to dip on ${day}s (${Math.round(avg * 100)}% vs ${Math.round(avgMood * 100)}% average)`
      });
    } else if (diff > 0.15) {
      patterns.push({
        type: 'weekly_high',
        day,
        avgMood: avg,
        overallAvg: avgMood,
        message: `${day}s tend to be your best days (${Math.round(avg * 100)}% mood)`
      });
    }
  });

  // Trigger word analysis
  const triggerWords = ['deadline', 'meeting', 'presentation', 'conflict', 'argument', 'stress', 'anxiety', 'tired', 'exhausted', 'overwhelmed'];
  triggerWords.forEach(trigger => {
    const withTrigger = moodEntries.filter(e => e.text.toLowerCase().includes(trigger));
    const withoutTrigger = moodEntries.filter(e => !e.text.toLowerCase().includes(trigger));

    if (withTrigger.length >= 3 && withoutTrigger.length >= 3) {
      const avgWith = withTrigger.reduce((sum, e) => sum + e.analysis.mood_score, 0) / withTrigger.length;
      const avgWithout = withoutTrigger.reduce((sum, e) => sum + e.analysis.mood_score, 0) / withoutTrigger.length;

      if (avgWithout - avgWith > 0.15) {
        patterns.push({
          type: 'trigger_correlation',
          trigger,
          avgWith,
          avgWithout,
          percentDiff: (avgWithout - avgWith) * 100,
          message: `"${trigger}" appears in entries with lower mood (${Math.round(avgWith * 100)}% vs ${Math.round(avgWithout * 100)}%)`
        });
      }
    }
  });

  return patterns;
};
