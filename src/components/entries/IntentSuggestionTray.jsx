import { useEffect, useState } from 'react';
import { Chip } from '../cloud';
import { getFlag } from '../../config/flags';
import { db } from '../../config/firebase';
import { useUser } from '../../stores';
import {
  subscribeSuggestedIntentsForEntry,
  keepIntent,
  dismissIntent,
  setIntentUserText,
} from '../../services/intents/intentClient';

/** Intent display text: userText (user-edited) wins over the raw source span. */
function displayText(suggestion) {
  return suggestion.userText || suggestion.sourceSpan?.text || '';
}

/** Row label per kind — plain, non-presumptive copy (no guilt/urgency language). */
function rowLabel(kind) {
  return kind === 'open_loop' ? 'Revisit this?' : 'Possible task';
}

/**
 * IntentSuggestionTray - per-entry surface for `state: 'suggested'` intents
 * extracted from a single journal entry (PRD 0B / plan R1 Task 6).
 *
 * This is the ONLY place suggested-state intents are ever shown to the user —
 * widgets, reports, and notifications only ever surface `active` intents.
 * Each row offers three quiet, non-fanfare actions: Keep (suggested ->
 * active, verbatim), Edit (inline text edit, then suggested -> active with
 * the edited text persisted first), and No thanks (dismissed).
 *
 * Gating: renders null unless `intentExtraction` is on. Within that, `task`
 * suggestions always show; `open_loop` suggestions additionally require the
 * `openLoops` flag. Renders null once there is nothing left to show (either
 * because the subscription is empty, or every suggestion present is a
 * loop and `openLoops` is off).
 *
 * INT-02 (atomic + failure-visible actions): a row is removed optimistically
 * on tap for a snappy feel, but the underlying mutation (keepIntent /
 * dismissIntent / setIntentUserText+keepIntent) is now awaited. On success
 * the optimistic removal simply stands. On failure the row is restored (an
 * edit's typed text is preserved on the restored row so nothing the user
 * typed is lost) and a quiet, non-alarming inline message appears under that
 * row — matching the app's existing quiet-error tone (e.g.
 * PendingAudioBanner's amber/honey banner, never red). While a row's action
 * is in flight its buttons are disabled so a double-tap can't fire the same
 * mutation twice (the thing worth preventing — decisions are an append-only
 * audit, so a genuine double-append is a UI bug, not something the service
 * layer dedups).
 */
const IntentSuggestionTray = ({ entryId }) => {
  const intentExtractionOn = getFlag('intentExtraction');
  const openLoopsOn = getFlag('openLoops');
  const user = useUser();
  const uid = user?.uid;

  const [suggestions, setSuggestions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  // Ids with an action currently in flight (per-row, not global — two rows
  // can be mid-mutation independently) and the row id currently showing the
  // quiet failure state.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [errorId, setErrorId] = useState(null);

  useEffect(() => {
    if (!intentExtractionOn || !uid || !entryId) return undefined;
    const unsubscribe = subscribeSuggestedIntentsForEntry(
      db,
      uid,
      entryId,
      setSuggestions,
      () => setSuggestions([]),
    );
    return unsubscribe;
  }, [intentExtractionOn, uid, entryId]);

  if (!intentExtractionOn) return null;

  const visible = suggestions.filter((s) => s.kind !== 'open_loop' || openLoopsOn);
  if (visible.length === 0) return null;

  const removeLocally = (id) => setSuggestions((prev) => prev.filter((s) => s.id !== id));

  // Re-add a suggestion the optimistic removal already dropped, after its
  // mutation failed. Guards against a duplicate insert if it somehow already
  // came back (e.g. the live subscription refired in the meantime).
  const restoreLocally = (suggestion) => {
    setSuggestions((prev) => (prev.some((s) => s.id === suggestion.id) ? prev : [...prev, suggestion]));
  };

  const markBusy = (id) => setBusyIds((prev) => new Set(prev).add(id));
  const clearBusy = (id) => setBusyIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  /**
   * Remove `suggestion` optimistically, run `mutate` (already db/uid-bound),
   * and await it. On failure, restore the row and flag it with the quiet
   * failure state; on success, leave the optimistic removal standing. Marks
   * the row busy for the duration so its buttons stay disabled — the
   * double-tap/re-entrant-call guard (e.g. a live-subscription refire
   * re-delivering the still-`suggested` doc while the batch commit is still
   * in flight must not be able to trigger a second mutation for the same id).
   */
  const runAction = async (suggestion, mutate) => {
    setErrorId((prev) => (prev === suggestion.id ? null : prev));
    markBusy(suggestion.id);
    removeLocally(suggestion.id);
    try {
      await mutate();
    } catch {
      restoreLocally(suggestion);
      setErrorId(suggestion.id);
    } finally {
      clearBusy(suggestion.id);
    }
  };

  const handleKeep = (suggestion) => {
    if (!uid || busyIds.has(suggestion.id)) return;
    runAction(suggestion, () => keepIntent(db, uid, suggestion.id));
  };

  const handleDismiss = (suggestion) => {
    if (!uid || busyIds.has(suggestion.id)) return;
    runAction(suggestion, () => dismissIntent(db, uid, suggestion.id));
  };

  const startEdit = (suggestion) => {
    setEditingId(suggestion.id);
    setEditText(displayText(suggestion));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const confirmEdit = (suggestion) => {
    if (!uid || busyIds.has(suggestion.id)) return;
    const text = editText;
    setEditingId(null);
    setEditText('');
    // setIntentUserText must land before keepIntent (persist the edited text
    // before the suggested->active transition). If either step fails, the
    // row is restored WITH the text the user just typed (so a retry doesn't
    // need to be re-typed), even though it was never persisted.
    runAction({ ...suggestion, userText: text }, async () => {
      await setIntentUserText(db, uid, suggestion.id, text);
      await keepIntent(db, uid, suggestion.id);
    });
  };

  return (
    <div className="mt-4 pt-3 border-t border-divider space-y-2">
      {visible.map((suggestion) => {
        const busy = busyIds.has(suggestion.id);
        return (
          <div key={suggestion.id}>
            <div className="flex items-start justify-between gap-2">
              {editingId === suggestion.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="min-h-11 flex-1 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => confirmEdit(suggestion)}
                    disabled={busy}
                    className="min-h-11 px-2 text-xs font-semibold text-accent-deep disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={busy}
                    className="min-h-11 px-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <Chip className="mb-1 text-[10px]">{rowLabel(suggestion.kind)}</Chip>
                    <p className="text-sm text-foreground truncate">{displayText(suggestion)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-none">
                    <button
                      type="button"
                      onClick={() => handleKeep(suggestion)}
                      disabled={busy}
                      className="min-h-11 px-2 text-xs font-semibold text-accent-deep disabled:opacity-50"
                    >
                      Keep
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(suggestion)}
                      disabled={busy}
                      className="min-h-11 px-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDismiss(suggestion)}
                      disabled={busy}
                      className="min-h-11 px-2 text-xs text-faint disabled:opacity-50"
                    >
                      No thanks
                    </button>
                  </div>
                </>
              )}
            </div>
            {errorId === suggestion.id && (
              <p className="mt-1 text-xs text-honey-700 dark:text-honey-300">
                Couldn&apos;t save that — try again.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default IntentSuggestionTray;
