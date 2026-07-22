import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { db } from '../../config/firebase';
import { getFlag } from '../../config/flags';
import { Switch, Dialog, DialogContent, DialogTitle, DialogDescription } from '../cloud';
import { ownerStorageKey } from '../../services/storage/ownerScopedStorage';
import {
  getRevisitPrefs,
  setRevisitEnabled,
  listRevisitExclusions,
  removeRevisitExclusion,
  addRevisitExclusion,
} from '../../services/revisit/revisitService';

/**
 * RevisitControls — full-screen Gentle Revisit overlay (R2 Task 20), modeled
 * on `PrivacyCenter.jsx`'s cloud-sheet layout (same precedent
 * `InsightControlCenter.jsx`/`RecipesScreen.jsx` followed). Reachable both
 * as "Manage" from `RevisitWidget` and as its own row in Settings — always
 * self-sufficient (fetches its own prefs/exclusions off `uid`, never relies
 * on a caller-supplied snapshot), since either entry point may mount it
 * without a live queue item in view.
 *
 * Three sections:
 *   (a) Opt-in toggle — turning ON for the first time ever (per-device,
 *       owner-scoped — see `ONBOARDING_AREA` below) shows a one-time
 *       explainer sheet (what it does / what's excluded / how to stop, PRD
 *       P0 "explicit onboarding choice") BEFORE the toggle actually flips;
 *       cancelling leaves it off. Turning OFF calls `setRevisitEnabled(db,
 *       uid, false)` directly — the service itself deletes every queued
 *       doc as part of that call (PRD: immediate cancel, not a fade-out) —
 *       no extra confirm needed since disabling is fully reversible (just
 *       toggle back on).
 *   (b) Hidden dimensions — add hide-by Space/Person/Tag/Date rows, written
 *       as `revisit_exclusions` with `reason:'hidden_dim'` (permanent — a
 *       deliberate standing suppression, unlike the 90-day "Less like this"
 *       signal from the widget).
 *   (c) Exclusions — every exclusion regardless of reason (hidden_dim,
 *       never_show, less_like_this), each removable (delete is the only
 *       restore path — firestore.rules denies updates on this collection,
 *       same as `listRevisitExclusions`'s own doc comment).
 *
 * `onEnabledChange(next)` lets a caller that renders this inline (e.g.
 * `RevisitWidget`) keep its own local `prefsEnabled` state in sync without
 * a live Firestore subscription (the service exposes no
 * `subscribeRevisitPrefs`).
 */

const ONBOARDING_AREA = 'revisit/onboardingSeen';

const DIMENSION_OPTIONS = [
  { value: 'tag', label: 'Tag' },
  { value: 'person', label: 'Person' },
  { value: 'date', label: 'Date' },
  { value: 'space', label: 'Space', flag: 'contextSpaces' },
];

const REASON_LABELS = {
  never_show: 'Never show (this entry)',
  less_like_this: 'Less like this (90 days)',
  hidden_dim: 'Hidden',
};

const DIMENSION_LABELS = {
  entry: 'Entry',
  date: 'Date',
  person: 'Person',
  tag: 'Tag',
  space: 'Space',
  family: 'Theme/Entity',
};

function hasSeenOnboarding(uid) {
  try {
    return localStorage.getItem(ownerStorageKey(uid, ONBOARDING_AREA)) === 'true';
  } catch {
    return false;
  }
}

function markOnboardingSeen(uid) {
  try {
    localStorage.setItem(ownerStorageKey(uid, ONBOARDING_AREA), 'true');
  } catch {
    // localStorage unavailable (private mode, etc.) — the sheet will simply
    // reappear next time, which is safe (never blocks the toggle).
  }
}

