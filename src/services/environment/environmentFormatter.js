/**
 * Environment Context Formatter
 *
 * Formats environment data (weather, light, location) for AI consumption.
 * Produces human-readable summaries with key signals for:
 * - AI Chat (askJournalAI)
 * - Insight Generation (generateInsight)
 * - Day Summaries (generateDaySummary)
 * - Nexus 2.0 pattern detection
 */

/**
 * Format environment context for AI consumption (compact, single-line)
 * Used in entry context strings for chat and insights
 *
 * @param {Object} environmentContext - Environment data from entry
 * @returns {string|null} Formatted environment string or null if no data
 */
export const formatEnvironmentForAI = (environmentContext) => {
  if (!environmentContext) return null;

  const parts = [];

  // Weather condition
  if (environmentContext.weatherLabel) {
    parts.push(environmentContext.weatherLabel);
  }

  // Temperature
  if (environmentContext.temperature != null) {
    const unit = environmentContext.temperatureUnit || '\u00B0F';
    parts.push(`${Math.round(environmentContext.temperature)}${unit}`);
  }

  // Day summary - sunshine levels (important for SAD patterns)
  if (environmentContext.daySummary) {
    const ds = environmentContext.daySummary;
    if (ds.sunshinePercent != null) {
      if (ds.sunshinePercent < 30) {
        parts.push('low sunshine');
      } else if (ds.sunshinePercent > 70) {
        parts.push('high sunshine');
      }
    }
  }

  // Light context
  if (environmentContext.lightContext === 'dark' || environmentContext.isAfterDark) {
    parts.push('after dark');
  } else if (environmentContext.lightContext === 'fading') {
    parts.push('fading light');
  } else if (environmentContext.lightContext === 'low_light') {
    parts.push('overcast/dim');
  }

  // Daylight remaining (if relevant for evening entries)
  if (environmentContext.daylightRemaining != null &&
      environmentContext.daylightRemaining < 2 &&
      environmentContext.daylightRemaining > 0) {
    parts.push(`${environmentContext.daylightRemaining.toFixed(1)}h daylight left`);
  }

  return parts.length > 0 ? `[Environment: ${parts.join(', ')}]` : null;
};

/**
 * Format environment data for detailed analysis (multi-line, verbose)
 * Used in day summaries and deep analysis
 *
 * @param {Object} environmentContext - Environment data from entry
 * @returns {string|null} Formatted environment sections or null if no data
 */
export const formatEnvironmentDetailed = (environmentContext) => {
  if (!environmentContext) return null;

  const sections = [];

  // Current conditions
  if (environmentContext.weatherLabel || environmentContext.temperature != null) {
    const temp = environmentContext.temperature != null
      ? `${Math.round(environmentContext.temperature)}${environmentContext.temperatureUnit || '\u00B0F'}`
      : '?';
    sections.push(`WEATHER: ${environmentContext.weatherLabel || 'unknown'}, ${temp}`);
  }

  // Cloud cover (if available)
  if (environmentContext.cloudCover != null) {
    sections.push(`CLOUD COVER: ${environmentContext.cloudCover}%`);
  }

  // Day summary
  if (environmentContext.daySummary) {
    const ds = environmentContext.daySummary;
    const tempRange = (ds.tempHigh != null && ds.tempLow != null)
      ? `High ${ds.tempHigh}\u00B0, Low ${ds.tempLow}\u00B0, `
      : '';
    sections.push(`DAY SUMMARY: ${tempRange}` +
                  `${ds.sunshinePercent || '?'}% sunshine (${ds.sunshineMinutes || '?'} min)`);
  }

  // Light conditions
  if (environmentContext.daylightHours || environmentContext.lightContext) {
    let lightInfo = `LIGHT: ${environmentContext.lightContext || 'unknown'}`;
    if (environmentContext.daylightHours) {
      lightInfo += `, ${environmentContext.daylightHours.toFixed(1)}h total daylight`;
    }
    if (environmentContext.daylightRemaining != null) {
      lightInfo += `, ${environmentContext.daylightRemaining.toFixed(1)}h remaining`;
    }
    sections.push(lightInfo);
  }

  // Sun times
  if (environmentContext.sunriseTime || environmentContext.sunsetTime) {
    sections.push(`SUN: Rise ${environmentContext.sunriseTime || '?'}, Set ${environmentContext.sunsetTime || '?'}`);
  }

  return sections.length > 0 ? sections.join('\n') : null;
};

/**
 * Extract key environment signals for pattern detection and correlations
 * Returns normalized, typed values for statistical analysis
 *
 * @param {Object} environmentContext - Environment data from entry
 * @returns {Object|null} Extracted signals or null if no data
 */
