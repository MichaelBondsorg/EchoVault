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
 * just infer a family to mute for 90 days). Mirrors the same two sources
 * `themesCorrelations.js`/`peopleCorrelations.js` already read off an entry:
 * `analysis.themes[0]` (AI-extracted theme strings) first, falling back to
 * `analysis.entities[0].name` (AI-extracted named entity). Returns null when
 * neither exists — the caller must hide the action rather than write a junk
 * exclusion (brief requirement).
 */
export function deriveTopThemeOrEntity(entry) {
  const theme = entry?.analysis?.themes?.[0];
  if (typeof theme === 'string' && theme.trim()) return theme.trim();
  const entityName = entry?.analysis?.entities?.[0]?.name;
  if (typeof entityName === 'string' && entityName.trim()) return entityName.trim();
  return null;
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
 *   - `status === 'shown'` — the user already tapped Show this session (or
 *     remounted after doing so) — render revealed (entry text visible)
 *     directly, no need to tap Show again. Local `revealed` state also
 *     drives this so the very same click that fires `markShown` reveals
 *     immediately, without waiting on the round-trip.
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
  const [spaces, setSpaces] = useState([]);

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
    setNeverShowOpen(true);
  };
  const closeNeverShow = () => {
    setNeverShowOpen(false);
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
  const cardVisible = Boolean(
    flagOn && prefsLoaded && prefsEnabled && item
    && item.status !== 'dismissed'
    && (item.status === 'queued' || item.status === 'shown'),
  );

  const entry = cardVisible ? entries.find((e) => e.id === item.entryId) : null;
  const revealed = cardVisible && (localRevealed || item.status === 'shown');
  const dateLabel = monthYearLabel(entry);
  const spaceName = cardVisible && contextSpacesOn && item.spaceId
    ? spaces.find((s) => s.id === item.spaceId)?.name || item.spaceId
    : null;
  const topThemeOrEntity = entry ? deriveTopThemeOrEntity(entry) : null;
  const reasonLine = cardVisible ? (item.reason || 'A memory from your journal') : '';
  const entryText = entry?.content || entry?.text || '';

  const handleShow = () => {
    setLocalRevealed(true);
    if (uid) markShown(db, uid, item.id);
  };

  const handleNotNow = () => {
    if (uid) dismissRevisit(db, uid, item.id);
  };

  const handleConfirmNeverShow = async () => {
    if (!uid || !cardVisible) return;
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
    } finally {
      setNeverShowBusy(false);
    }
  };

  const handleLessLikeThis = async () => {
    if (!uid || !cardVisible || !topThemeOrEntity) return;
    const expiresAt = new Date(Date.now() + NINETY_DAYS_MS).toISOString();
    await addRevisitExclusion(db, uid, {
      dimension: 'family',
      value: topThemeOrEntity,
      reason: 'less_like_this',
      permanent: false,
      expiresAt,
    });
    await dismissRevisit(db, uid, item.id);
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

            <div className="mt-3 flex flex-wrap gap-3">
              {!revealed && (
                <button type="button" onClick={handleShow} className={actionButtonClass}>
                  Show
                </button>
              )}
              <button type="button" onClick={handleNotNow} className={actionButtonClass}>
                Not now
              </button>
              <button
                type="button"
                onClick={openNeverShow}
                className={actionButtonClass}
              >
                Never show this entry
              </button>
              {topThemeOrEntity && (
                <button type="button" onClick={handleLessLikeThis} className={actionButtonClass}>
                  Less like this
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
