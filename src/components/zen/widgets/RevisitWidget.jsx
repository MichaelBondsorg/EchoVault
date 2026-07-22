import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import GlassCard from '../GlassCard';
import { Chip, Dialog, DialogContent, DialogTitle, DialogDescription } from '../../cloud';
import { getFlag } from '../../../config/flags';
import { db } from '../../../config/firebase';
import { useUser } from '../../../stores';
import {
  getRevisitPrefs,
  subscribeTodayRevisit,
  markShown,
  dismissRevisit,
  addRevisitExclusion,
} from '../../../services/revisit/revisitService';
import { subscribeSpaces } from '../../../services/spaces/spacesService';
import RevisitControls from '../../revisit/RevisitControls';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// GR1 (Michael's direct safety review) current-state gate, client mirror.
// Kept in exact lockstep BY HAND with
// `functions/src/revisit/selectRevisits.js`'s `currentStateGateTripped`/
// `sustainedLowMoodTripped` — duplicated, not imported, because this is a
// separate deployable package (client bundle vs. Cloud Functions), same
// rationale as the existing `crisisKeywords.js` client/server duplication.
const RECENT_WINDOW_DAYS = 14;
const LOW_MOOD_LOOKBACK = 7;
const LOW_MOOD_MIN_SCORED = 3;
const LOW_MOOD_THRESHOLD = 0.4;

// Compact 44px-hit-area text action, same technique as
// InsightControlCenter.jsx's `smallActionButtonClass` — a transparent
// `-inset-2` overlay pads the real tap target without inflating the visible
// pill, so this never needs a `min-h` override on `Button` (which would lose
// to Button's own `min-h-[44px]` via twMerge last-wins anyway).
const actionButtonClass =
  'relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-[\'\'] disabled:opacity-50';

/**
 * "A memory from {Month Year}" date line, derived from the underlying
 * entry's own date (effectiveDate wins over createdAt — EntryCard.jsx's
 * convention), NOT the queue doc's `dueDate`/`selectedAt` (when it was
 * surfaced, not when it was written). Omitted entirely when the entry isn't
 * in the in-memory `entries` list (no fabricated date).
 */
function monthYearLabel(entry) {
  const iso = entry?.effectiveDate || entry?.createdAt;
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The theme/entity "Less like this" suppresses (PRD: no explanation asked —
 * just infer a family to mute for 90 days), written as a `family` exclusion
 * value. MUST read exactly the fields `matchesExclusion`'s `family` case
 * reads server-side (`functions/src/revisit/selectRevisits.js`) — writer and
 * reader share one key space, or the exclusion is a silent no-op (R2 review
 * finding: this used to read `entry.analysis.themes`/`entry.analysis.entities`,
 * which NO real analysis write path populates — `orchestrator.js`'s
 * `buildSuccessPayload` only ever writes `analysis.{mood_score, framework,
 * cbt_breakdown, act_analysis, vent_support, celebration,
 * task_acknowledgment}` and top-level `tags`; there is no write path for
 * `analysis.themes`/`analysis.entities` anywhere in `functions/src`). The
 * selector's `family` match is `entityValues(entry)` (top-level
 * `entry.entities`, id preferred over name per entity — currently always
 * empty in production, since nothing writes top-level `entities` either, but
 * read here anyway for exact parity with the reader) OR top-level
 * `entry.tags` (the one production analysis writes actually populate).
 * Returns null when neither exists — the caller must hide the action rather
 * than write a junk exclusion (brief requirement).
 */
export function deriveTopThemeOrEntity(entry) {
  const topEntity = entry?.entities?.[0];
  const entityValue = topEntity?.id || topEntity?.name;
  if (typeof entityValue === 'string' && entityValue.trim()) return entityValue.trim();
  const tag = entry?.tags?.[0];
  if (typeof tag === 'string' && tag.trim()) return tag.trim();
  return null;
}