export const extractEnvironmentSignals = (environmentContext) => {
  if (!environmentContext) return null;

  return {
    // Weather
    weather: environmentContext.weather || null,
    weatherLabel: environmentContext.weatherLabel || null,
    temperature: environmentContext.temperature || null,
    cloudCover: environmentContext.cloudCover || null,

    // Day/Night
    isDay: environmentContext.isDay ?? true,
    isAfterDark: environmentContext.isAfterDark || false,
    lightContext: environmentContext.lightContext || null,

    // Daylight
    daylightHours: environmentContext.daylightHours || null,
    daylightRemaining: environmentContext.daylightRemaining || null,

    // Sunshine (important for SAD patterns)
    sunshinePercent: environmentContext.daySummary?.sunshinePercent || null,
    sunshineMinutes: environmentContext.daySummary?.sunshineMinutes || null,
    isLowSunshine: environmentContext.daySummary?.isLowSunshine || false,

    // Day condition
    dayCondition: environmentContext.daySummary?.condition || null,
    tempHigh: environmentContext.daySummary?.tempHigh || null,
    tempLow: environmentContext.daySummary?.tempLow || null
  };
};

/**
 * Get a brief environment status summary for UI badges
 *
 * @param {Object} environmentContext - Environment data from entry
 * @returns {Object} Status indicators for UI
 */
export const getEnvironmentStatus = (environmentContext) => {
  if (!environmentContext) return { hasData: false };

  const status = { hasData: true };

  // Weather status
  if (environmentContext.weatherLabel || environmentContext.weather) {
    status.weather = {
      condition: environmentContext.weather,
      label: environmentContext.weatherLabel,
      temperature: environmentContext.temperature,
      isDay: environmentContext.isDay ?? true
    };
  }

  // Sunshine status
  if (environmentContext.daySummary?.sunshinePercent != null) {
    const sunPct = environmentContext.daySummary.sunshinePercent;
    status.sunshine = {
      percent: sunPct,
      level: sunPct >= 70 ? 'high' :
             sunPct >= 30 ? 'moderate' : 'low',
      isLowSunshine: environmentContext.daySummary.isLowSunshine || sunPct < 30
    };
  }

  // Light context status
  if (environmentContext.lightContext) {
    status.light = {
      context: environmentContext.lightContext,
      isAfterDark: environmentContext.isAfterDark || false,
      daylightRemaining: environmentContext.daylightRemaining
    };
  }

  return status;
};

/**
 * Check if environment conditions suggest potential mood impact
 *
 * @param {Object} environmentContext - Environment data from entry
 * @returns {Object} Potential mood impact indicators
 */
export const getEnvironmentMoodIndicators = (environmentContext) => {
  if (!environmentContext) return null;

  const indicators = [];

  // Low sunshine - potential SAD trigger
  if (environmentContext.daySummary?.isLowSunshine ||
      (environmentContext.daySummary?.sunshinePercent != null &&
       environmentContext.daySummary.sunshinePercent < 30)) {
    indicators.push({
      type: 'low_sunshine',
      impact: 'negative',
      note: 'Low sunshine may affect energy and mood'
    });
  }

  // Rainy/stormy weather
  if (environmentContext.weather && /rain|storm|thunder/i.test(environmentContext.weather)) {
    indicators.push({
      type: 'precipitation',
      impact: 'mixed', // Some people find rain cozy, others gloomy
      note: 'Rainy weather - consider indoor activities'
    });
  }

  // Beautiful sunny weather
  if (environmentContext.weather && /sunny|clear/i.test(environmentContext.weather) &&
      environmentContext.daySummary?.sunshinePercent > 70) {
    indicators.push({
      type: 'sunny',
      impact: 'positive',
      note: 'Great day for outdoor activities'
    });
  }

  // Short daylight hours (winter)
  if (environmentContext.daylightHours != null && environmentContext.daylightHours < 10) {
    indicators.push({
      type: 'short_days',
      impact: 'negative',
      note: 'Short daylight hours - consider light therapy'
    });
  }

  // After dark journaling (evening reflection)
  if (environmentContext.isAfterDark) {
    indicators.push({
      type: 'after_dark',
      impact: 'neutral',
      note: 'Evening reflection time'
    });
  }

  return indicators.length > 0 ? indicators : null;
};

export default {
  formatEnvironmentForAI,
  formatEnvironmentDetailed,
  extractEnvironmentSignals,
  getEnvironmentStatus,
  getEnvironmentMoodIndicators
};
