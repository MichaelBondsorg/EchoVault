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
import { auth } from '../../config/firebase';

// Legacy (pre owner-scoping) global keys. Per ADR-0001 / PRIV-01
// (docs/adr/0001-owner-scoped-local-data.md,
// src/services/storage/storageRegistry.js), unowned local data is
// quarantined (deleted) the first time it's discovered — never adopted by
// whichever account happens to be signed in when it's next encountered.
const LEGACY_HEALTH_CACHE_KEY = 'health_context_cache';
const LEGACY_HEALTH_PERMISSION_KEY = 'health_permission_status';

const healthCacheKey = (uid) => `health_context_cache::${uid}`;
const healthPermissionKey = (uid) => `health_permission_status::${uid}`;

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
    console.log('[PlatformHealth] Permission status:', permissionStatus);

    // Only consider available if we have explicitly granted or partial permissions
    // 'unknown' means the user hasn't interacted with the permission dialog yet
    const isAvailable = permissionStatus === 'granted' || permissionStatus === 'partial';

    return {
      strategy: capabilities.provider,
      isAvailable,
      permissionStatus,
      capabilities,
      platform,
      fallback: 'manual',
      // Allow UI to know if permissions can be requested
      canRequestPermission: permissionStatus === 'unknown' || permissionStatus === 'denied'
    };
  }

  // Web platform - check for cached data. getCachedHealthData already
  // removes (not just ignores) an expired owner-scoped cache on read — see
  // its own doc comment — so a stale hit here can only mean "no usable
  // cache", never "leftover expired data".
  const cachedData = await getCachedHealthData();

  if (cachedData) {
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
 * Cache health data for web access, scoped to the signed-in owner.
 * Called after successful native health data fetch.
 *
 * No-ops (never falls back to a global key) when nobody is signed in —
 * health data must never be written anywhere it can outlive its owner.
 *
 * @param {Object} healthData - Health summary to cache
 */
export const cacheHealthData = async (healthData) => {
  const uid = currentUid();
  if (!uid) return;
  try {
    await Preferences.set({
      key: healthCacheKey(uid),
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
 * Get this owner's cached health data. Returns null (never a different
 * owner's or a pre-migration global value) when:
 * - nobody is signed in (and quarantines any lingering legacy global cache),
 * - this owner has never cached locally (same quarantine, on the scoped
 *   miss — a legacy value is never adopted by the next signed-in account),
 * - or the cache is older than the retention window, in which case it is
 *   REMOVED (not merely ignored) so a stale hit can't reappear later.
 */
export const getCachedHealthData = async () => {
  const uid = currentUid();
  if (!uid) {
    await quarantineLegacyKey(LEGACY_HEALTH_CACHE_KEY);
    return null;
  }
  try {
    const { value } = await Preferences.get({ key: healthCacheKey(uid) });
    if (!value) {
      await quarantineLegacyKey(LEGACY_HEALTH_CACHE_KEY);
      return null;
    }
    const cached = JSON.parse(value);
    if (isCacheStale(cached)) {
      await Preferences.remove({ key: healthCacheKey(uid) });
      return null;
    }
    return cached;
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
 * Store permission status, scoped to the signed-in owner. No-ops when
 * nobody is signed in.
 */
export const setPermissionStatus = async (status) => {
  const uid = currentUid();
  if (!uid) return;
  try {
    await Preferences.set({
      key: healthPermissionKey(uid),
      value: status
    });
  } catch (error) {
    console.error('Failed to store permission status:', error);
  }
};

/**
 * Get this owner's stored permission status. Quarantines (never adopts) a
 * pre-migration legacy global value on a scoped miss, exactly like
 * getCachedHealthData above.
 */
export const getPermissionStatus = async () => {
  const uid = currentUid();
  if (!uid) {
    await quarantineLegacyKey(LEGACY_HEALTH_PERMISSION_KEY);
    return 'unknown';
  }
  try {
    const { value } = await Preferences.get({ key: healthPermissionKey(uid) });
    if (!value) {
      await quarantineLegacyKey(LEGACY_HEALTH_PERMISSION_KEY);
      return 'unknown';
    }
    return value;
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
