/**
 * Signals Service
 *
 * CRUD operations for temporal signals with version checking
 * to handle race conditions during rapid edits.
 *
 * Signals are stored in: artifacts/{appId}/users/{userId}/signals/{signalId}
 * Day summaries are managed by Cloud Function triggers (not client-side)
 */

import {
  db,
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

/**
 * Get the signals collection reference for a user
 */
const getSignalsCollection = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signals');
};

/**
 * Get the day_summaries collection reference for a user
 */
const getDaySummariesCollection = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'day_summaries');
};

/**
 * Format a Date to YYYY-MM-DD string
 */
export const formatDateKey = (date) => {
  const d = date instanceof Date ? date : date.toDate?.() || new Date(date);
  return d.toISOString().split('T')[0];
};

/**
 * Save signals with version checking
 *
 * This prevents race conditions when a user rapidly edits an entry:
 * - Only signals matching the current extractionVersion are saved
 * - Old signals from previous versions are deleted
 *
 * @param {Array} signals - Array of signal objects to save
 * @param {string} entryId - The source entry ID
 * @param {string} userId - The user ID
 * @param {number} extractionVersion - The current extraction version
 * @returns {Promise<Array>} - Array of saved signal IDs
 */
export const saveSignalsWithVersionCheck = async (signals, entryId, userId, extractionVersion) => {
  const signalsRef = getSignalsCollection(userId);
  const batch = writeBatch(db);
  const savedIds = [];

  // First, delete any existing signals for this entry with older versions
  const existingQuery = query(signalsRef, where('entryId', '==', entryId));
  const existingSnap = await getDocs(existingQuery);

  existingSnap.forEach((docSnap) => {
    const data = docSnap.data();
    // Delete if it's from an older version
    if (data.extractionVersion < extractionVersion) {
      batch.delete(docSnap.ref);
    }
  });

  // Add new signals with current version
  const now = Timestamp.now();

  for (const signal of signals) {
    const signalRef = doc(signalsRef);
    const signalData = {
      id: signalRef.id,
      entryId,
      userId,
      extractionVersion,

      // Temporal
      targetDate: signal.targetDate instanceof Date
        ? Timestamp.fromDate(signal.targetDate)
        : signal.targetDate,
      recordedAt: now,

      // Signal content
      type: signal.type,
      content: signal.content,
      sentiment: signal.sentiment || 'neutral',
      originalPhrase: signal.originalPhrase,

      // Confidence & verification
      confidence: signal.confidence,
      status: 'active', // 'active' | 'verified' | 'dismissed'

      // Recurring
      isRecurringInstance: signal.isRecurringInstance || false,
      recurringPattern: signal.recurringPattern || null,
      occurrenceIndex: signal.occurrenceIndex || null,

      // Metadata
      createdAt: now,
      updatedAt: now
    };

    batch.set(signalRef, signalData);
    savedIds.push(signalRef.id);
  }

  await batch.commit();
  console.log(`Saved ${savedIds.length} signals for entry ${entryId} (version ${extractionVersion})`);

  return savedIds;
};

/**
 * Delete all signals for an entry (used before re-extraction on edit)
 */
export const deleteSignalsForEntry = async (entryId, userId) => {
  const signalsRef = getSignalsCollection(userId);
  const q = query(signalsRef, where('entryId', '==', entryId));
  const snapshot = await getDocs(q);

  const batch = writeBatch(db);
  snapshot.forEach((docSnap) => {
    batch.delete(docSnap.ref);
  });

  await batch.commit();
  console.log(`Deleted ${snapshot.size} signals for entry ${entryId}`);

  return snapshot.size;
};

/**
 * Update signal status (for verify/dismiss actions)
 */
export const updateSignalStatus = async (signalId, userId, status) => {
  const signalRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signals', signalId);
  await updateDoc(signalRef, {
    status,
    updatedAt: Timestamp.now()
  });
};

/**
 * Batch update signal status (for auto-verify high confidence signals)
 */
export const batchUpdateSignalStatus = async (signalIds, userId, status) => {
  const batch = writeBatch(db);
  const now = Timestamp.now();

  for (const signalId of signalIds) {
    const signalRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signals', signalId);
    batch.update(signalRef, {
      status,
      updatedAt: now
    });
  }

  await batch.commit();
  console.log(`Updated ${signalIds.length} signals to status: ${status}`);
};

/**
 * Get signals for a specific entry
 */
export const getSignalsForEntry = async (entryId, userId) => {
  const signalsRef = getSignalsCollection(userId);
  const q = query(signalsRef, where('entryId', '==', entryId));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(docSnap => ({
    ...docSnap.data(),
    id: docSnap.id,
    targetDate: docSnap.data().targetDate?.toDate?.() || docSnap.data().targetDate
  }));
};

/**
 * Get signals for a specific date
 */
export const getSignalsForDate = async (userId, targetDate) => {
  const signalsRef = getSignalsCollection(userId);
  const dateKey = formatDateKey(targetDate);

  // Create start and end of day timestamps
  const startOfDay = new Date(dateKey + 'T00:00:00.000Z');
  const endOfDay = new Date(dateKey + 'T23:59:59.999Z');

  const q = query(
    signalsRef,
    where('targetDate', '>=', Timestamp.fromDate(startOfDay)),
    where('targetDate', '<=', Timestamp.fromDate(endOfDay))
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map(docSnap => ({
      ...docSnap.data(),
      id: docSnap.id,
      targetDate: docSnap.data().targetDate?.toDate?.() || docSnap.data().targetDate
    }))
    .filter(s => s.status !== 'dismissed');
};

/**
 * Get day summaries for a date range (for heatmap)
 */
export const getDaySummaries = async (userId, dateKeys) => {
  const summariesRef = getDaySummariesCollection(userId);
  const summaries = {};

  // Fetch all summaries in parallel
  const promises = dateKeys.map(async (dateKey) => {
    const docRef = doc(summariesRef, dateKey);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      summaries[dateKey] = docSnap.data();
    }
  });

  await Promise.all(promises);
  return summaries;
};

/**
 * Get all signals for a user (for bulk operations)
 */
export const getAllSignals = async (userId) => {
  const signalsRef = getSignalsCollection(userId);
  const q = query(signalsRef, orderBy('targetDate', 'desc'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map(docSnap => ({
    ...docSnap.data(),
    id: docSnap.id,
    targetDate: docSnap.data().targetDate?.toDate?.() || docSnap.data().targetDate
  }));
};

/**
 * Get signals targeting future dates (for follow-ups)
 */
export const getFutureSignals = async (userId, fromDate = new Date()) => {
  const signalsRef = getSignalsCollection(userId);
  const q = query(
    signalsRef,
    where('targetDate', '>=', Timestamp.fromDate(fromDate)),
    where('type', '==', 'plan')
  );

  const snapshot = await getDocs(q);

  return snapshot.docs
    .map(docSnap => ({
      ...docSnap.data(),
      id: docSnap.id,
      targetDate: docSnap.data().targetDate?.toDate?.() || docSnap.data().targetDate
    }))
    .filter(s => s.status !== 'dismissed');
};

export default {
  saveSignalsWithVersionCheck,
  deleteSignalsForEntry,
  updateSignalStatus,
  batchUpdateSignalStatus,
  getSignalsForEntry,
  getSignalsForDate,
  getDaySummaries,
  getAllSignals,
  getFutureSignals,
  formatDateKey
};
