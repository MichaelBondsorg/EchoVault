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
 * lookback window) is compared against the plan's OWN frozen
 * `coverageFloor` (see "FROZEN THRESHOLD SNAPSHOT" below; falls back to
 * `COVERAGE_FLOOR` imported from `estimator.js` for a legacy plan with no
 * snapshot) BEFORE trusting an otherwise-`ok` analysis. Without this check,
 * a sparse-but-lucky sample (e.g. sleep data on only 12 of 60 elapsed days,
 * all 12 of which happen to pair with mood) can clear the minimum
 * paired-observations threshold on raw pair count alone while still being a
 * biased, non-representative slice of the window — exactly the failure mode
 * default #2 exists to catch. When either variable's coverage ratio is
 * below the effective floor, the result is `insufficient` regardless of
 * what `runAnalysisPlan` would have said, with machine-readable
 * `reasons: string[]` (`'exposure_coverage_below_floor'` /
 * `'outcome_coverage_below_floor'`, snake_case matching `preflight.js`'s
 * token style so Task 6 can render both uniformly) at the top level of the
 * result — present only when `status: 'insufficient'`, mirroring the
 * absence-not-undefined pattern already used for `estimate`/`summary`. When
 * coverage already fails, this module still cheaply checks `pairs.length <
 * effectiveMinPairedObservations` (no bootstrap — that check is O(1) and
 * doesn't invoke `runAnalysisPlan`'s expensive resampling) so
 * `'insufficient_paired_observations'` can appear alongside a coverage
 * reason when both are true; it does NOT additionally invoke the full
 * `runAnalysisPlan` in that branch (which would spend 2,000 bootstrap
 * resamples computing an estimate that's going to be discarded anyway) —
 * so `'degenerate_exposure_split'`/`'lag_mismatch'` are only surfaced when
 * coverage passes and `runAnalysisPlan` itself is the one that fails.
 *
 * FROZEN THRESHOLD SNAPSHOT (Important review fix, R3 final review):
 * `experimentsService.buildAnalysisPlan` has always snapshotted
 * `minPairedObservations`/`coverageFloor` (the estimator's spec constants at
 * the moment the plan was created) onto `experiment.analysisPlan`, with a
 * docblock promising they "never change for the life of the experiment" —
 * but until this fix nothing ever READ those two fields back, so the
 * promise was decorative: every experiment silently used whatever
 * `MIN_PAIRED_OBSERVATIONS`/`COVERAGE_FLOOR` happen to be live in
 * `estimator.js` today, even if the spec's thresholds were revised (through
 * their own re-sign-off process, see the data-method spec's "Note on
 * default #1/#2 thresholds") after this experiment was created — the exact
 * opposite of a freeze. This module now reads
 * `plan.minPairedObservations ?? MIN_PAIRED_OBSERVATIONS` and
 * `plan.coverageFloor ?? COVERAGE_FLOOR` (the `??` fallback keeps a LEGACY
 * plan written before the snapshot existed working unchanged) and uses
 * those effective values for both the coverage-floor comparison above and
 * the paired-observations check below. `runAnalysisPlan` itself is NOT
 * given a plan-supplied threshold — its own docblock is explicit that
 * `plan` is accepted for forward-compat/lag-validation only and its
 * ≥`MIN_PAIRED_OBSERVATIONS` gate is a fixed module constant, not a knob
 * (data-method spec default #7: one pre-declared estimate, not something
 * tunable after the fact) — so this module enforces the plan's OWN
 * paired-observations threshold itself, BEFORE ever calling
 * `runAnalysisPlan`, rather than trying to thread it through. Practically,
 * this makes `estimator.js`'s `MIN_PAIRED_OBSERVATIONS` a FLOOR OF LAST
 * RESORT underneath the plan's frozen threshold: a plan that ever snapshots
 * a value LOWER than the module constant (not expected in practice — the
 * only way to change the constant is the spec's sign-off process, and this
 * module has no code path that writes a lower value) would still be
 * blocked by `runAnalysisPlan`'s own internal check once pairs are handed
 * to it, since that check is never bypassed or overridden here.
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
import { pairObservations, runAnalysisPlan, computeCoverage, MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR, SMALL_EFFECT_DELTA } from './estimator';
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

/**
 * Shown when `ci[0] <= 0 <= ci[1]`, replacing the "X points higher/lower"
 * language for that result. VALUE REPLACED 2026-07-22 (Michael review
 * hardening, Task EX1 correction, action item for EX2): the constant NAME
 * stays `CI_SPANS_ZERO_COPY` per EX1's instruction — only the string
 * literal changes, to the data-method spec's new fixed wording (see
 * "Fixed strings" section, "REPLACED 2026-07-22").
 */
export const CI_SPANS_ZERO_COPY =
  'These recorded days are compatible with both higher and lower mood; no consistent direction appears.';

/**
 * Practical-significance framing (Michael review hardening, EX1 item 5/H5,
 * wired by EX2): appended alongside a directional (non-CI-spans-zero)
 * headline whenever `|delta| < SMALL_EFFECT_DELTA` (estimator.js's single
 * source-of-truth constant, 0-100 display-scale points) — see
 * `buildSummary`'s doc comment for exactly when/how this is appended.
 */
export const SMALL_EFFECT_COPY =
  'This difference is small — worth noticing, not worth reorganizing your life around.';

/**
 * Stability caveat (final hardening review — H4 wiring): appended to
 * `narrative.summary` whenever `estimate.stability.signConsistent` is
 * `false` — see `docs/quality/experiments-data-method.md`'s H4 row and
 * "Fixed strings" section (this string is copied verbatim from there, per
 * default #8's frozen-strings convention). H4 (Michael review hardening,
 * `estimator.js`) computes `stability` but deliberately never decides how to
 * present it — this is the narrative layer's decision, wired here. Appended
 * AFTER every other clause (small-effect suffix included, whether or not the
 * CI spans zero) — this is a caveat about the estimate's OWN fragility,
 * layered on top of whatever headline was already shown, never a
 * replacement for it. When `signConsistent` is `true`, nothing is appended —
 * the result-view's "How this was computed" section already covers the
 * positive case with its own stability line.
 */
export const STABILITY_CAVEAT_COPY =
  'This direction was not consistent — removing a single day could flip it, so hold this result especially lightly.';

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
 * ambiguity today — every other health field's `|| null` is treated as a
 * genuine "unmeasured" signal here (recovery/HRV essentially never read as
 * a meaningful zero). `sleepHours` is a known, ACCEPTED gap in that
 * treatment, not a case where the same ambiguity is provably absent: a
 * true zero-sleep night is a real (if rare) possibility, and
 * `healthFormatter.js`'s `sleep?.totalHours || null` coerces it to
 * indistinguishable-from-missing exactly like the exerciseMinutes/steps bug
 * this fix addresses — this module just doesn't extend the known-zero fix
 * to it (out of scope for this task; see
 * `docs/quality/experiments-data-method.md`'s revisit list). Maps the
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
    // MISSING TAGS = UNKNOWN (Michael review hardening, EX2 item 4): a day
    // contributes to the tag-presence series ONLY when the entry carries an
    // EXPLICIT `tags` array — that is the signal that this entry was
    // actually analyzed for tags at all. A legacy entry, or one whose
    // analysis failed before tags were ever attached, has NO `tags` field —
    // that is a genuinely UNKNOWN observation for this variable (dropped,
    // like any other missing value), not a known "tag absent" day. This is
    // a deliberate REVERSAL of this module's pre-EX2 behavior (which
    // treated a missing `tags` array as a known 0/absent) — the old
    // behavior silently manufactured false "absent" data points out of
    // entries that were never actually screened for the tag at all,
    // biasing the LOW group with observations that don't actually tell you
    // anything about tag presence.
    if (!Array.isArray(entry?.tags)) return null; // no explicit tags array -> unknown, dropped
    return entry.tags.includes(tag) ? 1 : 0; // explicit array, tag absent -> a REAL known 0
  }
  return null;
}

