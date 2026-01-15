/**
 * Whoop Health Service
 *
 * Client-side interface for Whoop cloud integration.
 * Communicates with the relay-server to fetch Whoop data via OAuth.
 *
 * Unlike HealthKit/Google Fit which require native platform access,
 * Whoop works on all platforms (web + native) via cloud-to-cloud integration.
 */

import { auth } from '../../config/firebase';
import { Preferences } from '@capacitor/preferences';
import { cacheHealthData } from './platformHealth';

// Derive HTTP relay URL from WebSocket URL
const getRelayHttpUrl = () => {
  const wsUrl = import.meta.env.VITE_VOICE_RELAY_URL || 'ws://localhost:8080/voice';
  // Convert wss://host/voice or ws://host/voice to https://host or http://host
  return wsUrl
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:')
    .replace(/\/voice$/, '');
};

const RELAY_URL = getRelayHttpUrl();
const WHOOP_STATUS_KEY = 'whoop_link_status';

/**
 * Get Firebase auth token for API calls
 */
const getAuthToken = async () => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Not authenticated');
  }
  return user.getIdToken();
};

/**
 * Make authenticated request to relay server
 */
const relayFetch = async (endpoint, options = {}) => {
  const token = await getAuthToken();

  const response = await fetch(`${RELAY_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
};

/**
 * Check if user has Whoop linked
 * Checks local cache first, then verifies with server
 */
export const isWhoopLinked = async () => {
  // Quick check from local storage
  try {
    const { value } = await Preferences.get({ key: WHOOP_STATUS_KEY });
    if (value === 'true') {
      // Verify with server in background (don't block)
      verifyWhoopStatus().catch(console.error);
      return true;
    }
  } catch {
    // Ignore local storage errors
  }

  // Check with server
  return verifyWhoopStatus();
};

/**
 * Verify Whoop status with server and update local cache
 */
const verifyWhoopStatus = async () => {
  try {
    const { linked } = await relayFetch('/auth/whoop/status');
    await setLocalWhoopStatus(linked);
    return linked;
  } catch (error) {
    console.error('Failed to verify Whoop status:', error);
    return false;
  }
};

/**
 * Store Whoop link status locally
 */
const setLocalWhoopStatus = async (linked) => {
  try {
    await Preferences.set({
      key: WHOOP_STATUS_KEY,
      value: linked ? 'true' : 'false',
    });
  } catch (error) {
    console.error('Failed to store Whoop status:', error);
  }
};

/**
 * Initiate Whoop OAuth flow
 * Returns the authorization URL to redirect user to
 */
export const initiateWhoopOAuth = async () => {
  const { authUrl } = await relayFetch('/auth/whoop');
  return authUrl;
};

/**
 * Disconnect Whoop from user account
 */
export const disconnectWhoop = async () => {
  await relayFetch('/auth/whoop', { method: 'DELETE' });
  await setLocalWhoopStatus(false);
  // Clear cached Whoop data
  await Preferences.remove({ key: 'whoop_cached_summary' });
};

/**
 * Handle successful OAuth callback
 * Called after user is redirected back from Whoop authorization
 */
export const handleWhoopOAuthSuccess = async () => {
  await setLocalWhoopStatus(true);
  // Fetch initial data to populate cache
  try {
    await getWhoopSummary();
  } catch (error) {
    console.error('Failed to fetch initial Whoop data:', error);
  }
};

/**
 * Fetch Whoop health summary via relay server
 * Returns data in EchoVault-compatible format
 */
export const getWhoopSummary = async (date = new Date()) => {
  try {
    const response = await relayFetch(
      `/health/whoop/summary?date=${date.toISOString()}`
    );

    // Transform response to match EchoVault nested health schema (same as HealthKit)
    const workouts = response.workouts?.map(w => ({
      type: w.type,
      duration: w.duration,
      calories: w.calories,
      strain: w.strain,
    })) || [];

    const summary = {
      available: response.available,
      source: 'whoop',
      date: response.date,

      // Nested format matching HealthKit structure for UI compatibility
      sleep: response.sleep ? {
        totalHours: response.sleep.totalHours,
        quality: response.sleep.quality,
        score: response.sleep.score || null,
        stages: null, // Whoop doesn't provide sleep stages breakdown
        inBed: response.sleep.inBed,
        asleep: response.sleep.asleep,
      } : null,

      heart: {
        restingRate: response.heartRate?.resting || null,
        currentRate: null, // Whoop doesn't provide current HR
        hrv: response.hrv?.average || null,
        hrvTrend: null,
        stressIndicator: response.hrv?.stressIndicator || null,
      },

      activity: {
        // Whoop doesn't track steps - estimate from strain calories
        stepsToday: response.strain?.calories ? Math.round(response.strain.calories * 15) : null,
        totalCaloriesBurned: response.strain?.calories || null,
        activeCaloriesBurned: response.strain?.calories || null,
        totalExerciseMinutes: workouts.reduce((sum, w) => sum + (w.duration || 0), 0),
        hasWorkout: workouts.length > 0,
        workouts: workouts,
      },

      // Whoop-specific fields (preserved for Whoop UI elements)
      recovery: response.recovery ? {
        score: response.recovery.score,
        status: response.recovery.status,
      } : null,
      strain: response.strain ? {
        score: response.strain.score,
        calories: response.strain.calories,
      } : null,

      // Legacy flat fields for backward compatibility
      hrv: response.hrv ? {
        average: response.hrv.average,
        stressIndicator: response.hrv.stressIndicator,
      } : null,
      heartRate: response.heartRate ? {
        resting: response.heartRate.resting,
      } : null,
      workouts: workouts,
      hasWorkout: workouts.length > 0,
      steps: response.strain?.calories ? Math.round(response.strain.calories * 15) : null,

      queriedAt: response.queriedAt || new Date().toISOString(),
    };

    // Cache for offline/web access
    await cacheHealthData(summary);
    await cacheWhoopSummary(summary);

    return summary;
  } catch (error) {
    console.error('Error fetching Whoop summary:', error);

    // Try to return cached data on error
    const cached = await getCachedWhoopSummary();
    if (cached) {
      return {
        ...cached,
        fromCache: true,
        cacheError: error.message,
      };
    }

    return {
      available: false,
      source: 'whoop',
      error: error.message,
    };
  }
};

/**
 * Get Whoop health history for correlation analysis
 */
export const getWhoopHistory = async (days = 14) => {
  const history = [];
  const today = new Date();

  // Fetch data for each day
  // Note: In production, this should be a single batch endpoint
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    try {
      const summary = await getWhoopSummary(date);
      if (summary.available) {
        history.push(summary);
      }
    } catch {
      // Skip failed days
    }
  }

  return {
    available: history.length > 0,
    source: 'whoop',
    days: history,
    queriedAt: new Date().toISOString(),
  };
};

/**
 * Cache Whoop summary for quick access
 */
const cacheWhoopSummary = async (summary) => {
  try {
    await Preferences.set({
      key: 'whoop_cached_summary',
      value: JSON.stringify({
        ...summary,
        cachedAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error('Failed to cache Whoop summary:', error);
  }
};

/**
 * Get cached Whoop summary
 */
const getCachedWhoopSummary = async () => {
  try {
    const { value } = await Preferences.get({ key: 'whoop_cached_summary' });
    if (value) {
      const cached = JSON.parse(value);
      // Check if cache is fresh (within 1 hour)
      const cacheTime = new Date(cached.cachedAt).getTime();
      if (Date.now() - cacheTime < 60 * 60 * 1000) {
        return cached;
      }
    }
  } catch {
    // Ignore cache errors
  }
  return null;
};

/**
 * Get Whoop-specific recovery insights
 * Returns actionable insights based on recovery score
 */
export const getWhoopRecoveryInsight = (recovery) => {
  if (!recovery?.score) return null;

  const score = recovery.score;

  if (score >= 67) {
    return {
      status: 'green',
      title: 'Recovered',
      message: 'Your body is well recovered. Great day for high intensity.',
      recommendation: 'Consider a challenging workout or tackling demanding tasks.',
    };
  }

  if (score >= 34) {
    return {
      status: 'yellow',
      title: 'Moderate Recovery',
      message: 'Your body is partially recovered. Listen to your body today.',
      recommendation: 'Light to moderate activity recommended. Prioritize sleep tonight.',
    };
  }

  return {
    status: 'red',
    title: 'Low Recovery',
    message: 'Your body needs rest. Take it easy today.',
    recommendation: 'Focus on recovery: stretching, hydration, and early bedtime.',
  };
};

/**
 * Get Whoop strain insight
 * Correlates strain with recovery for balanced recommendations
 */
export const getWhoopStrainInsight = (strain, recovery) => {
  if (!strain?.score) return null;

  const strainScore = strain.score;
  const recoveryScore = recovery?.score || 50;

  // High strain with low recovery = burnout risk
  if (strainScore > 15 && recoveryScore < 34) {
    return {
      type: 'warning',
      message: 'High strain with low recovery detected. Consider rest.',
      actionable: true,
    };
  }

  // Optimal strain for recovery level
  const optimalStrain = recoveryScore >= 67 ? 14 : recoveryScore >= 34 ? 10 : 6;

  if (strainScore >= optimalStrain) {
    return {
      type: 'success',
      message: 'Good activity level for your recovery state.',
      actionable: false,
    };
  }

  return {
    type: 'info',
    message: `You have capacity for more activity today (target: ${optimalStrain} strain).`,
    actionable: true,
  };
};

export default {
  isWhoopLinked,
  initiateWhoopOAuth,
  disconnectWhoop,
  handleWhoopOAuthSuccess,
  getWhoopSummary,
  getWhoopHistory,
  getWhoopRecoveryInsight,
  getWhoopStrainInsight,
};
