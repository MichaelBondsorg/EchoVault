/**
 * pendingEntryCleanup (watchdog) guards.
 *
 * The watchdog sweeps entries stuck in analysisStatus:'pending' by
 * `createdAt` age. An edited entry's `createdAt` is its ORIGINAL creation
 * date, not the edit time — so a meaningfully-edited entry (entryInputVersion
 * bumped past 1, see plan task C4 / services/entries/entryCorrectionFields.js)
 * looks "stuck" to the sweep on the very next run, even when it's actually
 * mid-flight or (with the server orchestrator flag off) was never meant to
 * be re-analyzed at all.
 *
 * With `serverAnalysisOrchestrator` OFF, the pre-C4 codebase never
 * re-analyzed an edit — only the one-shot client chain ran, once, at
 * entryInputVersion 1. Letting the watchdog's REDUCED legacy inline path
 * (classify+analyze only, functions/index.js pendingEntryCleanup) run on an
 * edited entry would overwrite title/tags/mood while leaving stale
 * goal_update/contextualInsight/extracted_tasks behind — an internally
 * inconsistent doc, plus unplanned Gemini spend, and a behavior change from
 * the pre-C4 "flag off = no re-analysis on edit" status quo.
 *
 * With the flag ON, the orchestrator routing in pendingEntryCleanup already
 * handles versions correctly (runEntryAnalysis's stale-version guard) — no
 * skip needed there.
 */
import { getServerFlag } from '../shared/flags.js';

/**
 * @param {object} db - Firestore instance (admin SDK).
 * @param {object} data - The entry document data (as read by the watchdog).
 * @returns {Promise<boolean>} true if the watchdog must skip this entry
 *   entirely (no lease, not counted as failed).
 */
export async function shouldWatchdogSkipEditedEntry(db, data) {
  const isEditedEntry = (data?.entryInputVersion ?? 0) > 1;
  if (!isEditedEntry) return false;
  return !(await getServerFlag(db, 'serverAnalysisOrchestrator', false));
}

export default { shouldWatchdogSkipEditedEntry };
