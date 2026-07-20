/**
 * Correction invalidation (plan task C4): re-run analysis when a user edits
 * an entry's text after it was already analysed.
 *
 * The client (App.jsx handleEntryUpdate) bumps `entryInputVersion` via a
 * Firestore `increment()` sentinel on any meaningful text edit. This module
 * is the server-side reaction, called from the `onEntryUpdate` trigger
 * (functions/index.js):
 *
 *   after.entryInputVersion > before.entryInputVersion
 *     -> server flag `serverAnalysisOrchestrator` on
 *       -> claim a PER-VERSION dedup marker (a redelivered update event for
 *          the same version must not re-run analysis twice, but a second,
 *          later edit — a new version — must)
 *         -> runEntryAnalysis (functions/src/analysis/orchestrator.js),
 *            which re-checks consent per stage and discards + re-enqueues if
 *            the version drifts again mid-run (existing stale-version guard).
 *
 * Never touches rawTranscript/transcription: runEntryAnalysis's publish only
 * writes analysis-derived fields (see orchestrator.js buildSuccessPayload /
 * buildFailedPayload), so capture-time provenance survives corrections
 * untouched.
 */
import { claimProcessingMarkerForVersion } from './idempotency.js';
import { runEntryAnalysis } from '../analysis/orchestrator.js';
import { getServerFlag } from '../shared/flags.js';

/**
 * @param {object} args
 * @param {object} args.db - Firestore instance (admin SDK).
 * @param {object} args.entryRef - DocumentReference for the entry.
 * @param {string} args.entryId
 * @param {object} args.before - Entry data before the update.
 * @param {object} args.after - Entry data after the update.
 * @param {object} args.apiKeys - { gemini, openai } resolved secret values.
 * @param {Function} args.logStage - Stage telemetry logger.
 * @returns {Promise<{skipped:true, reason:string}|{reanalyzed:true, outcome:string}>}
 */
export async function maybeReanalyzeOnEntryUpdate({ db, entryRef, entryId, before, after, apiKeys, logStage }) {
  const beforeVersion = before?.entryInputVersion ?? 0;
  const afterVersion = after?.entryInputVersion ?? 0;

  // Only a genuine version increase (a correction) is a re-analysis trigger.
  // Guards against no-op writes and out-of-order/duplicate delivery where
  // `after` could equal or trail `before`.
  if (!(afterVersion > beforeVersion)) {
    return { skipped: true, reason: 'no-version-increase' };
  }

  // Flag gate: default OFF. Client remains authoritative until this is enabled.
  if (!(await getServerFlag(db, 'serverAnalysisOrchestrator', false))) {
    return { skipped: true, reason: 'flag-off' };
  }

  // At-least-once delivery: claim a PER-VERSION marker so a redelivered
  // update event for the SAME version doesn't run analysis twice, while a
  // later edit (a NEW version) can still claim and re-run.
  const claimed = await claimProcessingMarkerForVersion(
    db,
    entryRef,
    'processing.analysisStartedForVersion',
    afterVersion
  );
  if (!claimed) {
    return { skipped: true, reason: 'already-processing-version' };
  }

  const entry = { id: entryId, ...after, entryInputVersion: afterVersion };
  const result = await runEntryAnalysis({ db, entryRef, entry, apiKeys, logStage });
  return { reanalyzed: true, outcome: result.outcome };
}

export default { maybeReanalyzeOnEntryUpdate };
