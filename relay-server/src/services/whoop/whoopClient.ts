/**
 * Whoop API Client
 * Handles OAuth flow and API requests to Whoop V2 API
 * Includes automatic token refresh
 */

import { config } from '../../config/index.js';
import {
  getTokens,
  storeTokens,
  updateAccessToken,
  deleteTokens,
  isTokenExpired,
  WhoopTokens,
} from './tokenStore.js';

const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer';
const WHOOP_AUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';

// Required scopes for EchoVault integration
const REQUIRED_SCOPES = [
  'read:recovery',
  'read:sleep',
  'read:workout',
  'read:profile',
];

export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: string;
  score: {
    user_calibrating: boolean;
    recovery_score: number;
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
  } | null;
}

export interface WhoopSleep {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  } | null;
}

export interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number;
  score_state: string;
  score: {
    strain: number;
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_duration: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  } | null;
}

export interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string | null;
  timezone_offset: string;
  score_state: string;
  score: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  } | null;
}

export interface WhoopProfile {
  user_id: number;
  email: string;
  first_name: string;
  last_name: string;
}

/**
 * Generate OAuth authorization URL
 */
export const getAuthorizationUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: config.whoopClientId,
    redirect_uri: config.whoopRedirectUri,
    response_type: 'code',
    scope: REQUIRED_SCOPES.join(' '),
    state,
  });

  return `${WHOOP_AUTH_BASE}/auth?${params.toString()}`;
};

/**
 * Exchange authorization code for tokens
 */
