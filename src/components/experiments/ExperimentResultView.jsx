import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { db } from '../../config/firebase';
import { Button } from '../cloud';
import SourceList from '../insights/SourceList';
import { filterEntriesByScope } from '../../services/spaces/scopeFilter';
import { pairObservations } from '../../services/experiments/estimator';
import {
  exposureValueForEntry,
  outcomeValueForEntry,
  buildDaySeries,
  computeExperimentResult,
  localDateKeyForMs,
  shiftLocalDateKey,
  localMidnightUtcMs,
  STABILITY_CAVEAT_COPY,
} from '../../services/experiments/computeResult';
import {
  setObservationExcluded,
  writeResult,
  EXCLUSION_REASONS,
  buildAdjustedResultUpdate,
  writeAdjustedResult,
} from '../../services/experiments/experimentsService';
import { safeDate } from '../../utils/date';

/**
 * ExperimentResultView — the result screen for one completed Personal
 * Experiment (R3 Task 6). Renders the STORED `experiment.result` (the
 * output of the REAL `computeExperimentResult`, written by
 * `experimentsService.writeResult` at completion) — this view never calls
 * `computeExperimentResult` on mount.
 *
 * RESULT INTEGRITY (Michael review hardening, EX2 item 3, binding): the
 * stored `experiment.result` field is `{original, adjusted?,
 * exclusionHistory}` (`writeResult`'s wrapping shape) — `original` is
 * IMMUTABLE from this view's perspective; it is never re-derived or
 * overwritten. The observation inspector's exclude/include toggle
 * (`confirmToggle` below) now requires a REASON (`EXCLUSION_REASONS`:
 * `wrong_data`/`wrong_date`/`other`, chosen via a small dialog — calm copy,
 * no shaming) before it proceeds: `setObservationExcluded` (unchanged) ->
 * `computeExperimentResult` (real, deterministic) ->
 * `buildAdjustedResultUpdate` (pure — appends `{dateKey, excluded, reason,
 * at}` to `exclusionHistory`, sets `adjusted` to the new computation,
 * carries `original` through untouched) -> `writeAdjustedResult` -> local
 * state updates. Whenever `adjusted` exists, this view shows the "Modified
 * after seeing the result" label, a collapsible history list, and an
 * always-visible toggle to view the ORIGINAL result instead (never hidden
 * behind another click depth) — `showingOriginal` below.
 *
 * LEGACY BARE-SHAPE FALLBACK: a stored `result` written before this
 * wrapping existed (bare `computeExperimentResult` output, no `original`
 * key) is rendered as if it WERE the original, with an empty history — see
 * `normalizeStoredResult` below. None exist in prod today
 * (`personalExperiments` is flag-gated OFF), but this keeps the view
 * correct for any pre-EX2 doc regardless.
 *
 * Insufficiency (`result.status === 'insufficient'`) renders ONLY the
 * plain-language `narrative.insufficiency` copy plus machine-readable
 * `reasons` (via the shared `REASON_COPY` token->copy map, also imported by
 * `ExperimentsScreen`'s preflight review so both surfaces render the exact
 * same tokens uniformly) — no estimate, no CI, no "X points higher/lower"
 * sentence (`narrative.alternatives`/`whatThisDoesNotProve` are already
 * empty arrays on an insufficient result per `computeResult.js`'s
 * `buildInsufficientResult`, so mapping over them renders nothing extra).
 * Coverage and the receipt are shown in BOTH states (every result — ok and
 * insufficient — carries a receipt, and coverage explains WHY a result is
 * insufficient), and the observation inspector stays available in both
 * states too — excluding/including an observation can push an insufficient
 * result over the threshold on rerun.
 *
 * SENSITIVE-DAY DISCLOSURE (Michael review hardening, item 5): whenever
 * `result.sensitiveObservationCount > 0`, a calm disclosure sentence is
 * shown ("N sensitive days contributed to the statistics; details are
 * hidden.") — those entries are already folded into the estimate (the
 * user's own data) but never appear in `receipt.sources` (unchanged
 * invariant). The observation table (`buildObservationRows`) renders each
 * such paired day as "Sensitive day — details hidden" instead of its raw
 * exposure/outcome numbers — the dateKey stays visible and the
 * Exclude/Include toggle stays available (the user may exclude their own
 * sensitive day like any other).
 *
 * "HOW THIS WAS COMPUTED" (final hardening review, item 1 — Michael's
 * directive: "nHigh, nLow, the split threshold, and exposure contrast in the
 * result receipt"): these fields have existed on `estimate` since EX1's
 * statistical hardening but rendered nowhere in this view. A compact section
 * now surfaces `nHigh`/`nLow` (as an "N higher-X days vs M lower-X days"
 * sentence using the template's exposure label), `splitThreshold` (the
 * median value with the exposure's own label as its unit in median mode;
 * literal "present vs absent" wording in binary mode, where `splitThreshold`
 * is `null` by design — see `estimator.js`'s `binarySplit` doc comment),
 * `exposureContrast` (in the exposure's own units), `resampleDiscardCount`
 * (renamed from `resampleFallbackCount` in Michael's round-2 statistical
 * review, 2026-07-22, item 4 — the bootstrap no longer falls back to a
 * fixed-split resample when a resample's OWN split collapses, it discards
 * that resample outright; shown only when `> 0` — a plain sentence, omitted
 * entirely otherwise), and the leave-out-out `stability` range
 * (`deltaMin`..`deltaMax`, `null` when every LOO iteration failed its own
 * recomputed eligibility gates — see `estimator.js`'s `computeStability`),
 * followed by either the positive "held its direction" sentence or, when
 * `signConsistent` is `false`, the SAME `STABILITY_CAVEAT_COPY` sentence
 * `computeResult.js`'s `buildSummary` already appended to `narrative.summary`
 * above (final hardening review, item 2) — reused here, not re-typed. All of
 * this reads from the STORED `estimate`, exactly like the rest of this view.
 *
 * EXPLORATORY-RANGE LABELING (Michael's round-2 statistical review,
 * 2026-07-22, item 5 — see docs/quality/experiments-data-method.md's
 * "Round-2" section): the CI shown next to the headline difference is now
 * labeled "rough range (exploratory)", not "95% range" — the 95% CONFIDENCE
 * framing stays accurate and documented in the spec (the underlying
 * percentile computation is unchanged), but the UI leads with the
 * exploratory/rough framing Michael's round-2 review asked for, because the
 * bootstrap's independence-across-days assumption (see the spec's "What the
 * bootstrap actually assumes" section) is known to understate the true
 * uncertainty for sequentially-dependent daily data — "rough range" is the
 * honest headline, not "95% confident."
 */

