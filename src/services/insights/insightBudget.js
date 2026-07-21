/**
 * Insight Budget service (Trustworthy Capture / R1 plan, Task 12).
 *
 * Gates how many Nexus proactive insights the home surfaces show per
 * day/week, keyed off a user-chosen mode (quiet/balanced/exploratory), and
 * suppresses insights that near-duplicate something already shown in the
 * last 90 days. Storage mirrors the settings-doc read/write pattern in
 * `spacesService.js` (getLastCaptureSpaceId/setLastCaptureSpaceId) against
 * `settings/insightBudget`:
 *
 *   artifacts/{APP}/users/{uid}/settings/insightBudget
 *     { mode: 'quiet'|'balanced'|'exploratory', shownLog: [...], updatedAt }
 *
 * `firestore.rules` requires that doc to hasOnly(['mode','updatedAt','shownLog']),
 * mode in the three tiers, and shownLog (when present) to be a list — every
 * payload written here matches that shape exactly.
 *
 * `applyInsightBudget` is a pure function (no Firestore access) so it can
 * run synchronously wherever insights are rendered. Callers read `mode`
 * (readBudgetMode) and `shownLog` (readShownLog) once per mount, then pass
 * both in; `recordShownInsights` is the write-side counterpart, called with
 * whatever the gate actually let through.
 *
 * NOTE on reusing `isDuplicateInsight` (nexus/orchestrator.js): it compares
 * insight-shaped objects by reading `title`, `summary`, and (via the
 * private `extractInsightTheme` helper) `title`+`summary`+`body`. `shownLog`
 * entries intentionally carry NO content bodies — only
 * `{id, theme, title, shownAt}`, per the plan's privacy requirement and the
 * firestore.rules shape above. So each shownLog entry is adapted to a
 * thin comparable shape, `{title: entry.title, summary: '', body: ''}`,
 * before being passed to `isDuplicateInsight`. This preserves title-based
 * similarity (the dominant signal — see the >0.7 title-similarity
 * short-circuit in orchestrator.js) and still lets the theme-matching path
 * run (degraded to title-only, since summary/body are absent), without
 * reimplementing any similarity logic. EntryInsightsPopup is exempt (a
 * post-save reflection surface, not a proactive one) and never goes
 * through this gate.
 */
import { doc, getDoc, setDoc } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { isDuplicateInsight } from '../nexus/orchestrator';

const VALID_MODES = ['quiet', 'balanced', 'exploratory'];
const DEFAULT_MODE = 'balanced';

const BUDGET_CONFIGS = {
  quiet: { maxHomePerDay: 1, maxHomePerWeek: 4 },
  balanced: { maxHomePerDay: 2, maxHomePerWeek: 8 },
  exploratory: { maxHomePerDay: 4, maxHomePerWeek: 20 },
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SHOWN_LOG_ENTRIES = 200;

function settingsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/settings`;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Coerce a timestamp-ish value (ISO string, Firestore Timestamp, Date, or
 * epoch-ms number) to epoch ms. Missing/unrecognized -> 0.
 */
function toMillis(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

function isSameCalendarDay(msA, msB) {
  const a = new Date(msA);
  const b = new Date(msB);
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

/** Drop shownLog entries older than 90 days relative to `nowMs`. */
function pruneToWindow(shownLog, nowMs) {
  return (shownLog || []).filter((entry) => nowMs - toMillis(entry?.shownAt) <= NINETY_DAYS_MS);
}

function getInsightConfidence(insight) {
  const conf = insight?.confidence ?? insight?.evidence?.statistical?.confidence;
  return typeof conf === 'number' ? conf : 0;
}

function getInsightRecencyMs(insight) {
  return (
    toMillis(insight?.lastSeen)
    || toMillis(insight?.generatedAt)
    || toMillis(insight?.createdAt)
    || 0
  );
}

/**
 * @param {'quiet'|'balanced'|'exploratory'} mode
 * @returns {{maxHomePerDay:number, maxHomePerWeek:number}} unknown/missing
 *   mode falls back to 'balanced'.
 */
export function getBudgetConfig(mode) {
  return BUDGET_CONFIGS[mode] || BUDGET_CONFIGS[DEFAULT_MODE];
}

/**
 * Read the user's chosen budget mode.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<'quiet'|'balanced'|'exploratory'>} 'balanced' when the
 *   doc or the `mode` field is missing/invalid — never throws.
 */
export async function readBudgetMode(db, uid) {
  const snap = await getDoc(doc(db, settingsPath(uid), 'insightBudget'));
  if (!snap.exists()) return DEFAULT_MODE;
  const mode = snap.data()?.mode;
  return VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;
}

/**
 * Read the shown-insight ledger. This is the read-side counterpart to
 * `recordShownInsights` — `applyInsightBudget` is pure and takes `shownLog`
 * as a plain argument, so callers (e.g. `useNexusInsights`) fetch it here
 * once per mount, alongside `readBudgetMode`.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<Array<{id:string, theme:?string, title:string, shownAt:string}>>}
 *   [] when the doc or field is missing.
 */
export async function readShownLog(db, uid) {
  const snap = await getDoc(doc(db, settingsPath(uid), 'insightBudget'));
  if (!snap.exists()) return [];
  return snap.data()?.shownLog || [];
}

/**
 * Persist the user's chosen budget mode (setDoc merge onto
 * settings/insightBudget). Rejects (throws, no write) any mode outside the
 * three tiers.
 *
 * @param {object} db
 * @param {string} uid
 * @param {'quiet'|'balanced'|'exploratory'} mode
 */
export async function setBudgetMode(db, uid, mode) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid budget mode: "${mode}". Must be one of: ${VALID_MODES.join(', ')}.`);
  }
  await setDoc(
    doc(db, settingsPath(uid), 'insightBudget'),
    { mode, updatedAt: nowIso() },
    { merge: true },
  );
}

