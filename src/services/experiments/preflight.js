/**
 * Personal Experiments — preflight review (R3 Task 3).
 *
 * PURE MODULE — given a candidate `{entries, template, params, scope, now}`,
 * reports whether starting this experiment is likely to produce a usable
 * result (PRD: the create flow's "reviews the observations Engram proposes
 * to use" screen). Mirrors the shape of
 * `checkHealthDataSufficiency`/`checkEnvironmentDataSufficiency`
 * (`src/services/health/healthCorrelations.js`,
 * `src/services/environment/environmentCorrelations.js`) but is specific to
 * one template's variable pair rather than "any health/environment data at
 * all", and reuses `computeCoverage` from `estimator.js` rather than
 * reimplementing day-bucketing (spec thresholds — `MIN_PAIRED_OBSERVATIONS`,
 * `COVERAGE_FLOOR` — are also imported from there, never re-hardcoded).
 *
 * Strict scope filtering (`filterEntriesByScope`,
 * `src/services/spaces/scopeFilter.js`) is applied FIRST, before any
 * counting — a scoped preflight only ever sees that scope's entries.
 *
 * `now` is a REQUIRED explicit input (no internal `new Date()`/`Date.now()`
 * default) — this module makes the same purity/determinism promise
 * `estimator.js` documents for itself: every source of "what day is it" is
 * an explicit argument, not an ambient default, so a preflight is a pure
 * function of its arguments and trivially testable at exact boundaries.
 */
import { computeCoverage, MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } from './estimator';
import { filterEntriesByScope } from '../spaces/scopeFilter';
import { extractHealthSignals } from '../health/healthFormatter';
import { extractEnvironmentSignals } from '../environment/environmentFormatter';
import { safeDate } from '../../utils/date';

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_WINDOW_DAYS = 28;
const SHORT_DURATION_DAYS = 14;
const LONG_DURATION_DAYS = 28;

// ---------------------------------------------------------------------------
// Date-key helpers (UTC-based, matching estimator.js's convention — pairing
// and coverage must never depend on the host machine's timezone).
// ---------------------------------------------------------------------------

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateKeyToUtcMs(dateKey) {
  const m = DATE_KEY_RE.exec(dateKey);
  if (!m) return null;
  const [, y, mo, d] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d));
}

