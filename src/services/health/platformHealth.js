/**
 * Platform Health Detection Service
 *
 * Detects platform capabilities and returns appropriate health data strategy:
 * - iOS: HealthKit (full access)
 * - Android: Google Fit (full access)
 * - Web: Cached data from last native session OR manual input
 *
 * Key design: iPhone user on Chrome laptop still gets last-known health context
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const HEALTH_CACHE_KEY = 'health_context_cache';
const HEALTH_PERMISSION_KEY = 'health_permission_status';

/**
 * Platform capabilities for health data
 */
export const PLATFORM_CAPABILITIES = {
  ios: {
    name: 'iOS',
    provider: 'healthkit',
    hasNativeHealth: true,
    canAutoSync: true,
    features: ['steps', 'sleep', 'hrv', 'workouts', 'heartRate']
  },
  android: {
    name: 'Android',
    provider: 'googlefit',
    hasNativeHealth: true,
    canAutoSync: true,
    features: ['steps', 'sleep', 'heartRate', 'workouts']
  },
  web: {
    name: 'Web',
    provider: 'cache',
    hasNativeHealth: false,
    canAutoSync: false,
    features: ['cached_data', 'manual_input']
  }
};

/**
 * Detect current platform and capabilities
 *
 * @returns {Object} Platform info and capabilities
 */
export const detectPlatform = () => {
  const platform = Capacitor.getPlatform();

  return {
    platform,
    isNative: Capacitor.isNativePlatform(),
    capabilities: PLATFORM_CAPABILITIES[platform] || PLATFORM_CAPABILITIES.web,
    canAccessHealthData: platform === 'ios' || platform === 'android'
  };
};

/**
 * Get the best available health data strategy
 *
 * Priority:
 * 1. Native HealthKit/Google Fit (if on native platform)
 * 2. Cached data from last native session (if on web)
 * 3. Manual input (always available)
 *
 * @returns {Object} Strategy and available data
 */
export const getHealthDataStrategy = async () => {
  const { platform, isNative, capabilities } = detectPlatform();

  // Native platform - can access health APIs
  if (isNative) {
    const permissionStatus = await getPermissionStatus();

    return {
      strategy: capabilities.provider,
      isAvailable: permissionStatus === 'granted',
      permissionStatus,
      capabilities,
      platform,
      fallback: 'manual'
    };
  }

  // Web platform - check for cached data
  const cachedData = await getCachedHealthData();

  if (cachedData && !isCacheStale(cachedData)) {
    return {
      strategy: 'cache',
      isAvailable: true,
      cachedData,
      cacheAge: getCacheAge(cachedData),
      capabilities: PLATFORM_CAPABILITIES.web,
      platform,
      fallback: 'manual',
      note: 'Using health data from your last mobile session'
    };
  }

  // No native access, no valid cache
  return {
    strategy: 'manual',
    isAvailable: false,  // No actual health data on web without cache
    capabilities: PLATFORM_CAPABILITIES.web,
    platform,
    fallback: null,
    note: 'Health data available when using the mobile app'
  };
};

/**
 * Cache health data for web access
 * Called after successful native health data fetch
 *
 * @param {Object} healthData - Health summary to cache
 */
export const cacheHealthData = async (healthData) => {
  try {
    await Preferences.set({
      key: HEALTH_CACHE_KEY,
      value: JSON.stringify({
        ...healthData,
        cachedAt: new Date().toISOString(),
        platform: Capacitor.getPlatform()
      })
    });
  } catch (error) {
    console.error('Failed to cache health data:', error);
  }
};

/**
 * Get cached health data
 */
export const getCachedHealthData = async () => {
  try {
    const { value } = await Preferences.get({ key: HEALTH_CACHE_KEY });
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error('Failed to get cached health data:', error);
    return null;
  }
};

/**
 * Check if cache is too old to be useful
 * Cache is valid for 24 hours
 */
const isCacheStale = (cachedData) => {
  if (!cachedData?.cachedAt) return true;

  const cacheTime = new Date(cachedData.cachedAt).getTime();
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  return (now - cacheTime) > maxAge;
};

/**
 * Get human-readable cache age
 */
const getCacheAge = (cachedData) => {
  if (!cachedData?.cachedAt) return 'unknown';

  const cacheTime = new Date(cachedData.cachedAt).getTime();
  const now = Date.now();
  const ageMs = now - cacheTime;

  const hours = Math.floor(ageMs / (1000 * 60 * 60));
  if (hours < 1) return 'less than an hour ago';
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return 'over a day ago';
};

/**
 * Store permission status
 */
export const setPermissionStatus = async (status) => {
  try {
    await Preferences.set({
      key: HEALTH_PERMISSION_KEY,
      value: status
    });
  } catch (error) {
    console.error('Failed to store permission status:', error);
  }
};

/**
 * Get stored permission status
 */
export const getPermissionStatus = async () => {
  try {
    const { value } = await Preferences.get({ key: HEALTH_PERMISSION_KEY });
    return value || 'unknown';
  } catch (error) {
    return 'unknown';
  }
};

/**
 * Check if health features should be shown
 * Returns true if:
 * - Native platform with health access
 * - Web with valid cached data
 */
export const shouldShowHealthFeatures = async () => {
  const strategy = await getHealthDataStrategy();
  return strategy.isAvailable && strategy.strategy !== 'manual';
};

export default {
  detectPlatform,
  getHealthDataStrategy,
  cacheHealthData,
  getCachedHealthData,
  setPermissionStatus,
  getPermissionStatus,
  shouldShowHealthFeatures,
  PLATFORM_CAPABILITIES
};
