/**
 * Offline Sync Payload
 *
 * Pure construction of the Firestore payload written when a queued offline
 * entry drains to the server (see App.jsx's sync `saveEntry` closure, which
 * calls this before `setDoc`). Extracted so the payload shape — including
 * the Context Space `spaceId` passthrough — can be unit tested without
 * standing up Firestore/auth.
 */

import { Timestamp } from 'firebase/firestore';
import { removeUndefined } from '../../utils/string';

/**
 * Build the Firestore-ready payload for a synced offline entry.
 *
 * @param {Object} entryData - Queued offline entry data
 * @returns {Object} Payload ready to pass to setDoc (undefined keys stripped)
 */
export const buildOfflineSyncPayload = (entryData) => {
  const createdAtDate = entryData.createdAt ? new Date(entryData.createdAt) : new Date();
  const effectiveDate = entryData.effectiveDate ? new Date(entryData.effectiveDate) : createdAtDate;
  const aiConsent = entryData.aiProcessingConsent !== false;

  return removeUndefined({
    text: entryData.text,
    category: entryData.category || undefined,
    // Context Space (flag: contextSpaces) — carried through from the
    // offline-queued record (offlineManager.queueEntry now preserves
    // it). removeUndefined strips this when absent, same no-null-
    // stuffing convention as buildCoreEntry.js:106-111 on the online
    // path. Without this line, an entry captured offline with a
    // selected Space synced unscoped — this was the known R1 blocker.
    spaceId: entryData.spaceId || undefined,
    createdAt: Timestamp.fromDate(createdAtDate),
    effectiveDate: Timestamp.fromDate(effectiveDate),
    analysisStatus: aiConsent ? 'pending' : 'disabled',
    aiProcessingConsent: aiConsent,
    signalExtractionVersion: 1,
    createdOnPlatform: entryData.platform || undefined,
    syncedFromOffline: true,
    offlineId: entryData.offlineId || undefined,
    localAnalysis: entryData.localAnalysis || undefined,
    healthContext: entryData.healthContext || undefined,
    environmentContext: entryData.environmentContext || undefined,
    voiceTone: entryData.voiceTone || undefined,
    transcription: entryData.transcription || undefined,
    safety_flagged: entryData.safety_flagged || undefined,
    safety_user_response: entryData.safety_user_response || undefined,
    has_warning_indicators: entryData.has_warning_indicators || undefined,
  });
};

export default buildOfflineSyncPayload;
