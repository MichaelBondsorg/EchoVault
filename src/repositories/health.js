/**
 * Health Repository
 *
 * Repository for health-related data operations.
 * Handles Whoop tokens, health settings, and health context data.
 */

import { BaseRepository } from './base';
import { doc, setDoc, getDoc, Timestamp } from '../config/firebase';
import { db } from '../config/firebase';
import { APP_COLLECTION_ID } from '../config/constants';

class HealthRepository extends BaseRepository {
  constructor() {
    super('health_data');
  }

  // ============================================
  // WHOOP INTEGRATION
  // ============================================

  /**
   * Get Whoop tokens reference (stored at user level, not in subcollection)
   * @param {string} userId
   */
  getWhoopTokensRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'integrations', 'whoop');
  }

  /**
   * Get Whoop tokens
   * @param {string} userId
   */
  async getWhoopTokens(userId) {
    const docRef = this.getWhoopTokensRef(userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) return null;
    return docSnap.data();
  }

  /**
   * Save Whoop tokens
   * @param {string} userId
   * @param {Object} tokens
   */
  async saveWhoopTokens(userId, tokens) {
    const docRef = this.getWhoopTokensRef(userId);
    await setDoc(docRef, {
      ...tokens,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[health] Saved Whoop tokens');
  }

  /**
   * Delete Whoop tokens (disconnect)
   * @param {string} userId
   */
  async deleteWhoopTokens(userId) {
    const docRef = this.getWhoopTokensRef(userId);
    await setDoc(docRef, {
      accessToken: null,
      refreshToken: null,
      disconnectedAt: Timestamp.now()
    });

    console.log('[health] Disconnected Whoop');
  }

  /**
   * Check if Whoop is connected
   * @param {string} userId
   */
  async isWhoopConnected(userId) {
    const tokens = await this.getWhoopTokens(userId);
    return tokens?.accessToken != null;
  }

  // ============================================
  // HEALTH SETTINGS
  // ============================================

  /**
   * Get health settings reference
   * @param {string} userId
   */
  getHealthSettingsRef(userId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'health');
  }

  /**
   * Get health settings
   * @param {string} userId
   */
  async getHealthSettings(userId) {
    const docRef = this.getHealthSettingsRef(userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      // Return defaults
      return {
        autoFetchHealth: true,
        preferredSource: 'whoop',
        healthKitEnabled: false,
        googleFitEnabled: false
      };
    }

    return docSnap.data();
  }

  /**
   * Save health settings
   * @param {string} userId
   * @param {Object} settings
   */
  async saveHealthSettings(userId, settings) {
    const docRef = this.getHealthSettingsRef(userId);
    await setDoc(docRef, {
      ...settings,
      updatedAt: Timestamp.now()
    }, { merge: true });

    console.log('[health] Saved health settings');
  }

  /**
   * Update specific health setting
   * @param {string} userId
   * @param {string} key
   * @param {*} value
   */
  async updateHealthSetting(userId, key, value) {
    const docRef = this.getHealthSettingsRef(userId);
    await setDoc(docRef, {
      [key]: value,
      updatedAt: Timestamp.now()
    }, { merge: true });
  }

  // ============================================
  // HEALTH DATA CACHE
  // ============================================

  /**
   * Cache health data for a date
   * @param {string} userId
   * @param {string} dateString - YYYY-MM-DD
   * @param {Object} healthData
   */
  async cacheHealthData(userId, dateString, healthData) {
    return this.createWithId(userId, dateString, {
      ...healthData,
      date: dateString,
      cachedAt: Timestamp.now()
    }, { merge: true });
  }

  /**
   * Get cached health data for a date
   * @param {string} userId
   * @param {string} dateString
   */
  async getCachedHealthData(userId, dateString) {
    return this.findById(userId, dateString);
  }

  /**
   * Check if health data is cached and fresh (less than 4 hours old)
   * @param {string} userId
   * @param {string} dateString
   */
  async isCacheFresh(userId, dateString) {
    const cached = await this.getCachedHealthData(userId, dateString);
    if (!cached?.cachedAt) return false;

    const cacheAge = Date.now() - cached.cachedAt.toDate().getTime();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;

    return cacheAge < FOUR_HOURS;
  }

  /**
   * Get recent health data
   * @param {string} userId
   * @param {number} days
   */
  async getRecentHealthData(userId, days = 7) {
    const entries = await this.findAll(userId, {
      orderByField: 'date',
      orderDirection: 'desc',
      limitCount: days
    });

    return entries;
  }

  // ============================================
  // HEALTH METRICS AGGREGATION
  // ============================================

  /**
   * Get health summary for a date range
   * @param {string} userId
   * @param {number} days
   */
  async getHealthSummary(userId, days = 30) {
    const data = await this.getRecentHealthData(userId, days);

    if (data.length === 0) {
      return null;
    }

    // Calculate averages
    const withSleep = data.filter(d => d.sleepHours != null);
    const withHrv = data.filter(d => d.hrv != null);
    const withRecovery = data.filter(d => d.recoveryScore != null);
    const withSteps = data.filter(d => d.steps != null);

    return {
      dataPoints: data.length,
      averages: {
        sleepHours: withSleep.length > 0
          ? withSleep.reduce((sum, d) => sum + d.sleepHours, 0) / withSleep.length
          : null,
        hrv: withHrv.length > 0
          ? withHrv.reduce((sum, d) => sum + d.hrv, 0) / withHrv.length
          : null,
        recoveryScore: withRecovery.length > 0
          ? withRecovery.reduce((sum, d) => sum + d.recoveryScore, 0) / withRecovery.length
          : null,
        steps: withSteps.length > 0
          ? withSteps.reduce((sum, d) => sum + d.steps, 0) / withSteps.length
          : null
      },
      coverage: {
        sleep: withSleep.length,
        hrv: withHrv.length,
        recovery: withRecovery.length,
        steps: withSteps.length
      }
    };
  }
}

// Export singleton instance
export const healthRepository = new HealthRepository();

// Also export class for testing
export { HealthRepository };
