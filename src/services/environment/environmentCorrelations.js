/**
 * Environment-Mood Correlations Service
 *
 * Computes statistical correlations between environment factors and mood.
 * Used by Nexus 2.0 to generate insights like:
 * - "Mood is 18% higher on sunny days vs overcast"
 * - "Low sunshine days (<30%) correlate with lower energy"
 * - "Entries made during daylight show 15% better mood"
 */

import { extractEnvironmentSignals } from './environmentFormatter';

/**
 * Helper: Calculate average of array
 */
const average = (arr) => {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
};

/**
 * Helper: Calculate median of array
 */
const median = (arr) => {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Helper: Calculate Pearson correlation coefficient
 */
const pearsonCorrelation = (x, y) => {
  if (x.length !== y.length || x.length < 3) return 0;

  const n = x.length;
  const avgX = average(x);
  const avgY = average(y);

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const diffX = x[i] - avgX;
    const diffY = y[i] - avgY;
    numerator += diffX * diffY;
    denomX += diffX * diffX;
    denomY += diffY * diffY;
  }

  if (denomX === 0 || denomY === 0) return 0;
  return numerator / Math.sqrt(denomX * denomY);
};

/**
 * Compute correlations between environment factors and mood
 *
 * @param {Array} entries - Journal entries with environmentContext and analysis.mood_score
 * @returns {Object|null} Correlation insights or null if insufficient data
 */
