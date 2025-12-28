/**
 * Environment Service
 *
 * Main service for getting environmental context.
 * Combines location, weather, and sun times data.
 *
 * Privacy: Location is only accessed when user opens the app.
 * Data is processed locally and not shared with third parties.
 */

import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { getCurrentWeather, getDailyWeatherHistory } from './apis/weather';
import { getSunTimes, isAfterSunset, isBeforeSunrise, getDaylightRemaining } from './apis/sunTimes';

const LOCATION_CACHE_KEY = 'env_location_cache';
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Get current location with caching
 * Falls back to cached location if permission denied or error
 *
 * @returns {Object|null} { latitude, longitude, cached, error }
 */
export const getCurrentLocation = async () => {
  try {
    // Check permissions first
    const permission = await Geolocation.checkPermissions();

    if (permission.location === 'denied') {
      // Try to get cached location
      return await getCachedLocation();
    }

    if (permission.location === 'prompt') {
      // Request permission
      const requested = await Geolocation.requestPermissions();
      if (requested.location !== 'granted') {
        return await getCachedLocation();
      }
    }

    // Get current position
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false, // Coarse location is fine for weather
      timeout: 10000
    });

    const location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: Date.now(),
      cached: false
    };

    // Cache the location
    await Preferences.set({
      key: LOCATION_CACHE_KEY,
      value: JSON.stringify(location)
    });

    return location;
  } catch (error) {
    console.error('Failed to get location:', error);

    // Fall back to cached location
    const cached = await getCachedLocation();
    if (cached) return cached;

    return { error: error.message, cached: false };
  }
};

/**
 * Get cached location if available and not too old
 */
const getCachedLocation = async () => {
  try {
    const { value } = await Preferences.get({ key: LOCATION_CACHE_KEY });
    if (!value) return null;

    const cached = JSON.parse(value);

    // Check if cache is still valid (24 hours for location)
    if (Date.now() - cached.timestamp > 24 * 60 * 60 * 1000) {
      return null;
    }

    return { ...cached, cached: true };
  } catch {
    return null;
  }
};

/**
 * Get full environmental context for current location and time
 *
 * @returns {Object} Complete environmental context
 */
export const getEnvironmentContext = async () => {
  const location = await getCurrentLocation();

  if (!location || location.error) {
    return {
      available: false,
      error: location?.error || 'Location unavailable',
      timestamp: new Date().toISOString()
    };
  }

  const { latitude, longitude } = location;

  // Fetch weather and sun times in parallel
  const [weather, sunTimes] = await Promise.all([
    getCurrentWeather(latitude, longitude),
    getSunTimes(latitude, longitude)
  ]);

  const now = new Date();
  const afterSunset = sunTimes ? isAfterSunset(sunTimes, now) : false;
  const beforeSunrise = sunTimes ? isBeforeSunrise(sunTimes, now) : false;
  const daylightRemaining = sunTimes ? getDaylightRemaining(sunTimes, now) : null;

  // Determine light exposure context
  let lightContext = 'daylight';
  if (afterSunset || beforeSunrise) {
    lightContext = 'dark';
  } else if (weather?.isLowLight) {
    lightContext = 'low_light';
  } else if (daylightRemaining !== null && daylightRemaining < 2) {
    lightContext = 'fading';
  }

  return {
    available: true,
    location: {
      latitude: Math.round(latitude * 100) / 100, // Round for privacy
      longitude: Math.round(longitude * 100) / 100,
      cached: location.cached
    },
    weather,
    sunTimes,
    lightContext,
    isAfterSunset: afterSunset,
    isBeforeSunrise: beforeSunrise,
    daylightRemaining,
    timestamp: new Date().toISOString()
  };
};

/**
 * Get environmental context for a specific entry
 * Used to enrich entry data at creation time
 *
 * @returns {Object} Simplified context for storage
 */
export const getEntryEnvironmentContext = async () => {
  const context = await getEnvironmentContext();

  if (!context.available) {
    return null;
  }

  return {
    weather: context.weather?.condition || null,
    temperature: context.weather?.temperature || null,
    cloudCover: context.weather?.cloudCover || null,
    sunsetTime: context.sunTimes?.sunsetLocal || null,
    sunriseTime: context.sunTimes?.sunriseLocal || null,
    daylightHours: context.sunTimes?.daylightHours || null,
    isAfterDark: context.isAfterSunset || context.isBeforeSunrise,
    lightContext: context.lightContext,
    capturedAt: context.timestamp
  };
};

/**
 * Check if location permission is available
 *
 * @returns {Object} { granted, canRequest }
 */
export const checkLocationPermission = async () => {
  try {
    const permission = await Geolocation.checkPermissions();
    return {
      granted: permission.location === 'granted',
      canRequest: permission.location === 'prompt',
      denied: permission.location === 'denied'
    };
  } catch (error) {
    console.error('Failed to check location permission:', error);
    return { granted: false, canRequest: false, denied: false, error: error.message };
  }
};

/**
 * Request location permission
 *
 * @returns {boolean} Whether permission was granted
 */
export const requestLocationPermission = async () => {
  try {
    const result = await Geolocation.requestPermissions();
    return result.location === 'granted';
  } catch (error) {
    console.error('Failed to request location permission:', error);
    return false;
  }
};

export default {
  getCurrentLocation,
  getEnvironmentContext,
  getEntryEnvironmentContext,
  checkLocationPermission,
  requestLocationPermission
};