/**
 * Mood normalization (Michael review hardening, EX2 item 1 — launch
 * blocker; REWRITTEN in Michael's round-2 statistical review, 2026-07-22,
 * item 3 — see docs/quality/experiments-data-method.md's "Round-2" section).
 * `analysis.mood_score` is captured on a 0-1 scale, but every estimate/CI/
 * narrative in this pipeline is on a 0-100 "points" display scale —
 * rendering a raw 0-1 delta as "points" made ordinary differences look 100x
 * smaller than they are. This function is the ONE place that conversion
 * happens (the "series-builder boundary" the plan names).
 *
 * EXPLICIT SCHEMA (round-2, binding): `plan.outcome.unit === 'mood_0_100'`
 * means EXACTLY this, and nothing else — source field `analysis.mood_score`
 * on the 0-1 schema; valid domain `[0, 1]` inclusive; transform `x * 100`.
 * A value outside `[0, 1]` (or non-finite) is INVALID under this schema and
 * is REJECTED — returned as `null` (dropped from the series as an unknown
 * observation by `buildDaySeries`, exactly like a genuinely missing value),
 * NEVER clamped or otherwise coerced into range.
 *
 * PRE-ROUND-2 BEHAVIOR (REMOVED, not merely revised): a raw value already
 * `> 1` used to pass through UNMULTIPLIED and be clamped to `[0, 100]` — a
 * defensive allowance for a hypothetical legacy/future writer already
 * storing an already-0-100 number. Michael's round-2 review: "computeResult.js
 * treats values at or below 1 as proportions and larger values as
 * percentages, then clamps out-of-range data. This conflicts with the
 * plan's 'never infer units from magnitude' principle." That passthrough
 * branch is deleted entirely — there is no longer any code path in this
 * function that infers a different unit from how large a number happens to
 * be, or that silently converts an out-of-range value into `0` or `100`.
 * If a future writer ever needs to store mood on a different scale, that
 * needs its OWN explicit `plan.outcome.unit` value (see
 * `computeExperimentResult`'s outcome-unit gate, which already fails the
 * whole result closed — `unknown_outcome_unit` — for any unit string other
 * than `'mood_0_100'`), not a magnitude guess inside this function.
 *
 * Callers never see WHY a value was rejected from this function alone
 * (`null` is the same signal as "missing") — the count of REJECTED (as
 * opposed to genuinely missing) observations is tracked separately by
 * `countInvalidOutcomeObservations` below and surfaced on the result as
 * `invalidObservationCount`, disclosed to the user when `> 0`.
 *
 * @param {number} raw
 * @returns {number|null} `null` when `raw` is not finite OR outside `[0, 1]`.
 */
