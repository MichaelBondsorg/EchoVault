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
import { auth } from '../../config/firebase';
import { getCurrentWeather, getDailyWeatherHistory, getWeatherIcon } from './apis/weather';
import { getSunTimes, isAfterSunset, isBeforeSunrise, getDaylightRemaining } from './apis/sunTimes';

// Legacy (pre owner-scoping) global key. Per ADR-0001 / PRIV-01
// (docs/adr/0001-owner-scoped-local-data.md,
// src/services/storage/storageRegistry.js), unowned local data is
// quarantined (deleted) the first time it's discovered — never adopted by
// whichever account happens to be signed in when it's next encountered.
const LEGACY_LOCATION_CACHE_KEY = 'env_location_cache';
const locationCacheKey = (uid) => `env_location_cache::${uid}`;
// Location cache retention: 24 hours. Matches the storageRegistry entry's retentionMs.
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const GEOLOCATION_TIMEOUT_MS = 5000; // 5 second timeout for permission checks

/**
 * Resolve the currently authenticated owner for cache scoping. Returns null
 * (rather than throwing) so cache reads/writes fail safe to "no cache"
 * instead of surfacing an auth error out of an unrelated lookup. No uid is
 * ever cached at module scope — every call re-derives it from the live
 * Firebase auth session. Mirrors src/services/health/whoop.js's identical
 * helper.
 */
const currentUid = () => auth.currentUser?.uid || null;

/**
 * Delete an unowned legacy Preferences key if present. Best-effort — a
 * failed removal just means we try again next time the key is encountered.
 */
const quarantineLegacyKey = async (legacyKey) => {
  try {
    await Preferences.remove({ key: legacyKey });
  } catch {
    // Nothing to recover if removal fails.
  }
};

/**
 * Wrap a promise with a timeout
 */
const withTimeout = (promise, ms, fallback = null) => {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);
};

/**
 * Get current location with caching
 * Falls back to cached location if permission denied or error
 *
 * @returns {Object|null} { latitude, longitude, cached, error }
 */
export const getCurrentLocation = async () => {
  try {
    // Check permissions first (with timeout to prevent hanging)
    const permission = await withTimeout(
      Geolocation.checkPermissions(),
      GEOLOCATION_TIMEOUT_MS,
      { location: 'denied' }
    );

    if (permission.location === 'denied') {
      // Try to get cached location
      return await getCachedLocation();
    }

    if (permission.location === 'prompt') {
      // Request permission (with timeout)
      const requested = await withTimeout(
        Geolocation.requestPermissions(),
        GEOLOCATION_TIMEOUT_MS,
        { location: 'denied' }
      );
      if (requested.location !== 'granted') {
        return await getCachedLocation();
      }
    }

    // Get current position (already has its own timeout)
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: false, // Coarse location is fine for weather
      timeout: 8000
    });

    const location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: Date.now(),
      cached: false
    };

    // Cache the location, scoped to the signed-in owner. No-ops (never
    // falls back to a global key) when nobody is signed in — the freshly
    // fetched location is still returned to the caller either way.
    const uid = currentUid();
    if (uid) {
      await Preferences.set({
        key: locationCacheKey(uid),
        value: JSON.stringify(location)
      });
    }

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
 * Get this owner's cached location, if available and not too old. Returns
 * null (never a different owner's or a pre-migration global value) when:
 * - nobody is signed in (and quarantines any lingering legacy global cache),
 * - this owner has never cached locally (same quarantine, on the scoped
 *   miss — a legacy value is never adopted by the next signed-in account),
 * - or the cache is older than the retention window, in which case it is
 *   REMOVED (not merely ignored) so a stale hit can't reappear later.
 */
const getCachedLocation = async () => {
  const uid = currentUid();
  if (!uid) {
    await quarantineLegacyKey(LEGACY_LOCATION_CACHE_KEY);
    return null;
  }
  try {
    const { value } = await Preferences.get({ key: locationCacheKey(uid) });
    if (!value) {
      await quarantineLegacyKey(LEGACY_LOCATION_CACHE_KEY);
      return null;
    }

    const cached = JSON.parse(value);

    // Check if cache is still valid. An expired cache is deleted, not just
    // ignored, so it can never resurface later.
    if (Date.now() - cached.timestamp > LOCATION_CACHE_TTL_MS) {
      await Preferences.remove({ key: locationCacheKey(uid) });
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
 * Captures both:
 * - Point-in-time weather (current conditions when entry is made)
 * - Day summary weather (overall day conditions for better correlation)
 *
 * @returns {Object} Simplified context for storage
 */
export const getEntryEnvironmentContext = async () => {
  const context = await getEnvironmentContext();

  if (!context.available) {
    return null;
  }

  const { latitude, longitude } = context.location;

  // Fetch today's weather summary (dominant condition, high/low temps, sunshine)
  let daySummary = null;
  try {
    const dailyHistory = await getDailyWeatherHistory(latitude, longitude, 1);
    if (dailyHistory && dailyHistory.length > 0) {
      const today = dailyHistory[dailyHistory.length - 1]; // Most recent day
      daySummary = {
        condition: today.condition,
        conditionLabel: today.conditionLabel,
        tempHigh: today.tempMax,
        tempLow: today.tempMin,
        sunshineMinutes: today.sunshineDuration,
        sunshinePercent: today.sunshinePercent,
        isLowSunshine: today.isLowLight
      };
    }
  } catch (error) {
    console.warn('Failed to fetch day summary weather:', error);
    // Continue without day summary - point-in-time is still valuable
  }

  return {
    // Point-in-time (current conditions when entry is made)
    weather: context.weather?.condition || null,
    weatherLabel: context.weather?.conditionLabel || null,
    temperature: context.weather?.temperature || null,
    temperatureUnit: context.weather?.temperatureUnit || '°C',
    cloudCover: context.weather?.cloudCover || null,
    // Unknown day/night stays null (not fabricated `true`) so consumers can tell
    // "no weather data" from a genuine daytime reading.
    isDay: context.weather?.isDay ?? null,

    // Day summary (overall day conditions - more useful for mood correlation)
    daySummary,

    // Sun times
    sunsetTime: context.sunTimes?.sunsetLocal || null,
    sunriseTime: context.sunTimes?.sunriseLocal || null,
    daylightHours: context.sunTimes?.daylightHours || null,

    // Light context
    isAfterDark: context.isAfterSunset || context.isBeforeSunrise,
    lightContext: context.lightContext,
    daylightRemaining: context.daylightRemaining,

    // Metadata
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