// Shared token -> plain-language copy map (binding: "render both uniformly,
// one token->copy map") for `computeExperimentResult`'s insufficiency
// `reasons` tokens AND preflight's `reasons`/`missingSources` tokens (they
// overlap on `no_tag_occurrences`/`no_mood_data`; every other token is
// additive). Defined here (not in `ExperimentsScreen`, which already
// imports this module for the result-view swap) so there is exactly one
// import edge between the two files, not a circular one.
export const REASON_COPY = {
  no_health_data: 'No health data is connected yet.',
  no_environment_data: 'No weather data is available yet.',
  no_tag_occurrences: "This tag doesn't appear in your entries yet.",
  no_mood_data: 'Not enough mood data is recorded yet.',
  projected_pairs_below_minimum: "There likely won't be enough matched days by the end of this experiment.",
  coverage_below_floor: 'Not enough days have data for one of these variables yet.',
  exposure_coverage_below_floor: 'Not enough days have data for this variable yet.',
  outcome_coverage_below_floor: 'Not enough days have mood data yet.',
  insufficient_paired_observations: 'There are not enough matched days yet.',
  lag_mismatch: "The data doesn't line up with the expected day-to-day pattern.",
  degenerate_exposure_split: "There isn't enough variation in this variable to compare higher and lower days.",
  // Michael review hardening (Task EX1 estimator guards; EX2 cross-checks
  // every emitter against this map so no new reason ever renders as the
  // generic fallback below by accident).
  group_too_small: 'One of the groups being compared has too few days to trust yet.',
  groups_too_imbalanced: 'The higher and lower days being compared are too lopsided to trust yet.',
  exposure_contrast_too_small: "There isn't a clear enough difference between the higher and lower days being compared.",
  split_unstable: 'The way days split into higher and lower was not stable enough to trust.',
  unknown_outcome_unit: "This experiment's mood data isn't in a format Engram recognizes yet.",
};

