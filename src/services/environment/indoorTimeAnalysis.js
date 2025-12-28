/**
 * Indoor Time Analysis Service
 *
 * Detects patterns of indoor time from entry context clues:
 * - Time of day patterns (late night entries suggest indoor)
 * - Weather mentions (staying in due to rain)
 * - Activity mentions (Netflix, gaming, work from home)
 * - Explicit indoor/outdoor mentions
 */

const INDOOR_INDICATORS = [
  // Entertainment at home
  { pattern: /\b(netflix|hulu|disney\+?|streaming|binge.?watch)/i, weight: 0.9 },
  { pattern: /\b(video\s?games?|gaming|played?\s+(xbox|playstation|ps[45]|switch|pc))/i, weight: 0.9 },
  { pattern: /\b(watched?\s+(tv|movie|show|series))/i, weight: 0.8 },

  // Work from home
  { pattern: /\b(work(ed|ing)?\s+from\s+home|wfh|remote\s+work)/i, weight: 0.95 },
  { pattern: /\b(home\s+office|at\s+my\s+desk|zoom\s+(call|meeting)s?)/i, weight: 0.9 },

  // Indoor activities
  { pattern: /\b(stayed?\s+(in|home|inside))/i, weight: 1.0 },
  { pattern: /\b(didn't\s+(go\s+out|leave|get\s+out))/i, weight: 1.0 },
  { pattern: /\b(couch|sofa|bed\s+all\s+day)/i, weight: 0.85 },
  { pattern: /\b(cooking|baking|cleaning\s+(the\s+)?house)/i, weight: 0.7 },
  { pattern: /\b(reading|books?|kindle)/i, weight: 0.6 },

  // Weather-related staying in
  { pattern: /\b(too\s+(cold|hot|rainy)|stuck\s+inside|rain(ing|y)?.*inside)/i, weight: 0.9 },
  { pattern: /\b(snow(ing)?.*home|blizzard|storm.*inside)/i, weight: 0.95 },

  // Isolation indicators
  { pattern: /\b(alone\s+all\s+day|by\s+myself|no\s+one\s+to\s+see)/i, weight: 0.8 },
  { pattern: /\b(hermit|isolat(ed|ing)|holed\s+up)/i, weight: 0.9 }
];

const OUTDOOR_INDICATORS = [
  // Exercise outside
  { pattern: /\b(walk(ed)?|hiking?|ran?|running|jogging?)/i, weight: 0.8 },
  { pattern: /\b(bike|cycling|biked?|rode\s+(my\s+)?bike)/i, weight: 0.9 },
  { pattern: /\b(outdoor\s+workout|exercis(e|ed|ing)\s+outside)/i, weight: 1.0 },

  // Nature activities
  { pattern: /\b(park|beach|trail|nature|outside|outdoors)/i, weight: 0.7 },
  { pattern: /\b(garden(ing)?|yard\s+work|mow(ed|ing)?\s+(the\s+)?lawn)/i, weight: 0.85 },
  { pattern: /\b(picnic|bbq|barbecue|grill(ing)?.*outside)/i, weight: 0.9 },

  // Social outings
  { pattern: /\b(went\s+(out|to)|grabbed\s+(coffee|lunch|dinner))/i, weight: 0.6 },
  { pattern: /\b(shopping|mall|store|errands)/i, weight: 0.5 },
  { pattern: /\b(coffee\s+shop|cafe|restaurant)/i, weight: 0.5 },

  // Commute/travel
  { pattern: /\b(commut(e|ed|ing)|drove\s+to\s+work|office)/i, weight: 0.6 },
  { pattern: /\b(travel(ed|ing)?|trip|vacation)/i, weight: 0.7 },

  // Explicit outdoor mentions
  { pattern: /\b(got\s+(some\s+)?sun(light)?|fresh\s+air|vitamin\s+d)/i, weight: 0.9 },
  { pattern: /\b(beautiful\s+day|nice\s+weather|sunny|enjoyed?\s+the\s+weather)/i, weight: 0.8 }
];

/**
 * Analyze a single entry for indoor/outdoor signals
 *
 * @param {Object} entry - Journal entry
 * @returns {Object} Indoor/outdoor analysis
 */
export const analyzeEntryForIndoorTime = (entry) => {
  const text = entry?.text || '';
  const createdAt = entry?.createdAt?.toDate?.() || new Date(entry?.createdAt);
  const hour = createdAt.getHours();

  let indoorScore = 0;
  let outdoorScore = 0;
  const indoorMatches = [];
  const outdoorMatches = [];

  // Check indoor indicators
  for (const { pattern, weight } of INDOOR_INDICATORS) {
    if (pattern.test(text)) {
      indoorScore += weight;
      indoorMatches.push(text.match(pattern)?.[0]);
    }
  }

  // Check outdoor indicators
  for (const { pattern, weight } of OUTDOOR_INDICATORS) {
    if (pattern.test(text)) {
      outdoorScore += weight;
      outdoorMatches.push(text.match(pattern)?.[0]);
    }
  }

  // Time-based adjustments
  // Very late night entries (midnight-5am) suggest indoor
  if (hour >= 0 && hour < 5) {
    indoorScore += 0.5;
  }

  // Determine primary context
  let context = 'unknown';
  if (indoorScore > outdoorScore && indoorScore >= 0.5) {
    context = 'indoor';
  } else if (outdoorScore > indoorScore && outdoorScore >= 0.5) {
    context = 'outdoor';
  } else if (indoorScore > 0 || outdoorScore > 0) {
    context = 'mixed';
  }

  return {
    context,
    indoorScore: Math.round(indoorScore * 100) / 100,
    outdoorScore: Math.round(outdoorScore * 100) / 100,
    indoorMatches: [...new Set(indoorMatches)].slice(0, 3),
    outdoorMatches: [...new Set(outdoorMatches)].slice(0, 3),
    entryHour: hour
  };
};

/**
 * Analyze indoor time patterns over a period
 *
 * @param {Array} entries - Journal entries
 * @param {number} days - Days to analyze (default 14)
 * @returns {Object} Indoor time patterns
 */
export const analyzeIndoorPatterns = (entries, days = 14) => {
  if (!entries || entries.length < 5) {
    return {
      available: false,
      reason: 'insufficient_entries',
      entriesCount: entries?.length || 0
    };
  }

  // Filter to recent entries
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recentEntries = entries.filter(entry => {
    const date = entry?.createdAt?.toDate?.() || new Date(entry?.createdAt);
    return date >= cutoff;
  });

  if (recentEntries.length < 5) {
    return {
      available: false,
      reason: 'insufficient_recent_entries',
      entriesCount: recentEntries.length
    };
  }

  // Analyze each entry
  const analyzed = recentEntries.map(entry => ({
    ...analyzeEntryForIndoorTime(entry),
    moodScore: entry.analysis?.mood_score,
    date: (entry?.createdAt?.toDate?.() || new Date(entry?.createdAt)).toISOString().split('T')[0]
  }));

  // Count contexts
  const contextCounts = {
    indoor: analyzed.filter(a => a.context === 'indoor').length,
    outdoor: analyzed.filter(a => a.context === 'outdoor').length,
    mixed: analyzed.filter(a => a.context === 'mixed').length,
    unknown: analyzed.filter(a => a.context === 'unknown').length
  };

  // Calculate indoor ratio
  const knownContextEntries = analyzed.filter(a => a.context !== 'unknown');
  const indoorRatio = knownContextEntries.length > 0
    ? contextCounts.indoor / knownContextEntries.length
    : null;

  // Mood by context
  const moodByContext = {};
  for (const context of ['indoor', 'outdoor', 'mixed']) {
    const contextEntries = analyzed.filter(a => a.context === context && a.moodScore !== undefined);
    if (contextEntries.length >= 2) {
      const avgMood = contextEntries.reduce((sum, e) => sum + e.moodScore, 0) / contextEntries.length;
      moodByContext[context] = {
        avgMood: Math.round(avgMood * 100) / 100,
        count: contextEntries.length
      };
    }
  }

  // Check for consecutive indoor days
  const uniqueDates = [...new Set(analyzed.filter(a => a.context === 'indoor').map(a => a.date))].sort();
  let maxConsecutiveIndoor = 0;
  let currentStreak = 0;
  let lastDate = null;

  for (const date of uniqueDates) {
    if (lastDate) {
      const diff = (new Date(date) - new Date(lastDate)) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        currentStreak++;
        maxConsecutiveIndoor = Math.max(maxConsecutiveIndoor, currentStreak);
      } else {
        currentStreak = 1;
      }
    } else {
      currentStreak = 1;
    }
    lastDate = date;
  }

  // Generate insights
  const insights = generateIndoorInsights(
    indoorRatio,
    moodByContext,
    maxConsecutiveIndoor,
    contextCounts
  );

  return {
    available: true,
    entriesAnalyzed: analyzed.length,
    daysAnalyzed: days,
    contextCounts,
    indoorRatio: indoorRatio !== null ? Math.round(indoorRatio * 100) : null,
    moodByContext,
    maxConsecutiveIndoorDays: maxConsecutiveIndoor,
    insights,
    analyzedAt: new Date().toISOString()
  };
};

/**
 * Generate insights from indoor patterns
 */
const generateIndoorInsights = (indoorRatio, moodByContext, consecutiveIndoor, contextCounts) => {
  const insights = [];

  // High indoor ratio warning
  if (indoorRatio !== null && indoorRatio > 0.7) {
    insights.push({
      type: 'high_indoor_time',
      severity: indoorRatio > 0.85 ? 'high' : 'medium',
      message: `${Math.round(indoorRatio * 100)}% of your entries mention indoor activities. Getting outside could help.`,
      indoorRatio: Math.round(indoorRatio * 100)
    });
  }

  // Mood difference between indoor and outdoor
  if (moodByContext.indoor && moodByContext.outdoor) {
    const diff = moodByContext.outdoor.avgMood - moodByContext.indoor.avgMood;
    const percentDiff = Math.round((diff / moodByContext.indoor.avgMood) * 100);

    if (diff > 0.1) {
      insights.push({
        type: 'outdoor_mood_boost',
        severity: 'low',
        message: `Your mood is ${percentDiff}% higher on days with outdoor activities.`,
        moodDiff: Math.round(diff * 100) / 100,
        percentDiff
      });
    }
  }

  // Consecutive indoor days warning
  if (consecutiveIndoor >= 4) {
    insights.push({
      type: 'consecutive_indoor',
      severity: consecutiveIndoor >= 7 ? 'high' : 'medium',
      message: `You had ${consecutiveIndoor} consecutive days of indoor-focused entries.`,
      consecutiveDays: consecutiveIndoor
    });
  }

  // Low outdoor engagement
  if (contextCounts.outdoor === 0 && contextCounts.indoor >= 5) {
    insights.push({
      type: 'no_outdoor_mentions',
      severity: 'medium',
      message: 'No outdoor activities mentioned recently. Even brief outdoor time can help mood.',
      indoorCount: contextCounts.indoor
    });
  }

  return insights;
};

/**
 * Check if current context suggests indoor time risk
 *
 * @param {Object} environmentContext - From getEnvironmentContext
 * @param {Object} indoorPatterns - From analyzeIndoorPatterns
 * @returns {Object} Risk assessment
 */
export const assessIndoorTimeRisk = (environmentContext, indoorPatterns) => {
  const risks = [];
  let riskLevel = 'low';

  // Environmental factors that encourage staying indoors
  if (environmentContext?.weather?.isLowLight) {
    risks.push({
      factor: 'weather',
      message: 'Current weather conditions may encourage staying indoors'
    });
  }

  if (environmentContext?.lightContext === 'dark') {
    risks.push({
      factor: 'darkness',
      message: "It's currently dark outside"
    });
  }

  if (environmentContext?.daylightRemaining !== undefined && environmentContext.daylightRemaining < 1) {
    risks.push({
      factor: 'fading_light',
      message: 'Less than an hour of daylight remaining'
    });
  }

  // Pattern-based risks
  if (indoorPatterns?.available) {
    if (indoorPatterns.indoorRatio > 80) {
      risks.push({
        factor: 'pattern',
        message: 'High indoor time pattern detected recently'
      });
      riskLevel = 'medium';
    }

    if (indoorPatterns.maxConsecutiveIndoorDays >= 4) {
      risks.push({
        factor: 'streak',
        message: `${indoorPatterns.maxConsecutiveIndoorDays}-day indoor streak detected`
      });
      riskLevel = indoorPatterns.maxConsecutiveIndoorDays >= 7 ? 'high' : 'medium';
    }
  }

  // Determine overall risk
  if (risks.length >= 3 || (indoorPatterns?.indoorRatio > 90)) {
    riskLevel = 'high';
  } else if (risks.length >= 2) {
    riskLevel = 'medium';
  }

  return {
    riskLevel,
    risks,
    recommendation: getIndoorRiskRecommendation(riskLevel, risks)
  };
};

/**
 * Get recommendation based on indoor time risk
 */
const getIndoorRiskRecommendation = (riskLevel, risks) => {
  if (riskLevel === 'low') {
    return null;
  }

  const hasDarknessRisk = risks.some(r => r.factor === 'darkness' || r.factor === 'fading_light');
  const hasPatternRisk = risks.some(r => r.factor === 'pattern' || r.factor === 'streak');

  if (hasPatternRisk && hasDarknessRisk) {
    return {
      type: 'morning_priority',
      title: 'Morning Light Priority',
      message: 'Try to get outside in the morning when daylight is available. Even 15 minutes helps.',
      icon: 'Sunrise'
    };
  }

  if (hasPatternRisk) {
    return {
      type: 'break_pattern',
      title: 'Break the Pattern',
      message: 'Consider a brief outdoor activity today—a walk, coffee run, or just standing outside.',
      icon: 'Footprints'
    };
  }

  if (hasDarknessRisk) {
    return {
      type: 'plan_ahead',
      title: 'Plan for Tomorrow',
      message: 'Schedule outdoor time for tomorrow morning when daylight is available.',
      icon: 'Calendar'
    };
  }

  return {
    type: 'general',
    title: 'Get Some Fresh Air',
    message: 'A short outdoor break can help reset your mood.',
    icon: 'Wind'
  };
};

export default {
  analyzeEntryForIndoorTime,
  analyzeIndoorPatterns,
  assessIndoorTimeRisk
};
