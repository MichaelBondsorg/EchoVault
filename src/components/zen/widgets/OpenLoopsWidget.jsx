import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, MessageSquare, Check, X, ChevronDown } from 'lucide-react';
import GlassCard from '../GlassCard';
import { Chip } from '../../cloud';
import { getFlag } from '../../../config/flags';
import { db } from '../../../config/firebase';
import { useUser } from '../../../stores';
import {
  subscribeDueOpenLoops,
  subscribeUpcomingOpenLoops,
  snoozeLoop,
  answerLoop,
  closeLoop,
  dismissIntent,
} from '../../../services/intents/intentClient';
import { useFreshnessTick } from '../../../hooks/useFreshnessTick';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Intent display text: userText (user-edited) wins over the raw source span. */
function loopText(loop) {
  return loop.userText || loop.sourceSpan?.text || '';
}

/**
 * Neutral, plain-language "since when" phrasing for a due loop. No urgency,
 * no guilt copy — just a factual anchor ("since Friday", "since Jan 1").
 * `now` is injectable for testing; defaults to the real current time.
 *
 * @param {string} targetAtIso
 * @param {Date} [now]
 * @returns {string}
 */
export function formatDueSince(targetAtIso, now = new Date()) {
  const target = new Date(targetAtIso);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(target)) / 86400000);

  if (diffDays <= 0) return 'since today';
  if (diffDays === 1) return 'since yesterday';
  if (diffDays < 7) return `since ${DAY_NAMES[target.getDay()]}`;
  return `since ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/** Plain calendar-date label for the read-only upcoming list. */
function formatUpcomingDate(targetAtIso) {
  return new Date(targetAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SNOOZE_OPTIONS = [
  { key: 'tonight', label: 'Tonight' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'next week', label: 'Next week' },
];

/**
 * Compute the target ISO instant for a snooze option, local time.
 * `now` is injectable for testing; defaults to the real current time.
 *
 * 'tonight' rolls to tomorrow 20:00 if it's already past 20:00 local —
 * otherwise "tonight" would resolve to a past instant, which
 * `subscribeDueOpenLoops` treats as already-elapsed (`snoozedUntil <= now`),
 * so the loop would just reappear immediately instead of being snoozed.
 */
export function snoozeUntilIso(option, now = new Date()) {
  const d = new Date(now);
  if (option === 'tonight') {
    d.setHours(20, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
  } else if (option === 'tomorrow') {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  } else if (option === 'next week') {
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
  }
  return d.toISOString();
}

// Sentinel strings the composer's save chain (App.jsx's saveEntry/
// doSaveEntry/handleAudioWrapper) is documented to resolve to when a save
// genuinely completed but no real entry id is available on this call —
// never an id, must never be written into `answerEntryId` as if it were one.
const NON_ID_SAVE_SENTINELS = new Set(['saved', 'deferred']);

/**
 * Decide whether an open loop may close, from whatever AppLayout's
 * onVoiceSave/onTextSave wrapper resolved the "Answer" composer save to
 * (see AppLayout.jsx — the actual value EntryComposer's onEntrySaved, and
 * therefore this callback, receives).
 *
 * I1: a loop must NOT close when the answer entry never saved. AppLayout's
 * wrapper reports three outcomes: a real Firestore id string (success —
 * close and link it), the sentinel 'deferred' (saved but no id available on
 * this call — e.g. the documented crisis-deferred flow — close with no
 * linked id), or `false` (save failed or threw — do NOT close). This stays
 * defensive against the legacy 'saved' sentinel too, and treats anything
 * else unrecognized (undefined, null, thrown-away values) the same as
 * `false` — fail safe, never close on an outcome we don't understand.
 *
 * @param {string|'deferred'|false|null|undefined} savedResult
 * @returns {{shouldClose: boolean, entryId: string|null}}
 */
function resolveAnswerOutcome(savedResult) {
  if (typeof savedResult === 'string' && !NON_ID_SAVE_SENTINELS.has(savedResult)) {
    return { shouldClose: true, entryId: savedResult };
  }
  if (savedResult === 'deferred' || savedResult === 'saved') {
    return { shouldClose: true, entryId: null };
  }
  // false, undefined, null, or anything else unrecognized: fail safe — do
  // NOT close the loop.
  return { shouldClose: false, entryId: null };
}

/**
 * OpenLoopsWidget - Due open-loop surface for the Bento dashboard.
 *
 * Shows up to 3 due open-loop intents (subscribeDueOpenLoops), each with
 * neutral due phrasing and four actions: Answer (opens the capture composer
 * with a quiet context chip via `onAnswerLoop`, then closes the loop — with
 * the saved entry id when one is available — only if the answer entry
 * actually saved; a save failure leaves the loop due, see
 * `resolveAnswerOutcome`), Snooze (tonight/tomorrow/next week), Close, and
 * Dismiss ("Don't revisit"). A "+N upcoming" footer expands to a read-only
 * list of not-yet-due loops with dismiss only.
 *
 * Renders nothing (absence is correct, no placeholder) when the
 * `openLoops`/`intentExtraction` flags are off, or when there are no due
 * loops. In-app only — no notification code here.
 *
 * Both the due AND upcoming subscriptions' `now` boundary is captured once at
 * subscribe time (see `subscribeDueOpenLoops`/`subscribeUpcomingOpenLoops`);
 * the shared `refreshNonce` (from `useFreshnessTick`) re-keys BOTH effects on
 * document visibility (foregrounding) and every 5 minutes while visible, so a
 * loop that crosses its `targetAt` while the app stays open — migrating from
 * upcoming to due — appears/moves without needing a full remount.
 *
 * INT-02 part 2 item 3 (same pattern as IntentSuggestionTray/CapturedToast):
 * snooze/close/dismiss remove a row optimistically, but the underlying
 * intentClient batched mutation is now awaited; on failure the row is
 * restored and a quiet, non-alarming inline message appears under it. Answer
 * never removed the row optimistically to begin with (the live subscription
 * naturally drops it once the batch commits), so it just surfaces the same
 * quiet failure message on the still-visible row if `answerLoop` rejects.
 * Since this widget can show several loops at once, busy/error state is
 * tracked per-id (`busyIds`/`errorIds`, both Sets) rather than a single
 * scalar — one row's in-flight action must never disable or flag another
 * row. Each mutation also forwards the loop's own `versions` field (INT-02
 * item 1) so the paired decision doc carries its model/policy snapshot.
 */
const OpenLoopsWidget = ({
  size = '2x1',
  isEditing = false,
  onDelete,
  onAnswerLoop,
}) => {
  const flagsOn = getFlag('openLoops') && getFlag('intentExtraction');
  const user = useUser();
  const uid = user?.uid;

  const [dueLoops, setDueLoops] = useState([]);
  const [upcomingLoops, setUpcomingLoops] = useState([]);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [snoozeMenuId, setSnoozeMenuId] = useState(null);
  // INT-02 item 3: ids with an action currently in flight, and ids currently
  // showing the quiet failure message — both per-loop, since several loops
  // can be mid-action independently.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [errorIds, setErrorIds] = useState(() => new Set());

  // I2 (+ upcoming-list follow-up): subscribeDueOpenLoops/
  // subscribeUpcomingOpenLoops each bake `now` into their Firestore query at
  // subscribe time and never refresh it — a loop that becomes due (or
  // crosses from upcoming into due) while this widget stays mounted (app
  // left open/backgrounded across midnight, a snooze target passing, etc.)
  // would never move until something else forced a remount. refreshNonce
  // (from the shared `useFreshnessTick` hook) re-keys BOTH subscribe effects
  // below (a fresh onSnapshot listener re-evaluates `now` at creation)
  // whenever the tab/app comes back to the foreground, and every 5 minutes
  // while it stays foregrounded.
  const refreshNonce = useFreshnessTick();

  useEffect(() => {
    if (!flagsOn || !uid) return undefined;
    const unsubscribe = subscribeDueOpenLoops(db, uid, setDueLoops, () => setDueLoops([]));
    return unsubscribe;
  }, [flagsOn, uid, refreshNonce]);

  useEffect(() => {
    if (!flagsOn || !uid) return undefined;
    const unsubscribe = subscribeUpcomingOpenLoops(db, uid, setUpcomingLoops, () => setUpcomingLoops([]));
    return unsubscribe;
  }, [flagsOn, uid, refreshNonce]);

  const removeDueLocally = (id) => {
    setDueLoops((prev) => prev.filter((l) => l.id !== id));
  };

  // Re-add `loop` after its mutation failed. Guards against a duplicate
  // insert if it somehow already came back (e.g. a live subscription refire).
  const restoreDueLocally = (loop) => {
    setDueLoops((prev) => (prev.some((l) => l.id === loop.id) ? prev : [...prev, loop]));
  };

  const restoreUpcomingLocally = (loop) => {
    setUpcomingLoops((prev) => (prev.some((l) => l.id === loop.id) ? prev : [...prev, loop]));
  };

  const markBusy = (id) => setBusyIds((prev) => new Set(prev).add(id));
  const clearBusy = (id) => setBusyIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });
  const markError = (id) => setErrorIds((prev) => new Set(prev).add(id));
  const clearError = (id) => setErrorIds((prev) => {
    if (!prev.has(id)) return prev;
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  /**
   * Run `mutate` (already db/uid-bound) for `loop`, awaited. `optimistic`
   * (if given) runs synchronously first for a snappy feel; on failure
   * `restore` (if given) re-adds the row and the quiet failure state is
   * flagged; on success nothing further happens. Marks `loop.id` busy for
   * the duration so a re-entrant call for the same row is blocked.
   */
  const runAction = async (loop, mutate, { optimistic, restore } = {}) => {
    clearError(loop.id);
    markBusy(loop.id);
    optimistic?.();
    try {
      await mutate();
    } catch {
      restore?.(loop);
      markError(loop.id);
    } finally {
      clearBusy(loop.id);
    }
  };

  const handleAnswer = (loop) => {
    if (!uid || busyIds.has(loop.id)) return;
    onAnswerLoop?.(loopText(loop), (savedResult) => {
      // I1: only close the loop when the answer entry actually saved (a real
      // id, or the documented "saved with no id available" cases) — a save
      // failure must leave the loop due, with no error UI beyond whatever
      // the save path itself already surfaced (e.g. App.jsx's alert()).
      const { shouldClose, entryId } = resolveAnswerOutcome(savedResult);
      if (!shouldClose) return;
      // No optimistic removal here (never was): the live subscription drops
      // the loop from `dueLoops` once the batch actually commits. On
      // failure the loop is simply still due — the quiet message surfaces
      // on the still-visible row.
      runAction(loop, () => answerLoop(db, uid, loop.id, entryId, loop.versions));
    });
  };

  const handleSnoozeOption = (loop, optionKey) => {
    if (!uid || busyIds.has(loop.id)) return;
    setSnoozeMenuId(null);
    runAction(
      loop,
      () => snoozeLoop(db, uid, loop.id, snoozeUntilIso(optionKey), loop.versions),
      { optimistic: () => removeDueLocally(loop.id), restore: restoreDueLocally },
    );
  };

  const handleClose = (loop) => {
    if (!uid || busyIds.has(loop.id)) return;
    runAction(
      loop,
      () => closeLoop(db, uid, loop.id, loop.versions),
      { optimistic: () => removeDueLocally(loop.id), restore: restoreDueLocally },
    );
  };

  const handleDismissDue = (loop) => {
    if (!uid || busyIds.has(loop.id)) return;
    runAction(
      loop,
      () => dismissIntent(db, uid, loop.id, null, loop.versions),
      { optimistic: () => removeDueLocally(loop.id), restore: restoreDueLocally },
    );
  };

  const handleDismissUpcoming = (loop) => {
    if (!uid || busyIds.has(loop.id)) return;
    runAction(
      loop,
      () => dismissIntent(db, uid, loop.id, null, loop.versions),
      {
        optimistic: () => setUpcomingLoops((prev) => prev.filter((l) => l.id !== loop.id)),
        restore: restoreUpcomingLocally,
      },
    );
  };

  if (!flagsOn) return null;

  const visibleLoops = dueLoops.slice(0, 3);
  if (visibleLoops.length === 0) return null;

  return (
    <GlassCard size={size} isEditing={isEditing} onDelete={onDelete}>
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          <Clock size={16} />
          <span className="text-xs font-medium">Open Loops</span>
        </div>

        <ul className="space-y-2">
          {visibleLoops.map((loop, index) => {
            const busy = busyIds.has(loop.id);
            return (
            <motion.li
              key={loop.id}
              className="border-b border-divider pb-2 last:border-b-0 last:pb-0"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground line-clamp-2">{loopText(loop)}</p>
                  <p className="text-[10px] text-faint mt-0.5">{formatDueSince(loop.targetAt)}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleAnswer(loop)}
                    title="Answer"
                    aria-label="Answer"
                    disabled={busy}
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors disabled:opacity-50"
                  >
                    <MessageSquare size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnoozeMenuId((cur) => (cur === loop.id ? null : loop.id))}
                    title="Snooze"
                    aria-label="Snooze"
                    disabled={busy}
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors disabled:opacity-50"
                  >
                    <Clock size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClose(loop)}
                    title="Close"
                    aria-label="Close"
                    disabled={busy}
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors disabled:opacity-50"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismissDue(loop)}
                    title="Don't revisit"
                    aria-label="Don't revisit"
                    disabled={busy}
                    className="w-6 h-6 rounded flex items-center justify-center text-faint hover:text-muted-foreground transition-colors disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {errorIds.has(loop.id) && (
                <p className="mt-1 text-[10px] text-accent-deep">
                  Couldn&apos;t save that — try again.
                </p>
              )}

              {snoozeMenuId === loop.id && (
                <div role="menu" className="mt-1.5 flex gap-1.5">
                  {SNOOZE_OPTIONS.map((option) => (
                    <Chip
                      key={option.key}
                      as="button"
                      type="button"
                      role="menuitem"
                      onClick={() => handleSnoozeOption(loop, option.key)}
                      className="text-[10px]"
                    >
                      {option.label}
                    </Chip>
                  ))}
                </div>
              )}
            </motion.li>
            );
          })}
        </ul>

        {upcomingLoops.length > 0 && (
          <div className="mt-2 pt-2 border-t border-divider">
            <button
              type="button"
              onClick={() => setShowUpcoming((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-faint hover:text-muted-foreground transition-colors"
            >
              <ChevronDown size={12} className={showUpcoming ? 'rotate-180 transition-transform' : 'transition-transform'} />
              +{upcomingLoops.length} upcoming
            </button>

            {showUpcoming && (
              <ul className="mt-1.5 space-y-1">
                {upcomingLoops.map((loop) => (
                  <li key={loop.id}>
                    <div className="flex items-center justify-between gap-2 text-[10px] text-faint">
                      <span className="line-clamp-1 flex-1">{loopText(loop)}</span>
                      <span className="shrink-0">{formatUpcomingDate(loop.targetAt)}</span>
                      <button
                        type="button"
                        onClick={() => handleDismissUpcoming(loop)}
                        title="Don't revisit"
                        aria-label="Don't revisit"
                        disabled={busyIds.has(loop.id)}
                        className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-faint hover:text-muted-foreground transition-colors disabled:opacity-50"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {errorIds.has(loop.id) && (
                      <p className="mt-0.5 text-[10px] text-accent-deep">
                        Couldn&apos;t save that — try again.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
};

export default OpenLoopsWidget;
