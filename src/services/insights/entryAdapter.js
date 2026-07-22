/**
 * Entry Schema Adapter (R4 Task 1 — Insight Integrity, DR finding 2)
 *
 * The basicInsights correlation engines were written against several
 * different, undocumented assumptions about where a field lives on a
 * journal entry document — some correct for the CURRENT write pipeline
 * (`functions/src/analysis/orchestrator.js`), some only ever true for a
 * LEGACY shape, and some (`analysis.themes`/`analysis.emotions`/
 * `analysis.cognitive_patterns`/`analysis.entities`) never true at all —
 * those fields are simply never written by any known writer today. One of
 * the engines (`activityCorrelations.js`) additionally assumed
 * `healthContext.activity` was a STRING and called `.toLowerCase()` on it;
 * it is actually an OBJECT (`{stepsToday, hasWorkout, workouts: [...], ...}`
 * — see `src/services/health/healthFormatter.js`) — a live crash on a real
 * export, verified by the external deep review at HEAD.
 *
 * `normalizeEntryForInsights(entry)` is the ONE place this shape-variance
 * lives. Every basicInsights correlation engine (Task 1) consumes ONLY this
 * function's output — never raw `entry.analysis.*`/`entry.tags`/etc. If a
 * new field-location bug turns up, it gets fixed HERE, not by re-auditing
 * five engine files.
 *
 * ── Tri-state discipline (the review's core demand) ─────────────────────
 * A field can be in one of three states, and engines MUST tell them apart:
 *   1. UNKNOWN     — the field was never computed/written for this entry
 *                     (e.g. every entry today, for `themes`). We have no
 *                     information about the factor either way.
 *   2. known, empty/absent — the field WAS computed and explicitly says
 *                     "no value" (e.g. `tags: []` on an entry that went
 *                     through analysis and simply has no tags).
 *   3. known, present — the field was computed and has a real value.
 *
 * Only (2) may ever count as "factor absent" in a correlation's complement
 * baseline. (1) must be dropped from that analysis entirely — mirrors the
 * "missing tags = UNKNOWN" rule Personal Experiments enforces in
 * `computeResult.js`'s `exposureValueForEntry` (`source: 'tags'` branch):
 * no explicit `tags` array on the entry is a genuinely unknown observation,
 * never a known "tag absent" day. UNKNOWN is exported as a distinct
 * sentinel — never `null`/`[]` — precisely so "unknown" can't silently
 * collapse into "known absent" by accident (`value == null` or
 * `value.length === 0` checks would do exactly that).
 *
 * ── Canonical shape ──────────────────────────────────────────────────────
 * {
 *   id: string|null,            // entry.id || entry.entryId
 *   dateKey: string|null,       // LOCAL 'YYYY-MM-DD' calendar day
 *                                // (device timezone by default), or null
 *                                // if the entry has no usable date at all.
 *   timestampMs: number|null,   // exact instant (epoch ms) behind dateKey —
 *                                // for consumers needing hour/day-of-week,
 *                                // not just the calendar day (e.g.
 *                                // timeCorrelations.js); same
 *                                // effectiveDate??createdAt parse as
 *                                // dateKey, just not truncated to a day.
 *   mood01: number|null,        // 0-1 scale (Mood01 convention). null when
 *                                // missing OR outside the declared [0,1]
 *                                // domain — NEVER fabricated, NEVER
 *                                // clamped/rescaled from a differently-
 *                                // scaled value (mirrors
 *                                // computeResult.js's normalizeMoodTo100
 *                                // INVALID-domain rule). Display conversion
 *                                // (x*100 -> "points") stays the caller's
 *                                // job, same as today.
 *   entryType: string|UNKNOWN,
 *   category: string|UNKNOWN,
 *   tags: string[]|UNKNOWN,      // known-empty [] is a REAL "no tags" —
 *                                // UNKNOWN only when no tags array exists
 *                                // anywhere (top-level OR legacy nested).
 *   entities: Array|UNKNOWN,     // never written by any current writer;
 *                                // resolved from a future top-level/legacy
 *                                // location if one ever appears, else
 *                                // UNKNOWN (not []).
 *   themes: Array|UNKNOWN,       // never written today -> always UNKNOWN
 *                                // unless a future writer populates
 *                                // analysis.themes.
 *   emotions: Array|UNKNOWN,     // same treatment as themes.
 *   cognitivePatterns: Array|UNKNOWN, // same treatment as themes.
 *   memoryMentions: Array|UNKNOWN,
 *   text: string,                // entry.content ?? entry.text ?? ''
 *   hasText: boolean,
 *   healthSignals: Object|null,  // via the REAL extractHealthSignals()
 *                                // (healthFormatter.js), extended with a
 *                                // few fields healthExtendedCorrelations
 *                                // needs that the shared extractor doesn't
 *                                // return (activeCalories/totalCalories/
 *                                // distance/activityTypes) — see below.
 *                                // null only when the entry has no
 *                                // healthContext at all.
 *   adapterVersion: number,      // ADAPTER_VERSION
 * }
 *
 * `healthSignals.activityTypes` is the fix for the `.toLowerCase()` crash:
 * a lowercased string[] built from `healthContext.activity.workouts[].type`
 * / `.activityType` — the REAL place an activity label lives on the object
 * — instead of the (never-true) assumption that `healthContext.activity`
 * itself is a string.
 */

