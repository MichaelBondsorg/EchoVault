/**
 * Daily observation rollup (R4 Phase 1, DR "daily observation rollup" stage).
 * PURE — no Firestore, no clock. One row per user-local calendar day.
 * Tri-state discipline: a day-level field is UNKNOWN only when every entry
 * that day left it UNKNOWN; a known-empty [] is evidence of absence.
 */
import { normalizeEntriesForInsights, UNKNOWN, isUnknown } from './entryAdapter';

export const OBSERVATION_SCHEMA_VERSION = 1;

// Health numeric fields eligible as exposures (keys inside normalized
// healthSignals, i.e. the REAL keys extractHealthSignals()
// (src/services/health/healthFormatter.js) emits — camelCase, not the
// snake_case originally drafted in the plan — plus the extra numeric fields
// entryAdapter.js's buildHealthSignals() adds on top of that base object).
export const HEALTH_EXPOSURE_FIELDS = Object.freeze([
  'sleepHours', 'sleepScore', 'recoveryScore', 'strainScore', 'steps',
  'activeCalories', 'distance',
]);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Strips float-representation dust (e.g. (0.4+0.8)/2*100 === 60.00000000000001)
// without losing any real precision moods/health readings actually carry.
const round6 = (x) => (x == null ? x : Math.round(x * 1e6) / 1e6);

function mergeArrayField(dayValues) {
  // dayValues: array of (string[]|UNKNOWN). UNKNOWN only if ALL are UNKNOWN.
  const known = dayValues.filter((v) => !isUnknown(v));
  if (!known.length) return UNKNOWN;
  const set = new Set();
  known.forEach((arr) => arr.forEach((x) => set.add(String(x).toLowerCase())));
  return [...set].sort();
}

export function buildDailyObservations(entries, { timeZone } = {}) {
  const normalized = normalizeEntriesForInsights(entries, { timeZone });
  const byDay = new Map();
  for (const n of normalized) {
    if (!n.dateKey) continue;
    if (!byDay.has(n.dateKey)) byDay.set(n.dateKey, []);
    byDay.get(n.dateKey).push(n);
  }
  const rawById = new Map((entries || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const rows = [];
  for (const [dateKey, dayEntries] of byDay.entries()) {
    const moods = dayEntries.map((e) => e.mood01).filter((m) => Number.isFinite(m));
    const healthNumeric = {};
    for (const field of HEALTH_EXPOSURE_FIELDS) {
      const vals = dayEntries
        .map((e) => e.healthSignals?.[field])
        .filter((v) => Number.isFinite(v));
      if (vals.length) healthNumeric[field] = round6(mean(vals));
    }
    const sensitive = dayEntries.some((e) => {
      const raw = rawById.get(e.id);
      return raw?.safety_flagged === true || raw?.has_warning_indicators === true;
    });
    rows.push({
      dateKey,
      entryIds: dayEntries.map((e) => e.id),
      mood100: moods.length ? round6(mean(moods) * 100) : null,
      tags: mergeArrayField(dayEntries.map((e) => e.tags)),
      entities: mergeArrayField(dayEntries.map((e) => e.entities)),
      category: (() => {
        const known = dayEntries.map((e) => e.category).filter((c) => !isUnknown(c));
        return known.length ? String(known[0]).toLowerCase() : UNKNOWN;
      })(),
      healthSignals: Object.keys(healthNumeric).length ? healthNumeric : null,
      sensitive,
    });
  }
  return rows.sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
}

export function observationSeriesFor(observations, spec) {
  const out = [];
  for (const row of observations) {
    if (spec.kind === 'health') {
      const v = row.healthSignals?.[spec.field];
      if (Number.isFinite(v)) out.push({ dateKey: row.dateKey, value: v });
      continue;
    }
    const container = spec.kind === 'tag' ? row.tags
      : spec.kind === 'entity' ? row.entities
      : spec.kind === 'category' ? row.category
      : UNKNOWN;
    if (isUnknown(container)) continue; // unknown ≠ absent: omit the day entirely
    const target = spec.key.slice(spec.key.indexOf(':') + 1);
    const present = spec.kind === 'category'
      ? container === target
      : container.includes(target);
    out.push({ dateKey: row.dateKey, value: present ? 1 : 0 });
  }
  return out;
}

export function moodSeriesFor(observations) {
  return observations
    .filter((r) => Number.isFinite(r.mood100))
    .map((r) => ({ dateKey: r.dateKey, value: r.mood100 }));
}

export function enumerateExposures(observations, { minPresentDays = 3, minHealthDays = 5 } = {}) {
  const presentDays = new Map(); // 'tag:gym' -> count of days present
  const healthDays = new Map();
  for (const row of observations) {
    if (!isUnknown(row.tags)) row.tags.forEach((t) => bump(presentDays, `tag:${t}`));
    if (!isUnknown(row.entities)) row.entities.forEach((e) => bump(presentDays, `entity:${e}`));
    if (!isUnknown(row.category) && row.category) bump(presentDays, `category:${row.category}`);
    for (const field of HEALTH_EXPOSURE_FIELDS) {
      if (Number.isFinite(row.healthSignals?.[field])) bump(healthDays, field);
    }
  }
  const specs = [];
  for (const [key, count] of presentDays.entries()) {
    if (count < minPresentDays) continue;
    const [kind, ...rest] = key.split(':');
    specs.push({ key, kind, label: rest.join(':'), splitMode: 'binary' });
  }
  for (const [field, count] of healthDays.entries()) {
    if (count < minHealthDays) continue;
    specs.push({
      key: `health:${field}`, kind: 'health', field,
      label: field.replace(/_/g, ' '), splitMode: 'median',
    });
  }
  return specs.sort((a, b) => (a.key < b.key ? -1 : 1));
}

function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }
