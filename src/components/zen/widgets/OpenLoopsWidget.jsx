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

/**
 * Normalize whatever the composer's save resolved to into a real entry id
 * or null. The underlying save chain (App.jsx's saveEntry/doSaveEntry/
 * handleAudioWrapper) has its own long-standing return contract of the
 * sentinel strings 'saved'/'deferred' (or undefined on some early-return
 * paths) — those must never be written into `outcome.answerEntryId` as if
 * they were an id. The real id (when available) now arrives via a separate
 * onEntryRef side-channel threaded through AppLayout, but this stays
 * defensive against any sentinel value still reaching here.
 */
function normalizeSavedEntryId(savedResult) {
  if (typeof savedResult === 'string') {
    if (savedResult === 'saved' || savedResult === 'deferred') return null;
    return savedResult;
  }
  if (savedResult && typeof savedResult === 'object' && typeof savedResult.id === 'string') {
    return savedResult.id;
  }
  return null;
}

/**
 * OpenLoopsWidget - Due open-loop surface for the Bento dashboard.
 *
 * Shows up to 3 due open-loop intents (subscribeDueOpenLoops), each with
 * neutral due phrasing and four actions: Answer (opens the capture composer
 * with a quiet context chip via `onAnswerLoop`, then closes the loop with
 * the saved entry id), Snooze (tonight/tomorrow/next week), Close, and
 * Dismiss ("Don't revisit"). A "+N upcoming" footer expands to a read-only
 * list of not-yet-due loops with dismiss only.
 *
 * Renders nothing (absence is correct, no placeholder) when the
 * `openLoops`/`intentExtraction` flags are off, or when there are no due
 * loops. In-app only — no notification code here.
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

  useEffect(() => {
    if (!flagsOn || !uid) return undefined;
    const unsubscribe = subscribeDueOpenLoops(db, uid, setDueLoops, () => setDueLoops([]));
    return unsubscribe;
  }, [flagsOn, uid]);

  useEffect(() => {
    if (!flagsOn || !uid) return undefined;
    const unsubscribe = subscribeUpcomingOpenLoops(db, uid, setUpcomingLoops, () => setUpcomingLoops([]));
    return unsubscribe;
  }, [flagsOn, uid]);

  const removeDueLocally = (id) => {
    setDueLoops((prev) => prev.filter((l) => l.id !== id));
  };

  const handleAnswer = (loop) => {
    if (!uid) return;
    onAnswerLoop?.(loopText(loop), (savedResult) => {
      answerLoop(db, uid, loop.id, normalizeSavedEntryId(savedResult));
    });
  };

  const handleSnoozeOption = (loop, optionKey) => {
    if (uid) snoozeLoop(db, uid, loop.id, snoozeUntilIso(optionKey));
    setSnoozeMenuId(null);
    removeDueLocally(loop.id);
  };

  const handleClose = (loop) => {
    if (uid) closeLoop(db, uid, loop.id);
    removeDueLocally(loop.id);
  };

  const handleDismissDue = (loop) => {
    if (uid) dismissIntent(db, uid, loop.id);
    removeDueLocally(loop.id);
  };

  const handleDismissUpcoming = (loop) => {
    if (uid) dismissIntent(db, uid, loop.id);
    setUpcomingLoops((prev) => prev.filter((l) => l.id !== loop.id));
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
          {visibleLoops.map((loop, index) => (
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
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors"
                  >
                    <MessageSquare size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSnoozeMenuId((cur) => (cur === loop.id ? null : loop.id))}
                    title="Snooze"
                    aria-label="Snooze"
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors"
                  >
                    <Clock size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClose(loop)}
                    title="Close"
                    aria-label="Close"
                    className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-accent-deep transition-colors"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismissDue(loop)}
                    title="Don't revisit"
                    aria-label="Don't revisit"
                    className="w-6 h-6 rounded flex items-center justify-center text-faint hover:text-muted-foreground transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

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
          ))}
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
                  <li key={loop.id} className="flex items-center justify-between gap-2 text-[10px] text-faint">
                    <span className="line-clamp-1 flex-1">{loopText(loop)}</span>
                    <span className="shrink-0">{formatUpcomingDate(loop.targetAt)}</span>
                    <button
                      type="button"
                      onClick={() => handleDismissUpcoming(loop)}
                      title="Don't revisit"
                      aria-label="Don't revisit"
                      className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-faint hover:text-muted-foreground transition-colors"
                    >
                      <X size={12} />
                    </button>
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
