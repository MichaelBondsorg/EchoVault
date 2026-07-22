/**
 * Personal Experiments — result computation + receipt + narrative (R3 Task 5).
 *
 * `computeExperimentResult({experiment, entries, now})` is a PURE orchestration
 * function: it never touches Firestore, never calls an LLM/provider, and never
 * reads an ambient clock (`now` is a required explicit argument, mirroring
 * `preflight.js`'s posture). Given the same `(experiment, entries, now)` it
 * always produces the same result — this is what lets the UI call it again
 * after `setObservationExcluded` and get a trustworthy rerun (Task 6).
 *
 * PIPELINE (binding, from the plan):
 *   scopeFilter -> date-window filter (startAt..min(endAt, now)) -> build
 *   exposure/outcome day-series (via the shared series-builder below) ->
 *   drop excludedObservations dateKeys -> estimator.runAnalysisPlan with the
 *   FROZEN plan from experiment.analysisPlan (never re-derived from the
 *   template catalog — the catalog is consulted ONLY for narrative-only
 *   fixed strings: confounders / whatThisDoesNotProve, never for the
 *   exposure/outcome/lag values that drive the statistics) -> result object.
 *
 * FROZEN PLAN AUTHORITY: every value that feeds `pairObservations`/
 * `runAnalysisPlan` (exposure.source/field/tag, outcome.field, lag) comes
 * from `experiment.analysisPlan`, which was snapshotted once at
 * `startExperiment` time (`experimentsService.buildAnalysisPlan`). This
 * module never calls `getTemplateById` to re-derive those values — only to
 * look up the template's fixed `confounders`/`whatThisDoesNotProve` display
 * strings, which are narrative-only and cannot change the estimate.
 *
 * CARRY-FORWARD FIX (Task 3 review, binding): `extractHealthSignals`
 * (`src/services/health/healthFormatter.js`) uses `healthContext.activity?.X
 * || null` for `exerciseMinutes`/`steps` — a TRUE ZERO (0 exercise minutes,
 * 0 steps) is indistinguishable, at that layer, from "no activity data at
 * all". Zero-exercise/zero-step days are exactly the most contrastive
 * observations for those templates, so silently dropping them as "missing"
 * would bias the estimate toward whatever non-zero days happen to exist.
 * `exposureValueForEntry` below (the shared series-builder helper,
 * re-exported and reused by `preflight.js`) fixes this WITHOUT editing
 * `extractHealthSignals` itself (other consumers depend on its current
 * `|| null` semantics): for `exerciseMinutes`/`steps` specifically, the RAW
 * field on `healthContext.activity` (`totalExerciseMinutes`/`stepsToday`) is
 * checked directly — precise on the raw key, not just "an activity object
 * exists": if that raw key is present and `=== 0`, the day is a KNOWN ZERO
 * (value 0, kept in the series); if the raw key is entirely absent (no
 * activity data for that specific field, even if `healthContext.activity`
 * has OTHER fields populated — e.g. steps present but exercise minutes
 * never recorded that day), the day is a genuinely MISSING observation for
 * THAT field (dropped) — a partially-populated `activity` object no longer
 * makes every activity field "known" just because one of them is. Every
 * other field (sleep, recovery, HRV, sunshine, ...) keeps drop-on-null
 * semantics unchanged — a null there really does mean "unmeasured", not
 * "measured and zero".
 *
 * MULTIPLE ENTRIES PER CALENDAR DAY: the day-series builder
 * (`buildDaySeries`) groups entries by calendar day and, when more than one
 * entry on the same day carries a usable value for a variable, takes their
 * MEAN. This is a deliberate, documented design choice (not required by any
 * single rail module, which mostly assume one data point per entry) that
 * keeps day-series construction order-independent regardless of what order
 * `entries` arrives in — the same property `pairObservations`/
 * `runAnalysisPlan` already guarantee for pairs. One entry per day (the
 * common case) is unaffected — the "mean" of one value is that value.
 *
 * EXCLUSION SEMANTICS: `excludedObservations` (dateKeys stored on the
 * experiment doc) are applied AFTER pairing, filtering out any pair whose
 * `dateKey` (the pair's primary/exposure-day key, matching
 * `pairObservations`' output shape and the UI's "paired days" table) is in
 * the excluded set. This is deliberately NOT implemented by stripping that
 * dateKey out of the raw exposure/outcome day-series before pairing:
 * for lag-1 templates, a given calendar day's OUTCOME value is also the
 * exposure day's own value contributor for one pair but the *outcome* for
 * the pair anchored on the PREVIOUS day — stripping the day out of both
 * series would incorrectly also erase that unrelated adjacent pair.
 * Filtering the already-formed `pairs` list by their own `dateKey` excludes
 * exactly the one paired observation the user asked to exclude and nothing
 * else — "an excluded observation contributes nothing" at the pair level,
 * with no collateral effect on a neighboring pair.
 *
 * COVERAGE WINDOW: `coverage` in the result reports coverage over the
 * EXPERIMENT's own window (`startAt` .. `min(endAt, now)`), computed from
 * the FULL (pre-exclusion) day-series — not the preflight module's fixed
 * 28-day lookback window, and not affected by toggling an exclusion
 * (coverage answers "how much data exists", independent of which paired
 * days the user has chosen to fold into the estimate).
 *
 * COVERAGE FLOOR ENFORCEMENT (data-method spec default #2, review fix):
 * `estimator.runAnalysisPlan` deliberately does NOT enforce the ≥50%
 * per-variable coverage floor itself — its own docblock says so explicitly
 * ("missingness/coverage thresholds are checked by the caller... BEFORE
 * calling this function"). This module is that caller: EACH of
 * `exposureCoverage`/`outcomeCoverage` (over the experiment window, not a
 * lookback window) is compared against `COVERAGE_FLOOR` (imported from
 * `estimator.js`, never re-hardcoded) BEFORE trusting an otherwise-`ok`
 * analysis. Without this check, a sparse-but-lucky sample (e.g. sleep data
 * on only 12 of 60 elapsed days, all 12 of which happen to pair with mood)
 * can clear `MIN_PAIRED_OBSERVATIONS` on raw pair count alone while still
 * being a biased, non-representative slice of the window — exactly the
 * failure mode default #2 exists to catch. When either variable's coverage
 * ratio is `< COVERAGE_FLOOR`, the result is `insufficient` regardless of
 * what `runAnalysisPlan` would have said, with machine-readable
 * `reasons: string[]` (`'exposure_coverage_below_floor'` /
 * `'outcome_coverage_below_floor'`, snake_case matching `preflight.js`'s
 * token style so Task 6 can render both uniformly) at the top level of the
 * result — present only when `status: 'insufficient'`, mirroring the
 * absence-not-undefined pattern already used for `estimate`/`summary`. When
 * coverage already fails, this module still cheaply checks `pairs.length <
 * MIN_PAIRED_OBSERVATIONS` (no bootstrap — that check is O(1) and doesn't
 * invoke `runAnalysisPlan`'s expensive resampling) so
 * `'insufficient_paired_observations'` can appear alongside a coverage
 * reason when both are true; it does NOT additionally invoke the full
 * `runAnalysisPlan` in that branch (which would spend 2,000 bootstrap
 * resamples computing an estimate that's going to be discarded anyway) —
 * so `'degenerate_exposure_split'`/`'lag_mismatch'` are only surfaced when
 * coverage passes and `runAnalysisPlan` itself is the one that fails.
 *
 * NARRATIVE SNAPSHOT (review fix): `alternatives`/`whatThisDoesNotProve`
 * are read from `experiment.analysisPlan.confounders`/`.whatThisDoesNotProve`
 * FIRST — snapshotted onto the plan at create time by
 * `experimentsService.buildAnalysisPlan`, exactly like the plan's
 * statistical fields — so a later edit (or removal) of the template catalog
 * entry can never silently change or blank out the safety-caveat text an
 * already-`completed` result shows. `getTemplateById(plan.templateId)` is
 * used ONLY as a fallback for legacy plans written before this snapshot
 * existed (none in prod today — `personalExperiments` is flag-gated OFF —
 * but kept for robustness/forward-compat rather than assuming every plan
 * in Firestore was written by the current code).
 *
 * RECEIPT `versions.generatedAt` NOTE: `buildReceipt`
 * (`src/services/insights/receipts.js`) stamps `versions.generatedAt` with
 * `new Date().toISOString()` unconditionally — it has no injectable clock.
 * That one metadata field is therefore NOT part of this module's
 * determinism guarantee (exactly like every other receipt-carrying
 * generator in the codebase); every other field of the result, including
 * every other receipt field, is a pure function of `(experiment, entries,
 * now)`. Tests that assert rerun determinism compare results with that one
 * field normalized out.
 */