/** Calm, non-judgmental copy for the post-result exclusion reason dialog (Michael review hardening, item 3). */
export const EXCLUSION_REASON_COPY = {
  wrong_data: 'The recorded data for this day looks wrong',
  wrong_date: 'This is tied to the wrong day',
  other: 'Something else',
};

export function reasonCopy(token) {
  return REASON_COPY[token] || 'Not enough data yet for a reliable result.';
}

function entryTimestampMs(entry) {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

/** Group entries by (local, `timeZone`) calendar dateKey — mirrors `computeResult.js`'s private `groupEntriesByDateKey` (not exported), for the sensitive-day lookup below. */
function groupEntriesByDateKey(entries, timeZone) {
  const map = new Map();
  for (const entry of entries || []) {
    const dateKey = entryDateKeyLocal(entry, timeZone);
    if (!dateKey) continue;
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey).push(entry);
  }
  return map;
}

function entryDateKeyLocal(entry, timeZone) {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  if (Number.isNaN(d.getTime())) return null;
  return localDateKeyForMs(d.getTime(), timeZone);
}

/**
 * Rebuild the FULL (pre-exclusion) paired-observations list for the
 * observation inspector table, using the exact same pure building blocks
 * `computeResult.js`'s own pipeline uses (`filterEntriesByScope` -> local
 * calendar-day, partial-start-day window filter -> `buildDaySeries` ->
 * `pairObservations`) — see that module's "PIPELINE" and "LOCAL CALENDAR
 * DAYS + FROZEN TIMEZONE" doc comments. This is NOT a second implementation
 * of the estimator/statistics: every non-trivial step is the same
 * exported, independently-tested pure function `computeExperimentResult`
 * itself calls (including the exact same `localDateKeyForMs`/
 * `shiftLocalDateKey`/`localMidnightUtcMs` timezone helpers, imported
 * rather than re-derived, per Michael review hardening item 2 — the two
 * pipelines must never disagree about which local day a pair belongs to);
 * only the thin date-window-filter glue (not exported, since
 * `computeResult.js` only exports its named helpers, not the whole
 * pipeline) is duplicated here, deliberately kept minimal.
 *
 * Each row also carries `sensitive: boolean` (Michael review hardening,
 * item 5) — true when ANY entry dated on the pair's `dateKey` OR
 * `outcomeDateKey` (same union `computeResult.js`'s receipt builder uses)
 * is `safety_flagged`/`has_warning_indicators` — so the table can render
 * "Sensitive day — details hidden" for that row instead of its raw
 * exposure/outcome numbers.
 *
 * @returns {{dateKey:string, outcomeDateKey:string, exposure:number, outcome:number, sensitive:boolean}[]}
 */