/** Same `effectiveDate || createdAt` convention as `monthYearLabel` above. Coerces to epoch ms, NaN if uncoercible. */
function entryTimeMs(entry) {
  const iso = entry?.effectiveDate || entry?.createdAt;
  if (!iso) return NaN;
  if (iso instanceof Date) return iso.getTime();
  if (typeof iso === 'string') return Date.parse(iso);
  if (typeof iso?.toMillis === 'function') return iso.toMillis();
  return NaN;
}

/**
 * GR1 (Michael's direct safety review, Task GR1) current-state gate, client
 * mirror of the server's `functions/src/revisit/selectRevisits.js`
 * `currentStateGateTripped`/`sustainedLowMoodTripped`. Defense in depth over
 * whatever `entries` this widget already has loaded — suppresses the card
 * even if a `revisit_queue` doc was already selected by the server before
 * today's signal appeared (e.g. the user journaled something concerning
 * later the same day, after the sweep ran). THE SERVER IS AUTHORITATIVE for
 * selection itself; this can only ever additionally suppress a card that
 * already made it through server-side, never cause one the server declined
 * to select.
 *
 * Same rule as the server: any RECENT_WINDOW_DAYS-day-old entry flagged
 * `safety_flagged`/`has_warning_indicators` trips it; otherwise, among the
 * last LOW_MOOD_LOOKBACK mood-scored recent entries, LOW_MOOD_MIN_SCORED or
 * more below LOW_MOOD_THRESHOLD trips it. Fewer than LOW_MOOD_MIN_SCORED
 * mood-scored recent entries fails OPEN (does not suppress) — insufficient
 * signal is not treated as equivalent to vulnerable, matching the server.
 *
 * ONE NOTED DIVERGENCE (QA-H): this client copy windows recency by
 * `effectiveDate || createdAt` (`entryTimeMs` above, matching this widget's
 * own date-display convention), whereas the server's recent-window
 * Firestore query filters on raw `createdAt` alone — the server remains
 * authoritative for selection either way, and this is suppress-only defense
 * in depth, so the divergence is bounded to "the client might suppress a
 * card the server's stricter/looser window wouldn't have," never the
 * reverse.
 *
 * @param {Array<object>} entries - whatever entries this widget received.
 * @param {number} [nowMs]
 * @returns {boolean} true → suppress the card.
 */
export function currentStateGateTripped(entries, nowMs = Date.now()) {
  const recent = (entries || [])
    .filter((e) => {
      if (!e) return false;
      const ms = entryTimeMs(e);
      if (!Number.isFinite(ms)) return false;
      const ageMs = nowMs - ms;
      return ageMs >= 0 && ageMs <= RECENT_WINDOW_DAYS * DAY_MS;
    })
    .sort((a, b) => entryTimeMs(b) - entryTimeMs(a));

  if (recent.some((e) => e.safety_flagged === true || e.has_warning_indicators === true)) return true;

  const moodScored = recent
    .filter((e) => typeof e.analysis?.mood_score === 'number' && !Number.isNaN(e.analysis.mood_score))
    .slice(0, LOW_MOOD_LOOKBACK);
  if (moodScored.length < LOW_MOOD_MIN_SCORED) return false; // fail-open: insufficient signal
  const lowCount = moodScored.filter((e) => e.analysis.mood_score < LOW_MOOD_THRESHOLD).length;
  return lowCount >= LOW_MOOD_MIN_SCORED;
}

