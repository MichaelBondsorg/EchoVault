/**
 * Analytics Repository
 *
 * Firestore CRUD abstraction for analytics collections.
 * Analytics uses named documents (not auto-ID) under users/{userId}/analytics/.
 *
 * Path: artifacts/{APP_COLLECTION_ID}/users/{userId}/analytics/{docName}
 */
import {
  db, doc, getDoc, setDoc, Timestamp, runTransaction,
} from '../config/firebase.js';
import { APP_COLLECTION_ID } from '../config/constants.js';

class AnalyticsRepository {
  /**
   * Get a reference to an analytics document.
   */
  getDocRef(userId, docName) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'analytics', docName);
  }

  /**
   * Read an analytics document by name.
   * @param {string} userId
   * @param {string} docName - e.g. 'topic_coverage', 'entry_stats'
   * @returns {Promise<Object|null>}
   */
  async getAnalyticsDoc(userId, docName) {
    const docRef = this.getDocRef(userId, docName);
    const snap = await getDoc(docRef);
    return snap.exists() ? snap.data() : null;
  }

  /**
   * Write/merge an analytics document.
   */
  async setAnalyticsDoc(userId, docName, data) {
    const docRef = this.getDocRef(userId, docName);
    await setDoc(docRef, { ...data, lastUpdated: Timestamp.now() }, { merge: true });
  }

  /**
   * Run a transaction on an analytics document.
   */
  async transactAnalyticsDoc(userId, docName, updateFn) {
    const docRef = this.getDocRef(userId, docName);
    return runTransaction(db, async (transaction) => {
      const snap = await transaction.get(docRef);
      const current = snap.exists() ? snap.data() : null;
      const updated = updateFn(current);
      transaction.set(docRef, { ...updated, lastUpdated: Timestamp.now() }, { merge: true });
      return updated;
    });
  }

  // Convenience methods for each analytics document

  async getTopicCoverage(userId) {
    return this.getAnalyticsDoc(userId, 'topic_coverage');
  }

  async getEntryStats(userId) {
    return this.getAnalyticsDoc(userId, 'entry_stats');
  }

  async getHealthTrends(userId) {
    return this.getAnalyticsDoc(userId, 'health_trends');
  }

  async getEntityActivity(userId) {
    return this.getAnalyticsDoc(userId, 'entity_activity');
  }
}

export const analyticsRepository = new AnalyticsRepository();
export { AnalyticsRepository };
