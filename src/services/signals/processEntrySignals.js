/**
 * Process Entry Signals Service
 *
 * Orchestrates the extraction and saving of signals from journal entries.
 * This is the main entry point for signal processing.
 *
 * Key features:
 * - Extracts signals using AI
 * - Expands recurring patterns into discrete signal documents
 * - Saves signals with version checking
 * - Handles race conditions from rapid edits
 */

import { extractSignals } from './signalExtractor';
import { saveSignalsWithVersionCheck, deleteSignalsForEntry } from './index';
import { generateRecurringSignals, isRecurringPattern } from './recurringGenerator';
import { db, doc, getDoc } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

/**
 * Get the current extraction version for an entry
 */
const getEntryExtractionVersion = async (entryId, userId) => {
  const entryRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'entries', entryId);
  const entrySnap = await getDoc(entryRef);

  if (!entrySnap.exists()) {
    return null;
  }

  return entrySnap.data().signalExtractionVersion || 0;
};

/**
 * Process signals for a journal entry
 *
 * This function:
 * 1. Extracts signals from entry text using AI
 * 2. Expands any recurring patterns into discrete signals
 * 3. Checks for race conditions (entry edited during extraction)
 * 4. Saves signals to Firestore
 *
 * @param {Object} entry - The entry object with id, text, userId
 * @param {string} text - The entry text
 * @param {number} extractionVersion - The extraction version when this was triggered
 * @returns {Promise<{signals: Array, hasTemporalContent: boolean, stale: boolean}>}
 */
export const processEntrySignals = async (entry, text, extractionVersion) => {
  const userId = entry.userId || entry.uid;
  const entryId = entry.id;

  console.log(`Processing signals for entry ${entryId} (version ${extractionVersion})`);

  try {
    // Extract signals from text
    const { signals: rawSignals, hasTemporalContent, reasoning } = await extractSignals(text);

    if (rawSignals.length === 0) {
      console.log('No signals extracted from entry');
      return { signals: [], hasTemporalContent: false, stale: false, reasoning };
    }

    // Expand recurring patterns into discrete signals
    const expandedSignals = [];
    for (const signal of rawSignals) {
      if (signal.recurringPattern && isRecurringPattern(signal.recurringPattern)) {
        // Generate multiple instances for recurring events
        const recurringInstances = generateRecurringSignals(
          signal.recurringPattern,
          signal,
          new Date()
        );
        expandedSignals.push(...recurringInstances);
      } else {
        expandedSignals.push(signal);
      }
    }

    // Check if entry was edited while we were processing (race condition)
    const currentVersion = await getEntryExtractionVersion(entryId, userId);
    if (currentVersion !== null && currentVersion !== extractionVersion) {
      console.log(`Entry ${entryId} was edited during extraction (current: ${currentVersion}, expected: ${extractionVersion}), discarding stale results`);
      return { signals: [], hasTemporalContent: false, stale: true, reasoning: 'Stale extraction discarded' };
    }

    // Save signals to Firestore
    const savedIds = await saveSignalsWithVersionCheck(
      expandedSignals,
      entryId,
      userId,
      extractionVersion
    );

    console.log(`Saved ${savedIds.length} signals for entry ${entryId}`);

    // Return signals with their IDs for UI
    const signalsWithIds = expandedSignals.map((sig, i) => ({
      ...sig,
      id: savedIds[i]
    }));

    return {
      signals: signalsWithIds,
      hasTemporalContent,
      stale: false,
      reasoning
    };

  } catch (error) {
    console.error(`Error processing signals for entry ${entryId}:`, error);
    return {
      signals: [],
      hasTemporalContent: false,
      stale: false,
      error: error.message
    };
  }
};

/**
 * Re-process signals after an entry edit (wipe and replace)
 *
 * @param {string} entryId - The entry ID
 * @param {string} newText - The updated entry text
 * @param {string} userId - The user ID
 * @param {number} newVersion - The new extraction version
 * @returns {Promise<{signals: Array, hasTemporalContent: boolean}>}
 */
export const reprocessSignalsOnEdit = async (entryId, newText, userId, newVersion) => {
  console.log(`Re-processing signals for edited entry ${entryId} (new version ${newVersion})`);

  // Delete existing signals for this entry
  await deleteSignalsForEntry(entryId, userId);

  // Extract and save new signals
  const result = await processEntrySignals(
    { id: entryId, userId },
    newText,
    newVersion
  );

  return result;
};

export default {
  processEntrySignals,
  reprocessSignalsOnEdit
};