import { pairObservations, runAnalysisPlan, computeCoverage, MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } from './estimator';
import { getTemplateById } from './templates';
import { filterEntriesByScope } from '../spaces/scopeFilter';
import { buildReceipt, sourceFromEntry } from '../insights/receipts';
import { extractHealthSignals } from '../health/healthFormatter';
import { extractEnvironmentSignals } from '../environment/environmentFormatter';
import { safeDate } from '../../utils/date';

// ---------------------------------------------------------------------------
// Fixed strings (data-method spec, docs/quality/experiments-data-method.md,
// "Fixed strings" section) — copied VERBATIM, not re-typed, per default #8.
// This is the "constants module alongside estimator.js" the spec says Task 5
// adds. Task 6 (UI) and any other consumer must import these rather than
// retyping equivalent-but-not-identical copy.
// ---------------------------------------------------------------------------

/** Appended to every `status: 'ok'` result, regardless of template. */
export const NON_CAUSAL_FRAMING = 'This is an association, not proof that one caused the other.';

/** Shown instead of any estimate whenever the estimator returns `insufficient` — never alongside a number. */
export const INSUFFICIENCY_COPY =
  "There isn't enough data yet to say anything about this. Keep going, or check back once you have more days recorded.";

/** Shown when `ci[0] <= 0 <= ci[1]`, replacing the "X points higher/lower" language for that result. */
export const CI_SPANS_ZERO_COPY =
  "The difference could be real or could be chance — this data doesn't show a clear association either way.";