/**
 * Pure gate: filters, orders, and caps `insights` for display. NEVER pads —
 * if zero insights qualify (all near-dupes, or the quota is exhausted),
 * returns [] so the caller renders nothing (absence of a card), even when
 * some allowance is technically left. Confidence/provenance gates upstream
 * of this function are never loosened to fill the quota.
 *
 * Gate order (matches useNexusInsights wiring: feedback suppression runs
 * before this is ever called):
 *   1. Drop insights that near-duplicate a shownLog entry from the last 90
 *      days (via `isDuplicateInsight` — see module doc for the adapter).
 *   2. Sort survivors by confidence desc, then recency desc.
 *   3. Cap to the remaining allowance: day-count/week-count are derived
 *      from `shownLog` (entries dated same-calendar-day-as-`now`, and
 *      within the last 7 days, respectively); allowance is
 *      max(0, maxPerDay - dayCount) bounded by (i.e. the smaller of that
 *      and) max(0, maxPerWeek - weekCount).
 *
 * @param {Array} insights
 * @param {{mode?: string, shownLog?: Array, now?: number|Date|string}} [options]
 * @returns {Array} the subset (and order) to display; possibly [].
 */
export function applyInsightBudget(insights, { mode, shownLog, now = Date.now() } = {}) {
  if (!Array.isArray(insights) || insights.length === 0) return [];

  const nowMs = toMillis(now);
  const config = getBudgetConfig(mode);
  const recentLog = pruneToWindow(shownLog, nowMs);

  // (1) 90-day near-dup suppression vs shownLog.
  const comparableShown = recentLog.map((entry) => ({
    title: entry?.title || '',
    summary: '',
    body: '',
  }));
  const novel = insights.filter((insight) => !isDuplicateInsight(insight, comparableShown));

  if (novel.length === 0) return [];

  // (2) confidence desc, then recency desc.
  const sorted = [...novel].sort((a, b) => {
    const confDiff = getInsightConfidence(b) - getInsightConfidence(a);
    if (confDiff !== 0) return confDiff;
    return getInsightRecencyMs(b) - getInsightRecencyMs(a);
  });

  // (3) cap to remaining day/week allowance — never widened to fill it.
  const dayCount = recentLog.filter((entry) => isSameCalendarDay(toMillis(entry?.shownAt), nowMs)).length;
  const weekCount = recentLog.filter((entry) => nowMs - toMillis(entry?.shownAt) <= SEVEN_DAYS_MS).length;

  const dayAllowance = Math.max(0, config.maxHomePerDay - dayCount);
  const weekAllowance = Math.max(0, config.maxHomePerWeek - weekCount);
  const allowance = Math.min(dayAllowance, weekAllowance);

  return allowance > 0 ? sorted.slice(0, allowance) : [];
}

/**
 * Append `{id, theme, title, shownAt}` entries (no content bodies) to the
 * shownLog for whatever was actually displayed, pruned to 90 days and
 * capped to the 200 newest.
 *
 * `theme` uses `insight.theme` when the insight object already carries one,
 * else falls back to `insight.type` (e.g. 'calibration') as the best
 * available category. Nexus insights don't universally carry an explicit
 * `theme` field — the theme *classifier* in orchestrator.js
 * (`extractInsightTheme`) is private/unexported and re-derives from
 * title+summary+body, which this ledger intentionally excludes — so this
 * is a best-effort category tag, not a re-derivation of that classifier.
 *
 * @param {object} db
 * @param {string} uid
 * @param {Array} insights the insights actually shown to the user
 */
export async function recordShownInsights(db, uid, insights) {
  if (!Array.isArray(insights) || insights.length === 0) return;

  const ref = doc(db, settingsPath(uid), 'insightBudget');
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data()?.shownLog || []) : [];
  const nowMs = Date.now();

  const newEntries = insights
    .filter((insight) => insight?.id)
    .map((insight) => ({
      id: insight.id,
      theme: insight.theme ?? insight.type ?? null,
      title: insight.title || '',
      shownAt: nowIso(),
    }));

  if (newEntries.length === 0) return;

  const merged = pruneToWindow([...existing, ...newEntries], nowMs).slice(-MAX_SHOWN_LOG_ENTRIES);

  await setDoc(ref, { shownLog: merged, updatedAt: nowIso() }, { merge: true });
}

export default {
  getBudgetConfig,
  readBudgetMode,
  readShownLog,
  setBudgetMode,
  applyInsightBudget,
  recordShownInsights,
};
