/**
 * entryCorrectionFields — user-correction invalidation (plan task C4).
 *
 * When a user edits an entry's text after analysis has already run, the
 * previously-computed derived data (mood, tags, insight, goal_update, ...) is
 * now stale. `handleEntryUpdate` (App.jsx) already bumps
 * `signalExtractionVersion` on a meaningful text change; this module adds the
 * fields the server-side re-analysis pipeline keys off of:
 *
 *   - `entryInputVersion` (increment(1)): the server `onEntryUpdate` trigger
 *     (functions/index.js) compares `after.entryInputVersion >
 *     before.entryInputVersion` to decide whether to re-run
 *     `runEntryAnalysis` (functions/src/analysis/orchestrator.js). A
 *     Firestore `increment()` sentinel (not a read-then-write) so concurrent
 *     edits still each bump exactly once.
 *   - `analysisStatus: 'pending'`: mirrors the initial-save state so the UI
 *     (EntryCard) shows the existing "analyzing" affordance while recompute
 *     is in flight.
 *   - `enrichment.status: 'stale'`: marks optional enrichment (health/
 *     environment/temporal) as needing a refresh too — mirrors the
 *     core-first save envelope shape (buildCoreEntry.js).
 *
 * Extracted as pure functions (rather than left inline in App.jsx, which is
 * otherwise untested) so both branches — meaningful edit vs. no-op — have
 * direct unit coverage without mounting the app.
 */

/**
 * Pure, side-effect-free text-diff heuristic: is `newText` different enough
 * from `oldText` to justify re-extraction (not just a typo/punctuation fix)?
 * Moved verbatim from the former App.jsx `hasTextMeaningfullyChanged`
 * useCallback — same normalization + word-delta algorithm.
 */
export function hasTextMeaningfullyChanged(oldText, newText) {
  if (!oldText || !newText) return true;

  // Normalize: lowercase, collapse whitespace, remove punctuation
  const normalize = (text) => text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')  // Remove punctuation
    .replace(/\s+/g, ' ')       // Collapse whitespace
    .trim();

  const oldNorm = normalize(oldText);
  const newNorm = normalize(newText);

  // Exact match after normalization = no meaningful change
  if (oldNorm === newNorm) return false;

  // Calculate word-level difference
  const oldWords = oldNorm.split(' ').filter(w => w.length > 0);
  const newWords = newNorm.split(' ').filter(w => w.length > 0);

  // If word counts differ by more than 2, meaningful
  if (Math.abs(oldWords.length - newWords.length) > 2) return true;

  // Count words that are different
  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);
  const addedWords = [...newSet].filter(w => !oldSet.has(w));
  const removedWords = [...oldSet].filter(w => !newSet.has(w));

  // More than 2 words added or removed = meaningful
  return (addedWords.length + removedWords.length) > 2;
}

/**
 * The fields a meaningful text edit stamps onto the entry, in ADDITION to
 * the pre-existing `signalExtractionVersion` bump. Never touches
 * `rawTranscript`/`transcription` — those are capture-time provenance and
 * must survive corrections untouched.
 *
 * @param {object} args
 * @param {number} args.nextSignalExtractionVersion - The already-computed
 *   next signalExtractionVersion (current + 1).
 * @param {Function} args.increment - Firestore `increment` sentinel factory
 *   (injected for testability; App.jsx passes the real one from
 *   `./config/firebase`).
 */
export function buildMeaningfulEditFields({ nextSignalExtractionVersion, increment }) {
  return {
    signalExtractionVersion: nextSignalExtractionVersion,
    entryInputVersion: increment(1),
    analysisStatus: 'pending',
    'enrichment.status': 'stale',
  };
}

export default { hasTextMeaningfullyChanged, buildMeaningfulEditFields };
