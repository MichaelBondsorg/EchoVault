/**
 * Environmental Patterns Analysis
 *
 * Correlates mood with environmental factors:
 * - Weather conditions
 * - Daylight hours
 * - Time of day (relative to sunset)
 * - Seasonal patterns
 */

import { getDailyWeatherHistory } from './apis/weather';
import { getSunTimesRange, analyzeDaylightTrend } from './apis/sunTimes';

/**
 * Analyze correlations between mood and environmental factors
 *
 * @param {Array} entries - Journal entries with mood scores
 * @param {Object} location - { latitude, longitude }
 * @returns {Object} Environmental correlations and insights
 */
export const analyzeEnvironmentalCorrelations = async (entries, location) => {
  if (!entries || entries.length < 7 || !location) {
    return {
      available: false,
      reason: 'insufficient_data',
      entriesAnalyzed: entries?.length || 0
    };
  }

  // Get weather and sun data for the analysis period
  const [weatherHistory, sunTimesHistory] = await Promise.all([
    getDailyWeatherHistory(location.latitude, location.longitude, 30),
    getSunTimesRange(location.latitude, location.longitude, 30)
  ]);

  // Create lookup maps by date
  const weatherByDate = new Map(weatherHistory.map(w => [w.date, w]));
  const sunByDate = new Map(sunTimesHistory.map(s => [s.date, s]));

  // Analyze entries with environmental context
  const entriesWithContext = entries.map(entry => {
    const entryDate = getDateString(entry.createdAt);
    const entryTime = getEntryTime(entry.createdAt);
    const weather = weatherByDate.get(entryDate);
    const sunTimes = sunByDate.get(entryDate);

    // Determine if entry was after dark
    let isAfterDark = false;
    if (sunTimes && entryTime) {
      const sunsetHour = parseSunTime(sunTimes.sunsetLocal);
      const sunriseHour = parseSunTime(sunTimes.sunriseLocal);
      const entryHour = entryTime.hours + entryTime.minutes / 60;

      isAfterDark = entryHour > sunsetHour || entryHour < sunriseHour;
    }

    return {
      ...entry,
      moodScore: entry.analysis?.mood_score,
      weather: weather?.condition,
      isLowLightWeather: weather?.isLowLight,
      daylightHours: sunTimes?.daylightHours,
      isAfterDark,
      isShortDay: sunTimes?.isShortDay
    };
  }).filter(e => e.moodScore !== undefined);

  // Calculate correlations
  const weatherCorrelation = calculateWeatherCorrelation(entriesWithContext);
  const daylightCorrelation = calculateDaylightCorrelation(entriesWithContext);
  const afterDarkCorrelation = calculateAfterDarkCorrelation(entriesWithContext);
  const daylightTrend = analyzeDaylightTrend(sunTimesHistory);

  // Generate insights
  const insights = generateEnvironmentalInsights(
    weatherCorrelation,
    daylightCorrelation,
    afterDarkCorrelation,
    daylightTrend
  );

  // Generate interventions based on patterns
  const interventions = generateInterventions(
    weatherCorrelation,
    daylightCorrelation,
    afterDarkCorrelation,
    daylightTrend
  );

  return {
    available: true,
    entriesAnalyzed: entriesWithContext.length,
    weatherCorrelation,
    daylightCorrelation,
    afterDarkCorrelation,
    daylightTrend,
    insights,
    interventions,
    analyzedAt: new Date().toISOString()
  };
};

/**
 * Calculate mood correlation with weather conditions
 */
const calculateWeatherCorrelation = (entries) => {
  const byCondition = {};

  for (const entry of entries) {
    if (!entry.weather || entry.moodScore === undefined) continue;

    const condition = entry.weather;
    if (!byCondition[condition]) {
      byCondition[condition] = { moods: [], count: 0 };
    }
    byCondition[condition].moods.push(entry.moodScore);
    byCondition[condition].count++;
  }

  // Calculate averages and compare to overall
  const allMoods = entries.filter(e => e.moodScore !== undefined).map(e => e.moodScore);
  const overallAvg = allMoods.length > 0 ? allMoods.reduce((a, b) => a + b, 0) / allMoods.length : 0.5;

  const results = {};
  for (const [condition, data] of Object.entries(byCondition)) {
    if (data.count < 3) continue; // Need enough samples

    const avg = data.moods.reduce((a, b) => a + b, 0) / data.moods.length;
    const diff = avg - overallAvg;
    const percentDiff = Math.round((diff / overallAvg) * 100);

    results[condition] = {
      avgMood: Math.round(avg * 100) / 100,
      entriesCount: data.count,
      diffFromAverage: Math.round(diff * 100) / 100,
      percentDiff,
      impact: percentDiff < -10 ? 'negative' : percentDiff > 10 ? 'positive' : 'neutral'
    };
  }

  return results;
};