// ---------------------------------------------------------------------------
// Shared series-builder helper (the carry-forward fix from Task 3's review).
// `preflight.js` imports `exposureValueForEntry` from here instead of
// keeping its own copy, so preflight coverage and result-series agree.
// ---------------------------------------------------------------------------

/**
 * Health-signal fields where a null/non-finite value from
 * `extractHealthSignals` is ambiguous between "no data for this field at
 * all" and "true zero coerced to null by `healthContext.activity?.X ||
 * null`" (see module doc comment). Only these two fields carry that
 * ambiguity today — every other health field's `|| null` is a genuine
 * "unmeasured" signal (sleep/recovery/HRV never legitimately read as a
 * meaningful zero the way exercise minutes or steps can). Maps the
 * extractor's output key to the RAW key on `healthContext.activity` so the
 * known-zero check can be precise about which specific field is present,
 * not just whether the `activity` object exists at all.
 */
const ACTIVITY_ZERO_FIELDS = new Set(['exerciseMinutes', 'steps']);
const ACTIVITY_RAW_KEY = { exerciseMinutes: 'totalExerciseMinutes', steps: 'stepsToday' };

/**
 * The exposure value for one entry given a FROZEN plan/template `exposure`
 * descriptor (`{source, field}` — health/environment/tags), or `null` when
 * this entry carries no usable value for that variable (dropped from the
 * series entirely — never coerced to 0), EXCEPT:
 *   - `source: 'health'`, `field` in `ACTIVITY_ZERO_FIELDS`: the RAW field
 *     on `healthContext.activity` (`totalExerciseMinutes`/`stepsToday`) is
 *     checked directly. Present AND `=== 0` -> KNOWN ZERO (`0`, kept).
 *     Absent entirely (even if `healthContext.activity` has OTHER fields
 *     populated — e.g. steps present but exercise minutes never recorded)
 *     -> MISSING for that field (`null`, dropped). See module doc comment.
 *   - `source: 'tags'`: "no tag present that day" is itself a real, known
 *     observation (`0`), not a missing one, as long as the day was
 *     journaled at all (an entry exists) — see the tags branch below.
 *
 * @param {object} entry
 * @param {{source:'health'|'environment'|'tags', field:string}} exposure
 * @param {string} [tag] - required only when `exposure.source === 'tags'`.
 * @returns {number|null}
 */