import { extractHealthSignals } from '../health/healthFormatter';
import { localDateKeyForMs, resolveDeviceTimezone } from '../experiments/computeResult';
import { safeDate } from '../../utils/date';

/** Bump when the canonical shape or its field-resolution rules change. */
export const ADAPTER_VERSION = 1;

/**
 * Distinct sentinel for "this field was never computed for this entry" —
 * never equal to `null`, `undefined`, `[]`, or any real value, so a
 * `=== UNKNOWN` check can never accidentally match real data.
 * `Symbol.for` (a registry symbol) so the sentinel compares equal even if
 * this module is somehow evaluated twice (e.g. duplicate bundle chunks).
 */
export const UNKNOWN = Symbol.for('echo-vault.entryAdapter.UNKNOWN');

/** True iff `value` is the UNKNOWN sentinel (not merely falsy). */
export const isUnknown = (value) => value === UNKNOWN;

/**
 * Resolve `entry.id`/`entry.entryId`, or null if the entry has neither.
 */
const resolveId = (entry) => entry?.id || entry?.entryId || null;

/**
 * The entry's effective Date (`effectiveDate ?? createdAt`, coerced), or
 * null if the entry has no usable date. Single parse shared by `dateKey`
 * (LOCAL calendar day) and `timestampMs` (exact instant — needed by
 * `timeCorrelations.js` for hour/day-of-week classification, which a
 * calendar-day dateKey alone can't provide) so both derive from the same
 * parse rather than re-parsing twice. The `effectiveDate ?? createdAt`
 * field-precedence is replicated here in miniature because
 * `computeResult.js`'s own `entryDateKey` composition of that same logic is
 * a private (non-exported) helper — see that module's doc comment for why
 * `effectiveDate` (the user-corrected/backdated date) takes precedence over
 * `createdAt`.
 */
const resolveEntryDate = (entry) => {
  const raw = entry?.effectiveDate ?? entry?.createdAt;
  if (raw == null) return null;
  const d = safeDate(raw);
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
};

/**
 * A finite number strictly within `[0, 1]`, or null. Mirrors
 * `computeResult.js`'s `normalizeMoodTo100` INVALID-domain rule: a
 * non-finite or out-of-range value is REJECTED (dropped as unknown), never
 * clamped or reinterpreted as a different scale.
 */
const resolveMood01 = (raw) => {
  if (!Number.isFinite(raw)) return null;
  if (raw < 0 || raw > 1) return null;
  return raw;
};

/**
 * mood01 resolution order: `analysis.mood_score` (current, authoritative
 * once analysis completes) -> `localAnalysis.mood_score` (pre-analysis
 * local estimate, only ever used if analysis truly has none) ->
 * top-level `mood_score` (defensive, export-shape fallback). Each candidate
 * is independently domain-validated; an out-of-domain candidate is treated
 * as if it were absent and the next candidate is tried, rather than
 * poisoning the result.
 */
const resolveMood = (entry) => {
  const candidates = [
    entry?.analysis?.mood_score,
    entry?.localAnalysis?.mood_score,
    entry?.mood_score,
  ];
  for (const candidate of candidates) {
    const value = resolveMood01(candidate);
    if (value !== null) return value;
  }
  return null;
};

/**
 * String field resolution: prefer the CURRENT top-level location, fall
 * back to the LEGACY nested `analysis.*` location, then UNKNOWN.
 */
const resolveStringField = (topLevelValue, legacyValue) => {
  if (typeof topLevelValue === 'string' && topLevelValue.length > 0) return topLevelValue;
  if (typeof legacyValue === 'string' && legacyValue.length > 0) return legacyValue;
  return UNKNOWN;
};

