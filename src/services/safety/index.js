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
 * Check longitudinal risk based on recent entries
 */
export const checkLongitudinalRisk = (recentEntries) => {
  const last7Days = recentEntries.filter(e =>
    e.createdAt > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  );

  if (last7Days.length < 3) {
    console.log('Longitudinal risk check skipped: insufficient data', {
      entriesInWindow: last7Days.length,
      requiredMinimum: 3
    });
    return false;
  }

  const avgMood = last7Days.reduce((sum, e) =>
    sum + (e.analysis?.mood_score || 0.5), 0) / last7Days.length;

  const moodScores = last7Days.map(e => e.analysis?.mood_score || 0.5);
  const n = moodScores.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = moodScores.reduce((a, b) => a + b, 0);
  const sumXY = moodScores.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  return avgMood < 0.25 || slope < -0.05;
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