export function exposureValueForEntry(entry, exposure, tag) {
  const { source, field } = exposure || {};
  if (source === 'health') {
    const healthContext = entry?.healthContext;
    const signals = extractHealthSignals(healthContext);
    if (!signals) return null; // no health data at all -> missing
    const raw = signals[field];
    if (Number.isFinite(raw)) return raw;
    if (ACTIVITY_ZERO_FIELDS.has(field)) {
      const rawKey = ACTIVITY_RAW_KEY[field];
      const activity = healthContext?.activity;
      if (
        activity &&
        typeof activity === 'object' &&
        Object.prototype.hasOwnProperty.call(activity, rawKey) &&
        activity[rawKey] === 0
      ) {
        // The raw field IS present for this day and is an explicit zero;
        // the extractor coerced it to null. Known-zero, not missing.
        return 0;
      }
    }
    return null; // genuinely unmeasured (raw field absent, or a non-activity field with no signal)
  }
  if (source === 'environment') {
    const signals = extractEnvironmentSignals(entry?.environmentContext);
    const v = signals ? signals[field] : null;
    return Number.isFinite(v) ? v : null;
  }
  if (source === 'tags') {
    if (typeof tag !== 'string' || !tag) return null; // no tag chosen -> can't evaluate at all
    if (!Array.isArray(entry?.tags)) return 0; // day was journaled; tag is known absent
    return entry.tags.includes(tag) ? 1 : 0;
  }
  return null;
}

/**
 * The outcome value for one entry given a FROZEN plan/template `outcome`
 * descriptor. v1 templates always declare `{field: 'analysis.mood_score'}`
 * (`templates.js`'s fixed `MOOD_OUTCOME`); the dotted-path lookup below is a
 * small forward-compat allowance, not a sign this ever varies today.
 *
 * @param {object} entry
 * @param {{field:string}} outcome
 * @returns {number|null}
 */
export function outcomeValueForEntry(entry, outcome) {
  const path = outcome?.field || 'analysis.mood_score';
  const raw = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), entry);
  return Number.isFinite(raw) ? raw : null;
}

// ---------------------------------------------------------------------------
// Date-key helpers (mirrors preflight.js's own minimal, intentionally
// duplicated UTC dateKey parsing — see task-3-report.md's self-review note
// on why these small helpers aren't shared/exported from estimator.js,
// which only exports its three public functions and two constants).
// ---------------------------------------------------------------------------

