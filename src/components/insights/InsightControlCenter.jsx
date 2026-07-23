import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { db } from '../../config/firebase';
import { Button } from '../cloud';
import { listSourceExclusions, restoreSource } from '../../services/insights/sourceExclusions';
import { getSuppressedPatterns, liftSuppression } from '../../services/basicInsights/feedbackLearning';
import { getActiveExclusions, removeExclusion } from '../../services/signals/signalLifecycle';
import { getCachedInsights } from '../../services/nexus/orchestrator';
import { rebuildInsights, describeRebuildResult } from '../../services/insights/rebuildInsights';
import { readBudgetMode, readShownLog, getBudgetConfig } from '../../services/insights/insightBudget';
import { sourceFromEntry } from '../../services/insights/receipts';

/**
 * InsightControlCenter — full-screen overlay (R2 Task 12), modeled on
 * `PrivacyCenter.jsx`'s cloud-sheet layout (same precedent `SpaceManager.jsx`
 * followed for Context Spaces). Gives the user one place to see and reverse
 * everything that currently shapes their insights:
 *
 *   (a) Excluded sources    — `sourceExclusions.js` (Task 10)
 *   (b) Muted insight families — feedback-learning suppression (Task ~9) AND
 *       the R1-era per-pattern-type exclusions (`signalLifecycle.js`)
 *   (c) Recompute            — staleness (`nexus/insights.stale`) + the
 *       manual "Recompute now" trigger, which routes through the SAME
 *       `rebuildInsights` orchestration contract every other refresh
 *       surface on the Insights page uses (Fix C, 2026-07-24 brief) —
 *       reruns the active engine's real pipeline, not a bare re-read, and
 *       (with `insightClaims` on) reruns the claims pipeline too, not just
 *       Nexus.
 *   (d) Withheld this week    — an honest (never over-claiming) budget count
 *       derived from the shown-log + the user's chosen mode's weekly cap
 *
 * Every action here is reversible (restore / show-again / recompute), so
 * there is deliberately NO destructive-confirm dialog anywhere in this
 * screen — unlike SpaceManager's archive sheet, which guards a state change
 * with real consequences.
 *
 * This component does NOT read `getFlag('insightReceipts')` itself — same
 * convention as `ReceiptSheet.jsx`: the flag gate lives at the mount site
 * (`AppLayout.jsx` + the `SettingsPage.jsx` nav row), so this component is
 * flag-agnostic and testable in isolation.
 *
 * Entry lookup for exclusion rows is synchronous-only (same v1 scope note as
 * `ReceiptSheet`'s source rows): `entries` is whatever the caller already
 * has in memory. When the excluded entry isn't there, the row falls back to
 * a plain "no longer available" placeholder rather than fetching from
 * Firestore.
 */

const REASON_LABELS = {
  wrong_source: 'Wrong source',
  excluded_by_user: 'You excluded this',
};