export const exchangeCodeForTokens = async (
  code: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> => {
  const response = await fetch(`${WHOOP_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.whoopClientId,
      client_secret: config.whoopClientSecret,
      redirect_uri: config.whoopRedirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
};

/**
 * Refresh access token using refresh token
 */
const refreshAccessToken = async (
  refreshToken: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> => {
  const response = await fetch(`${WHOOP_AUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.whoopClientId,
      client_secret: config.whoopClientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
};

/**
 * Revoke tokens with Whoop
 */
export const revokeTokens = async (accessToken: string): Promise<void> => {
  try {
    await fetch(`${WHOOP_AUTH_BASE}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token: accessToken,
        client_id: config.whoopClientId,
        client_secret: config.whoopClientSecret,
      }).toString(),
    });
  } catch (error) {
    // Log but don't throw - we still want to clean up locally
    console.error('Error revoking Whoop token:', error);
  }
};

/**
 * Get valid access token, refreshing if necessary
 */
const getValidAccessToken = async (userId: string): Promise<string> => {
  const tokens = await getTokens(userId);
  if (!tokens) {
    throw new Error('Whoop not connected');
  }

  // Check if token is expired or about to expire
  if (isTokenExpired(tokens.expiresAt)) {
    console.log(`Refreshing Whoop token for user ${userId}`);

    const refreshed = await refreshAccessToken(tokens.refreshToken);
    const newExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);

    await updateAccessToken(
      userId,
      refreshed.accessToken,
      newExpiresAt,
      refreshed.refreshToken !== tokens.refreshToken ? refreshed.refreshToken : undefined
    );

    return refreshed.accessToken;
  }

  return tokens.accessToken;
};

/**
 * Make authenticated request to Whoop API
 */
const whoopFetch = async <T>(
  userId: string,
  endpoint: string,
  options?: RequestInit
): Promise<T> => {
  const accessToken = await getValidAccessToken(userId);

  const response = await fetch(`${WHOOP_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whoop API error (${response.status}): ${error}`);
  }

  return response.json();
};

/**
 * Get user profile
 */
export const getProfile = async (userId: string): Promise<WhoopProfile> => {
  return whoopFetch<WhoopProfile>(userId, '/v1/user/profile/basic');
};

/**
 * Get recovery data for a date range
 */
export const getRecovery = async (
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<WhoopRecovery[]> => {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  const response = await whoopFetch<{ records: WhoopRecovery[] }>(
    userId,
    `/v1/recovery?${params.toString()}`
  );

  return response.records;
};

/**
 * Get sleep data for a date range
 */
export const getSleep = async (
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<WhoopSleep[]> => {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  const response = await whoopFetch<{ records: WhoopSleep[] }>(
    userId,
    `/v1/activity/sleep?${params.toString()}`
  );

  return response.records;
};

/**
 * Get workout data for a date range
 */
export const getWorkouts = async (
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<WhoopWorkout[]> => {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  const response = await whoopFetch<{ records: WhoopWorkout[] }>(
    userId,
    `/v1/activity/workout?${params.toString()}`
  );

  return response.records;
};

/**
 * Get cycle (strain) data for a date range
 */
export const getCycles = async (
  userId: string,
  startDate: Date,
  endDate: Date
): Promise<WhoopCycle[]> => {
  const params = new URLSearchParams({
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  const response = await whoopFetch<{ records: WhoopCycle[] }>(
    userId,
    `/v1/cycle?${params.toString()}`
  );

  return response.records;
};

/**
 * Get comprehensive health summary for a specific date
 * Aggregates recovery, sleep, strain, and workouts into EchoVault-compatible format
 */
export const getHealthSummary = async (
  userId: string,
  date: Date = new Date()
): Promise<{
  available: boolean;
  source: 'whoop';
  date: string;
  sleep: {
    totalHours: number;
    quality: 'good' | 'fair' | 'poor';
    inBed: number;
    asleep: number;
    efficiency: number;
    stages: {
      light: number;
      deep: number;
      rem: number;
      awake: number;
    };
  } | null;
  hrv: {
    average: number;
    stressIndicator: 'low' | 'moderate' | 'high';
  } | null;
  recovery: {
    score: number;
    status: 'green' | 'yellow' | 'red';
  } | null;
  strain: {
    score: number;
    calories: number;
    averageHR: number;
    maxHR: number;
  } | null;
  workouts: Array<{
    type: string;
    duration: number;
    strain: number;
    calories: number;
    averageHR: number;
  }>;
  heartRate: {
    resting: number;
  } | null;
  queriedAt: string;
}> => {
  // Set date range for the query (24 hours centered on the date)
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Fetch all data types in parallel
  const [recoveryData, sleepData, cycleData, workoutData] = await Promise.all([
    getRecovery(userId, startOfDay, endOfDay).catch(() => []),
    getSleep(userId, startOfDay, endOfDay).catch(() => []),
    getCycles(userId, startOfDay, endOfDay).catch(() => []),
    getWorkouts(userId, startOfDay, endOfDay).catch(() => []),
  ]);

  const dateStr = date.toISOString().split('T')[0];

  // Process recovery data (most recent)
  const latestRecovery = recoveryData.find((r) => r.score?.recovery_score != null);
  const recovery = latestRecovery?.score
    ? {
        score: latestRecovery.score.recovery_score,
        status: (latestRecovery.score.recovery_score >= 67
          ? 'green'
          : latestRecovery.score.recovery_score >= 34
          ? 'yellow'
          : 'red') as 'green' | 'yellow' | 'red',
      }
    : null;

  // Process HRV data from recovery
  const hrv = latestRecovery?.score?.hrv_rmssd_milli
    ? {
        average: Math.round(latestRecovery.score.hrv_rmssd_milli),
        stressIndicator: (latestRecovery.score.recovery_score >= 67
          ? 'low'
          : latestRecovery.score.recovery_score >= 34
          ? 'moderate'
          : 'high') as 'low' | 'moderate' | 'high',
      }
    : null;

  // Process resting heart rate
  const heartRate = latestRecovery?.score?.resting_heart_rate
    ? { resting: latestRecovery.score.resting_heart_rate }
    : null;

  // Process sleep data (most recent non-nap)
  const latestSleep = sleepData.find((s) => !s.nap && s.score);
  const sleep = latestSleep?.score
    ? {
        totalHours:
          (latestSleep.score.stage_summary.total_in_bed_time_milli -
            latestSleep.score.stage_summary.total_awake_time_milli) /
          3600000,
        quality: (latestSleep.score.sleep_performance_percentage >= 80
          ? 'good'
          : latestSleep.score.sleep_performance_percentage >= 60
          ? 'fair'
          : 'poor') as 'good' | 'fair' | 'poor',
        inBed: latestSleep.score.stage_summary.total_in_bed_time_milli / 3600000,
        asleep:
          (latestSleep.score.stage_summary.total_in_bed_time_milli -
            latestSleep.score.stage_summary.total_awake_time_milli) /
          3600000,
        efficiency: latestSleep.score.sleep_efficiency_percentage,
        stages: {
          light: latestSleep.score.stage_summary.total_light_sleep_time_milli / 3600000,
          deep: latestSleep.score.stage_summary.total_slow_wave_sleep_time_milli / 3600000,
          rem: latestSleep.score.stage_summary.total_rem_sleep_time_milli / 3600000,
          awake: latestSleep.score.stage_summary.total_awake_time_milli / 3600000,
        },
      }
    : null;

  // Process cycle (strain) data
  const latestCycle = cycleData.find((c) => c.score);
  const strain = latestCycle?.score
    ? {
        score: latestCycle.score.strain,
        calories: Math.round(latestCycle.score.kilojoule / 4.184), // kJ to kcal
        averageHR: latestCycle.score.average_heart_rate,
        maxHR: latestCycle.score.max_heart_rate,
      }
    : null;

  // Process workouts
  const workouts = workoutData
    .filter((w) => w.score)
    .map((w) => ({
      type: getSportName(w.sport_id),
      duration: new Date(w.end).getTime() - new Date(w.start).getTime(),
      strain: w.score!.strain,
      calories: Math.round(w.score!.kilojoule / 4.184),
      averageHR: w.score!.average_heart_rate,
    }));

  return {
    available: true,
    source: 'whoop',
    date: dateStr,
    sleep,
    hrv,
    recovery,
    strain,
    workouts,
    heartRate,
    queriedAt: new Date().toISOString(),
  };
};

/**
 * Map Whoop sport IDs to human-readable names
 */
const getSportName = (sportId: number): string => {
  const sports: Record<number, string> = {
    -1: 'Activity',
    0: 'Running',
    1: 'Cycling',
    16: 'Baseball',
    17: 'Basketball',
    18: 'Rowing',
    19: 'Fencing',
    20: 'Field Hockey',
    21: 'Football',
    22: 'Golf',
    24: 'Ice Hockey',
    25: 'Lacrosse',
    27: 'Rugby',
    28: 'Sailing',
    29: 'Skiing',
    30: 'Soccer',
    31: 'Softball',
    32: 'Squash',
    33: 'Swimming',
    34: 'Tennis',
    35: 'Track & Field',
    36: 'Volleyball',
    37: 'Water Polo',
    38: 'Wrestling',
    39: 'Boxing',
    42: 'Dance',
    43: 'Pilates',
    44: 'Yoga',
    45: 'Weightlifting',
    47: 'Cross Country Skiing',
    48: 'Functional Fitness',
    49: 'Duathlon',
    51: 'Gymnastics',
    52: 'HIIT',
    53: 'Martial Arts',
    55: 'Meditation',
    56: 'Other',
    57: 'Triathlon',
    59: 'Snowboarding',
    60: 'Elliptical',
    63: 'Stairmaster',
    64: 'Spin',
    65: 'Walking',
    66: 'Surfing',
    70: 'Barre',
    71: 'Assault Bike',
    73: 'Stretching',
    74: 'Kayaking',
    75: 'Paddleboarding',
    76: 'Obstacle Course Racing',
    82: 'Motor Sports',
    83: 'Hiking',
    84: 'Rucking',
    85: 'Climbing',
    86: 'Horseback Riding',
    87: 'Diving',
    88: 'Badminton',
    89: 'Table Tennis',
    90: 'Pickleball',
    91: 'Skateboarding',
    92: 'Roller Skating',
    93: 'Inline Skating',
    94: 'Motocross',
    95: 'Wheelchair Pushing',
    96: 'Jumping Rope',
  };

  return sports[sportId] || 'Activity';
};

/**
 * Complete the OAuth flow and store tokens
 */
export const completeOAuthFlow = async (
  userId: string,
  code: string
): Promise<void> => {
  // Exchange code for tokens
  const tokenData = await exchangeCodeForTokens(code);

  // Calculate expiration time
  const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000);

  // Store tokens
  const tokens: WhoopTokens = {
    accessToken: tokenData.accessToken,
    refreshToken: tokenData.refreshToken,
    expiresAt,
    scopes: tokenData.scope.split(' '),
    linkedAt: new Date(),
  };

  // Get Whoop user profile to store user ID
  try {
    // Temporarily use the new access token
    const profileResponse = await fetch(`${WHOOP_API_BASE}/v1/user/profile/basic`, {
      headers: {
        Authorization: `Bearer ${tokenData.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (profileResponse.ok) {
      const profile = await profileResponse.json();
      tokens.whoopUserId = profile.user_id?.toString();
    }
  } catch (error) {
    console.error('Failed to fetch Whoop profile:', error);
  }

  await storeTokens(userId, tokens);
};

/**
 * Disconnect Whoop from user account
 */
export const disconnectWhoop = async (userId: string): Promise<void> => {
  const tokens = await getTokens(userId);
  if (tokens) {
    // Revoke the token with Whoop
    await revokeTokens(tokens.accessToken);
  }

  // Delete tokens from Firestore
  await deleteTokens(userId);
};