/** The entry's calendar day, as a 'YYYY-MM-DD' UTC dateKey, or null if undated. */
function entryDateKey(entry) {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

function entryTimestampMs(entry) {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// ---------------------------------------------------------------------------
// buildDaySeries — the shared series-builder (exported per Task 5 brief).
// Groups entries by calendar day, extracts each entry's value via
// `valueForEntry`, and — when more than one entry on the same day yields a
// usable value — takes their mean (see module doc comment). Output is
// sorted by dateKey, so the resulting series (and everything downstream:
// pairing, coverage, the bootstrap seed) is independent of `entries`' input
// order, matching `estimator.js`'s own order-independence guarantee.
// ---------------------------------------------------------------------------

/**
 * @param {Array} entries
 * @param {(entry:object) => number|null} valueForEntry
 * @returns {{dateKey:string, value:number}[]}
 */
export function buildDaySeries(entries, valueForEntry) {
  const byDate = new Map();
  for (const entry of entries || []) {
    const dateKey = entryDateKey(entry);
    if (!dateKey) continue;
    const value = valueForEntry(entry);
    if (value === null || !Number.isFinite(value)) continue;
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(value);
  }
  return [...byDate.keys()].sort().map((dateKey) => {
    const values = byDate.get(dateKey);
    const value = values.reduce((a, b) => a + b, 0) / values.length;
    return { dateKey, value };
  });
}

/** Group entries by calendar dateKey (for receipt-source lookups — every entry on the day, not just ones with a usable value). */
function groupEntriesByDateKey(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    const dateKey = entryDateKey(entry);
    if (!dateKey) continue;
    if (!map.has(dateKey)) map.set(dateKey, []);
    map.get(dateKey).push(entry);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Narrative assembly — ONLY the template's fixed strings + this module's
// fixed strings, with numbers slotted in. No free text, no LLM.
// ---------------------------------------------------------------------------

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

function formatMissingness(exposureCoverage, outcomeCoverage) {
  return `Exposure: ${exposureCoverage.label}. Outcome: ${outcomeCoverage.label}.`;
}

/** `covered/total` as a ratio in [0,1]; `computeCoverage` always returns `total >= 1`, so no div-by-zero guard needed. */
function coverageRatio(coverage) {
  return coverage.total > 0 ? coverage.covered / coverage.total : 0;
}

/**
 * Build the `narrative.summary` sentence for an `ok` result. The sentence
 * SCAFFOLD (which numbers get slotted where) is this module's own — the
 * data-method spec's "Fixed strings" section explicitly leaves this
 * template-specific slotting to Task 5 ("the sentences above are the fixed
 * scaffolding those numbers get slotted into"). The two clauses that ARE
 * spec-fixed (`NON_CAUSAL_FRAMING`, and `CI_SPANS_ZERO_COPY` when the CI
 * spans zero) are always appended/substituted verbatim, never paraphrased.
 */
function buildSummary({ exposureLabel, outcomeLabel, estimate, ciSpansZero }) {
  const { delta, n } = estimate;
  if (ciSpansZero) {
    return (
      `On days with more ${exposureLabel} than usual, compared to days with less ` +
      `(based on ${n} paired days): ${CI_SPANS_ZERO_COPY} ${NON_CAUSAL_FRAMING}`
    );
  }
  const direction = delta >= 0 ? 'higher' : 'lower';
  const magnitude = roundToOneDecimal(Math.abs(delta));
  return (
    `On days with more ${exposureLabel} than usual, ${outcomeLabel} averaged ${magnitude} points ` +
    `${direction} than on days with less (based on ${n} paired days). ${NON_CAUSAL_FRAMING}`
  );
}

/**
 * Build the receipt for a result — the union of entries dated on each
 * pair's `dateKey` AND `outcomeDateKey` (handles lag templates, where a day
 * can contribute as an outcome for one pair and an exposure for another),
 * deduped by entry id, safety-filtered (see SAFETY comment below), then
 * mapped via `sourceFromEntry`. Shared by both the `ok` and `insufficient`
 * paths — every result carries a receipt (receipt invariant).
 */
function buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage }) {
  const entriesByDateKey = groupEntriesByDateKey(windowed);
  const contributing = [];
  const seenIds = new Set();
  for (const pair of pairs) {
    const dayEntries = [
      ...(entriesByDateKey.get(pair.dateKey) || []),
      ...(entriesByDateKey.get(pair.outcomeDateKey) || []),
    ];
    for (const entry of dayEntries) {
      const id = entry?.id || entry?.entryId;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      contributing.push(entry);
    }
  }
  // SAFETY (binding): flagged entries are INCLUDED in the statistics above
  // (they're the user's own data; excluding them would bias the mood
  // estimate) but NEVER appear in receipt source excerpts — id and excerpt
  // both, matching Session Prep export's posture
  // (`src/services/reflections/sessionPrep.js`'s `safeDates` filter).
  const safeContributing = contributing.filter(
    (entry) => entry && !entry.safety_flagged && !entry.has_warning_indicators,
  );
  const receiptSources = safeContributing.map(sourceFromEntry).filter(Boolean);

  return buildReceipt({
    sources: receiptSources,
    scope: experiment.scope ?? null,
    timeWindow: { start: experiment.startAt, end: new Date(effectiveEndMs).toISOString() },
    sampleSize: pairs.length,
    missingness: formatMissingness(exposureCoverage, outcomeCoverage),
    generator: 'experiment_v1',
  });
}

/**
 * Build the `status: 'insufficient'` result shape. `reasons` are the
 * machine-readable tokens (coverage-floor and/or estimator reasons) — see
 * the module doc comment's "COVERAGE FLOOR ENFORCEMENT" section. `estimate`
 * and `narrative.summary` are never assigned (true key absence, not
 * `undefined`), matching the payload-exactness contract.
 */
function buildInsufficientResult({ coverage, reasons, windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage }) {
  const receipt = buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage });
  return {
    status: 'insufficient',
    coverage,
    receipt,
    reasons,
    narrative: {
      alternatives: [],
      whatThisDoesNotProve: [],
      insufficiency: INSUFFICIENCY_COPY,
    },
  };
}

