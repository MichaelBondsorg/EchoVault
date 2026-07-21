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
 * (dismissIntent), Edit (inline input -> setIntentUserText), or a 6s
 * auto-dismiss timer that clears on unmount/interaction.
 *
 * Non-modal: no backdrop, fixed to the bottom above the tab bar, and the
 * wrapper is `pointer-events-none` so it never intercepts clicks outside its
 * own card — never blocks the EntryBar/composer.
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

  useEffect(() => {
    if (!current) return undefined;
    timerRef.current = setTimeout(advance, AUTO_DISMISS_MS);
    return clearAutoDismiss;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, advance]);

  const handleUndo = () => {
    if (uid && current) dismissIntent(db, uid, current.id);
    advance();
  };

  const handleEditStart = () => {
    clearAutoDismiss();
    setEditText(captureText(current));
    setEditing(true);
  };

  const handleEditConfirm = () => {
    if (uid && current) setIntentUserText(db, uid, current.id, editText);
    advance();
  };

  if (!flagOn) return null;
  if (!current) return null;

  return (
    <div className="fixed bottom-24 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
      <Card className="pointer-events-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
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
              className="shrink-0 text-sm font-medium text-accent-deep"
            >
              Save
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
              className="shrink-0 text-sm font-medium text-accent-deep"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={handleEditStart}
              className="shrink-0 text-sm font-medium text-muted-foreground"
            >
              Edit
            </button>
          </>
        )}
      </Card>
    </div>
  );
};

export default CapturedToast;