/**
 * RevisitWidget — Gentle Revisit surface for the Bento dashboard (R2 Task
 * 20, flag: `gentleRevisit`). Renders null unless the flag is on, the user
 * has opted in (`revisitPrefs.enabled`), and today has a revisit_queue doc.
 *
 * Contract quirk (Task 19 review, documented on `subscribeTodayRevisit`):
 * the service applies NO status filter, so a `shown` or `dismissed` doc from
 * earlier today is forwarded exactly like a fresh `queued` one. This widget
 * resolves that itself:
 *   - `status === 'queued'` — preview card (reason + Space chip + date;
 *     entry text withheld) with the full action row.
 *   - `status === 'shown'` — the doc is still shown as the SAME preview card
 *     (reason/date/Space chip, Show action present) on every fresh mount.
 *     Entry text is rendered ONLY from session-local `localRevealed` state
 *     (Round 2, Michael's direct review, `.superpowers/sdd/task-gr-r2-report.md`)
 *     — it is NEVER auto-derived from `status === 'shown'` alone, so a
 *     remount (navigate away and back, app relaunch, another device) shows
 *     the preview again and requires a fresh tap of Show before the entry
 *     text renders. Tapping Show on an already-`shown` doc re-reveals
 *     locally WITHOUT re-calling `markShown` (see `handleShow`) — the
 *     server-side status doesn't change, and no duplicate write happens.
 *   - `status === 'dismissed'` (or any other/unknown status) — render null.
 *     Absence is the correct state; no guilt/streak copy anywhere here.
 *
 * "Manage" opens `RevisitControls` as a self-mounted full-screen overlay
 * (this widget owns that state directly — no AppLayout wiring exists for
 * Gentle Revisit yet, see Task 20 report). The same surface is also reachable
 * from Settings independently, so opt-out/exclusion management doesn't
 * require a live queue item to exist.
 */