export function normalizeMoodTo100(raw) {
  if (!Number.isFinite(raw)) return null;
  if (raw < 0 || raw > 1) return null; // outside the declared domain -> INVALID, dropped (never clamped/converted)
  return raw * 100;
}

/**
 * Count observations whose raw outcome value is a FINITE number but OUTSIDE
 * the `mood_0_100` schema's declared domain `[0, 1]` (Michael's round-2
 * statistical review, item 3) — these are the ones `normalizeMoodTo100`
 * rejects as INVALID (as opposed to genuinely missing/non-finite, which is
 * the ordinary, already-disclosed-via-coverage case and is NOT counted
 * here). Only meaningful when `outcome.unit === 'mood_0_100'` — any other
 * (or absent) unit returns `0` unconditionally, since `computeExperimentResult`
 * already fails the whole result closed (`unknown_outcome_unit`) before an
 * invalid-domain count would mean anything for a different unit.
 *
 * Disclosed on the result as `invalidObservationCount` (present, possibly
 * `0`, on BOTH `ok` and `insufficient` results — same "always present"
 * convention as `sensitiveObservationCount`) and, when `> 0`, shown in the
 * UI as a single calm sentence ("N observations had out-of-range values and
 * were not used.").
 *
 * @param {Array} entries - the windowed (post scope/date-filter) entries.
 * @param {{field?:string, unit?:string}} outcome
 * @returns {number}
 */
function countInvalidOutcomeObservations(entries, outcome) {
  if (outcome?.unit !== 'mood_0_100') return 0;
  const path = outcome?.field || 'analysis.mood_score';
  let count = 0;
  for (const entry of entries || []) {
    const raw = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), entry);
    if (Number.isFinite(raw) && (raw < 0 || raw > 1)) count += 1;
  }
  return count;
}

/**
 * The outcome value for one entry given a FROZEN plan/template `outcome`
 * descriptor. v1 templates always declare `{field: 'analysis.mood_score',
 * unit: 'mood_0_100'}` (`templates.js`'s fixed `MOOD_OUTCOME`); the
 * dotted-path lookup below is a small forward-compat allowance, not a sign
 * the field path ever varies today.
 *
 * UNIT HANDLING: when `outcome.unit === 'mood_0_100'` (the only value any
 * v1 template ever declares), the raw value is normalized via
 * `normalizeMoodTo100` above. `computeExperimentResult` is the caller that
 * enforces the unit is RECOGNIZED before ever reaching this function for
 * real work (an unrecognized/absent unit fails the whole result closed
 * with `unknown_outcome_unit` — see that function's doc comment) — this
 * function itself stays a pure, direct pass-through for any other unit
 * value, since by the time it's called in the real pipeline the unit has
 * already been validated.
 *
 * @param {object} entry
 * @param {{field:string, unit?:string}} outcome
 * @returns {number|null}
 */