const RevisitControls = ({ uid, onClose, onEnabledChange }) => {
  const [enabled, setEnabled] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [exclusions, setExclusions] = useState([]);
  const [exclusionsLoaded, setExclusionsLoaded] = useState(false);
  const [error, setError] = useState(null);

  const [addDimension, setAddDimension] = useState('tag');
  const [addValue, setAddValue] = useState('');
  const [addError, setAddError] = useState(null);
  const [adding, setAdding] = useState(false);

  const contextSpacesOn = getFlag('contextSpaces');
  const dimensionOptions = DIMENSION_OPTIONS.filter((opt) => !opt.flag || getFlag(opt.flag));

  useEffect(() => {
    if (!uid) return;
    if (!dimensionOptions.some((opt) => opt.value === addDimension)) {
      setAddDimension(dimensionOptions[0]?.value || 'tag');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only needs to
    // re-run if the available options themselves change (contextSpacesOn).
  }, [contextSpacesOn]);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;

    Promise.all([
      getRevisitPrefs(db, uid).catch(() => ({ enabled: false })),
      listRevisitExclusions(db, uid).catch(() => []),
    ]).then(([prefs, excl]) => {
      if (cancelled) return;
      setEnabled(prefs.enabled === true);
      setPrefsLoaded(true);
      setExclusions(excl || []);
      setExclusionsLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const applyEnabled = async (next) => {
    if (!uid || toggling) return;
    setError(null);
    setToggling(true);
    const previous = enabled;
    setEnabled(next);
    try {
      await setRevisitEnabled(db, uid, next);
      onEnabledChange?.(next);
    } catch {
      setEnabled(previous);
      setError('Could not update Gentle Revisit. Please try again.');
    } finally {
      setToggling(false);
    }
  };

  const handleToggle = (next) => {
    if (!next) {
      applyEnabled(false);
      return;
    }
    if (hasSeenOnboarding(uid)) {
      applyEnabled(true);
      return;
    }
    setShowOnboarding(true);
  };

  const confirmOnboarding = async () => {
    markOnboardingSeen(uid);
    setShowOnboarding(false);
    await applyEnabled(true);
  };

  const cancelOnboarding = () => {
    setShowOnboarding(false);
  };

  const handleRemoveExclusion = async (exclusionId) => {
    setError(null);
    const removed = exclusions.find((e) => e.id === exclusionId);
    setExclusions((prev) => prev.filter((e) => e.id !== exclusionId));
    try {
      await removeRevisitExclusion(db, uid, exclusionId);
    } catch {
      setError('Could not remove that exclusion. Please try again.');
      if (removed) setExclusions((prev) => [...prev, removed]);
    }
  };

  const handleAddHidden = async (e) => {
    e.preventDefault();
    setAddError(null);
    const trimmed = addValue.trim();
    if (!trimmed) {
      setAddError('Enter a value to hide.');
      return;
    }
    setAdding(true);
    try {
      const created = await addRevisitExclusion(db, uid, {
        dimension: addDimension,
        value: trimmed,
        reason: 'hidden_dim',
        permanent: true,
      });
      setExclusions((prev) => [...prev, created]);
      setAddValue('');
    } catch (err) {
      setAddError(err?.message || 'Could not hide that.');
    } finally {
      setAdding(false);
    }
  };

  const selectedDimensionOption = dimensionOptions.find((opt) => opt.value === addDimension) || dimensionOptions[0];

  // Nested-overlay a11y (RecipesScreen precedent): only one `aria-modal`
  // dialog may be active at a time. While the onboarding sheet (a real
  // Radix `Dialog`, its own independent portal) is open, this outer
  // hand-rolled `role="dialog"` wrapper drops `aria-modal` and gains
  // `aria-hidden`/`inert` (string, matching the convention) instead of
  // colliding with it as a second simultaneous dialog.
  const nestedOverlayOpen = showOnboarding;

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
      role="dialog"
      aria-modal={nestedOverlayOpen ? undefined : 'true'}
      aria-hidden={nestedOverlayOpen ? 'true' : undefined}
      inert={nestedOverlayOpen ? 'true' : undefined}
      aria-labelledby="revisit-controls-title"
    >
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start justify-between">
          <div>
            <p className="cloud-kicker">GENTLE REVISIT</p>
            <h2 id="revisit-controls-title" className="cloud-title text-3xl">Gentle Revisit</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Occasionally resurface a calm memory from your journal.
            </p>
          </div>
          <button type="button" className="cloud-icon-button" aria-label="Close Gentle Revisit" onClick={onClose}>
            <X size={21} />
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <section>
          <h3 className="cloud-kicker mb-2">STATUS</h3>
          <div className="cloud-sheet rounded-2xl border p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="revisit-enabled-switch" className="min-w-0 flex-1 cursor-pointer">
                <p className="font-medium text-[var(--foreground)]">Gentle Revisit</p>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {enabled ? 'On — you may see a memory occasionally.' : 'Off — nothing is surfaced.'}
                </p>
              </label>
              <Switch
                id="revisit-enabled-switch"
                checked={enabled}
                disabled={!prefsLoaded || toggling}
                onCheckedChange={handleToggle}
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="cloud-kicker mb-2">HIDDEN DIMENSIONS</h3>
          <div className="cloud-sheet space-y-3 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-[var(--secondary-foreground)]">
              Hide a Space, person, tag, or date from ever being resurfaced.
            </p>
            <form onSubmit={handleAddHidden} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Dimension to hide"
                value={selectedDimensionOption?.value}
                onChange={(e) => setAddDimension(e.target.value)}
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              >
                {dimensionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <input
                type={addDimension === 'date' ? 'date' : 'text'}
                aria-label={`Value to hide (${selectedDimensionOption?.label || ''})`}
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                placeholder={addDimension === 'date' ? undefined : 'e.g. Work, Alex, #travel'}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={adding}
                className="min-h-[44px] rounded-full bg-accent-deep px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {adding ? 'Hiding…' : 'Hide'}
              </button>
            </form>
            {addError && <p role="alert" className="text-xs text-destructive">{addError}</p>}
          </div>
        </section>

        <section>
          <h3 className="cloud-kicker mb-2">EXCLUSIONS</h3>
          <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
            {!exclusionsLoaded ? (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">Loading…</p>
            ) : exclusions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                Nothing excluded yet.
              </p>
            ) : (
              exclusions.map((exclusion) => (
                <div key={exclusion.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--foreground)] break-words">{exclusion.value}</p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {DIMENSION_LABELS[exclusion.dimension] || exclusion.dimension} · {REASON_LABELS[exclusion.reason] || 'Excluded'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveExclusion(exclusion.id)}
                    className="relative inline-flex min-h-[28px] shrink-0 items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-['']"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <Dialog open={showOnboarding} onOpenChange={(next) => { if (!next) cancelOnboarding(); }}>
        <DialogContent aria-labelledby="revisit-onboarding-title">
          <DialogTitle id="revisit-onboarding-title">Before you turn on Gentle Revisit</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-[var(--secondary-foreground)]">
              <p>What it does — occasionally shows a single calm entry from your journal, and you choose whether to open it.</p>
              <p>What&apos;s excluded — entries flagged for safety or with warning indicators are never eligible, and anything you hide or exclude here stays hidden.</p>
              <p>How to stop — turn the toggle back off anytime; anything waiting is cleared immediately.</p>
            </div>
          </DialogDescription>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={cancelOnboarding}
              className="min-h-[44px] flex-1 rounded-full border border-border text-sm font-medium text-secondary-foreground transition-colors hover:bg-divider"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={confirmOnboarding}
              className="min-h-[44px] flex-1 rounded-full bg-accent-deep text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Turn on
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RevisitControls;