export const computeEnvironmentMoodCorrelations = (entries) => {
  // Extract entries with both mood and environment data
  const dataPoints = entries
    .filter(e => e.analysis?.mood_score != null && e.environmentContext)
    .map(e => ({
      mood: e.analysis.mood_score,
      date: e.createdAt,
      ...extractEnvironmentSignals(e.environmentContext)
    }));

  if (dataPoints.length < 7) {
    return null; // Need at least 7 data points
  }

  const correlations = {};

  // ===== SUNSHINE-MOOD CORRELATION =====
  const sunshineData = dataPoints.filter(d => d.sunshinePercent != null);
  if (sunshineData.length >= 5) {
    const highSunshineMood = average(sunshineData.filter(d => d.sunshinePercent >= 60).map(d => d.mood));
    const lowSunshineMood = average(sunshineData.filter(d => d.sunshinePercent < 30).map(d => d.mood));
    const sunshineMoods = sunshineData.map(d => d.mood);
    const sunshineValues = sunshineData.map(d => d.sunshinePercent);
    const sunCorr = pearsonCorrelation(sunshineValues, sunshineMoods);

    const highCount = sunshineData.filter(d => d.sunshinePercent >= 60).length;
    const lowCount = sunshineData.filter(d => d.sunshinePercent < 30).length;

    if (highCount >= 2 && lowCount >= 2 && Math.abs(highSunshineMood - lowSunshineMood) > 0.1) {
      correlations.sunshineMood = {
        type: 'sunshine_mood',
        correlation: sunCorr,
        highSunshineMood,
        lowSunshineMood,
        difference: highSunshineMood - lowSunshineMood,
        insight: `Mood is ${Math.round(Math.abs(highSunshineMood - lowSunshineMood) * 100)}% ${highSunshineMood > lowSunshineMood ? 'higher' : 'lower'} on sunny days (60%+ sunshine) vs overcast (<30%)`,
        strength: Math.abs(sunCorr) > 0.4 ? 'strong' : Math.abs(sunCorr) > 0.2 ? 'moderate' : 'weak',
        sampleSize: sunshineData.length,
        recommendation: lowSunshineMood < highSunshineMood
          ? 'Consider light therapy or outdoor walks on low-sunshine days'
          : null
      };
    }
  }

  // ===== WEATHER CONDITION-MOOD CORRELATION =====
  const weatherData = dataPoints.filter(d => d.weatherLabel != null);
  if (weatherData.length >= 5) {
    // Group by weather type
    const sunnyEntries = weatherData.filter(d => /sunny|clear/i.test(d.weatherLabel || ''));
    const cloudyEntries = weatherData.filter(d => /cloud|overcast/i.test(d.weatherLabel || ''));
    const rainyEntries = weatherData.filter(d => /rain|storm|drizzle/i.test(d.weatherLabel || ''));

    const sunnyMood = sunnyEntries.length >= 2 ? average(sunnyEntries.map(d => d.mood)) : null;
    const cloudyMood = cloudyEntries.length >= 2 ? average(cloudyEntries.map(d => d.mood)) : null;
    const rainyMood = rainyEntries.length >= 2 ? average(rainyEntries.map(d => d.mood)) : null;

    if (sunnyMood !== null && cloudyMood !== null && Math.abs(sunnyMood - cloudyMood) > 0.08) {
      correlations.weatherMood = {
        type: 'weather_mood',
        sunnyMood,
        cloudyMood,
        rainyMood,
        sunnyVsCloudy: sunnyMood - cloudyMood,
        insight: `Sunny days average ${Math.round(sunnyMood * 100)}% mood vs ${Math.round(cloudyMood * 100)}% on cloudy days`,
        strength: Math.abs(sunnyMood - cloudyMood) > 0.2 ? 'strong' : 'moderate',
        breakdown: {
          sunny: { count: sunnyEntries.length, avgMood: sunnyMood },
          cloudy: { count: cloudyEntries.length, avgMood: cloudyMood },
          rainy: rainyMood ? { count: rainyEntries.length, avgMood: rainyMood } : null
        },
        sampleSize: weatherData.length
      };
    }
  }

  // ===== DAYLIGHT HOURS-MOOD CORRELATION (Seasonal) =====
  const daylightData = dataPoints.filter(d => d.daylightHours != null);
  if (daylightData.length >= 10) {
    const longDayMood = average(daylightData.filter(d => d.daylightHours >= 12).map(d => d.mood));
    const shortDayMood = average(daylightData.filter(d => d.daylightHours < 10).map(d => d.mood));
    const daylightMoods = daylightData.map(d => d.mood);
    const daylightHours = daylightData.map(d => d.daylightHours);
    const daylightCorr = pearsonCorrelation(daylightHours, daylightMoods);

    const longCount = daylightData.filter(d => d.daylightHours >= 12).length;
    const shortCount = daylightData.filter(d => d.daylightHours < 10).length;

    if (longCount >= 3 && shortCount >= 3 && Math.abs(longDayMood - shortDayMood) > 0.1) {
      correlations.daylightMood = {
        type: 'daylight_mood',
        correlation: daylightCorr,
        longDayMood,
        shortDayMood,
        difference: longDayMood - shortDayMood,
        insight: `Mood tends to be ${Math.round(Math.abs(longDayMood - shortDayMood) * 100)}% ${longDayMood > shortDayMood ? 'higher' : 'lower'} during longer daylight periods (12h+)`,
        strength: Math.abs(daylightCorr) > 0.4 ? 'strong' : 'moderate',
        sampleSize: daylightData.length,
        recommendation: shortDayMood < longDayMood
          ? 'Consider light therapy or maximizing outdoor time during shorter days (winter months)'
          : null
      };
    }
  }

  // ===== TIME OF DAY (Light Context)-MOOD CORRELATION =====
  const lightContextData = dataPoints.filter(d => d.lightContext != null);
  if (lightContextData.length >= 5) {
    const daylightMood = average(lightContextData.filter(d => d.lightContext === 'daylight').map(d => d.mood));
    const darkMood = average(lightContextData.filter(d => d.isAfterDark).map(d => d.mood));
    const lowLightMood = average(lightContextData.filter(d => d.lightContext === 'low_light').map(d => d.mood));

    const daylightCount = lightContextData.filter(d => d.lightContext === 'daylight').length;
    const darkCount = lightContextData.filter(d => d.isAfterDark).length;

    if (daylightCount >= 2 && darkCount >= 2 && Math.abs(daylightMood - darkMood) > 0.08) {
      const betterTime = daylightMood > darkMood ? 'daylight' : 'evening';
      correlations.lightContextMood = {
        type: 'light_context_mood',
        daylightMood,
        darkMood,
        lowLightMood,
        difference: Math.abs(daylightMood - darkMood),
        insight: daylightMood > darkMood
          ? `Entries during daylight average ${Math.round((daylightMood - darkMood) * 100)}% higher mood than evening entries`
          : `Evening entries show ${Math.round((darkMood - daylightMood) * 100)}% higher mood - you may be a night person!`,
        strength: Math.abs(daylightMood - darkMood) > 0.2 ? 'strong' : 'moderate',
        peakTime: betterTime,
        sampleSize: lightContextData.length
      };
    }
  }

  // ===== TEMPERATURE-MOOD CORRELATION =====
  const tempData = dataPoints.filter(d => d.temperature != null);
  if (tempData.length >= 10) {
    const medianTemp = median(tempData.map(d => d.temperature));
    const warmMood = average(tempData.filter(d => d.temperature >= 70).map(d => d.mood));
    const coolMood = average(tempData.filter(d => d.temperature < 50).map(d => d.mood));
    const mildMood = average(tempData.filter(d => d.temperature >= 50 && d.temperature < 70).map(d => d.mood));

    const warmCount = tempData.filter(d => d.temperature >= 70).length;
    const coolCount = tempData.filter(d => d.temperature < 50).length;

    if (warmCount >= 3 && coolCount >= 3 && Math.abs(warmMood - coolMood) > 0.1) {
      correlations.temperatureMood = {
        type: 'temperature_mood',
        warmMood,
        coolMood,
        mildMood,
        difference: warmMood - coolMood,
        medianTemp,
        insight: `Warmer days (70°F+) correlate with ${Math.round(Math.abs(warmMood - coolMood) * 100)}% ${warmMood > coolMood ? 'better' : 'lower'} mood vs cold days (<50°F)`,
        strength: Math.abs(warmMood - coolMood) > 0.2 ? 'strong' : 'moderate',
        optimalRange: mildMood > warmMood && mildMood > coolMood ? '50-70°F' : (warmMood > coolMood ? '70°F+' : '<50°F'),
        sampleSize: tempData.length
      };
    }
  }

  // ===== LOW SUNSHINE WARNING (SAD Indicator) =====
  const lowSunshineData = dataPoints.filter(d => d.isLowSunshine != null);
  if (lowSunshineData.length >= 5) {
    const lowSunDays = lowSunshineData.filter(d => d.isLowSunshine);
    const normalDays = lowSunshineData.filter(d => !d.isLowSunshine);

    if (lowSunDays.length >= 2 && normalDays.length >= 2) {
      const lowSunMood = average(lowSunDays.map(d => d.mood));
      const normalMood = average(normalDays.map(d => d.mood));

      if (normalMood - lowSunMood > 0.1) {
        correlations.lowSunshineWarning = {
          type: 'low_sunshine_warning',
          lowSunshineDayMood: lowSunMood,
          normalDayMood: normalMood,
          difference: normalMood - lowSunMood,
          lowSunshineDaysCount: lowSunDays.length,
          insight: `Low sunshine days (<30%) show ${Math.round((normalMood - lowSunMood) * 100)}% lower mood - consider SAD prevention strategies`,
          strength: normalMood - lowSunMood > 0.2 ? 'strong' : 'moderate',
          recommendation: 'Light therapy, vitamin D supplementation, or morning outdoor walks may help',
          sampleSize: lowSunshineData.length
        };
      }
    }
  }

  return Object.keys(correlations).length > 0 ? correlations : null;
};

