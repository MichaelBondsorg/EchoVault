import { useState, useEffect, useRef, useCallback } from 'react';
import { Card } from '../cloud';
import { getFlag } from '../../config/flags';
import { db } from '../../config/firebase';
import { useUser } from '../../stores';
import {
  subscribeRecentActiveIntents,
  dismissIntent,
  setIntentUserText,
} from '../../services/intents/intentClient';

const AUTO_DISMISS_MS = 6000;
// Safety net for an abandoned edit (user taps Edit and walks away): revert
// to the confirm view without saving partial text, then let the normal
// auto-dismiss flow resume from that point.
const EDIT_ABANDON_MS = 30000;

/** Display text: userText (user-edited) wins over the raw source span. */
function captureText(intent) {
  return intent.userText || intent.sourceSpan?.text || '';
}

/**
 * CapturedToast - non-blocking "Captured" confirmation row (PRD 0B, plan
 * task R1-7).
 *
 * Mounts always; renders null unless `intentExtraction` is on. Subscribes to
 * the newest active intents (subscribeRecentActiveIntents) and surfaces only
 * "session-new" ones — created strictly after this component mounted — so a
 * page load never dredges up old intents. Session-seen ids are tracked in a
 * ref so a Firestore snapshot refire (e.g. an unrelated field changing on an
 * already-shown intent) never re-shows it.
 *
 * One row at a time: additional session-new intents queue FIFO (oldest
 * capture first) and appear after the current one resolves — via Undo
 * (dismissIntent), Edit (inline input -> setIntentUserText or Cancel to
 * revert), or a 6s auto-dismiss timer that clears on unmount/interaction.
 * Entering Edit swaps the 6s auto-dismiss for a 30s abandonment safety net:
 * if the user taps Edit and never confirms/cancels, the edit reverts on its
 * own (partial text is never saved) and the normal 6s flow resumes from
 * there, so the row/queue can never stall indefinitely.
 *
 * Non-modal: no backdrop, fixed to the bottom above the tab bar, and the
 * wrapper is `pointer-events-none` so it never intercepts clicks outside its
 * own card — never blocks the EntryBar/composer.
 *
 * INT-02 part 2 item 2 (same pattern as IntentSuggestionTray, part 1): Undo
 * (dismissIntent) and Edit-Save (setIntentUserText) are removed
 * optimistically for a snappy feel, but the underlying mutation is now
 * awaited. On success the optimistic advance simply stands. On failure the
 * item is restored to the FRONT of the queue (so it becomes `current`
 * again) and a quiet, non-alarming inline message appears — same amber/
 * honey tone as IntentSuggestionTray/PendingAudioBanner, never red. Its
 * `versions` field (INT-02 item 1) is passed through to dismissIntent so
 * the paired decision doc carries the intent's model/policy snapshot.
 */