const MODE_LABELS = {
  quiet: 'Quiet',
  balanced: 'Balanced',
  exploratory: 'Exploratory',
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function reasonLabel(reason) {
  return REASON_LABELS[reason] || 'Excluded';
}

function humanizePatternType(patternType) {
  if (!patternType) return 'Unspecified pattern';
  const spaced = String(patternType).replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// `timeZone: 'UTC'` mirrors ReceiptSheet's formatDate: exclusion/receipt
// dates are ISO/UTC instants, and formatting in the host's local timezone
// can shift the displayed calendar day by +/-1 depending on viewer/CI tz.
function formatDate(iso) {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function formatRelativeTime(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffMs = Math.max(0, Date.now() - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  return `${Math.floor(diffMs / day)}d ago`;
}

/** Count of shownLog entries within the last 7 days — the same window
 * `insightBudget.js#applyInsightBudget` uses for its weekly cap. */
function weekShownCount(shownLog, now = Date.now()) {
  return (shownLog || []).filter((entry) => {
    const t = Date.parse(entry?.shownAt);
    return !Number.isNaN(t) && now - t <= SEVEN_DAYS_MS;
  }).length;
}

/**
 * Excerpt + date for an excluded source row. Prefers the real entry (via
 * `sourceFromEntry`, the same normalizer receipts use) when it's in memory;
 * otherwise a synchronous placeholder — the exclusion doc itself carries no
 * excerpt/date of its own to fall back to (unlike a receipt's `sources`).
 */
function excludedSourceDisplay(exclusion, entriesById) {
  const entry = entriesById[exclusion.entryId];
  if (entry) {
    const { date, excerpt } = sourceFromEntry(entry) || {};
    return { dateLabel: formatDate(date), excerptLabel: excerpt || 'No excerpt available' };
  }
  return { dateLabel: null, excerptLabel: 'This entry is no longer available.' };
}

const smallActionButtonClass =
  'relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-[\'\'] disabled:opacity-50';

const InsightControlCenter = ({ uid, entries = [], onClose }) => {
  const [error, setError] = useState(null);

  const [sourceExclusions, setSourceExclusions] = useState([]);
  const [suppressedPatterns, setSuppressedPatterns] = useState([]);
  const [patternExclusions, setPatternExclusions] = useState([]);
  const [cachedInfo, setCachedInfo] = useState(null); // {stale, generatedAt} | null
  const [budgetMode, setBudgetMode] = useState('balanced');
  const [shownLog, setShownLog] = useState([]);

  const [recomputing, setRecomputing] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState(null);

  const entriesById = useMemo(() => {
    const map = {};
    (entries || []).forEach((entry) => {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    });
    return map;
  }, [entries]);

  useEffect(() => {
    if (!uid) return undefined;
    let cancelled = false;

    Promise.all([
      listSourceExclusions(db, uid).catch(() => []),
      getSuppressedPatterns(uid).catch(() => []),
      getActiveExclusions(uid).catch(() => []),
      getCachedInsights(uid).catch(() => null),
      readBudgetMode(db, uid).catch(() => 'balanced'),
      readShownLog(db, uid).catch(() => []),
    ]).then(([exclusions, suppressed, patternExcl, cached, mode, log]) => {
      if (cancelled) return;
      setSourceExclusions(exclusions || []);
      setSuppressedPatterns(suppressed || []);
      setPatternExclusions(patternExcl || []);
      setCachedInfo(cached);
      setBudgetMode(mode || 'balanced');
      setShownLog(log || []);
    });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const handleRestore = async (exclusionId) => {
    setError(null);
    const removed = sourceExclusions.find((e) => e.id === exclusionId);
    setSourceExclusions((prev) => prev.filter((e) => e.id !== exclusionId));
    try {
      await restoreSource(db, uid, exclusionId);
    } catch {
      setError('Could not restore that source. Please try again.');
      if (removed) setSourceExclusions((prev) => [...prev, removed]);
    }
  };

  const handleLiftSuppression = async (patternType) => {
    setError(null);
    const removed = suppressedPatterns.find((p) => p.patternType === patternType);
    setSuppressedPatterns((prev) => prev.filter((p) => p.patternType !== patternType));
    try {
      const ok = await liftSuppression(uid, patternType);
      if (ok === false) {
        setError('Could not show that pattern again. Please try again.');
        if (removed) setSuppressedPatterns((prev) => [...prev, removed]);
      }
    } catch {
      setError('Could not show that pattern again. Please try again.');
      if (removed) setSuppressedPatterns((prev) => [...prev, removed]);
    }
  };

  const handleRemoveExclusion = async (exclusionId) => {
    setError(null);
    const removed = patternExclusions.find((e) => e.id === exclusionId);
    setPatternExclusions((prev) => prev.filter((e) => e.id !== exclusionId));
    try {
      await removeExclusion(uid, exclusionId);
    } catch {
      setError('Could not show that pattern again. Please try again.');
      if (removed) setPatternExclusions((prev) => [...prev, removed]);
    }
  };

  // Fix C (2026-07-24 brief): "Recompute now" routes through the SAME
  // `rebuildInsights` orchestration the Insights page header's "Rebuild
  // insights" action uses — it reruns the active engine's real generation
  // pipeline (Basic Insights, plus Nexus or the claims pipeline depending
  // on `insightClaims`), never a bare Firestore re-read. `describeRebuildResult`
  // is the SAME formatter that page uses, so the two surfaces' result copy
  // never drifts apart.
  const handleRecompute = async () => {
    if (recomputing || !uid) return;
    setRecomputing(true);
    setRecomputeResult(null);
    try {
      const result = await rebuildInsights(db, uid, entries);
      setRecomputeResult(describeRebuildResult(result).message);
      if (result?.ok) {
        setCachedInfo({ stale: false, generatedAt: new Date().toISOString() });
      }
    } catch {
      setRecomputeResult(describeRebuildResult(null).message);
    } finally {
      setRecomputing(false);
    }
  };

  const noMutedFamilies = suppressedPatterns.length === 0 && patternExclusions.length === 0;

  const modeLabel = MODE_LABELS[budgetMode] || 'Balanced';
  const weekCap = getBudgetConfig(budgetMode).maxHomePerWeek;
  const shownCount = weekShownCount(shownLog);

  const stalenessLine = !cachedInfo
    ? 'No insights generated yet.'
    : cachedInfo.stale
    ? 'Insights will refresh with your current exclusions.'
    : `Last generated ${formatRelativeTime(cachedInfo.generatedAt) || 'recently'}.`;

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="insight-control-center-title"
    >
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start justify-between">
          <div>
            <p className="cloud-kicker">INSIGHTS</p>
            <h2 id="insight-control-center-title" className="cloud-title text-3xl">Insight Control Center</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              Everything here is reversible — nothing is deleted.
            </p>
          </div>
          <button
            type="button"
            className="cloud-icon-button"
            aria-label="Close Insight Control Center"
            onClick={onClose}
          >
            <X size={21} />
          </button>
        </header>

        {error && (
          <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* (a) Excluded sources */}
        <section>
          <h3 className="cloud-kicker mb-2">EXCLUDED SOURCES</h3>
          <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
            {sourceExclusions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                No sources excluded. Entries you exclude from insights will appear here.
              </p>
            ) : (
              sourceExclusions.map((exclusion) => {
                const { dateLabel, excerptLabel } = excludedSourceDisplay(exclusion, entriesById);
                return (
                  <div key={exclusion.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      {dateLabel && <p className="text-xs text-[var(--muted-foreground)]">{dateLabel}</p>}
                      <p className="mt-0.5 text-sm text-[var(--secondary-foreground)] break-words">{excerptLabel}</p>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">{reasonLabel(exclusion.reason)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(exclusion.id)}
                      className={`${smallActionButtonClass} shrink-0`}
                    >
                      Restore
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* (b) Muted insight families */}
        <section>
          <h3 className="cloud-kicker mb-2">MUTED INSIGHT FAMILIES</h3>
          <div className="cloud-sheet divide-y divide-[var(--divider)] overflow-hidden rounded-2xl border shadow-sm">
            {noMutedFamilies ? (
              <p className="px-4 py-4 text-sm text-[var(--muted-foreground)]">
                Nothing is muted right now.
              </p>
            ) : (
              <>
                {suppressedPatterns.map((pattern) => (
                  <div key={pattern.patternType} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--foreground)]">{humanizePatternType(pattern.patternType)}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">Paused based on your feedback</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLiftSuppression(pattern.patternType)}
                      className={`${smallActionButtonClass} shrink-0`}
                    >
                      Show again
                    </button>
                  </div>
                ))}
                {patternExclusions.map((exclusion) => (
                  <div key={exclusion.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-[var(--foreground)]">{humanizePatternType(exclusion.patternType)}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">You dismissed this pattern type</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveExclusion(exclusion.id)}
                      className={`${smallActionButtonClass} shrink-0`}
                    >
                      Show again
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>

        {/* (c) Recompute */}
        <section>
          <h3 className="cloud-kicker mb-2">RECOMPUTE</h3>
          <div className="cloud-sheet space-y-3 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-[var(--secondary-foreground)]">{stalenessLine}</p>
            <Button onClick={handleRecompute} disabled={recomputing || !uid} className="w-full">
              {recomputing ? 'Recomputing…' : 'Recompute now'}
            </Button>
            {recomputeResult && (
              <p role="status" className="text-sm text-[var(--secondary-foreground)]">{recomputeResult}</p>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              Recomputing uses your current exclusions ({sourceExclusions.length} sources excluded).
            </p>
          </div>
        </section>

        {/* (d) Withheld this week */}
        <section>
          <h3 className="cloud-kicker mb-2">WITHHELD THIS WEEK</h3>
          <div className="cloud-sheet space-y-1 rounded-2xl border p-4 shadow-sm">
            <p className="text-sm text-[var(--secondary-foreground)]">
              Your {modeLabel} budget showed {shownCount} of up to {weekCap} insights this week.
            </p>
            <p className="text-xs text-[var(--muted-foreground)]">
              Change this anytime in Settings, under AI &amp; Privacy &rarr; Insight frequency.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default InsightControlCenter;