/**
 * Array field resolution: prefer the CURRENT location (if it's ever
 * populated by a future writer), fall back to LEGACY, then UNKNOWN.
 * A present-but-empty array at either location is KNOWN-EMPTY, not
 * UNKNOWN — the array's mere existence is the signal that this entry was
 * actually processed for this field.
 */
const resolveArrayField = (currentValue, legacyValue) => {
  if (Array.isArray(currentValue)) return currentValue;
  if (Array.isArray(legacyValue)) return legacyValue;
  return UNKNOWN;
};

/**
 * Extended health signals for basicInsights: the shared
 * `extractHealthSignals` plus a few fields `healthExtendedCorrelations`
 * needs that the shared extractor (used by AI-context formatting too)
 * doesn't return, and `activityTypes` — the fix for the activity
 * `.toLowerCase()`-on-an-object crash: a lowercased string[] of workout
 * type labels, the REAL place an activity label lives on
 * `healthContext.activity` (an OBJECT, never a string).
 */
const buildHealthSignals = (healthContext) => {
  const base = extractHealthSignals(healthContext);
  if (!base) return null;

  const activity = healthContext?.activity && typeof healthContext.activity === 'object'
    ? healthContext.activity
    : {};
  const workouts = Array.isArray(activity.workouts) ? activity.workouts : [];
  const activityTypes = workouts
    .map((w) => (w?.type || w?.activityType || '').toString().toLowerCase().trim())
    .filter(Boolean);

  return {
    ...base,
    activeCalories: Number.isFinite(activity.activeCalories) ? activity.activeCalories : null,
    totalCalories: Number.isFinite(activity.totalCalories) ? activity.totalCalories : null,
    distance: Number.isFinite(activity.distance) ? activity.distance : null,
    activityTypes,
  };
};

/**
 * Normalize one raw journal entry into the canonical basicInsights shape.
 * Returns null for a null/non-object `entry` (nothing to normalize) —
 * callers should filter these out (see `normalizeEntriesForInsights`).
 *
 * @param {Object} entry - raw entry as read from Firestore/export.
 * @param {Object} [options]
 * @param {string} [options.timeZone] - IANA zone for `dateKey`; defaults to
 *   the device's resolved local timezone (`resolveDeviceTimezone()`), since
 *   basicInsights day-grounding is about the user's OWN local calendar day.
 * @returns {Object|null}
 */
export const normalizeEntryForInsights = (entry, { timeZone } = {}) => {
  if (!entry || typeof entry !== 'object') return null;

  const resolvedTimeZone = timeZone || resolveDeviceTimezone();
  const text = entry.content ?? entry.text ?? '';
  const entryDate = resolveEntryDate(entry);

  return {
    id: resolveId(entry),
    dateKey: entryDate ? localDateKeyForMs(entryDate.getTime(), resolvedTimeZone) : null,
    timestampMs: entryDate ? entryDate.getTime() : null,
    mood01: resolveMood(entry),
    entryType: resolveStringField(entry.entry_type, entry.analysis?.entry_type ?? entry.classification?.entry_type),
    category: resolveStringField(entry.category, entry.classification?.primary_category),
    tags: resolveArrayField(entry.tags, entry.analysis?.tags),
    entities: resolveArrayField(entry.entities, entry.analysis?.entities),
    themes: resolveArrayField(entry.analysis?.themes, entry.themes),
    emotions: resolveArrayField(entry.analysis?.emotions, entry.emotions),
    cognitivePatterns: resolveArrayField(entry.analysis?.cognitive_patterns, entry.cognitivePatterns),
    memoryMentions: resolveArrayField(entry.memoryMentions, null),
    text: typeof text === 'string' ? text : '',
    hasText: typeof text === 'string' && text.trim().length > 0,
    healthSignals: buildHealthSignals(entry.healthContext),
    adapterVersion: ADAPTER_VERSION,
  };
};

/**
 * Normalize a list of entries, dropping any null/non-object entries.
 * The single call site basicInsightsOrchestrator uses to normalize once
 * before fanning out to the correlation engines.
 */
export const normalizeEntriesForInsights = (entries, options) =>
  (Array.isArray(entries) ? entries : [])
    .map((entry) => normalizeEntryForInsights(entry, options))
    .filter(Boolean);

export default {
  ADAPTER_VERSION,
  UNKNOWN,
  isUnknown,
  normalizeEntryForInsights,
  normalizeEntriesForInsights,
};
