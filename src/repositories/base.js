/**
 * Base Repository
 *
 * Abstract base class providing common CRUD operations for Firestore.
 * Domain-specific repositories extend this class to inherit these methods.
 *
 * Collection Path Pattern: artifacts/{APP_COLLECTION_ID}/users/{userId}/{collectionName}
 */

import {
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  setDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  Timestamp,
  writeBatch,
  runTransaction
} from '../config/firebase';
import { APP_COLLECTION_ID } from '../config/constants';

/**
 * Base repository providing common Firestore operations.
 * All domain repositories should extend this class.
 */
export class BaseRepository {
  /**
   * @param {string} collectionName - The Firestore subcollection name under users/{userId}/
   */
  constructor(collectionName) {
    this.collectionName = collectionName;
  }

  // ============================================
  // COLLECTION REFERENCES
  // ============================================

  /**
   * Get the collection reference for a user
   * @param {string} userId
   * @returns {CollectionReference}
   */
  getCollection(userId) {
    return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, this.collectionName);
  }

  /**
   * Get a document reference
   * @param {string} userId
   * @param {string} docId
   * @returns {DocumentReference}
   */
  getDocRef(userId, docId) {
    return doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, this.collectionName, docId);
  }

  // ============================================
  // CREATE OPERATIONS
  // ============================================

  /**
   * Create a new document with auto-generated ID
   * @param {string} userId
   * @param {Object} data
   * @returns {Promise<{id: string, ...data}>}
   */
  async create(userId, data) {
    const collectionRef = this.getCollection(userId);
    const now = Timestamp.now();

    const docData = {
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now
    };

    const docRef = await addDoc(collectionRef, docData);
    console.log(`[${this.collectionName}] Created: ${docRef.id}`);

    return { id: docRef.id, ...docData };
  }

  /**
   * Create a document with a specific ID
   * @param {string} userId
   * @param {string} docId
   * @param {Object} data
   * @param {Object} options - { merge: boolean }
   * @returns {Promise<{id: string, ...data}>}
   */
  async createWithId(userId, docId, data, options = {}) {
    const docRef = this.getDocRef(userId, docId);
    const now = Timestamp.now();

    const docData = {
      ...data,
      createdAt: data.createdAt || now,
      updatedAt: now
    };

    await setDoc(docRef, docData, options);
    console.log(`[${this.collectionName}] Created with ID: ${docId}`);

    return { id: docId, ...docData };
  }

  // ============================================
  // READ OPERATIONS
  // ============================================

  /**
   * Find a document by ID
   * @param {string} userId
   * @param {string} docId
   * @returns {Promise<Object|null>}
   */
  async findById(userId, docId) {
    const docRef = this.getDocRef(userId, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    return { id: docSnap.id, ...docSnap.data() };
  }

  /**
   * Find all documents in the collection
   * @param {string} userId
   * @param {Object} options - { orderByField, orderDirection, limitCount }
   * @returns {Promise<Array>}
   */
  async findAll(userId, options = {}) {
    const collectionRef = this.getCollection(userId);
    let q = collectionRef;

    const constraints = [];

    if (options.orderByField) {
      constraints.push(orderBy(options.orderByField, options.orderDirection || 'desc'));
    }

    if (options.limitCount) {
      constraints.push(firestoreLimit(options.limitCount));
    }

    if (constraints.length > 0) {
      q = query(collectionRef, ...constraints);
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Find documents matching a query
   * @param {string} userId
   * @param {Array} constraints - Array of Firestore query constraints
   * @returns {Promise<Array>}
   */
  async findWhere(userId, constraints = []) {
    const collectionRef = this.getCollection(userId);
    const q = query(collectionRef, ...constraints);
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Find documents by a field value
   * @param {string} userId
   * @param {string} field
   * @param {string} operator - '==', '!=', '<', '>', '<=', '>=', 'in', 'array-contains', etc.
   * @param {*} value
   * @returns {Promise<Array>}
   */
  async findByField(userId, field, operator, value) {
    return this.findWhere(userId, [where(field, operator, value)]);
  }

  // ============================================
  // UPDATE OPERATIONS
  // ============================================

  /**
   * Update a document
   * @param {string} userId
   * @param {string} docId
   * @param {Object} updates
   * @returns {Promise<void>}
   */
  async update(userId, docId, updates) {
    const docRef = this.getDocRef(userId, docId);

    const updateData = {
      ...updates,
      updatedAt: Timestamp.now()
    };

    await updateDoc(docRef, updateData);
    console.log(`[${this.collectionName}] Updated: ${docId}`);
  }

  /**
   * Update multiple documents in a batch
   * @param {string} userId
   * @param {Array<{id: string, updates: Object}>} items
   * @returns {Promise<void>}
   */
  async updateBatch(userId, items) {
    if (items.length === 0) return;

    const batch = writeBatch(db);
    const now = Timestamp.now();

    for (const { id, updates } of items) {
      const docRef = this.getDocRef(userId, id);
      batch.update(docRef, { ...updates, updatedAt: now });
    }

    await batch.commit();
    console.log(`[${this.collectionName}] Batch updated ${items.length} documents`);
  }

  /**
   * Update a document atomically using a transaction
   * @param {string} userId
   * @param {string} docId
   * @param {Function} updateFn - (currentData) => updatedData
   * @returns {Promise<Object>} Updated document
   */
  async updateTransaction(userId, docId, updateFn) {
    const docRef = this.getDocRef(userId, docId);

    const result = await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);

      if (!docSnap.exists()) {
        throw new Error(`Document not found: ${docId}`);
      }

      const currentData = { id: docSnap.id, ...docSnap.data() };
      const updates = updateFn(currentData);
      const updateData = { ...updates, updatedAt: Timestamp.now() };

      transaction.update(docRef, updateData);

      return { ...currentData, ...updateData };
    });

    console.log(`[${this.collectionName}] Transaction updated: ${docId}`);
    return result;
  }

  // ============================================
  // DELETE OPERATIONS
  // ============================================

  /**
   * Delete a document
   * @param {string} userId
   * @param {string} docId
   * @returns {Promise<void>}
   */
  async delete(userId, docId) {
    const docRef = this.getDocRef(userId, docId);
    await deleteDoc(docRef);
    console.log(`[${this.collectionName}] Deleted: ${docId}`);
  }

  /**
   * Delete multiple documents in a batch
   * @param {string} userId
   * @param {Array<string>} docIds
   * @returns {Promise<void>}
   */
  async deleteBatch(userId, docIds) {
    if (docIds.length === 0) return;

    const batch = writeBatch(db);

    for (const docId of docIds) {
      const docRef = this.getDocRef(userId, docId);
      batch.delete(docRef);
    }

    await batch.commit();
    console.log(`[${this.collectionName}] Batch deleted ${docIds.length} documents`);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Check if a document exists
   * @param {string} userId
   * @param {string} docId
   * @returns {Promise<boolean>}
   */
  async exists(userId, docId) {
    const docRef = this.getDocRef(userId, docId);
    const docSnap = await getDoc(docRef);
    return docSnap.exists();
  }

  /**
   * Count documents matching criteria
   * @param {string} userId
   * @param {Array} constraints
   * @returns {Promise<number>}
   */
  async count(userId, constraints = []) {
    const docs = await this.findWhere(userId, constraints);
    return docs.length;
  }
}

export default BaseRepository;