// ---------------------------------------------------------------------------
// computeExperimentResult
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {Object} args.experiment - the experiment doc (including the FROZEN
 *   `analysisPlan`, `scope`, `startAt`, `endAt`, `excludedObservations`).
 * @param {Array} args.entries - the user's journal entries (unfiltered by
 *   scope — this function applies strict scope filtering itself).
 * @param {Date|string|number} args.now - REQUIRED; no internal `new Date()`
 *   default (mirrors `preflight.js`/`estimator.js`'s purity posture).
 * @returns {{status:'ok'|'insufficient', estimate?:object,
 *   coverage:{exposure:object, outcome:object}, receipt:object,
 *   reasons?:string[], narrative:{summary?:string, alternatives:string[],
 *     whatThisDoesNotProve:string[], insufficiency?:string}}} `reasons` is
 *   present only when `status: 'insufficient'` (coverage-floor and/or
 *   estimator reasons — see the module doc comment).
 */
export function computeExperimentResult({ experiment, entries = [], now } = {}) {
  if (!experiment || typeof experiment !== 'object') {
    throw new Error('computeExperimentResult: a valid experiment is required.');
  }
  const plan = experiment.analysisPlan;
  if (!plan || typeof plan.exposure !== 'object' || typeof plan.outcome !== 'object') {
    throw new Error('computeExperimentResult: experiment.analysisPlan (with exposure/outcome) is required.');
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  if (now == null || Number.isNaN(nowDate.getTime())) {
    throw new Error('computeExperimentResult: a valid `now` is required.');
  }
  const startMs = Date.parse(experiment.startAt);
  const declaredEndMs = Date.parse(experiment.endAt);
  if (Number.isNaN(startMs) || Number.isNaN(declaredEndMs)) {
    throw new Error('computeExperimentResult: experiment.startAt/endAt must be valid ISO timestamps.');
  }
  const effectiveEndMs = Math.min(declaredEndMs, nowDate.getTime());

  // --- scopeFilter -> date-window filter --------------------------------
  const scoped = filterEntriesByScope(Array.isArray(entries) ? entries : [], experiment.scope ?? null);
  const windowed = scoped.filter((entry) => {
    const ts = entryTimestampMs(entry);
    return ts !== null && ts >= startMs && ts < effectiveEndMs;
  });

  // --- build exposure/outcome day-series (shared series-builder) --------
  const exposureSeries = buildDaySeries(windowed, (entry) =>
    exposureValueForEntry(entry, plan.exposure, plan.exposure?.tag),
  );
  const outcomeSeries = buildDaySeries(windowed, (entry) => outcomeValueForEntry(entry, plan.outcome));

  // --- coverage over the EXPERIMENT window (not preflight's 28d window) --
  const exposureCoverage = computeCoverage(exposureSeries, startMs, effectiveEndMs);
  const outcomeCoverage = computeCoverage(outcomeSeries, startMs, effectiveEndMs);
  const coverage = { exposure: exposureCoverage, outcome: outcomeCoverage };

  // --- pair, then drop excludedObservations dateKeys (per-pair, see doc) -
  const allPairs = pairObservations({ exposureSeries, outcomeSeries, lag: plan.lag });
  const excludedSet = new Set(Array.isArray(experiment.excludedObservations) ? experiment.excludedObservations : []);
  const pairs = allPairs.filter((p) => !excludedSet.has(p.dateKey));

  // --- coverage floor (spec default #2 — see module doc comment) ---------
  // estimator.runAnalysisPlan deliberately does NOT enforce this itself;
  // this module is the caller its docblock says must check coverage BEFORE
  // trusting an otherwise-`ok` analysis.
  const coverageReasons = [];
  if (coverageRatio(exposureCoverage) < COVERAGE_FLOOR) coverageReasons.push('exposure_coverage_below_floor');
  if (coverageRatio(outcomeCoverage) < COVERAGE_FLOOR) coverageReasons.push('outcome_coverage_below_floor');

  // --- narrative fixed strings: FROZEN plan snapshot first, catalog fallback
  const template = getTemplateById(plan.templateId);
  const exposureLabel = plan.exposure?.label || template?.exposure?.label || 'this variable';
  const outcomeLabel = plan.outcome?.label || template?.outcome?.label || 'mood';
  const alternatives = Array.isArray(plan.confounders)
    ? [...plan.confounders]
    : [...(template?.confounders || [])];
  const whatThisDoesNotProve = Array.isArray(plan.whatThisDoesNotProve)
    ? [...plan.whatThisDoesNotProve]
    : [...(template?.whatThisDoesNotProve || [])];

  if (coverageReasons.length > 0) {
    // Coverage floor already fails for at least one variable — disqualifying
    // on its own. Cheaply check pair count too (no bootstrap: runAnalysisPlan
    // only pays for its 2,000-resample bootstrap once every OTHER check has
    // already passed) so the reasons list isn't artificially truncated to
    // "whichever check happened to run first."
    const reasons = [...coverageReasons];
    if (pairs.length < MIN_PAIRED_OBSERVATIONS) {
      reasons.push('insufficient_paired_observations');
    }
    return buildInsufficientResult({
      coverage,
      reasons,
      windowed,
      pairs,
      experiment,
      effectiveEndMs,
      exposureCoverage,
      outcomeCoverage,
    });
  }

  // --- estimator: the FROZEN plan is the authority ------------------------
  const analysis = runAnalysisPlan({ pairs, plan });

  if (analysis.status !== 'ok') {
    return buildInsufficientResult({
      coverage,
      reasons: analysis.reasons,
      windowed,
      pairs,
      experiment,
      effectiveEndMs,
      exposureCoverage,
      outcomeCoverage,
    });
  }

  // --- receipt: contributing PAIRED entries, safety-filtered -------------
  const receipt = buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage });

  const { estimate } = analysis;
  const ciSpansZero = estimate.ci[0] <= 0 && 0 <= estimate.ci[1];
  const summary = buildSummary({ exposureLabel, outcomeLabel, estimate, ciSpansZero });

  return {
    status: 'ok',
    estimate,
    coverage,
    receipt,
    narrative: {
      summary,
      alternatives,
      whatThisDoesNotProve,
    },
  };
}

export default {
  NON_CAUSAL_FRAMING,
  INSUFFICIENCY_COPY,
  CI_SPANS_ZERO_COPY,
  exposureValueForEntry,
  outcomeValueForEntry,
  buildDaySeries,
  computeExperimentResult,
};
