/**
 * Health Type Definitions
 *
 * Types for health data integration and correlations.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Health data source providers
 */
export type HealthSource = 'whoop' | 'healthkit' | 'google_fit' | 'manual';

/**
 * Complete health context for an entry
 */
export interface HealthContext {
  source: HealthSource;

  // Sleep metrics
  sleepHours?: number;
  sleepScore?: number;
  sleepStages?: SleepStages;

  // Heart rate metrics
  hrv?: number;
  rhr?: number;
  maxHr?: number;

  // Recovery/readiness
  recoveryScore?: number;
  strain?: number;

  // Activity metrics
  steps?: number;
  activeCalories?: number;
  totalCalories?: number;
  distance?: number;

  // Workout info
  hadWorkout?: boolean;
  workoutType?: string;
  workoutDuration?: number;
  workoutCalories?: number;

  // Timestamp
  fetchedAt: Timestamp;
}

/**
 * Sleep stage breakdown
 */
export interface SleepStages {
  awake: number;
  light: number;
  deep: number;
  rem: number;
}

/**
 * Health-mood correlation result
 */
export interface HealthCorrelation {
  type: HealthCorrelationType;
  correlation?: number;
  insight: string;
  strength: CorrelationStrength;
  sampleSize: number;
  recommendation?: string;
}

/**
 * Types of health correlations computed
 */
export type HealthCorrelationType =
  | 'sleep_mood'
  | 'sleep_quality_mood'
  | 'hrv_mood'
  | 'exercise_mood'
  | 'recovery_mood'
  | 'steps_mood'
  | 'rhr_mood';

/**
 * Correlation strength categories
 */
export type CorrelationStrength = 'strong' | 'moderate' | 'weak';

/**
 * Sleep-mood correlation details
 */
export interface SleepMoodCorrelation extends HealthCorrelation {
  type: 'sleep_mood';
  goodSleepAvgMood: number;
  poorSleepAvgMood: number;
  difference: number;
}

/**
 * HRV-mood correlation details
 */
export interface HrvMoodCorrelation extends HealthCorrelation {
  type: 'hrv_mood';
  medianHRV: number;
  highHRVAvgMood: number;
  lowHRVAvgMood: number;
  difference: number;
}

/**
 * Exercise-mood correlation details
 */
export interface ExerciseMoodCorrelation extends HealthCorrelation {
  type: 'exercise_mood';
  workoutDayMood: number;
  restDayMood: number;
  workoutDays: number;
  restDays: number;
  difference: number;
}

/**
 * Recovery-mood correlation details
 */
export interface RecoveryMoodCorrelation extends HealthCorrelation {
  type: 'recovery_mood';
  greenZoneMood: number;
  yellowZoneMood: number;
  redZoneMood: number;
  greenRedDifference: number;
}

/**
 * All health correlations for a user
 */
export interface HealthCorrelations {
  sleepMood?: SleepMoodCorrelation;
  sleepQualityMood?: HealthCorrelation;
  hrvMood?: HrvMoodCorrelation;
  exerciseMood?: ExerciseMoodCorrelation;
  recoveryMood?: RecoveryMoodCorrelation;
  stepsMood?: HealthCorrelation;
  rhrMood?: HealthCorrelation;
}

/**
 * Health data sufficiency check result
 */
export interface HealthDataSufficiency {
  hasEnoughData: boolean;
  dataPoints: number;
  needed?: number;
  message: string;
}

/**
 * Whoop OAuth tokens
 */
export interface WhoopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Timestamp;
  scope: string;
}

/**
 * Health settings for a user
 */
export interface HealthSettings {
  whoopConnected: boolean;
  healthKitEnabled: boolean;
  googleFitEnabled: boolean;
  autoFetchHealth: boolean;
  preferredSource: HealthSource;
}

/**
 * Extracted health signals for correlation analysis
 */
export interface ExtractedHealthSignals {
  sleepHours?: number;
  sleepScore?: number;
  hrv?: number;
  rhr?: number;
  recoveryScore?: number;
  hadWorkout?: boolean;
  steps?: number;
}