/**
 * Calculate mood correlation with daylight hours
 */
const calculateDaylightCorrelation = (entries) => {
  const shortDayEntries = entries.filter(e => e.isShortDay && e.moodScore !== undefined);
  const normalDayEntries = entries.filter(e => !e.isShortDay && e.moodScore !== undefined);

  if (shortDayEntries.length < 3 || normalDayEntries.length < 3) {
    return { available: false, reason: 'insufficient_samples' };
  }

  const shortDayAvg = shortDayEntries.reduce((sum, e) => sum + e.moodScore, 0) / shortDayEntries.length;
  const normalDayAvg = normalDayEntries.reduce((sum, e) => sum + e.moodScore, 0) / normalDayEntries.length;
  const diff = shortDayAvg - normalDayAvg;
  const percentDiff = Math.round((diff / normalDayAvg) * 100);

  return {
    available: true,
    shortDayAvgMood: Math.round(shortDayAvg * 100) / 100,
    normalDayAvgMood: Math.round(normalDayAvg * 100) / 100,
    shortDayCount: shortDayEntries.length,
    normalDayCount: normalDayEntries.length,
    moodDifference: Math.round(diff * 100) / 100,
    percentDiff,
    impact: percentDiff < -10 ? 'significant_negative' : percentDiff < -5 ? 'mild_negative' : 'neutral'
  };
};

/**
 * Calculate mood correlation with writing after dark
 */
const calculateAfterDarkCorrelation = (entries) => {
  const afterDarkEntries = entries.filter(e => e.isAfterDark && e.moodScore !== undefined);
  const daylightEntries = entries.filter(e => !e.isAfterDark && e.moodScore !== undefined);

  if (afterDarkEntries.length < 3 || daylightEntries.length < 3) {
    return { available: false, reason: 'insufficient_samples' };
  }

  const afterDarkAvg = afterDarkEntries.reduce((sum, e) => sum + e.moodScore, 0) / afterDarkEntries.length;
  const daylightAvg = daylightEntries.reduce((sum, e) => sum + e.moodScore, 0) / daylightEntries.length;
  const diff = afterDarkAvg - daylightAvg;
  const percentDiff = Math.round((diff / daylightAvg) * 100);

  return {
    available: true,
    afterDarkAvgMood: Math.round(afterDarkAvg * 100) / 100,
    daylightAvgMood: Math.round(daylightAvg * 100) / 100,
    afterDarkCount: afterDarkEntries.length,
    daylightCount: daylightEntries.length,
    moodDifference: Math.round(diff * 100) / 100,
    percentDiff,
    impact: percentDiff < -15 ? 'significant_negative' : percentDiff < -5 ? 'mild_negative' : 'neutral'
  };
};

/**
 * Generate human-readable insights from correlations
 */
