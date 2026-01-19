/**
 * Entry Type Definitions
 *
 * Core types for journal entries and their analysis results.
 */

import { Timestamp } from 'firebase/firestore';

/**
 * Journal entry categories
 */
export type EntryCategory = 'personal' | 'work' | 'health' | 'relationships' | 'growth';

/**
 * Entry analysis status
 */
export type AnalysisStatus = 'pending' | 'processing' | 'complete' | 'failed';

/**
 * Therapeutic frameworks used in analysis
 */
export type TherapeuticFramework = 'ACT' | 'CBT' | 'DBT' | 'RAIN' | 'general';

/**
 * Core journal entry structure
 */
export interface Entry {
  id: string;
  userId: string;
  text: string;
  category: EntryCategory;
  createdAt: Timestamp;
  effectiveDate: Timestamp;
  analysisStatus: AnalysisStatus;

  // Optional fields populated after analysis
  analysis?: AnalysisResult;
  embedding?: number[];
  classification?: EntryClassification;

  // Safety flags
  safety_flagged?: boolean;
  safety_user_response?: 'proceed' | 'get_help';
  has_warning_indicators?: boolean;

  // Context data
  healthContext?: HealthContext;
  environmentContext?: EnvironmentContext;

  // Signal extraction version for migrations
  signalExtractionVersion?: number;
}

/**
 * Result of AI entry analysis
 */
export interface AnalysisResult {
  mood_score: number; // 0-1 scale
  mood_label: string;
  mood_emoji: string;
  themes: string[];
  emotions: Emotion[];
  cognitive_patterns?: CognitivePattern[];
  therapeutic_response: string;
  therapeutic_framework?: TherapeuticFramework;
  values_alignment?: string[];
  growth_opportunities?: string[];
  coping_strategies?: string[];
  reflection_prompts?: string[];
}

/**
 * Detected emotion in an entry
 */
export interface Emotion {
  name: string;
  intensity: 'low' | 'medium' | 'high';
  valence: 'positive' | 'negative' | 'neutral';
}

/**
 * Cognitive distortion or pattern detected
 */
export interface CognitivePattern {
  type: string;
  description: string;
  frequency: 'occasional' | 'frequent' | 'persistent';
}

/**
 * Entry classification result
 */
export interface EntryClassification {
  primary_category: EntryCategory;
  confidence: number;
  secondary_categories?: EntryCategory[];
  topics?: string[];
}

/**
 * Health context attached to an entry
 */
export interface HealthContext {
  source: 'whoop' | 'healthkit' | 'google_fit' | 'manual';
  sleepHours?: number;
  sleepScore?: number;
  hrv?: number;
  rhr?: number;
  recoveryScore?: number;
  strain?: number;
  steps?: number;
  activeCalories?: number;
  hadWorkout?: boolean;
  workoutType?: string;
  fetchedAt: Timestamp;
}

/**
 * Environment context attached to an entry
 */
export interface EnvironmentContext {
  temperature?: number;
  weatherLabel?: string;
  sunshinePercent?: number;
  daylightHours?: number;
  lightContext?: 'daylight' | 'low_light' | 'dark';
  isAfterDark?: boolean;
  isLowSunshine?: boolean;
  location?: {
    latitude: number;
    longitude: number;
    city?: string;
  };
  fetchedAt: Timestamp;
}

/**
 * Offline entry queued for sync
 */
export interface OfflineEntry {
  offlineId: string;
  text: string;
  category: EntryCategory;
  createdAt: Date;
  effectiveDate?: Date;
  safety_flagged?: boolean;
  safety_user_response?: 'proceed' | 'get_help';
  has_warning_indicators?: boolean;
}