const CapturedToast = () => {
  const flagOn = getFlag('intentExtraction');
  const user = useUser();
  const uid = user?.uid;

  // Captured once, at first render — everything created at or before this
  // instant is "pre-existing", not session-new.
  const mountedAtRef = useRef(new Date().toISOString());
  const seenIdsRef = useRef(new Set());
  const timerRef = useRef(null);

  const [queue, setQueue] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  // INT-02 item 2: id currently mid-mutation (guards a re-entrant call for
  // the same item) and the id currently showing the quiet failure message.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [errorId, setErrorId] = useState(null);

  const current = queue[0] || null;

  useEffect(() => {
    if (!flagOn || !uid) return undefined;
    const unsubscribe = subscribeRecentActiveIntents(
      db,
      uid,
      (intents) => {
        const mountedAtIso = mountedAtRef.current;
        const fresh = intents.filter((intent) => {
          if (seenIdsRef.current.has(intent.id)) return false;
          if (!(intent.createdAt > mountedAtIso)) return false;
          return true;
        });
        if (fresh.length === 0) return;
        fresh.forEach((intent) => seenIdsRef.current.add(intent.id));
        // FIFO by creation time: earliest capture surfaces first, even
        // though the underlying query is newest-first.
        const sorted = [...fresh].sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1));
        setQueue((prev) => [...prev, ...sorted]);
      },
      () => {},
    );
    return unsubscribe;
  }, [flagOn, uid]);

  const clearAutoDismiss = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const advance = useCallback(() => {
    clearAutoDismiss();
    setEditing(false);
    setEditText('');
    setQueue((prev) => prev.slice(1));
  }, []);

  /** Revert from the edit view to the confirm view without saving. */
  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditText('');
  }, []);

  const markBusy = (id) => setBusyIds((prev) => new Set(prev).add(id));
  const clearBusy = (id) => setBusyIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  // Re-add `item` to the FRONT of the queue (making it `current` again)
  // after its mutation failed. Guards against a duplicate insert if it
  // somehow already came back.
  const restoreToFront = (item) => {
    setQueue((prev) => (prev.some((q) => q.id === item.id) ? prev : [item, ...prev]));
  };

  /**
   * Advance past `item` optimistically, then await `mutate`. On failure,
   * restore it to the front of the queue and flag the quiet failure state;
   * on success, leave the optimistic advance standing. Marks `item` busy for
   * the duration so a re-entrant call for the same id is blocked.
   */
  const runAction = async (item, mutate) => {
    setErrorId((prev) => (prev === item.id ? null : prev));
    markBusy(item.id);
    advance();
    try {
      await mutate();
    } catch {
      restoreToFront(item);
      setErrorId(item.id);
    } finally {
      clearBusy(item.id);
    }
  };

  // Arms the timer appropriate to the current mode whenever the head-of-queue
  // item or edit mode changes: a 6s auto-dismiss in the confirm view, or a
  // 30s abandonment safety net while editing. Re-running on every `editing`
  // flip means both a manual Cancel and the 30s abandonment timeout itself
  // (which calls cancelEdit) land back on a *fresh* 6s auto-dismiss, armed
  // from that revert point rather than any leftover budget.
  useEffect(() => {
    if (!current) return undefined;
    clearAutoDismiss();
    timerRef.current = setTimeout(editing ? cancelEdit : advance, editing ? EDIT_ABANDON_MS : AUTO_DISMISS_MS);
    return clearAutoDismiss;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, editing, advance, cancelEdit]);

  const handleUndo = () => {
    if (!uid || !current || busyIds.has(current.id)) return;
    runAction(current, () => dismissIntent(db, uid, current.id, null, current.versions));
  };

  const handleEditStart = () => {
    setEditText(captureText(current));
    setEditing(true);
  };

  const handleEditConfirm = () => {
    if (!uid || !current || busyIds.has(current.id)) return;
    const text = editText;
    const item = current;
    runAction({ ...item, userText: text }, () => setIntentUserText(db, uid, item.id, text));
  };

  if (!flagOn) return null;
  if (!current) return null;

  const busy = busyIds.has(current.id);

  return (
    <div className="fixed bottom-24 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
      <Card className="pointer-events-auto flex w-full max-w-md flex-col gap-1 px-4 py-3">
        <div className="flex items-center gap-3">
          {editing ? (
            <>
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                aria-label="Edit captured text"
                className="min-w-0 flex-1 border-b border-border bg-transparent text-sm text-foreground outline-none"
              />
              <button
                type="button"
                onClick={handleEditConfirm}
                disabled={busy}
                className="shrink-0 text-sm font-medium text-accent-deep disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={busy}
                className="shrink-0 text-sm font-medium text-muted-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <p className="min-w-0 flex-1 truncate text-sm text-foreground">
                Captured: {captureText(current)}
              </p>
              <button
                type="button"
                onClick={handleUndo}
                disabled={busy}
                className="shrink-0 text-sm font-medium text-accent-deep disabled:opacity-50"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={handleEditStart}
                disabled={busy}
                className="shrink-0 text-sm font-medium text-muted-foreground disabled:opacity-50"
              >
                Edit
              </button>
            </>
          )}
        </div>
        {errorId === current.id && (
          <p className="text-xs text-honey-700 dark:text-honey-300">
            Couldn&apos;t save that — try again.
          </p>
        )}
      </Card>
    </div>
  );
};

export default CapturedToast;