const RevisitWidget = ({ size = '2x1', isEditing = false, onDelete, entries = [] }) => {
  const flagOn = getFlag('gentleRevisit');
  const user = useUser();
  const uid = user?.uid;

  const [prefsEnabled, setPrefsEnabled] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [item, setItem] = useState(null);
  const [localRevealed, setLocalRevealed] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [neverShowOpen, setNeverShowOpen] = useState(false);
  const [neverShowBusy, setNeverShowBusy] = useState(false);
  const [neverShowError, setNeverShowError] = useState(null);
  const [spaces, setSpaces] = useState([]);

  // Per-action pending flags (disable + guard against double-submit while a
  // service call is in flight) and a shared inline error line for the
  // card-level actions (Show/Not now/Less like this) — matches
  // RevisitControls' inline-error idiom (role="alert",
  // bg-[var(--destructive-wash)]). "Never show this entry" gets its own
  // `neverShowError` since it surfaces inside the confirm dialog, not the
  // card.
  const [showBusy, setShowBusy] = useState(false);
  const [notNowBusy, setNotNowBusy] = useState(false);
  const [lessLikeBusy, setLessLikeBusy] = useState(false);
  const [cardError, setCardError] = useState(null);

  const contextSpacesOn = getFlag('contextSpaces');

  useEffect(() => {
    if (!flagOn || !uid) {
      setPrefsLoaded(true);
      return undefined;
    }
    let cancelled = false;
    setPrefsLoaded(false);
    getRevisitPrefs(db, uid).then((prefs) => {
      if (cancelled) return;
      setPrefsEnabled(prefs.enabled === true);
      setPrefsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [flagOn, uid]);

  useEffect(() => {
    if (!flagOn || !uid || !prefsEnabled) {
      setItem(null);
      return undefined;
    }
    return subscribeTodayRevisit(db, uid, setItem, () => setItem(null));
  }, [flagOn, uid, prefsEnabled]);

  useEffect(() => {
    if (!contextSpacesOn || !uid) {
      setSpaces([]);
      return undefined;
    }
    return subscribeSpaces(db, uid, setSpaces);
  }, [contextSpacesOn, uid]);

  // A new day's item (different id) starts unrevealed again locally — the
  // server's `status` on the fresh doc is authoritative either way.
  useEffect(() => {
    setLocalRevealed(false);
  }, [item?.id]);

  const manageTriggerRef = useRef(null);
  const neverShowTriggerRef = useRef(null);

  const openManage = (e) => {
    manageTriggerRef.current = e?.currentTarget || null;
    setShowManage(true);
  };
  const closeManage = () => {
    setShowManage(false);
    manageTriggerRef.current?.focus();
    manageTriggerRef.current = null;
  };
  const openNeverShow = (e) => {
    neverShowTriggerRef.current = e?.currentTarget || null;
    setNeverShowError(null);
    setNeverShowOpen(true);
  };
  const closeNeverShow = () => {
    setNeverShowOpen(false);
    setNeverShowError(null);
    neverShowTriggerRef.current?.focus();
    neverShowTriggerRef.current = null;
  };
  const handleEnabledChange = (next) => {
    setPrefsEnabled(next);
  };

  // Card visibility gate (the brief's "renders null unless flag && prefs &&
  // queued doc"). Deliberately NOT an early `return null` — the Manage
  // overlay below must stay mounted even if disabling Gentle Revisit from
  // inside it flips `prefsEnabled` false mid-session (an early return would
  // otherwise yank RevisitControls out from under the user the instant they
  // toggle off, before they've had a chance to close it themselves).
  // `status === 'shown'` is included deliberately (not just 'queued') — a
  // remount after the user already tapped Show should still show the CARD
  // (as a preview) rather than rendering nothing, since the selection is
  // still live and actionable (Manage/Not now/Less like this/Never show all
  // still apply). See the module doc above and `revealed` below for why the
  // ENTRY TEXT itself is a separate, session-local-only decision (Round 2)
  // — this flag only controls whether the card exists at all.
  // `'dismissed'`/anything else is already excluded by this being an
  // allow-list of exactly the two live statuses (no separate
  // `!== 'dismissed'` clause needed).
  //
  // GR1 (Michael's review): `!currentStateGateTripped(entries)` is the
  // client-side defense-in-depth half of the current-state gate — see that
  // function's doc comment. Placed last so it only runs once every cheaper
  // check already passed.
  const cardVisible = Boolean(
    flagOn && prefsLoaded && prefsEnabled && item
    && (item.status === 'queued' || item.status === 'shown')
    && !currentStateGateTripped(entries),
  );

  const entry = cardVisible ? entries.find((e) => e.id === item.entryId) : null;
  // Round 2 (Michael's direct review): entry text renders ONLY from
  // session-local `localRevealed` — NEVER auto-derived from
  // `item.status === 'shown'`. A fresh mount always starts unrevealed
  // (see the `localRevealed` reset effect keyed on `item?.id`, and the
  // fact that a full component remount re-initializes this state to
  // `false` regardless), requiring a fresh tap of Show every session.
  const revealed = cardVisible && localRevealed;
  const dateLabel = monthYearLabel(entry);
  const spaceName = cardVisible && contextSpacesOn && item.spaceId
    ? spaces.find((s) => s.id === item.spaceId)?.name || item.spaceId
    : null;
  const topThemeOrEntity = entry ? deriveTopThemeOrEntity(entry) : null;
  const reasonLine = cardVisible ? (item.reason || 'A memory from your journal') : '';
  const entryText = entry?.content || entry?.text || '';

  const handleShow = async () => {
    if (!uid || !cardVisible || showBusy) return;
    setCardError(null);
    setLocalRevealed(true); // session-local reveal — always happens immediately

    // Round 2 (Michael's direct review): if the server-side doc is already
    // `status === 'shown'` (a prior Show this feature-lifetime, now revealed
    // again after a remount per the memo's "fresh, session-local reveal"
    // rule), there is nothing new to persist — avoid a duplicate
    // `markShown` write. The reveal above already happened; this is the
    // ENTIRE handler in that case.
    if (item.status === 'shown') return;

    setShowBusy(true);
    try {
      await markShown(db, uid, item.id);
    } catch {
      setLocalRevealed(false); // rollback — the persisted status never changed
      setCardError("Couldn't save that you viewed this. Please try again.");
    } finally {
      setShowBusy(false);
    }
  };

  const handleNotNow = async () => {
    if (!uid || !cardVisible || notNowBusy) return;
    setCardError(null);
    setNotNowBusy(true);
    try {
      await dismissRevisit(db, uid, item.id);
    } catch {
      setCardError("Couldn't dismiss this. Please try again.");
    } finally {
      setNotNowBusy(false);
    }
  };

  const handleConfirmNeverShow = async () => {
    if (!uid || !cardVisible || neverShowBusy) return;
    setNeverShowError(null);
    setNeverShowBusy(true);
    try {
      await addRevisitExclusion(db, uid, {
        dimension: 'entry',
        value: item.entryId,
        reason: 'never_show',
        permanent: true,
      });
      await dismissRevisit(db, uid, item.id);
      closeNeverShow();
    } catch {
      setNeverShowError("Couldn't exclude this entry. Please try again.");
    } finally {
      setNeverShowBusy(false);
    }
  };

  const handleLessLikeThis = async () => {
    if (!uid || !cardVisible || !topThemeOrEntity || lessLikeBusy) return;
    setCardError(null);
    setLessLikeBusy(true);
    const expiresAt = new Date(Date.now() + NINETY_DAYS_MS).toISOString();
    try {
      await addRevisitExclusion(db, uid, {
        dimension: 'family',
        value: topThemeOrEntity,
        reason: 'less_like_this',
        permanent: false,
        expiresAt,
      });
      await dismissRevisit(db, uid, item.id);
    } catch {
      setCardError("Couldn't save that preference. Please try again.");
    } finally {
      setLessLikeBusy(false);
    }
  };

  return (
    <>
      {cardVisible && (
        <GlassCard size={size} isEditing={isEditing} onDelete={onDelete}>
          <div className="h-full flex flex-col">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <History size={16} />
              <span className="text-xs font-medium">Gentle Revisit</span>
            </div>

            <p className="text-sm text-foreground">{reasonLine}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {dateLabel && <p className="text-[11px] text-faint">A memory from {dateLabel}</p>}
              {spaceName && <Chip className="text-[10px]">{spaceName}</Chip>}
            </div>

            {revealed && entryText && (
              <p className="mt-2 text-sm text-secondary-foreground whitespace-pre-wrap">{entryText}</p>
            )}

            {cardError && (
              <div role="alert" className="mt-2 rounded-xl bg-[var(--destructive-wash)] p-2 text-xs text-destructive">
                {cardError}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-3">
              {!revealed && (
                <button type="button" onClick={handleShow} disabled={showBusy} className={actionButtonClass}>
                  {showBusy ? 'Saving…' : 'Show'}
                </button>
              )}
              <button type="button" onClick={handleNotNow} disabled={notNowBusy} className={actionButtonClass}>
                {notNowBusy ? 'Dismissing…' : 'Not now'}
              </button>
              <button
                type="button"
                onClick={openNeverShow}
                className={actionButtonClass}
              >
                Never show this entry
              </button>
              {topThemeOrEntity && (
                <button type="button" onClick={handleLessLikeThis} disabled={lessLikeBusy} className={actionButtonClass}>
                  {lessLikeBusy ? 'Saving…' : 'Less like this'}
                </button>
              )}
              <button type="button" onClick={openManage} className={actionButtonClass}>
                Manage
              </button>
            </div>
          </div>
        </GlassCard>
      )}

      <Dialog open={neverShowOpen} onOpenChange={(next) => { if (!next) closeNeverShow(); }}>
        <DialogContent aria-labelledby="revisit-never-show-title">
          <DialogTitle id="revisit-never-show-title">Never show this entry again?</DialogTitle>
          <DialogDescription>This entry will be excluded from Gentle Revisit going forward.</DialogDescription>
          {neverShowError && (
            <div role="alert" className="mt-2 rounded-xl bg-[var(--destructive-wash)] p-2 text-xs text-destructive">
              {neverShowError}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={closeNeverShow}
              disabled={neverShowBusy}
              className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmNeverShow}
              disabled={neverShowBusy}
              className="min-h-[44px] flex-1 rounded-full bg-accent-deep text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {neverShowBusy ? 'Excluding…' : 'Never show'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {showManage && (
        <RevisitControls uid={uid} onClose={closeManage} onEnabledChange={handleEnabledChange} />
      )}
    </>
  );
};

export default RevisitWidget;
