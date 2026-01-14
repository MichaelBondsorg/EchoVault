/**
 * Counterfactual Reasoner
 *
 * Generates "what if" insights by analyzing what the user didn't do
 * on bad days that they typically do on good days.
 */

import { callGemini } from '../../ai/gemini';

// ============================================================
// ACTIVITY PATTERNS
// ============================================================

const ACTIVITY_PATTERNS = {
  yoga: /yoga|flow|vinyasa/i,
  sterling_walk: /sterling|walked.*dog|dog.*walk/i,
  workout: /workout|gym|barrys|lift/i,
  spencer: /spencer/i,
  social: /dinner with|hung out|met up/i,
  meditation: /meditat|mindful|breathing/i,
  creative: /paint|built|created|coded/i,
  nature: /hike|park|outside|nature|beach/i
};

// ============================================================
// COUNTERFACTUAL DETECTION
// ============================================================

/**
 * Identify missing interventions on a bad day
 */
export const identifyMissingInterventions = (badDayEntry, interventionData, typicalGoodDayActivities) => {
  const badDayText = (badDayEntry.content || badDayEntry.text || '').toLowerCase();
  const badDayMood = badDayEntry.mood || badDayEntry.analysis?.mood_score;

  const missing = [];

  // Check what usually happens on good days that didn't happen today
  for (const activity of (typicalGoodDayActivities || [])) {
    const pattern = ACTIVITY_PATTERNS[activity];

    if (pattern && !pattern.test(badDayText)) {
      const effectiveness = interventionData?.interventions?.[activity]?.effectiveness?.global;

      if (effectiveness?.score > 0.7) {
        missing.push({
          activity,
          expectedMoodBoost: effectiveness.moodDelta?.mean || 10,
          effectivenessScore: effectiveness.score,
          typicalFrequency: interventionData.interventions[activity].totalOccurrences
        });
      }
    }
  }

  return missing.sort((a, b) => b.effectivenessScore - a.effectivenessScore);
};

/**
 * Find activities that correlate with good days
 */
export const findGoodDayActivities = (entries, minOccurrences = 3) => {
  if (!entries || entries.length < 10) return [];

  const activityMoodMap = {};

  // Analyze each entry
  for (const entry of entries) {
    const text = (entry.content || entry.text || '').toLowerCase();
    const mood = entry.mood || entry.analysis?.mood_score;

    if (!mood) continue;

    // Check each activity pattern
    for (const [activity, pattern] of Object.entries(ACTIVITY_PATTERNS)) {
      if (pattern.test(text)) {
        if (!activityMoodMap[activity]) {
          activityMoodMap[activity] = { moods: [], count: 0 };
        }
        activityMoodMap[activity].moods.push(mood);
        activityMoodMap[activity].count++;
      }
    }
  }

  // Calculate average mood and filter by minimum occurrences
  const results = [];
  for (const [activity, data] of Object.entries(activityMoodMap)) {
    if (data.count >= minOccurrences) {
      const avgMood = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
      if (avgMood >= 60) {  // Above-average mood threshold
        results.push({
          activity,
          averageMood: avgMood,
          occurrences: data.count
        });
      }
    }
  }

  return results.sort((a, b) => b.averageMood - a.averageMood);
};

/**
 * Generate counterfactual insight
 */
export const generateCounterfactualInsight = async (badDayEntry, missingInterventions, historicalData) => {
  if (!missingInterventions || missingInterventions.length === 0) return null;

  const topMissing = missingInterventions[0];

  try {
    const entryDate = badDayEntry.date || badDayEntry.createdAt?.toDate?.()?.toISOString?.().split('T')[0] || 'recently';

    const prompt = `Generate a "what if" insight for a user who had a low mood day.

BAD DAY CONTEXT:
- Date: ${entryDate}
- Mood: ${badDayEntry.mood || badDayEntry.analysis?.mood_score}%
- Brief summary: "${(badDayEntry.content || badDayEntry.text || '').slice(0, 200)}"

MISSING INTERVENTION:
- Activity: ${topMissing.activity.replace(/_/g, ' ')}
- Historical effectiveness: ${Math.round(topMissing.effectivenessScore * 100)}%
- Typical mood boost: +${Math.round(topMissing.expectedMoodBoost)} points

Generate a brief, non-judgmental counterfactual insight:
1. Don't say "you should have" - that's not helpful
2. Frame as useful information for future similar situations
3. Be specific about the expected impact
4. Acknowledge that some days are just hard

Response format (JSON):
{
  "title": "A Pattern to Note",
  "insight": "On days like this, [activity] has historically helped you by [specific amount]. This isn't about what you 'should' have done—it's information for next time.",
  "futureAction": "When you notice similar feelings, [activity] might help",
  "probability": 0.73
}`;

    const response = await callGemini(prompt, '');

    if (!response) {
      return null;
    }

    const parsed = JSON.parse(response.replace(/```json?\n?|```/g, '').trim());

    return {
      type: 'counterfactual',
      entryId: badDayEntry.id,
      entryDate,
      missingActivity: topMissing.activity,
      ...parsed,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('[Counterfactual] Insight generation failed:', error);
    return null;
  }
};

/**
 * Analyze a series of low mood days for patterns
 */
export const analyzeCounterfactualPatterns = async (entries, interventionData) => {
  if (!entries || entries.length < 5) return null;

  // Find low mood days (below 40%)
  const lowMoodDays = entries.filter(e => {
    const mood = e.mood || e.analysis?.mood_score;
    return mood && mood < 40;
  });

  if (lowMoodDays.length < 3) return null;

  // Find good day activities
  const goodDayActivities = findGoodDayActivities(entries);
  const activityNames = goodDayActivities.map(a => a.activity);

  // Check what's consistently missing on bad days
  const missingCounts = {};

  for (const badDay of lowMoodDays) {
    const missing = identifyMissingInterventions(badDay, interventionData, activityNames);

    for (const m of missing) {
      if (!missingCounts[m.activity]) {
        missingCounts[m.activity] = { count: 0, totalEffectiveness: 0 };
      }
      missingCounts[m.activity].count++;
      missingCounts[m.activity].totalEffectiveness += m.effectivenessScore;
    }
  }

  // Find the most consistently missing intervention
  let topMissing = null;
  let maxCount = 0;

  for (const [activity, data] of Object.entries(missingCounts)) {
    if (data.count > maxCount) {
      maxCount = data.count;
      topMissing = {
        activity,
        missingPercentage: Math.round((data.count / lowMoodDays.length) * 100),
        avgEffectiveness: data.totalEffectiveness / data.count
      };
    }
  }

  if (!topMissing || topMissing.missingPercentage < 60) return null;

  return {
    type: 'counterfactual_pattern',
    lowMoodDaysAnalyzed: lowMoodDays.length,
    consistentlyMissing: topMissing,
    insight: `${topMissing.activity.replace(/_/g, ' ')} was absent from ${topMissing.missingPercentage}% of your low mood days`,
    recommendation: `Consider ${topMissing.activity.replace(/_/g, ' ')} as a protective factor during difficult periods`,
    confidence: topMissing.missingPercentage / 100
  };
};
