/**
 * Users Repository
 *
 * Repository for user profile and settings operations.
 * Handles safety plans, preferences, and user metadata.
 */

import { BaseRepository } from './base';
import { doc, setDoc, getDoc, onSnapshot, Timestamp } from '../config/firebase';
import { db } from '../config/firebase';
import { APP_COLLECTION_ID, DEFAULT_SAFETY_PLAN } from '../config/constants';

class UsersRepository extends BaseRepository {
  constructor() {
    super('users');
  }

  // ============================================
  // USER PROFILE
  // ============================================

  /**
   * Get user profile reference
   * @param {string} userId
   */
  getUserProfileRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'profile', 'main');
  }

  /**
   * Get user profile
   * @param {string} userId
   */
  async getUserProfile(userId) {
    const docRef = this.getUserProfileRef(userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;
    return docSnap.data();
  }

  /**
   * Create or update user profile
   * @param {string} userId
   * @param {Object} profileData
   */
  async saveUserProfile(userId, profileData) {
    const docRef = this.getUserProfileRef(userId);
    await setDoc(docRef, {
      ...profileData,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[users] Saved user profile');
  }

  /**
   * Update user's last active timestamp
   * @param {string} userId
   */
  async updateLastActive(userId) {
    const docRef = this.getUserProfileRef(userId);
    await setDoc(docRef, {
      lastActive: Timestamp.now()
    }, { merge: true });
  }

  // ============================================
  // SAFETY PLAN
  // ============================================

  /**
   * Get safety plan reference
   * @param {string} userId
   */
  getSafetyPlanRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'safetyPlan', 'plan');
  }

  /**
   * Get safety plan
   * @param {string} userId
   */
  async getSafetyPlan(userId) {
    const docRef = this.getSafetyPlanRef(userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return DEFAULT_SAFETY_PLAN;
    }

    return { ...DEFAULT_SAFETY_PLAN, ...docSnap.data() };
  }

  /**
   * Save safety plan
   * @param {string} userId
   * @param {Object} safetyPlan
   */
  async saveSafetyPlan(userId, safetyPlan) {
    const docRef = this.getSafetyPlanRef(userId);

    // Remove undefined values
    const cleanPlan = Object.fromEntries(
      Object.entries(safetyPlan).filter(([_, v]) => v !== undefined)
    );

    await setDoc(docRef, {
      ...cleanPlan,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[users] Saved safety plan');
  }

  /**
   * Subscribe to safety plan changes
   * @param {string} userId
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  subscribeSafetyPlan(userId, callback) {
    const docRef = this.getSafetyPlanRef(userId);

    return onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        callback({ ...DEFAULT_SAFETY_PLAN, ...snap.data() });
      } else {
        callback(DEFAULT_SAFETY_PLAN);
      }
    });
  }

  // ============================================
  // USER PREFERENCES
  // ============================================

  /**
   * Get user preferences reference
   * @param {string} userId
   */
  getPreferencesRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'preferences');
  }

  /**
   * Get user preferences
   * @param {string} userId
   */
  async getPreferences(userId) {
    const docRef = this.getPreferencesRef(userId);
    const docSnap = await getDoc(docRef);

    const defaults = {
      theme: 'system',
      defaultCategory: 'personal',
      entryPreferredMode: 'text',
      notificationsEnabled: false,
      weekStartsOn: 0,
      dateFormat: 'US',
      privacyMode: false
    };

    if (!docSnap.exists()) return defaults;
    return { ...defaults, ...docSnap.data() };
  }

  /**
   * Save user preferences
   * @param {string} userId
   * @param {Object} preferences
   */
  async savePreferences(userId, preferences) {
    const docRef = this.getPreferencesRef(userId);
    await setDoc(docRef, {
      ...preferences,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[users] Saved preferences');
  }

  /**
   * Update specific preference
   * @param {string} userId
   * @param {string} key
   * @param {*} value
   */
  async updatePreference(userId, key, value) {
    const docRef = this.getPreferencesRef(userId);
    await setDoc(docRef, {
      [key]: value,
      updatedAt: Timestamp.now()
    }, { merge: true });
  }

  // ============================================
  // NOTIFICATION SETTINGS
  // ============================================

  /**
   * Get notification settings reference
   * @param {string} userId
   */
  getNotificationSettingsRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'notifications');
  }

  /**
   * Get notification settings
   * @param {string} userId
   */
  async getNotificationSettings(userId) {
    const docRef = this.getNotificationSettingsRef(userId);
    const docSnap = await getDoc(docRef);

    const defaults = {
      enabled: false,
      dailyReminder: false,
      reminderTime: '20:00',
      weeklyDigest: false,
      insightAlerts: true,
      crisisResources: true
    };

    if (!docSnap.exists()) return defaults;
    return { ...defaults, ...docSnap.data() };
  }

  /**
   * Save notification settings
   * @param {string} userId
   * @param {Object} settings
   */
  async saveNotificationSettings(userId, settings) {
    const docRef = this.getNotificationSettingsRef(userId);
    await setDoc(docRef, {
      ...settings,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[users] Saved notification settings');
  }

  // ============================================
  // USER STATS
  // ============================================

  /**
   * Update entry count
   * @param {string} userId
   * @param {number} count
   */
  async updateEntryCount(userId, count) {
    const docRef = this.getUserProfileRef(userId);
    await setDoc(docRef, {
      entryCount: count,
      updatedAt: Timestamp.now()
    }, { merge: true });
  }

  /**
   * Update streak info
   * @param {string} userId
   * @param {Object} streakInfo
   */
  async updateStreakInfo(userId, streakInfo) {
    const docRef = this.getUserProfileRef(userId);
    await setDoc(docRef, {
      currentStreak: streakInfo.currentStreak,
      longestStreak: streakInfo.longestStreak,
      lastEntryDate: streakInfo.lastEntryDate,
      updatedAt: Timestamp.now()
    }, { merge: true });
  }

  // ============================================
  // EXPORT HISTORY
  // ============================================

  /**
   * Log an export request
   * @param {string} userId
   * @param {Object} exportInfo
   */
  async logExport(userId, exportInfo) {
    const exportsCollection = this.getCollection(userId);
    // Note: This uses the base collection which might not be what we want
    // Consider creating a separate exports subcollection

    return this.create(userId, {
      type: 'export',
      format: exportInfo.format,
      dateRange: exportInfo.dateRange,
      includeAnalysis: exportInfo.includeAnalysis,
      createdAt: Timestamp.now()
    });
  }
}

// Export singleton instance
export const usersRepository = new UsersRepository();

// Also export class for testing
export { UsersRepository };
