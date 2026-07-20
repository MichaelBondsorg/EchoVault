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
import { normalizeWhoopSummary, requestedLocalDate } from './whoopTransforms';
import { getRelayHttpUrl } from '../../config/relay';

// Legacy (pre owner-scoping) global cache keys. Per ADR-0001, unowned local
// data is quarantined (deleted) on discovery — never adopted by whichever
// account happens to be signed in when it's next encountered.
const LEGACY_WHOOP_SUMMARY_KEY = 'whoop_cached_summary';
const LEGACY_WHOOP_STATUS_KEY = 'whoop_link_status';

const whoopSummaryKey = (uid) => `whoop_cached_summary::${uid}`;
const whoopStatusKey = (uid) => `whoop_link_status::${uid}`;

/**
 * Resolve the currently authenticated owner for cache scoping. Returns null
 * (rather than throwing) so cache reads/writes fail safe to "no cache"
 * instead of surfacing an auth error out of an unrelated lookup. No uid is
 * ever cached at module scope — every call re-derives it from the live
 * Firebase auth session.
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
 * Wrap a promise with a timeout
 */
const withTimeout = (promise, ms, message = 'Request timed out') => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    )
  ]);
};

/**
 * Make authenticated request to relay server with timeout
 */
const relayFetch = async (endpoint, options = {}, timeoutMs = 10000) => {
  const relayUrl = getRelayHttpUrl();
  if (!relayUrl) {
    // No valid relay endpoint for this environment (see src/config/relay.js).
    // Fail the same way any other unreachable-relay error does, so callers'
    // existing catch/fallback paths handle it without a code path change.
    throw new Error('relay_unavailable');
  }

  console.log(`[Whoop] relayFetch: ${endpoint}`);

  const token = await withTimeout(
    getAuthToken(),
    5000,
    'Auth token fetch timed out'
  );

  const fetchPromise = fetch(`${relayUrl}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const response = await withTimeout(
    fetchPromise,
    timeoutMs,
    `Whoop API request timed out after ${timeoutMs}ms`
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    console.error(`[Whoop] relayFetch error: ${response.status}`, error);
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  const data = await response.json();
  console.log(`[Whoop] relayFetch success:`, endpoint, { available: data.available });
  return data;
};

/**
 * Check if user has Whoop linked
 * Checks local cache first, then verifies with server
 */
export const isWhoopLinked = async () => {
  const status = await getWhoopConnectionStatus();
  return status === 'connected';
};

/**
 * Return a connection state that distinguishes provider linkage from relay
 * reachability. Cached linkage is never treated as fresh provider access.
 */
export const getWhoopConnectionStatus = async () => {
  const uid = currentUid();
  try {
    const { linked } = await relayFetch('/auth/whoop/status', {}, 5000);
    await setLocalWhoopStatus(uid, linked);
    return linked ? 'connected' : 'disconnected';
  } catch (error) {
    console.warn('[Whoop] Status verification unavailable:', error.message);
    if (!uid) {
      await quarantineLegacyKey(LEGACY_WHOOP_STATUS_KEY);
      return 'disconnected';
    }
    try {
      const { value } = await Preferences.get({ key: whoopStatusKey(uid) });
      if (value == null) {
        // This owner has never cached a status locally — quarantine any
        // pre-owner-scoping global status instead of exposing it.
        await quarantineLegacyKey(LEGACY_WHOOP_STATUS_KEY);
        return 'disconnected';
      }
      return value === 'true' ? 'unreachable' : 'disconnected';
    } catch {
      return 'disconnected';
    }
  }
};

/**
 * Store Whoop link status locally, scoped to the given owner uid.
 */
const setLocalWhoopStatus = async (uid, linked) => {
  if (!uid) return;
  try {
    await Preferences.set({
      key: whoopStatusKey(uid),
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
  const uid = currentUid();
  await relayFetch('/auth/whoop', { method: 'DELETE' });
  await setLocalWhoopStatus(uid, false);
  // Clear this owner's cached Whoop data only.
  if (uid) {
    await Preferences.remove({ key: whoopSummaryKey(uid) });
  }
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
 * Returns data in Engram-compatible format
 */
export const getWhoopSummary = async (date = new Date()) => {
  const uid = currentUid();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localDate = requestedLocalDate(date, timezone);
  try {
    const response = await relayFetch(
      `/health/whoop/summary?date=${encodeURIComponent(localDate)}&timezone=${encodeURIComponent(timezone)}`
    );
    const summary = normalizeWhoopSummary(response, localDate, timezone);

    // Cache for offline/web access
    await cacheHealthData(summary);
    await cacheWhoopSummary(uid, summary);

    return summary;
  } catch (error) {
    console.error('Error fetching Whoop summary:', error);

    // Try to return cached data on error
    const cached = await getCachedWhoopSummary(uid, localDate, timezone);
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
      requestedLocalDate: localDate,
      timezone,
      queriedAt: new Date().toISOString(),
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
 * Cache Whoop summary for quick access, scoped to the given owner uid.
 */
const cacheWhoopSummary = async (uid, summary) => {
  if (!uid) return;
  try {
    await Preferences.set({
      key: whoopSummaryKey(uid),
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
 * Get this owner's cached Whoop summary. On a scoped-key miss, quarantines
 * any pre-owner-scoping legacy global cache rather than ever returning it —
 * a different account's health data must never surface here.
 */
const getCachedWhoopSummary = async (uid, requestedDate, timezone) => {
  if (!uid) {
    await quarantineLegacyKey(LEGACY_WHOOP_SUMMARY_KEY);
    return null;
  }
  try {
    const { value } = await Preferences.get({ key: whoopSummaryKey(uid) });
    if (value) {
      const cached = JSON.parse(value);
      // Check if cache is fresh (within 1 hour)
      const cacheTime = new Date(cached.cachedAt).getTime();
      if (
        Date.now() - cacheTime < 60 * 60 * 1000 &&
        cached.requestedLocalDate === requestedDate &&
        cached.timezone === timezone
      ) {
        return cached;
      }
      return null;
    }
    await quarantineLegacyKey(LEGACY_WHOOP_SUMMARY_KEY);
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
  getWhoopConnectionStatus,
  initiateWhoopOAuth,
  disconnectWhoop,
  handleWhoopOAuthSuccess,
  getWhoopSummary,
  getWhoopHistory,
  getWhoopRecoveryInsight,
  getWhoopStrainInsight,
};
