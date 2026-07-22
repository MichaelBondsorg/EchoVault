import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { db } from '../../config/firebase';
import { Button } from '../cloud';
import SourceList from '../insights/SourceList';
import { filterEntriesByScope } from '../../services/spaces/scopeFilter';
import { pairObservations } from '../../services/experiments/estimator';
import { exposureValueForEntry, outcomeValueForEntry, buildDaySeries, computeExperimentResult } from '../../services/experiments/computeResult';
import { setObservationExcluded, writeResult } from '../../services/experiments/experimentsService';
import { safeDate } from '../../utils/date';

/**
 * ExperimentResultView — the result screen for one completed Personal
 * Experiment (R3 Task 6). Renders the STORED `experiment.result` (the
 * output of the REAL `computeExperimentResult`, written by
 * `experimentsService.writeResult` at completion) — this view never calls
 * `computeExperimentResult` on mount. The only path that recomputes is the
 * observation inspector's exclude/include toggle (`handleToggleExclude`
 * below): `setObservationExcluded` -> `computeExperimentResult` (real,
 * deterministic) -> `writeResult` -> local state updates so the change is
 * immediately visible, matching the eventual `subscribeExperiments` push
 * from the parent screen.
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

/**
 * Rebuild the FULL (pre-exclusion) paired-observations list for the
 * observation inspector table, using the exact same pure building blocks
 * `computeResult.js`'s own pipeline uses (`filterEntriesByScope` ->
 * date-window filter -> `buildDaySeries` -> `pairObservations`) — see that
 * module's "PIPELINE" doc comment. This is NOT a second implementation of
 * the estimator/statistics: every non-trivial step is the same exported,
 * independently-tested pure function `computeExperimentResult` itself
 * calls; only the thin date-window-filter glue (not exported, since
 * `computeResult.js` only exports its three named helpers) is duplicated
 * here, deliberately kept minimal and mirrored 1:1 from that module's
 * `entryTimestampMs`/windowed-filter step.
 *
 * @returns {{dateKey:string, outcomeDateKey:string, exposure:number, outcome:number}[]}
 */
export function buildObservationRows(experiment, entries) {
  const plan = experiment?.analysisPlan;
  if (!plan || typeof plan.exposure !== 'object' || typeof plan.outcome !== 'object') return [];
  const startMs = Date.parse(experiment.startAt);
  const declaredEndMs = Date.parse(experiment.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(declaredEndMs)) return [];
  const effectiveEndMs = Math.min(declaredEndMs, Date.now());

  const scoped = filterEntriesByScope(Array.isArray(entries) ? entries : [], experiment.scope ?? null);
  const windowed = scoped.filter((entry) => {
    const ts = entryTimestampMs(entry);
    return ts !== null && ts >= startMs && ts < effectiveEndMs;
  });

  const exposureSeries = buildDaySeries(windowed, (entry) => exposureValueForEntry(entry, plan.exposure, plan.exposure?.tag));
  const outcomeSeries = buildDaySeries(windowed, (entry) => outcomeValueForEntry(entry, plan.outcome));

  return pairObservations({ exposureSeries, outcomeSeries, lag: plan.lag });
}

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

const ExperimentResultView = ({ uid, entries = [], experiment, onClose }) => {
  const [result, setResult] = useState(experiment.result || null);
  const [excludedObservations, setExcludedObservations] = useState(
    Array.isArray(experiment.excludedObservations) ? experiment.excludedObservations : [],
  );
  const [busyDateKey, setBusyDateKey] = useState(null);
  const [error, setError] = useState(null);

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

  const handleToggleExclude = async (dateKey, nextExcluded) => {
    setError(null);
    setBusyDateKey(dateKey);
    try {
      const updatedExcluded = await setObservationExcluded(db, uid, experiment.id, dateKey, nextExcluded);
      const updatedExperiment = { ...experiment, excludedObservations: updatedExcluded };
      const nextResult = computeExperimentResult({ experiment: updatedExperiment, entries, now: new Date() });
      await writeResult(db, uid, experiment.id, nextResult);
      setExcludedObservations(updatedExcluded);
      setResult(nextResult);
    } catch (err) {
      setError(err?.message || 'Could not update that observation. Please try again.');
    } finally {
      setBusyDateKey(null);
    }
  };

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

  return (
    <div
      className="fixed inset-0 z-[90] overflow-y-auto bg-[var(--background)] p-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+16px)]"
      role="dialog"
      aria-modal="true"
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

        <section className="cloud-sheet space-y-2 rounded-2xl border p-4 shadow-sm">
          <p className="font-semibold">Coverage</p>
          <ul className="space-y-0.5 text-sm text-secondary-foreground">
            <li>{result.coverage?.exposure?.covered} of {result.coverage?.exposure?.total} days have {exposureLabel} data</li>
            <li>{result.coverage?.outcome?.covered} of {result.coverage?.outcome?.total} days have {outcomeLabel} data</li>
          </ul>
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
                Difference: {roundToOneDecimal(result.estimate.delta)} points (95% range: {roundToOneDecimal(result.estimate.ci[0])} to {roundToOneDecimal(result.estimate.ci[1])})
              </p>
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
                      <td className="py-1.5 pr-2">{pair.exposure}</td>
                      <td className="py-1.5 pr-2">{pair.outcome}</td>
                      <td className="py-1.5 pr-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleToggleExclude(pair.dateKey, !isExcluded)}
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
  );
};

export default ExperimentResultView;