export function buildObservationRows(experiment, entries) {
  const plan = experiment?.analysisPlan;
  if (!plan || typeof plan.exposure !== 'object' || typeof plan.outcome !== 'object') return [];
  const startMs = Date.parse(experiment.startAt);
  const declaredEndMs = Date.parse(experiment.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(declaredEndMs)) return [];
  const effectiveEndMs = Math.min(declaredEndMs, Date.now());
  const timeZone = typeof plan.timezone === 'string' && plan.timezone ? plan.timezone : 'UTC';

  // PARTIAL START DAY RULE (item 2) — mirrors computeResult.js exactly.
  const startLocalKey = localDateKeyForMs(startMs, timeZone);
  const day1LocalKey = shiftLocalDateKey(startLocalKey, 1);
  const windowStartMs = localMidnightUtcMs(day1LocalKey, timeZone);

  const scoped = filterEntriesByScope(Array.isArray(entries) ? entries : [], experiment.scope ?? null);
  const windowed = scoped.filter((entry) => {
    const ts = entryTimestampMs(entry);
    return ts !== null && ts >= windowStartMs && ts < effectiveEndMs;
  });

  const exposureSeries = buildDaySeries(windowed, (entry) => exposureValueForEntry(entry, plan.exposure, plan.exposure?.tag), timeZone);
  const outcomeSeries = buildDaySeries(windowed, (entry) => outcomeValueForEntry(entry, plan.outcome), timeZone);

  const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: plan.lag });
  const entriesByDateKey = groupEntriesByDateKey(windowed, timeZone);
  return pairs.map((pair) => {
    const dayEntries = [
      ...(entriesByDateKey.get(pair.dateKey) || []),
      ...(entriesByDateKey.get(pair.outcomeDateKey) || []),
    ];
    const sensitive = dayEntries.some((entry) => entry && (entry.safety_flagged || entry.has_warning_indicators));
    return { ...pair, sensitive };
  });
}

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Normalize `experiment.result` (as currently stored) into
 * `{original, adjusted, exclusionHistory}` — see module doc comment's
 * "LEGACY BARE-SHAPE FALLBACK" for why a stored value with no `original`
 * key is treated as the original itself, with empty history.
 */
export function normalizeStoredResult(storedField) {
  if (!storedField) return null;
  if (typeof storedField === 'object' && 'original' in storedField) {
    return {
      original: storedField.original,
      adjusted: storedField.adjusted || null,
      exclusionHistory: Array.isArray(storedField.exclusionHistory) ? storedField.exclusionHistory : [],
    };
  }
  return { original: storedField, adjusted: null, exclusionHistory: [] };
}