/**
 * Get top environment insights for display
 * @param {Array} entries - Journal entries
 * @param {number} maxInsights - Maximum insights to return
 * @returns {Array} Top insights sorted by strength
 */
export const getTopEnvironmentInsights = (entries, maxInsights = 3) => {
  const correlations = computeEnvironmentMoodCorrelations(entries);
  if (!correlations) return [];

  const insights = Object.values(correlations)
    .filter(c => c.insight)
    .sort((a, b) => {
      const strengthOrder = { strong: 3, moderate: 2, weak: 1 };
      return (strengthOrder[b.strength] || 0) - (strengthOrder[a.strength] || 0);
    })
    .slice(0, maxInsights);

  return insights;
};

/**
 * Check if user has enough data for environment correlations
 * @param {Array} entries - Journal entries
 * @returns {Object} { hasEnoughData, dataPoints, message }
 */
export const checkEnvironmentDataSufficiency = (entries) => {
  const withEnv = entries.filter(e => e.environmentContext && e.analysis?.mood_score != null);

  if (withEnv.length < 7) {
    return {
      hasEnoughData: false,
      dataPoints: withEnv.length,
      needed: 7,
      message: `Need ${7 - withEnv.length} more entries with environment data for correlations`
    };
  }

  return {
    hasEnoughData: true,
    dataPoints: withEnv.length,
    message: 'Sufficient data for environment-mood correlations'
  };
};

export default {
  computeEnvironmentMoodCorrelations,
  getTopEnvironmentInsights,
  checkEnvironmentDataSufficiency
};
