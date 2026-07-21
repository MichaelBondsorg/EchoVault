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
 */
const IntentSuggestionTray = ({ entryId }) => {
  const intentExtractionOn = getFlag('intentExtraction');
  const openLoopsOn = getFlag('openLoops');
  const user = useUser();
  const uid = user?.uid;

  const [suggestions, setSuggestions] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

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

  const handleKeep = (id) => {
    if (!uid) return;
    keepIntent(db, uid, id);
    removeLocally(id);
  };

  const handleDismiss = (id) => {
    if (!uid) return;
    dismissIntent(db, uid, id);
    removeLocally(id);
  };

  const startEdit = (suggestion) => {
    setEditingId(suggestion.id);
    setEditText(displayText(suggestion));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const confirmEdit = (id) => {
    if (!uid) return;
    // setIntentUserText must land before keepIntent (persist the edited text
    // before the suggested->active transition), but the UI updates
    // optimistically and synchronously — no need to block the click handler
    // on the write round-trip.
    setIntentUserText(db, uid, id, editText).then(() => keepIntent(db, uid, id));
    setEditingId(null);
    setEditText('');
    removeLocally(id);
  };

  return (
    <div className="mt-4 pt-3 border-t border-divider space-y-2">
      {visible.map((suggestion) => (
        <div key={suggestion.id} className="flex items-start justify-between gap-2">
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
                onClick={() => confirmEdit(suggestion.id)}
                className="min-h-11 px-2 text-xs font-semibold text-accent-deep"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="min-h-11 px-2 text-xs font-semibold text-muted-foreground"
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
                  onClick={() => handleKeep(suggestion.id)}
                  className="min-h-11 px-2 text-xs font-semibold text-accent-deep"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(suggestion)}
                  className="min-h-11 px-2 text-xs font-semibold text-muted-foreground"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDismiss(suggestion.id)}
                  className="min-h-11 px-2 text-xs text-faint"
                >
                  No thanks
                </button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

export default IntentSuggestionTray;
