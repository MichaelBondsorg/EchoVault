/**
 * Sun Times API Service
 *
 * Uses Sunrise-Sunset.org API (free, no API key required)
 * https://sunrise-sunset.org/api
 */

const SUNRISE_SUNSET_API = 'https://api.sunrise-sunset.org/json';

/**
 * Get sun times for a location and date
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {Date} date - Date to get sun times for (default: today)
 * @returns {Object} Sun times data
 */
export const getSunTimes = async (latitude, longitude, date = new Date()) => {
  try {
    const dateStr = date.toISOString().split('T')[0];

    const params = new URLSearchParams({
      lat: latitude.toFixed(4),
      lng: longitude.toFixed(4),
      date: dateStr,
      formatted: '0' // Get ISO 8601 format
    });

    const response = await fetch(`${SUNRISE_SUNSET_API}?${params}`);

    if (!response.ok) {
      throw new Error(`Sun times API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Sun times API status: ${data.status}`);
    }

    const results = data.results;

    // Parse times into local timezone
    const sunrise = new Date(results.sunrise);
    const sunset = new Date(results.sunset);
    const solarNoon = new Date(results.solar_noon);
    const civilTwilightBegin = new Date(results.civil_twilight_begin);
    const civilTwilightEnd = new Date(results.civil_twilight_end);

    // Calculate daylight duration in hours
    const daylightMs = sunset.getTime() - sunrise.getTime();
    const daylightHours = daylightMs / (1000 * 60 * 60);

    // Calculate usable daylight (civil twilight to civil twilight)
    const usableDaylightMs = civilTwilightEnd.getTime() - civilTwilightBegin.getTime();
    const usableDaylightHours = usableDaylightMs / (1000 * 60 * 60);

    return {
      date: dateStr,
      sunrise: sunrise.toISOString(),
      sunriseLocal: formatTime(sunrise),
      sunset: sunset.toISOString(),
      sunsetLocal: formatTime(sunset),
      solarNoon: solarNoon.toISOString(),
      solarNoonLocal: formatTime(solarNoon),
      civilTwilightBegin: civilTwilightBegin.toISOString(),
      civilTwilightEnd: civilTwilightEnd.toISOString(),
      daylightHours: Math.round(daylightHours * 10) / 10,
      usableDaylightHours: Math.round(usableDaylightHours * 10) / 10,
      dayLength: results.day_length, // seconds
      // Derived insights
      isShortDay: daylightHours < 10,
      isVeryShortDay: daylightHours < 9,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to fetch sun times:', error);
    return null;
  }
};

/**
 * Get sun times for multiple days (for trend analysis)
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} days - Number of days to fetch
 * @returns {Array} Sun times for each day
 */
export const getSunTimesRange = async (latitude, longitude, days = 14) => {
  const results = [];
  const today = new Date();

  // Fetch in parallel (but limit concurrency)
  const batchSize = 5;
  for (let i = 0; i < days; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, days); j++) {
      const date = new Date(today);
      date.setDate(date.getDate() - j);
      batch.push(getSunTimes(latitude, longitude, date));
    }

    const batchResults = await Promise.all(batch);
    results.push(...batchResults.filter(r => r !== null));

    // Small delay between batches to be respectful to API
    if (i + batchSize < days) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Calculate if current time is after sunset
 *
 * @param {Object} sunTimes - Sun times object from getSunTimes
 * @param {Date} currentTime - Current time to check (default: now)
 * @returns {boolean}
 */
export const isAfterSunset = (sunTimes, currentTime = new Date()) => {
  if (!sunTimes?.sunset) return false;
  const sunset = new Date(sunTimes.sunset);
  return currentTime > sunset;
};

/**
 * Calculate if current time is before sunrise
 *
 * @param {Object} sunTimes - Sun times object from getSunTimes
 * @param {Date} currentTime - Current time to check (default: now)
 * @returns {boolean}
 */
export const isBeforeSunrise = (sunTimes, currentTime = new Date()) => {
  if (!sunTimes?.sunrise) return false;
  const sunrise = new Date(sunTimes.sunrise);
  return currentTime < sunrise;
};

/**
 * Calculate available daylight remaining
 *
 * @param {Object} sunTimes - Sun times object
 * @param {Date} currentTime - Current time
 * @returns {number} Hours of daylight remaining (0 if after sunset)
 */
export const getDaylightRemaining = (sunTimes, currentTime = new Date()) => {
  if (!sunTimes?.sunset) return 0;

  const sunset = new Date(sunTimes.sunset);
  const sunrise = new Date(sunTimes.sunrise);

  if (currentTime > sunset) return 0;
  if (currentTime < sunrise) {
    // Return full day's daylight
    return sunTimes.daylightHours;
  }

  const remainingMs = sunset.getTime() - currentTime.getTime();
  return Math.round((remainingMs / (1000 * 60 * 60)) * 10) / 10;
};

/**
 * Analyze daylight trend (for SAD detection)
 *
 * @param {Array} sunTimesHistory - Array of sun times objects
 * @returns {Object} Trend analysis
 */
export const analyzeDaylightTrend = (sunTimesHistory) => {
  if (!sunTimesHistory || sunTimesHistory.length < 7) {
    return { trend: 'insufficient_data', daysAnalyzed: sunTimesHistory?.length || 0 };
  }

  const sorted = [...sunTimesHistory].sort((a, b) => a.date.localeCompare(b.date));
  const daylightHours = sorted.map(s => s.daylightHours);

  // Calculate average daylight
  const avgDaylight = daylightHours.reduce((a, b) => a + b, 0) / daylightHours.length;

  // Calculate trend (simple linear regression slope)
  const n = daylightHours.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = daylightHours.reduce((a, b) => a + b, 0);
  const sumXY = daylightHours.reduce((sum, y, i) => sum + i * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Determine trend
  let trend = 'stable';
  if (slope < -0.02) trend = 'decreasing'; // Days getting shorter
  if (slope > 0.02) trend = 'increasing';  // Days getting longer

  // Count short days
  const shortDays = daylightHours.filter(h => h < 10).length;
  const veryShortDays = daylightHours.filter(h => h < 9).length;

  return {
    trend,
    slope: Math.round(slope * 1000) / 1000, // Minutes change per day
    avgDaylightHours: Math.round(avgDaylight * 10) / 10,
    shortDaysCount: shortDays,
    veryShortDaysCount: veryShortDays,
    daysAnalyzed: n,
    // SAD risk indicators
    isSADRisk: avgDaylight < 10 || veryShortDays >= 5,
    isHighSADRisk: avgDaylight < 9 || veryShortDays >= 10
  };
};

/**
 * Format time for display
 */
const formatTime = (date) => {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

export default {
  getSunTimes,
  getSunTimesRange,
  isAfterSunset,
  isBeforeSunrise,
  getDaylightRemaining,
  analyzeDaylightTrend
};
