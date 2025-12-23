/**
 * Signal Migration Service
 *
 * Migrates existing entries with effectiveDate or futureMentions
 * to the new signals system.
 *
 * This can be run incrementally - entries that already have
 * signalExtractionVersion >= 1 are skipped.
 */

import { db, collection, getDocs, doc, updateDoc, query, where, Timestamp } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { saveSignalsWithVersionCheck } from './index';

/**
 * Convert mood score (0-1) to sentiment string
 */
const moodScoreToSentiment = (score) => {
  if (typeof score !== 'number') return 'neutral';
  if (score >= 0.75) return 'positive';
  if (score >= 0.55) return 'hopeful';
  if (score >= 0.45) return 'neutral';
  if (score >= 0.25) return 'anxious';
  return 'negative';
};

/**
 * Migrate a single entry to signals
 *
 * @param {Object} entry - The entry to migrate
 * @param {string} userId - User ID
 * @returns {Promise<{migrated: boolean, signalCount: number}>}
 */
export const migrateEntryToSignals = async (entry, userId) => {
  // Skip if already migrated
  if (entry.signalExtractionVersion >= 1) {
    return { migrated: false, signalCount: 0, reason: 'already_migrated' };
  }

  const signals = [];
  const entryId = entry.id;
  const recordedAt = entry.createdAt instanceof Date
    ? entry.createdAt
    : entry.createdAt?.toDate?.() || new Date();

  // 1. Convert effectiveDate to signal if backdated
  if (entry.effectiveDate) {
    const effectiveDate = entry.effectiveDate instanceof Date
      ? entry.effectiveDate
      : entry.effectiveDate?.toDate?.() || null;

    if (effectiveDate && effectiveDate.toDateString() !== recordedAt.toDateString()) {
      // This was a backdated entry - create an event signal
      signals.push({
        type: 'event',
        content: entry.temporalContext?.originalPhrase || 'Past event',
        targetDate: effectiveDate,
        recordedAt,
        sentiment: moodScoreToSentiment(entry.analysis?.mood_score),
        confidence: entry.temporalContext?.confidence || 0.7,
        originalPhrase: entry.temporalContext?.originalPhrase || entry.text?.substring(0, 100),
        status: 'verified' // Treat existing data as verified
      });
    }
  }

  // 2. Convert futureMentions to plan signals
  if (entry.futureMentions && Array.isArray(entry.futureMentions)) {
    for (const mention of entry.futureMentions) {
      const targetDate = mention.targetDate instanceof Date
        ? mention.targetDate
        : mention.targetDate?.toDate?.() || null;

      if (targetDate) {
        signals.push({
          type: 'plan',
          content: mention.event || 'Planned event',
          targetDate,
          recordedAt,
          sentiment: mention.sentiment || 'neutral',
          confidence: mention.confidence || 0.7,
          originalPhrase: mention.phrase || '',
          status: 'verified', // Treat existing data as verified
          isRecurringInstance: mention.isRecurring || false,
          recurringPattern: mention.recurringPattern || null
        });
      }
    }
  }

  // 3. Save signals if any were generated
  if (signals.length > 0) {
    try {
      await saveSignalsWithVersionCheck(signals, entryId, userId, 1);
    } catch (error) {
      console.error(`Failed to save signals for entry ${entryId}:`, error);
      return { migrated: false, signalCount: 0, reason: 'save_failed', error: error.message };
    }
  }

  // 4. Mark entry as migrated
  try {
    const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries', entryId);
    await updateDoc(entryRef, {
      signalExtractionVersion: 1,
      migratedToSignals: true,
      migrationDate: Timestamp.now()
    });
  } catch (error) {
    console.error(`Failed to update entry ${entryId}:`, error);
    return { migrated: false, signalCount: signals.length, reason: 'update_failed', error: error.message };
  }

  return { migrated: true, signalCount: signals.length };
};

/**
 * Migrate all entries for a user
 *
 * @param {string} userId - User ID
 * @param {Function} onProgress - Progress callback (processed, total, current)
 * @returns {Promise<{total: number, migrated: number, signalCount: number, errors: number}>}
 */
export const migrateUserEntries = async (userId, onProgress = null) => {
  const entriesRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries');

  // Query entries that haven't been migrated yet
  const q = query(entriesRef);
  const snapshot = await getDocs(q);

  const entries = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const total = entries.length;

  let migrated = 0;
  let signalCount = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    try {
      const result = await migrateEntryToSignals(entry, userId);

      if (result.migrated) {
        migrated++;
        signalCount += result.signalCount;
      } else if (result.reason === 'already_migrated') {
        skipped++;
      } else {
        errors++;
      }
    } catch (error) {
      console.error(`Error migrating entry ${entry.id}:`, error);
      errors++;
    }

    if (onProgress) {
      onProgress(i + 1, total, entry);
    }

    // Small delay to avoid overwhelming Firestore
    if (i > 0 && i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return {
    total,
    migrated,
    skipped,
    signalCount,
    errors
  };
};

/**
 * Check migration status for a user
 *
 * @param {string} userId - User ID
 * @returns {Promise<{total: number, migrated: number, pending: number}>}
 */
export const checkMigrationStatus = async (userId) => {
  const entriesRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries');
  const snapshot = await getDocs(entriesRef);

  let migrated = 0;
  let pending = 0;

  snapshot.docs.forEach(d => {
    const data = d.data();
    if (data.signalExtractionVersion >= 1) {
      migrated++;
    } else {
      pending++;
    }
  });

  return {
    total: snapshot.size,
    migrated,
    pending
  };
};

export default {
  migrateEntryToSignals,
  migrateUserEntries,
  checkMigrationStatus
};