/** The entry's calendar day, as a 'YYYY-MM-DD' UTC dateKey, or null if undated. */
function entryDateKey(entry) {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (!raw) return null;
  const d = safeDate(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/** Exclusive end of the "last 28 days" window: start of the UTC day AFTER `now`. */
function windowEndMs(now) {
  const d = safeDate(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + DAY_MS;
}

// ---------------------------------------------------------------------------
// Series builders
// ---------------------------------------------------------------------------

/**
 * The exposure value for one entry, per the template's declared source, or
 * null when this entry carries no usable value for that variable (dropped
 * from the series entirely — never coerced to 0), EXCEPT the tags source,
 * where "no tag present that day" is itself a real, known observation (0),
 * not a missing one — see the tags branch below.
 */
function exposureValueForEntry(entry, template, params) {
  const { source, field } = template.exposure;
  if (source === 'health') {
    const signals = extractHealthSignals(entry.healthContext);
    const v = signals ? signals[field] : null;
    return Number.isFinite(v) ? v : null;
  }
  if (source === 'environment') {
    const signals = extractEnvironmentSignals(entry.environmentContext);
    const v = signals ? signals[field] : null;
    return Number.isFinite(v) ? v : null;
  }
  if (source === 'tags') {
    const tag = params?.tag;
    if (typeof tag !== 'string' || !tag) return null; // no tag chosen -> can't evaluate at all
    if (!Array.isArray(entry.tags)) return 0; // day was journaled; tag is known absent
    return entry.tags.includes(tag) ? 1 : 0;
  }
  return null;
}

function buildExposureSeries(entries, template, params) {
  const series = [];
  for (const entry of entries) {
    const dateKey = entryDateKey(entry);
    if (!dateKey) continue;
    const value = exposureValueForEntry(entry, template, params);
    if (value === null) continue;
    series.push({ dateKey, value });
  }
  return series;
}

function buildOutcomeSeries(entries) {
  const series = [];
  for (const entry of entries) {
    const dateKey = entryDateKey(entry);
    if (!dateKey) continue;
    const value = entry?.analysis?.mood_score;
    if (!Number.isFinite(value)) continue;
    series.push({ dateKey, value });
  }
  return series;
}

// ---------------------------------------------------------------------------
// preflightExperiment
// ---------------------------------------------------------------------------

/**
 * @param {Object} args
 * @param {Array} [args.entries] - the user's journal entries (unfiltered by
 *   scope — this function applies strict scope filtering itself).
 * @param {{exposure:object, outcome:object, confounders:string[]}} args.template
 *   - a template catalog entry (`templates.js`).
 * @param {{tag?: string}} [args.params] - required `params.tag` for the
 *   tag-presence template.
 * @param {{spaceId:string}|null} [args.scope]
 * @param {Date|string|number} args.now - REQUIRED; see module doc comment.
 * @returns {{appropriate: boolean, reasons: string[], availableHistoryDays: number,
 *   expectedCoverage: {exposure: {covered:number,total:number,label:string},
 *     outcome: {covered:number,total:number,label:string}},
 *   missingSources: string[], recommendedDurationDays: 14|28,
 *   confounders: string[]}}
 */
export function preflightExperiment({ entries = [], template, params = {}, scope = null, now } = {}) {
  if (!template || typeof template.exposure !== 'object' || typeof template.outcome !== 'object') {
    throw new Error('preflightExperiment: a valid template is required.');
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  if (now == null || Number.isNaN(nowDate.getTime())) {
    throw new Error('preflightExperiment: a valid `now` is required.');
  }

  const scoped = filterEntriesByScope(Array.isArray(entries) ? entries : [], scope);

  // Available history: how many calendar days back the user's (in-scope)
  // journaling actually goes, uncapped by the 28-day coverage window — this
  // tells the reviewer whether a 28-day experiment is even plausible before
  // it starts, distinct from "coverage within the last 28 days".
  const scopedDateKeys = scoped.map(entryDateKey).filter(Boolean);
  const endMs = windowEndMs(nowDate);
  let availableHistoryDays = 0;
  if (scopedDateKeys.length > 0) {
    const earliestKey = scopedDateKeys.reduce((a, b) => (a < b ? a : b));
    const earliestMs = parseDateKeyToUtcMs(earliestKey);
    if (earliestMs !== null) {
      availableHistoryDays = Math.max(0, Math.round((endMs - earliestMs) / DAY_MS));
    }
  }

  const windowStartMs = endMs - HISTORY_WINDOW_DAYS * DAY_MS;

  const exposureSeries = buildExposureSeries(scoped, template, params);
  const outcomeSeries = buildOutcomeSeries(scoped);

  const exposureCoverage = computeCoverage(exposureSeries, windowStartMs, endMs);
  const outcomeCoverage = computeCoverage(outcomeSeries, windowStartMs, endMs);

  const isTagTemplate = template.exposure.source === 'tags';
  const tagPresentDays = isTagTemplate
    ? new Set(exposureSeries.filter((o) => o.value === 1).map((o) => o.dateKey)).size
    : null;

  const missingSources = [];
  if (template.exposure.source === 'health' && exposureCoverage.covered === 0) {
    missingSources.push('no_health_data');
  }
  if (template.exposure.source === 'environment' && exposureCoverage.covered === 0) {
    missingSources.push('no_environment_data');
  }
  if (isTagTemplate && (tagPresentDays === 0 || typeof params?.tag !== 'string' || !params.tag)) {
    missingSources.push('no_tag_occurrences');
  }
  if (outcomeCoverage.covered === 0) {
    missingSources.push('no_mood_data');
  }

  const exposureRate = exposureCoverage.total > 0 ? exposureCoverage.covered / exposureCoverage.total : 0;
  const outcomeRate = outcomeCoverage.total > 0 ? outcomeCoverage.covered / outcomeCoverage.total : 0;
  const bindingRate = Math.min(exposureRate, outcomeRate);

  const projectedPairsShort = bindingRate * SHORT_DURATION_DAYS;
  const recommendedDurationDays = projectedPairsShort >= MIN_PAIRED_OBSERVATIONS
    ? SHORT_DURATION_DAYS
    : LONG_DURATION_DAYS;
  const projectedPairs = bindingRate * recommendedDurationDays;

  const reasons = [];
  if (projectedPairs < MIN_PAIRED_OBSERVATIONS) {
    reasons.push('projected_pairs_below_minimum');
  }
  if (bindingRate < COVERAGE_FLOOR) {
    reasons.push('coverage_below_floor');
  }
  if (isTagTemplate && (tagPresentDays === 0 || typeof params?.tag !== 'string' || !params.tag)) {
    reasons.push('no_tag_occurrences');
  }
  if (outcomeCoverage.covered === 0) {
    reasons.push('no_mood_data');
  }

  return {
    appropriate: reasons.length === 0,
    reasons,
    availableHistoryDays,
    expectedCoverage: {
      exposure: exposureCoverage,
      outcome: outcomeCoverage,
    },
    missingSources,
    recommendedDurationDays,
    confounders: [...(template.confounders || [])],
  };
}

export default { preflightExperiment };
