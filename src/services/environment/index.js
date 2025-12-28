/**
 * Environment Services - Main Export
 *
 * Provides environmental context for mood correlation:
 * - Weather conditions (via Open-Meteo API)
 * - Sun times and daylight hours (via Sunrise-Sunset API)
 * - Indoor/outdoor activity pattern detection
 * - SAD risk assessment and interventions
 */

// Main environment service
export {
  getCurrentLocation,
  getEnvironmentContext,
  getEntryEnvironmentContext,
  checkLocationPermission,
  requestLocationPermission
} from './environmentService';

// Weather API
export {
  getCurrentWeather,
  getDailyWeatherHistory,
  mapWeatherCode
} from './apis/weather';

// Sun times API
export {
  getSunTimes,
  getSunTimesRange,
  isAfterSunset,
  isBeforeSunrise,
  getDaylightRemaining,
  analyzeDaylightTrend
} from './apis/sunTimes';

// Environmental pattern analysis
export {
  analyzeEnvironmentalCorrelations
} from './environmentalPatterns';

// Indoor time analysis
export {
  analyzeEntryForIndoorTime,
  analyzeIndoorPatterns,
  assessIndoorTimeRisk
} from './indoorTimeAnalysis';