function formatHistoryTimestamp(iso) {
  const d = safeDate(iso);
  if (Number.isNaN(d.getTime())) return iso || '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const ExperimentResultView = ({ uid, entries = [], experiment, onClose }) => {
  const [storedField, setStoredField] = useState(experiment.result || null);
  const [excludedObservations, setExcludedObservations] = useState(
    Array.isArray(experiment.excludedObservations) ? experiment.excludedObservations : [],
  );
  const [busyDateKey, setBusyDateKey] = useState(null);
  const [error, setError] = useState(null);
  const [showingOriginal, setShowingOriginal] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Post-result exclusion reason dialog (Michael review hardening, item 3).
  const [pendingToggle, setPendingToggle] = useState(null); // {dateKey, nextExcluded} | null
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);

  const entriesById = useMemo(() => {
    const map = {};
    for (const entry of entries || []) {
      const id = entry?.id || entry?.entryId;
      if (id) map[id] = entry;
    }
    return map;
  }, [entries]);

  const rows = useMemo(() => buildObservationRows(experiment, entries), [experiment, entries]);

  const exposureLabel = experiment.analysisPlan?.exposure?.label || 'this variable';
  const outcomeLabel = experiment.analysisPlan?.outcome?.label || 'mood';

  const normalized = useMemo(() => normalizeStoredResult(storedField), [storedField]);
  const hasAdjusted = Boolean(normalized?.adjusted);
  const result = normalized ? (showingOriginal ? normalized.original : (normalized.adjusted || normalized.original)) : null;

  const openReasonDialog = (dateKey, nextExcluded) => {
    setError(null);
    setReasonChoice('');
    setReasonNote('');
    setPendingToggle({ dateKey, nextExcluded });
  };

  const cancelReasonDialog = () => {
    if (confirmBusy) return;
    setPendingToggle(null);
  };

  const confirmToggle = async () => {
    if (!pendingToggle || !reasonChoice) return;
    const { dateKey, nextExcluded } = pendingToggle;
    setError(null);
    setConfirmBusy(true);
    setBusyDateKey(dateKey);
    try {
      const updatedExcluded = await setObservationExcluded(db, uid, experiment.id, dateKey, nextExcluded);
      const updatedExperiment = { ...experiment, excludedObservations: updatedExcluded };
      const nextResult = computeExperimentResult({ experiment: updatedExperiment, entries, now: new Date() });
      const at = new Date().toISOString();
      const nextField = buildAdjustedResultUpdate(storedField, {
        adjusted: nextResult,
        dateKey,
        excluded: nextExcluded,
        reason: reasonChoice,
        at,
        note: reasonNote,
      });
      await writeAdjustedResult(db, uid, experiment.id, nextField);
      setExcludedObservations(updatedExcluded);
      setStoredField(nextField);
      setShowingOriginal(false);
      setPendingToggle(null);
    } catch (err) {
      setError(err?.message || 'Could not update that observation. Please try again.');
    } finally {
      setBusyDateKey(null);
      setConfirmBusy(false);
    }
  };

  const nestedOverlayOpen = Boolean(pendingToggle);

  if (!result) {
    return (
      <div
        className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pt-[calc(env(safe-area-inset-top)+16px)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="experiment-result-title"
      >
        <button type="button" onClick={onClose} className="cloud-icon-button" aria-label="Back to experiments">
          <ChevronLeft size={21} />
        </button>
        <p id="experiment-result-title" className="mt-4 text-sm text-[var(--muted-foreground)]">
          No result is available for this experiment yet.
        </p>
      </div>
    );
  }

  const isOk = result.status === 'ok';
  const sensitiveCount = result.sensitiveObservationCount || 0;
  const invalidCount = result.invalidObservationCount || 0;

  return (
    <>
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
      role="dialog"
      aria-modal={nestedOverlayOpen ? undefined : 'true'}
      aria-hidden={nestedOverlayOpen ? 'true' : undefined}
      inert={nestedOverlayOpen ? 'true' : undefined}
      aria-labelledby="experiment-result-title"
    >
      <div className="mx-auto max-w-xl space-y-5">
        <header className="flex items-start gap-3">
          <button type="button" onClick={onClose} className="cloud-icon-button" aria-label="Back to experiments">
            <ChevronLeft size={21} />
          </button>
          <div className="min-w-0">
            <p className="cloud-kicker">RESULT</p>
            <h2 id="experiment-result-title" className="cloud-title text-2xl">{experiment.question}</h2>
          </div>
        </header>

        {error && (
          <div role="alert" className="rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {hasAdjusted && (
          <section className="cloud-sheet space-y-2 rounded-2xl border border-[var(--accent-deep)] p-4 shadow-sm">
            <p className="text-sm font-medium text-[var(--accent-deep)]">Modified after seeing the result</p>
            <p className="text-xs text-secondary-foreground">
              You excluded or included a day after this result was first computed. The numbers below reflect that change.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowingOriginal((prev) => !prev)}
                className="min-h-[44px] rounded-full border border-border px-3 text-xs font-medium text-accent-deep"
              >
                {showingOriginal ? 'View latest result' : 'View original result'}
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((prev) => !prev)}
                aria-expanded={historyOpen}
                className="min-h-[44px] rounded-full border border-border px-3 text-xs font-medium text-accent-deep"
              >
                {historyOpen ? 'Hide history' : 'Show history'}
              </button>
            </div>
            {historyOpen && (
              <ul className="mt-1 space-y-1 text-xs text-secondary-foreground">
                {normalized.exclusionHistory.map((entry, idx) => (
                  <li key={`${entry.dateKey}-${entry.at}-${idx}`}>
                    {entry.dateKey} — {entry.excluded ? 'excluded' : 'included'} ({EXCLUSION_REASON_COPY[entry.reason] || entry.reason}
                    {entry.note ? `: ${entry.note}` : ''}) on {formatHistoryTimestamp(entry.at)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
          <p className="font-semibold">Coverage</p>
          <ul className="space-y-0.5 text-sm text-secondary-foreground">
            <li>{result.coverage?.exposure?.covered} of {result.coverage?.exposure?.total} days have {exposureLabel} data</li>
            <li>{result.coverage?.outcome?.covered} of {result.coverage?.outcome?.total} days have {outcomeLabel} data</li>
          </ul>
          {sensitiveCount > 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {sensitiveCount} sensitive {sensitiveCount === 1 ? 'day' : 'days'} contributed to the statistics; details are hidden.
            </p>
          )}
          {invalidCount > 0 && (
            <p className="text-xs text-[var(--muted-foreground)]">
              {invalidCount} {invalidCount === 1 ? 'observation had' : 'observations had'} out-of-range values and were not used.
            </p>
          )}
        </section>

        {!isOk && (
          <section role="alert" className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
            <p className="font-semibold">Not enough data yet</p>
            <p className="text-sm text-secondary-foreground">{result.narrative?.insufficiency}</p>
            {result.reasons?.length > 0 && (
              <ul className="list-disc space-y-1 pl-4 text-sm text-secondary-foreground">
                {result.reasons.map((token) => <li key={token}>{reasonCopy(token)}</li>)}
              </ul>
            )}
          </section>
        )}

        {isOk && (
          <>
            <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
              <p className="font-semibold">Sample size</p>
              <p className="text-sm text-secondary-foreground">{result.estimate.n} matched days</p>
            </section>

            <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
              <p className="font-semibold">What this shows</p>
              <p className="text-sm text-secondary-foreground">{result.narrative?.summary}</p>
              <p className="text-xs text-[var(--muted-foreground)]">
                Difference: {roundToOneDecimal(result.estimate.delta)} points (0-100) (rough range (exploratory): {roundToOneDecimal(result.estimate.ci[0])} to {roundToOneDecimal(result.estimate.ci[1])})
              </p>
            </section>

            {/* IMPORTANT review fix (final hardening review, item 1 —
                Michael's directive: "nHigh, nLow, the split threshold, and
                exposure contrast in the result receipt"). These fields have
                existed on `estimate` since EX1 but rendered nowhere — this
                section surfaces them, reading from `estimate` exactly as the
                rest of this view already does (the STORED result, not a
                fresh computation). `receipt.computation` also mirrors the
                four core fields (see computeResult.js) so the persisted
                receipt object itself carries them, independent of this UI. */}
            <section className="cloud-sheet space-y-1.5 rounded-2xl border p-4 shadow-sm">
              <p className="font-semibold">How this was computed</p>
              <ul className="space-y-1 text-xs text-[var(--muted-foreground)]">
                <li>
                  {result.estimate.nHigh} higher-{exposureLabel} days vs {result.estimate.nLow} lower-{exposureLabel} days
                </li>
                <li>
                  {result.estimate.splitThreshold === null
                    ? 'Split: present vs absent'
                    : `Split point: ${roundToOneDecimal(result.estimate.splitThreshold)} ${exposureLabel}`}
                </li>
                <li>
                  Contrast between the higher and lower groups: {roundToOneDecimal(result.estimate.exposureContrast)} {exposureLabel}
                </li>
                {result.estimate.resampleDiscardCount > 0 && (
                  <li>
                    {result.estimate.resampleDiscardCount} of the bootstrap's resamples were discarded because their day-split collapsed.
                  </li>
                )}
                <li>
                  Leaving out any single day moved the difference between {roundToOneDecimal(result.estimate.stability.deltaMin)} and {roundToOneDecimal(result.estimate.stability.deltaMax)} points (0-100).{' '}
                  {result.estimate.stability.signConsistent
                    ? 'The result held its direction when any single day was removed.'
                    : STABILITY_CAVEAT_COPY}
                </li>
              </ul>
            </section>

            {result.narrative?.alternatives?.length > 0 && (
              <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <p className="font-semibold">Other things that could explain this</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-secondary-foreground">
                  {result.narrative.alternatives.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </section>
            )}

            {result.narrative?.whatThisDoesNotProve?.length > 0 && (
              <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
                <p className="font-semibold">What this does not prove</p>
                <ul className="list-disc space-y-1 pl-4 text-sm text-secondary-foreground">
                  {result.narrative.whatThisDoesNotProve.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </section>
            )}
          </>
        )}

        <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
          <p className="font-semibold">Sources</p>
          <SourceList sources={result.receipt?.sources || []} entriesById={entriesById} />
        </section>

        <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
          <p className="font-semibold">Paired days</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Exclude a day to leave it out of the result — the result updates right away.
          </p>
          {/* MINOR review fix (R3 final review): this table is rebuilt LIVE
              from `entries` on every render (`buildObservationRows`), while
              the summary/estimate sections above render the STORED
              `experiment.result` from whenever it was last computed —
              editing a journal entry after completion can make the two
              visibly disagree until the next toggle recomputes both. Copy
              only, not an architecture change (see the finding this
              addresses). */}
          <p className="text-xs text-[var(--muted-foreground)]">
            Reflects your entries as of now; the summary above is from when this result was last computed — toggling an observation recomputes both.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-[var(--muted-foreground)]">
                  <th className="py-1 pr-2 font-medium">Day</th>
                  <th className="py-1 pr-2 font-medium">{exposureLabel}</th>
                  <th className="py-1 pr-2 font-medium">{outcomeLabel}</th>
                  <th className="py-1 pr-2 font-medium">Include</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((pair) => {
                  const isExcluded = excludedObservations.includes(pair.dateKey);
                  const busy = busyDateKey === pair.dateKey;
                  return (
                    <tr key={pair.dateKey} className="border-t border-divider">
                      <td className="py-1.5 pr-2">{pair.dateKey}</td>
                      {pair.sensitive ? (
                        <td className="py-1.5 pr-2 text-[var(--muted-foreground)]" colSpan={2}>
                          Sensitive day — details hidden
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 pr-2">{pair.exposure}</td>
                          <td className="py-1.5 pr-2">{pair.outcome}</td>
                        </>
                      )}
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => openReasonDialog(pair.dateKey, !isExcluded)}
                          className="relative inline-flex min-h-[28px] items-center text-xs font-medium text-accent-deep before:absolute before:-inset-2 before:content-['']"
                          aria-label={`${isExcluded ? 'Include' : 'Exclude'} ${pair.dateKey}`}
                        >
                          {busy ? 'Updating…' : isExcluded ? 'Include' : 'Exclude'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-sm text-[var(--muted-foreground)]">No paired days yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Button variant="ghost" onClick={onClose}>Back to experiments</Button>
      </div>
    </div>

    {pendingToggle && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-[var(--overlay)] p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="exclusion-reason-title"
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
            <h3 id="exclusion-reason-title" className="mb-1 font-display font-bold text-lg text-foreground">
              {pendingToggle.nextExcluded ? 'Why exclude this day?' : 'Why include this day?'}
            </h3>
            <p className="mb-3 text-sm text-secondary-foreground">
              This helps keep the record honest — there's no wrong answer.
            </p>
            {error && (
              <div role="alert" className="mb-3 rounded-xl bg-[var(--destructive-wash)] p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="sr-only">Reason</legend>
              {EXCLUSION_REASONS.map((token) => (
                <label key={token} className="flex min-h-[44px] items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="exclusion-reason"
                    value={token}
                    checked={reasonChoice === token}
                    onChange={() => setReasonChoice(token)}
                  />
                  {EXCLUSION_REASON_COPY[token]}
                </label>
              ))}
            </fieldset>
            {reasonChoice === 'other' && (
              <textarea
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="Optional: say more"
                rows={2}
                className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
              />
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="ghost" onClick={cancelReasonDialog} disabled={confirmBusy} className="flex-1">
                Cancel
              </Button>
              <Button onClick={confirmToggle} disabled={!reasonChoice || confirmBusy} className="flex-1">
                {confirmBusy ? 'Saving…' : 'Continue'}
              </Button>
            </div>
          </div>
        </div>
    )}
    </>
  );
};

export default ExperimentResultView;