export function outcomeValueForEntry(entry, outcome) {
  const path = outcome?.field || 'analysis.mood_score';
  const raw = path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), entry);
  if (!Number.isFinite(raw)) return null;
  if (outcome?.unit === 'mood_0_100') return normalizeMoodTo100(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Local-timezone date-key helpers (Michael review hardening, EX2 item 2).
//
// Pre-EX2, every dateKey in this pipeline was a UTC calendar day. That's
// wrong for a journaling app: a user in America/Los_Angeles writing an
// entry at 9pm local time is, in UTC, already on the NEXT calendar day —
// their entry would silently get grouped/paired under tomorrow's date. Every
// dateKey this module produces is now derived in the experiment's FROZEN
// `analysisPlan.timezone` (an IANA zone string, snapshotted once at create
// time by `experimentsService.buildAnalysisPlan` from the device's timezone
// at that moment — see that function's doc comment) via `Intl` parts only
// (no date library). `preflight.js` mirrors this exact helper for its own
// (plan-less, device-tz) window, and mirrors the "minimal, intentionally
// duplicated" convention this module's date helpers have always followed
// (see task-3-report.md's self-review note on why these aren't shared/
// exported from estimator.js).
//
// TWO DISTINCT NUMBER SPACES are used deliberately, and must never be
// confused:
//   - "REAL ms": a true UTC epoch instant (e.g. an entry's actual
//     timestamp, or the true wall-clock instant of local midnight) — used
//     to decide whether a specific entry TIMESTAMP falls inside the
//     experiment's window.
//   - "PSEUDO ms" (`pseudoMsFromDateKey`): `Date.UTC(y, m-1, d)` for a
//     dateKey STRING, treating the label as if it were UTC midnight. This
//     is NOT a real instant — it's a pure label->number mapping used only
//     for comparing/day-counting dateKeys against each other, matching
//     EXACTLY how `estimator.js`'s own (private, unchanged) dateKey parsing
//     works internally. `computeCoverage` (estimator.js) is UNCHANGED and
//     still does its own pseudo-ms parsing of whatever dateKeys it's
//     handed — so the start/end bounds THIS module passes to it must also
//     be in pseudo-ms space (built the same way), not real wall-clock ms,
//     or the two would silently disagree at zone-offset boundaries.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Resolve the device's IANA timezone (never throws), falling back to 'UTC'. Used only where no frozen plan timezone exists (preflight.js's own window). */
export function resolveDeviceTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The local ('YYYY-MM-DD') calendar dateKey for a UTC epoch ms instant, in `timeZone`. `en-CA` formats as `YYYY-MM-DD` directly — no manual part-reassembly needed for this direction. */
export function localDateKeyForMs(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(new Date(ms));
}

/** Parse a 'YYYY-MM-DD' dateKey into its PSEUDO UTC-midnight epoch ms (`Date.UTC(y,m-1,d)`) — a label->number mapping for day-counting/ordering, NOT a real instant. See module doc comment. */
export function pseudoMsFromDateKey(dateKey) {
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Shift a 'YYYY-MM-DD' dateKey by `days` (may be negative) — pure calendar-day arithmetic on the label, timezone-independent once you have the key. */
export function shiftLocalDateKey(dateKey, days) {
  const ms = pseudoMsFromDateKey(dateKey);
  if (ms === null) return null;
  const shifted = new Date(ms + days * DAY_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** The tz offset (ms, positive when `timeZone` is ahead of UTC) in effect at real instant `ms`. */
function tzOffsetMsAt(ms, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(ms));
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? '00' : map.hour;
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(hour), Number(map.minute), Number(map.second));
  return asUtc - ms;
}

/**
 * The REAL (true wall-clock) UTC epoch ms of LOCAL midnight for a given
 * local 'YYYY-MM-DD' dateKey in `timeZone`. Documented approximation: this
 * evaluates the zone's UTC offset AT the first guess (treating the key as
 * UTC midnight) rather than iterating to a fixed point — for the ~24h
 * window this is used over, a DST transition landing exactly at that one
 * evaluation instant could misplace the boundary by the transition's
 * delta (typically 1h); acceptable for a v1 day-boundary computation and
 * called out here rather than silently assumed exact.
 *
 * Exported so `ExperimentResultView.jsx`'s `buildObservationRows` (a UI-side
 * duplicate of this module's window-boundary logic, for the live
 * observation table — see that file's own doc comment) can reproduce
 * EXACTLY the same partial-start-day window boundary this module uses,
 * rather than re-deriving the DST-approximation trick a second time.
 */
export function localMidnightUtcMs(dateKey, timeZone) {
  const guessPseudoMs = pseudoMsFromDateKey(dateKey);
  const offset = tzOffsetMsAt(guessPseudoMs, timeZone);
  return guessPseudoMs - offset;
}

/** The entry's calendar day, as a local 'YYYY-MM-DD' dateKey in `timeZone` (default 'UTC' for back-compat with direct/unit-test callers), or null if undated. */
function entryDateKey(entry, timeZone = 'UTC') {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  if (Number.isNaN(d.getTime())) return null;
  return localDateKeyForMs(d.getTime(), timeZone);
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
 * @param {string} [timeZone='UTC'] - IANA zone dateKeys are grouped in
 *   (Michael review hardening, item 2). Defaults to 'UTC' for back-compat
 *   with pre-EX2 direct callers/unit tests that don't pass one.
 * @returns {{dateKey:string, value:number}[]}
 */
export function buildDaySeries(entries, valueForEntry, timeZone = 'UTC') {
  const byDate = new Map();
  for (const entry of entries || []) {
    const dateKey = entryDateKey(entry, timeZone);
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

/**
 * CONFIRMED-EXPOSURE series builder (R4 Phase 3 Task 3, action confirmation
 * v1). When `analysisPlan.exposureMode === 'confirmed'`, the exposure
 * day-series comes from the experiment's `confirmations` subcollection
 * (explicit "did you do it" check-ins) instead of tag-scanning journal
 * entries — TRI-STATE, never assumed-absent:
 *   - `done: true`  -> `1` (a real, known "yes")
 *   - `done: false` -> `0` (a real, known "no" — an explicit answer, not a
 *     guess; kept in the series exactly like a tag-scan's real absent-tag
 *     zero)
 *   - no confirmation doc for a dateKey -> the day is OMITTED from the
 *     series entirely (UNKNOWN, matching `buildDaySeries`'s own
 *     never-coerce-missing-to-zero convention)
 * Only confirmations whose `dateKey` falls inside the experiment's own
 * window (the same half-open `[windowStartPseudoMs, windowEndPseudoMs)`
 * bounds `computeCoverage`/`pairObservations` use elsewhere in this module)
 * are counted — a stray confirmation from before start/after end (e.g. a
 * leftover doc from a stopped-then-restarted flow) must not leak into the
 * pairing or coverage math. A malformed confirmation (missing/non-string
 * `dateKey`, non-boolean `done`) is silently dropped, matching this
 * module's general "trust the shape, drop what doesn't fit" posture toward
 * caller-supplied inputs. A duplicate `dateKey` (defensive; the real store
 * has exactly one doc per dateKey) keeps the LAST value seen.
 *
 * @param {Array<{dateKey?:string, done?:boolean}>} confirmations
 * @param {number} windowStartPseudoMs
 * @param {number} windowEndPseudoMs
 * @returns {{dateKey:string, value:number}[]} sorted by dateKey.
 */
export function buildConfirmationSeries(confirmations, windowStartPseudoMs, windowEndPseudoMs) {
  const byDate = new Map();
  for (const c of confirmations || []) {
    if (!c || typeof c.dateKey !== 'string' || !c.dateKey) continue;
    if (typeof c.done !== 'boolean') continue;
    const pseudoMs = pseudoMsFromDateKey(c.dateKey);
    if (pseudoMs === null) continue;
    if (pseudoMs < windowStartPseudoMs || pseudoMs >= windowEndPseudoMs) continue; // outside the experiment window
    byDate.set(c.dateKey, c.done ? 1 : 0);
  }
  return [...byDate.keys()].sort().map((dateKey) => ({ dateKey, value: byDate.get(dateKey) }));
}

/** Group entries by (local, `timeZone`) calendar dateKey (for receipt-source lookups — every entry on the day, not just ones with a usable value). */
function groupEntriesByDateKey(entries, timeZone = 'UTC') {
  const map = new Map();
  for (const entry of entries || []) {
    const dateKey = entryDateKey(entry, timeZone);
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
 * scaffolding those numbers get slotted into"). The clauses that ARE
 * spec-fixed (`NON_CAUSAL_FRAMING`; `CI_SPANS_ZERO_COPY` when the CI spans
 * zero; `SMALL_EFFECT_COPY` per the practical-significance rule below) are
 * always appended/substituted verbatim, never paraphrased.
 *
 * PRACTICAL SIGNIFICANCE (Michael review hardening, EX1 item 5 / H5, wired
 * by EX2): when the CI does NOT span zero (a directional headline is being
 * shown) AND `|delta| < SMALL_EFFECT_DELTA` (the estimator's single
 * source-of-truth constant, display-scale 0-100 points), `SMALL_EFFECT_COPY`
 * is appended AFTER the headline sentence — in ADDITION to, never instead
 * of, the normal "X points higher/lower" language. When the CI spans zero,
 * no small-effect classification is shown at all: `CI_SPANS_ZERO_COPY`
 * already communicates "no clear direction," and layering a second
 * "...and it's small" caveat on top of that would be redundant/confusing
 * (there is no direction for a magnitude judgment to attach to).
 *
 * STABILITY CAVEAT (final hardening review, H4 wiring): when
 * `estimate.stability.signConsistent` is `false`, `STABILITY_CAVEAT_COPY` is
 * appended after every other clause above -- regardless of whether the CI
 * spans zero or a small-effect suffix already fired. Unlike the small-effect
 * suffix, this one is NOT skipped when the CI spans zero: "no clear
 * direction" (CI-spans-zero) and "the direction wasn't stable across single
 * days" (sign-inconsistent) are two different, non-redundant observations
 * about the same estimate. `signConsistent: true` appends nothing here --
 * the result view's own "How this was computed" section covers the positive
 * case.
 */
function buildSummary({ exposureLabel, outcomeLabel, estimate, ciSpansZero }) {
  const { delta, n, stability } = estimate;
  const stabilitySuffix = stability && stability.signConsistent === false ? ` ${STABILITY_CAVEAT_COPY}` : '';
  if (ciSpansZero) {
    return (
      `On days with more ${exposureLabel} than usual, compared to days with less ` +
      `(based on ${n} paired days): ${CI_SPANS_ZERO_COPY} ${NON_CAUSAL_FRAMING}${stabilitySuffix}`
    );
  }
  const direction = delta >= 0 ? 'higher' : 'lower';
  const magnitude = roundToOneDecimal(Math.abs(delta));
  const smallEffectSuffix = Math.abs(delta) < SMALL_EFFECT_DELTA ? ` ${SMALL_EFFECT_COPY}` : '';
  return (
    `On days with more ${exposureLabel} than usual, ${outcomeLabel} averaged ${magnitude} points (0-100) ` +
    `${direction} than on days with less (based on ${n} paired days). ${NON_CAUSAL_FRAMING}${smallEffectSuffix}${stabilitySuffix}`
  );
}

/**
 * Sensitive-day disclosure (Michael review hardening, EX2 item 5): count
 * how many of the given (post-exclusion) `pairs` have at least one
 * contributing entry (on the pair's `dateKey` OR `outcomeDateKey`, same
 * union `buildExperimentReceipt` uses) that is `safety_flagged` or
 * `has_warning_indicators`. This count is PER PAIR, not per raw entry —
 * "N sensitive days contributed to the statistics" is meant to describe
 * paired observations, matching the unit the rest of the result narrative
 * already uses (`estimate.n`, coverage). The underlying entries themselves
 * are NEVER exposed here (no text/excerpt) — only a count.
 */
function countSensitivePairs(windowed, pairs, timeZone) {
  const entriesByDateKey = groupEntriesByDateKey(windowed, timeZone);
  let count = 0;
  for (const pair of pairs) {
    const dayEntries = [
      ...(entriesByDateKey.get(pair.dateKey) || []),
      ...(entriesByDateKey.get(pair.outcomeDateKey) || []),
    ];
    if (dayEntries.some((entry) => entry && (entry.safety_flagged || entry.has_warning_indicators))) {
      count += 1;
    }
  }
  return count;
}

/**
 * Build the receipt for a result — the union of entries dated on each
 * pair's `dateKey` AND `outcomeDateKey` (handles lag templates, where a day
 * can contribute as an outcome for one pair and an exposure for another),
 * deduped by entry id, safety-filtered (see SAFETY comment below), then
 * mapped via `sourceFromEntry`. Shared by both the `ok` and `insufficient`
 * paths — every result carries a receipt (receipt invariant).
 */
function buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage, timeZone }) {
  const entriesByDateKey = groupEntriesByDateKey(windowed, timeZone);
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
  // (`src/services/reflections/sessionPrep.js`'s `safeDates` filter). This
  // is also the sensitive-day disclosure's invariant (item 5): the COUNT is
  // surfaced elsewhere on the result (`sensitiveObservationCount`), but
  // `receipt.sources` continues to exclude these entries entirely, same as
  // before.
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
 * `sensitiveObservationCount` is always present (item 5), even here — the
 * observation table renders in both states, so its hidden-row count must
 * be available regardless of status. `invalidObservationCount` (Michael's
 * round-2 statistical review, item 3) is likewise always present, even
 * here, for the same reason.
 */
function buildInsufficientResult({ coverage, reasons, windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage, timeZone, invalidObservationCount }) {
  const receipt = buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage, timeZone });
  return {
    status: 'insufficient',
    coverage,
    receipt,
    reasons,
    sensitiveObservationCount: countSensitivePairs(windowed, pairs, timeZone),
    invalidObservationCount,
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
 * @param {Array} [args.confirmations] - (R4 Phase 3 Task 3) the experiment's
 *   `confirmations` subcollection docs (`{dateKey, done}`), loaded by the
 *   caller (this function stays Firestore-free) — used ONLY when
 *   `experiment.analysisPlan.exposureMode === 'confirmed'`, to build the
 *   exposure series from explicit check-ins instead of tag-scanning
 *   `entries` (see `buildConfirmationSeries`). Ignored entirely for every
 *   passive/legacy plan — omitting it changes nothing for those, which is
 *   what keeps passive-mode results byte-identical to before this param
 *   existed.
 * @param {Date|string|number} args.now - REQUIRED; no internal `new Date()`
 *   default (mirrors `preflight.js`/`estimator.js`'s purity posture).
 * @returns {{status:'ok'|'insufficient', estimate?:object,
 *   coverage:{exposure:object, outcome:object}, receipt:object,
 *   reasons?:string[], narrative:{summary?:string, alternatives:string[],
 *     whatThisDoesNotProve:string[], insufficiency?:string}}} `reasons` is
 *   present only when `status: 'insufficient'` (coverage-floor and/or
 *   estimator reasons — see the module doc comment). On a `status: 'ok'`
 *   result, `receipt.computation = {nHigh, nLow, splitThreshold,
 *   exposureContrast}` mirrors those four fields off `estimate` (final
 *   hardening review, Important 1) — absent on an `insufficient` result,
 *   which never has an `estimate` to mirror.
 */
export function computeExperimentResult({ experiment, entries = [], confirmations = [], now } = {}) {
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

  // --- LOCAL CALENDAR DAYS + FROZEN TIMEZONE (Michael review hardening,
  // EX2 item 2) ------------------------------------------------------------
  // `plan.timezone` is the IANA zone frozen at create time
  // (`experimentsService.buildAnalysisPlan`); 'UTC' for a legacy plan
  // written before this field existed.
  const timeZone = typeof plan.timezone === 'string' && plan.timezone ? plan.timezone : 'UTC';

  // PARTIAL START DAY RULE (plan-pinned, binding): the experiment window is
  // whole LOCAL calendar days starting the day AFTER `startAt` — day 1 is
  // the first FULL local day. `startAt` can fall at any time of day (the
  // moment the user tapped Start), so the calendar day it falls on is only
  // ever partially observed and is excluded entirely, never partially
  // counted. `day1LocalKey` is that first full day's local dateKey;
  // `windowStartMs` is the TRUE (real, wall-clock) UTC instant of that
  // day's local midnight, used to filter actual entry TIMESTAMPS below.
  const startLocalKey = localDateKeyForMs(startMs, timeZone);
  const day1LocalKey = shiftLocalDateKey(startLocalKey, 1);
  const windowStartMs = localMidnightUtcMs(day1LocalKey, timeZone);

  // Window bounds in PSEUDO-ms (dateKey-label space — see module doc
  // comment) computed HERE, before series-building, so the CONFIRMED-mode
  // exposure series (below) can be filtered to the experiment's own window
  // exactly like `windowed` filters real entry timestamps just below. Also
  // reused, unchanged, by the coverage computation further down.
  const windowStartPseudoMs = pseudoMsFromDateKey(day1LocalKey);
  const windowEndPseudoMs = pseudoMsFromDateKey(localDateKeyForMs(effectiveEndMs, timeZone));

  // --- scopeFilter -> date-window filter (day1 local midnight .. effectiveEnd) --
  const scoped = filterEntriesByScope(Array.isArray(entries) ? entries : [], experiment.scope ?? null);
  const windowed = scoped.filter((entry) => {
    const ts = entryTimestampMs(entry);
    return ts !== null && ts >= windowStartMs && ts < effectiveEndMs;
  });

  // --- build exposure/outcome day-series (shared series-builder, LOCAL
  // dateKeys in the frozen timezone) --------------------------------------
  // CONFIRMED-EXPOSURE MODE (R4 Phase 3 Task 3): when the frozen plan opted
  // into daily check-ins, the exposure series comes from `confirmations`
  // (tri-state — see `buildConfirmationSeries`'s doc comment) instead of
  // tag-scanning `windowed` entries. Every other template/plan (passive,
  // including every legacy plan with no `exposureMode` at all) is
  // completely unaffected — this branch changes nothing about the
  // `buildDaySeries` call for them, which is what keeps passive-mode
  // results byte-identical.
  const confirmedExposureMode = plan.exposureMode === 'confirmed';
  const exposureSeries = confirmedExposureMode
    ? buildConfirmationSeries(confirmations, windowStartPseudoMs, windowEndPseudoMs)
    : buildDaySeries(
      windowed,
      (entry) => exposureValueForEntry(entry, plan.exposure, plan.exposure?.tag),
      timeZone,
    );

  // --- OUTCOME UNIT GATE (Michael review hardening, item 1): the frozen
  // plan MUST declare the recognized 0-100 mood unit before its outcome
  // series is trusted at all. An absent/unrecognized unit fails the WHOLE
  // result closed with a single, unambiguous reason — no coverage/pair-count
  // reason is layered on top, since without a known unit nothing downstream
  // can be trusted enough to report a "why" beyond this. See
  // `outcomeValueForEntry`'s doc comment for the normalization rule itself.
  const unitOk = plan.outcome?.unit === 'mood_0_100';
  const outcomeSeries = unitOk
    ? buildDaySeries(windowed, (entry) => outcomeValueForEntry(entry, plan.outcome), timeZone)
    : [];

  // --- invalid-domain outcome disclosure (Michael's round-2 statistical
  // review, item 3): counted independently of `unitOk` (the helper itself
  // returns 0 for any non-'mood_0_100' unit) so it's always a real, present
  // number on every result, not just the ones that reach a real estimate.
  const invalidObservationCount = countInvalidOutcomeObservations(windowed, plan.outcome);

  // --- coverage over the EXPERIMENT window (not preflight's 28d window) --
  // `windowStartPseudoMs`/`windowEndPseudoMs` were computed above (before
  // series-building, so the confirmed-mode branch could use them too) — see
  // module doc comment for why these are dateKey-label-space bounds, not
  // real wall-clock ms.
  const exposureCoverage = computeCoverage(exposureSeries, windowStartPseudoMs, windowEndPseudoMs);
  const outcomeCoverage = computeCoverage(outcomeSeries, windowStartPseudoMs, windowEndPseudoMs);
  const coverage = { exposure: exposureCoverage, outcome: outcomeCoverage };

  if (!unitOk) {
    return buildInsufficientResult({
      coverage,
      reasons: ['unknown_outcome_unit'],
      windowed,
      pairs: [],
      experiment,
      effectiveEndMs,
      exposureCoverage,
      outcomeCoverage,
      timeZone,
      invalidObservationCount,
    });
  }

  // --- pair, then drop excludedObservations dateKeys (per-pair, see doc) -
  // Pairing/lag arithmetic operates on the dateKey STRINGS only (pure
  // calendar-day math) — tz-agnostic and unchanged from pre-EX2, per the
  // plan's own framing (see module doc comment above and estimator.js).
  const allPairs = pairObservations({ exposureSeries, outcomeSeries, lag: plan.lag });
  const excludedSet = new Set(Array.isArray(experiment.excludedObservations) ? experiment.excludedObservations : []);
  const pairs = allPairs.filter((p) => !excludedSet.has(p.dateKey));

  // --- FROZEN THRESHOLD SNAPSHOT (see module doc comment) -----------------
  // Read the plan's own frozen thresholds; `??` falls back to the live
  // module constants only for a legacy plan written before the snapshot
  // existed. These effective values, not the module constants directly,
  // are what every threshold check below compares against.
  const effectiveMinPairedObservations = Number.isFinite(plan.minPairedObservations)
    ? plan.minPairedObservations
    : MIN_PAIRED_OBSERVATIONS;
  const effectiveCoverageFloor = Number.isFinite(plan.coverageFloor) ? plan.coverageFloor : COVERAGE_FLOOR;

  // --- coverage floor (spec default #2 — see module doc comment) ---------
  // estimator.runAnalysisPlan deliberately does NOT enforce this itself;
  // this module is the caller its docblock says must check coverage BEFORE
  // trusting an otherwise-`ok` analysis.
  const coverageReasons = [];
  if (coverageRatio(exposureCoverage) < effectiveCoverageFloor) coverageReasons.push('exposure_coverage_below_floor');
  if (coverageRatio(outcomeCoverage) < effectiveCoverageFloor) coverageReasons.push('outcome_coverage_below_floor');

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
    if (pairs.length < effectiveMinPairedObservations) {
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
      timeZone,
      invalidObservationCount,
    });
  }

  // --- plan's own paired-observations threshold (see "FROZEN THRESHOLD
  // SNAPSHOT" in the module doc comment) — enforced HERE, before
  // `runAnalysisPlan`, because `runAnalysisPlan` only ever enforces its own
  // fixed module constant (a floor of last resort), never a plan-supplied
  // value. Coverage already passed at this point, so this is the plan's
  // pair-count gate in isolation (no bootstrap spent on data that's going
  // to be discarded anyway).
  if (pairs.length < effectiveMinPairedObservations) {
    return buildInsufficientResult({
      coverage,
      reasons: ['insufficient_paired_observations'],
      windowed,
      pairs,
      experiment,
      effectiveEndMs,
      exposureCoverage,
      outcomeCoverage,
      timeZone,
      invalidObservationCount,
    });
  }

  // --- estimator: the FROZEN plan is the authority (its own internal
  // MIN_PAIRED_OBSERVATIONS check is the floor-of-last-resort described
  // above — see the module doc comment) -----------------------------------
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
      timeZone,
      invalidObservationCount,
    });
  }

  // --- receipt: contributing PAIRED entries, safety-filtered -------------
  const receipt = buildExperimentReceipt({ windowed, pairs, experiment, effectiveEndMs, exposureCoverage, outcomeCoverage, timeZone });

  const { estimate } = analysis;
  const ciSpansZero = estimate.ci[0] <= 0 && 0 <= estimate.ci[1];
  const summary = buildSummary({ exposureLabel, outcomeLabel, estimate, ciSpansZero });

  // PROVENANCE RECEIPT MIRROR (final hardening review, Important 1 — Michael's
  // directive: "nHigh, nLow, the split threshold, and exposure contrast in the
  // result receipt"). `receipt` (`insights/receipts.js`'s `buildReceipt`
  // output) carries no fixed shape in `firestore.rules` (the `result` field is
  // opaque there — verified: `experimentUpdateAllowed` only gates WHEN
  // `result` may be written, never its internal keys), so this additive
  // `computation` map is safe to attach. The UI (`ExperimentResultView.jsx`)
  // still reads these four fields from `estimate` directly, as it already did
  // before this change — this mirror exists so the STORED receipt object
  // itself also honors the directive, independent of what the UI happens to
  // read from.
  receipt.computation = {
    nHigh: estimate.nHigh,
    nLow: estimate.nLow,
    splitThreshold: estimate.splitThreshold,
    exposureContrast: estimate.exposureContrast,
  };

  return {
    status: 'ok',
    estimate,
    coverage,
    receipt,
    sensitiveObservationCount: countSensitivePairs(windowed, pairs, timeZone),
    invalidObservationCount,
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
  SMALL_EFFECT_COPY,
  STABILITY_CAVEAT_COPY,
  resolveDeviceTimezone,
  localDateKeyForMs,
  pseudoMsFromDateKey,
  shiftLocalDateKey,
  localMidnightUtcMs,
  normalizeMoodTo100,
  exposureValueForEntry,
  outcomeValueForEntry,
  buildDaySeries,
  buildConfirmationSeries,
  computeExperimentResult,
};
