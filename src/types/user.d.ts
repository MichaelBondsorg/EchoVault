/**
 * User Type Definitions
 *
 * Types for user accounts, safety plans, and preferences.
 */

import { Timestamp } from 'firebase/firestore';
import { HealthSettings } from './health';

/**
 * Firebase Auth user (subset of relevant fields)
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
  phoneNumber: string | null;
}

/**
 * User profile stored in Firestore
 */
export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  createdAt: Timestamp;
  lastActive: Timestamp;

  // Preferences
  preferences: UserPreferences;

  // Health integration
  healthSettings?: HealthSettings;

  // Safety
  safetyPlan?: SafetyPlan;

  // Stats
  entryCount: number;
  streak: number;
  lastEntryDate?: Timestamp;
}

/**
 * User preferences
 */
export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  defaultCategory: string;
  entryPreferredMode: 'voice' | 'text';
  notificationsEnabled: boolean;
  reminderTime?: string; // HH:mm format
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  dateFormat: 'US' | 'EU' | 'ISO';
  privacyMode: boolean;
}

/**
 * Safety plan structure
 */
export interface SafetyPlan {
  warningSignsEnabled: boolean;
  warningSignals: string[];
  copingStrategies: string[];
  distractions: string[];
  supportContacts: SupportContact[];
  professionalContacts: ProfessionalContact[];
  safeEnvironment: string[];
  reasonsForLiving: string[];
  lastUpdated?: Timestamp;
}

/**
 * Personal support contact
 */
export interface SupportContact {
  id: string;
  name: string;
  phone?: string;
  relationship: string;
  notes?: string;
}

/**
 * Professional/crisis contact
 */
export interface ProfessionalContact {
  id: string;
  name: string;
  phone: string;
  type: 'therapist' | 'psychiatrist' | 'crisis_line' | 'emergency' | 'other';
  notes?: string;
}

/**
 * Crisis modal state
 */
export interface CrisisModalState {
  isOpen: boolean;
  triggerType: 'keywords' | 'warning_indicators' | 'longitudinal';
  entryText: string;
  severity: 'low' | 'medium' | 'high';
}

/**
 * User session data
 */
export interface UserSession {
  userId: string;
  startedAt: Timestamp;
  lastActivity: Timestamp;
  deviceInfo?: DeviceInfo;
}

/**
 * Device information
 */
export interface DeviceInfo {
  platform: 'ios' | 'android' | 'web';
  appVersion: string;
  osVersion?: string;
  deviceModel?: string;
}

/**
 * Notification settings
 */
export interface NotificationSettings {
  enabled: boolean;
  dailyReminder: boolean;
  reminderTime: string;
  weeklyDigest: boolean;
  insightAlerts: boolean;
  crisisResources: boolean;
}

/**
 * Export request for therapist
 */
export interface TherapistExportRequest {
  userId: string;
  dateRange: {
    start: Timestamp;
    end: Timestamp;
  };
  includeAnalysis: boolean;
  includeHealthData: boolean;
  format: 'pdf' | 'json';
  createdAt: Timestamp;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  downloadUrl?: string;
}

/**
 * User streak information
 */
export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastEntryDate: string | null;
  totalEntries: number;
}

/**
 * Default safety plan
 */
export const DEFAULT_SAFETY_PLAN: SafetyPlan = {
  warningSignsEnabled: true,
  warningSignals: [],
  copingStrategies: [],
  distractions: [],
  supportContacts: [],
  professionalContacts: [],
  safeEnvironment: [],
  reasonsForLiving: []
};