const generateEnvironmentalInsights = (weather, daylight, afterDark, daylightTrend) => {
  const insights = [];

  // Weather insights
  for (const [condition, data] of Object.entries(weather)) {
    if (data.impact === 'negative' && data.entriesCount >= 5) {
      insights.push({
        type: 'weather_correlation',
        severity: Math.abs(data.percentDiff) > 20 ? 'high' : 'medium',
        message: `Your mood tends to be ${Math.abs(data.percentDiff)}% lower on ${condition} days.`,
        condition,
        percentDiff: data.percentDiff,
        samples: data.entriesCount
      });
    }
    if (data.impact === 'positive' && data.entriesCount >= 5) {
      insights.push({
        type: 'weather_boost',
        severity: 'low',
        message: `${condition.charAt(0).toUpperCase() + condition.slice(1)} days tend to boost your mood by ${data.percentDiff}%.`,
        condition,
        percentDiff: data.percentDiff,
        samples: data.entriesCount
      });
    }
  }

  // Daylight hours insights
  if (daylight.available && daylight.impact !== 'neutral') {
    insights.push({
      type: 'daylight_correlation',
      severity: daylight.impact === 'significant_negative' ? 'high' : 'medium',
      message: `Your mood is ${Math.abs(daylight.percentDiff)}% lower on short-daylight days (< 10 hours).`,
      percentDiff: daylight.percentDiff,
      shortDayCount: daylight.shortDayCount
    });
  }

  // After dark insights
  if (afterDark.available && afterDark.impact !== 'neutral') {
    insights.push({
      type: 'after_dark_correlation',
      severity: afterDark.impact === 'significant_negative' ? 'high' : 'medium',
      message: `Entries written after sunset show ${Math.abs(afterDark.percentDiff)}% lower mood on average.`,
      percentDiff: afterDark.percentDiff,
      afterDarkCount: afterDark.afterDarkCount
    });
  }

  // Seasonal insights
  if (daylightTrend.isSADRisk) {
    insights.push({
      type: 'seasonal_risk',
      severity: daylightTrend.isHighSADRisk ? 'high' : 'medium',
      message: daylightTrend.trend === 'decreasing'
        ? 'Days are getting shorter. This is a common trigger for seasonal mood changes.'
        : `You've had ${daylightTrend.veryShortDaysCount} days with less than 9 hours of daylight recently.`,
      trend: daylightTrend.trend,
      avgDaylight: daylightTrend.avgDaylightHours
    });
  }

  return insights;
};

/**
 * Generate intervention suggestions based on patterns
 */
const generateInterventions = (weather, daylight, afterDark, daylightTrend) => {
  const interventions = [];

  // SAD lamp recommendation
  if (daylightTrend.isSADRisk || (daylight.available && daylight.impact === 'significant_negative')) {
    interventions.push({
      type: 'SAD_lamp',
      priority: daylightTrend.isHighSADRisk ? 'high' : 'medium',
      title: 'Light Therapy',
      message: 'Consider using a SAD lamp for 20-30 minutes each morning.',
      reason: daylightTrend.trend === 'decreasing'
        ? 'Days are getting shorter'
        : 'Your mood correlates with reduced daylight',
      icon: 'Sun'
    });
  }

  // Morning light recommendation
  if (afterDark.available && afterDark.impact !== 'neutral') {
    interventions.push({
      type: 'morning_light',
      priority: 'medium',
      title: 'Morning Light Exposure',
      message: 'Try to get natural light within 30 minutes of waking.',
      reason: 'Your evening mood tends to be lower than daytime',
      icon: 'Sunrise'
    });
  }

  // Lunch walk recommendation
  if (afterDark.afterDarkCount > afterDark.daylightCount) {
    interventions.push({
      type: 'lunch_walk',
      priority: 'high',
      title: 'Midday Light Break',
      message: 'A 15-minute outdoor walk at lunch can significantly boost vitamin D and mood.',
      reason: 'Most of your entries are after dark - you may be missing available daylight',
      icon: 'Footprints'
    });
  }

  // Weather-based recommendation
  const overcastData = weather['overcast'];
  if (overcastData && overcastData.impact === 'negative' && overcastData.entriesCount >= 5) {
    interventions.push({
      type: 'cloudy_day_support',
      priority: 'low',
      title: 'Cloudy Day Strategy',
      message: 'On overcast days, consider extra self-care activities that boost your mood.',
      reason: `Your mood drops ${Math.abs(overcastData.percentDiff)}% on cloudy days`,
      icon: 'Cloud'
    });
  }

  return interventions;
};

/**
 * Utility: Get date string from timestamp
 */
const getDateString = (timestamp) => {
  if (!timestamp) return null;
  const date = timestamp instanceof Date ? timestamp : timestamp.toDate?.() || new Date(timestamp);
  return date.toISOString().split('T')[0];
};

/**
 * Utility: Get time from timestamp
 */
const getEntryTime = (timestamp) => {
  if (!timestamp) return null;
  const date = timestamp instanceof Date ? timestamp : timestamp.toDate?.() || new Date(timestamp);
  return {
    hours: date.getHours(),
    minutes: date.getMinutes()
  };
};

/**
 * Utility: Parse sun time string to hour number
 */
const parseSunTime = (timeStr) => {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours + minutes / 60;
};

export default {
  analyzeEnvironmentalCorrelations
};
