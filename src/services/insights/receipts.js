/**
 * Insight Receipts (Trustworthy Capture / R2, Task 8)
 *
 * Attaches a provenance "receipt" to every Nexus / Basic insight so the
 * user can see exactly what evidence produced it: which entries, what time
 * window, how many data points, and (for the small minority of insights
 * that are LLM-produced) which model/prompt version.
 *
 * This module is pure, flag-independent, DATA-layer plumbing — receipts
 * are attached unconditionally at generation time regardless of the
 * `insightReceipts` UI flag (see ReceiptSheet, Task 11) so flipping that
 * flag on later never requires regenerating insights. `buildReceipt` and
 * `applyReceiptDefaults` never touch Firestore and never mutate their
 * inputs.
 *
 * Receipt shape (binding, from the R2 plan):
 *   {
 *     sources: [{ entryId, date, excerpt }],  // excerpt: first 120 chars of
 *                                              // entry text, single-line
 *     scope,                    // {spaceId} | null (null = all spaces)
 *     timeWindow: { start, end },             // ISO strings
 *     sampleSize,
 *     missingness,               // e.g. '12 of 30 days have entries' | null
 *     versions: {
 *       generator,
 *       computationVersion: 1,
 *       generatedAt,             // ISO
 *       model,                   // null unless the insight was LLM-produced
 *       promptVersion,           // null unless the insight was LLM-produced
 *     },
 *   }
 *
 * Excerpts are provenance for the USER'S OWN insight, stored only in their
 * own `nexus/insights` / `basicInsights/current` doc — never logged, and
 * receipts never write back to or mutate the source entries.
 *
 * `missingness` is populated only on window-fallback receipts (no precise
 * source set); precise-source receipts pass `null` by design, since their
 * exact `sources` list already carries the evidence.
 */

export const RECEIPT_COMPUTATION_VERSION = 1;

const DEFAULT_MAX_SOURCES = 20;
export const WINDOW_FALLBACK_MAX_SOURCES = 10;
const EXCERPT_MAX_LEN = 120;
const DEFAULT_WINDOW_DAYS = 30;

/**
 * First `EXCERPT_MAX_LEN` chars of `text`, collapsed to a single line.
 * Returns null for empty/missing text so receipts never carry an empty
 * string excerpt that reads as "content, but blank" in the UI.
 */
export const excerptFromText = (text) => {
  if (!text) return null;
  const singleLine = String(text).replace(/\s+/g, ' ').trim();
  if (!singleLine) return null;
  return singleLine.length > EXCERPT_MAX_LEN
    ? singleLine.slice(0, EXCERPT_MAX_LEN)
    : singleLine;
};

/**
 * Coerce a timestamp-ish value (ISO string, Firestore Timestamp, Date, or
 * epoch-ms number) to an ISO string. Returns null for anything
 * unrecognized/unparsable rather than throwing — receipts degrade
 * gracefully (a null date just sorts last / renders as "date unknown").
 */
export const toISOTimestamp = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : new Date(value).toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString();
  }
  return null;
};

/**
 * Normalize a raw journal entry into a receipt source ref
 * `{entryId, date, excerpt}`. Returns null when the entry has no
 * identifiable id (nothing to cite).
 */
export const sourceFromEntry = (entry) => {
  if (!entry) return null;
  const entryId = entry.id || entry.entryId;
  if (!entryId) return null;
  const rawDate = entry.createdAt ?? entry.date ?? entry.timestamp ?? entry.entryDate ?? null;
  const text = entry.content ?? entry.text ?? '';
  return {
    entryId,
    date: toISOTimestamp(rawDate),
    excerpt: excerptFromText(text),
  };
};

/**
 * `{start, end}` ISO window spanning `days` back from `now`. Used as the
 * default time window for receipts when a generator doesn't compute a
 * narrower window of its own (mirrors `fetchRecentEntries`'s default
 * `days=30`).
 */
export const computeTimeWindow = (days = DEFAULT_WINDOW_DAYS, now = Date.now()) => ({
  start: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
  end: new Date(now).toISOString(),
});

/**
 * Best-effort "N of M days have entries" string for a set of entries
 * against a timeWindow. Returns null if the window can't be parsed —
 * missingness is a nice-to-have annotation, never a hard requirement.
 */
export const computeMissingness = (entries, timeWindow) => {
  if (!timeWindow?.start || !timeWindow?.end) return null;
  const startMs = Date.parse(timeWindow.start);
  const endMs = Date.parse(timeWindow.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;

  const totalDays = Math.max(1, Math.round((endMs - startMs) / (24 * 60 * 60 * 1000)));
  const daysWithEntries = new Set();
  for (const entry of entries || []) {
    const iso = toISOTimestamp(
      entry?.createdAt ?? entry?.date ?? entry?.timestamp ?? entry?.entryDate ?? null
    );
    if (iso) daysWithEntries.add(iso.slice(0, 10));
  }
  return `${daysWithEntries.size} of ${totalDays} days have entries`;
};

/**
 * Build a receipt.
 *
 * @param {Object} params
 * @param {Array<{entryId, date, excerpt}>} [params.sources] - already
 *   normalized source refs (use `sourceFromEntry` to build these from raw
 *   entries). Sorted most-recent-first and capped to `maxSources`.
 * @param {{spaceId: string}|null} [params.scope]
 * @param {{start: string, end: string}} [params.timeWindow]
 * @param {number} [params.sampleSize] - defaults to `sources.length` after
 *   capping; pass explicitly when the true sample is larger than what's
 *   cited (e.g. a window-level fallback citing 10 of 30 window entries).
 * @param {string|null} [params.missingness]
 * @param {string} params.generator - required; identifies which generator
 *   produced this insight (e.g. 'entity_correlation', 'pattern_correlation').
 * @param {string|null} [params.model] - only for LLM-produced insights.
 * @param {string|null} [params.promptVersion] - only for LLM-produced insights.
 * @param {number} [params.maxSources] - cap on `sources` after sorting
 *   (default 20; window-level fallback uses `WINDOW_FALLBACK_MAX_SOURCES`).
 */
export const buildReceipt = ({
  sources = [],
  scope = null,
  timeWindow = null,
  sampleSize = null,
  missingness = null,
  generator,
  model = null,
  promptVersion = null,
  maxSources = DEFAULT_MAX_SOURCES,
} = {}) => {
  if (!generator) {
    throw new Error('buildReceipt: `generator` is required');
  }

  const normalizedSources = (Array.isArray(sources) ? sources : [])
    .filter((s) => s && s.entryId)
    .map((s) => ({
      entryId: s.entryId,
      date: s.date ?? null,
      excerpt: s.excerpt ?? null,
    }))
    .sort((a, b) => {
      const at = a.date ? Date.parse(a.date) : NaN;
      const bt = b.date ? Date.parse(b.date) : NaN;
      const safeAt = Number.isNaN(at) ? 0 : at;
      const safeBt = Number.isNaN(bt) ? 0 : bt;
      return safeBt - safeAt; // most recent first
    })
    .slice(0, maxSources);

  return {
    sources: normalizedSources,
    scope: scope ?? null,
    timeWindow: {
      start: timeWindow?.start ?? null,
      end: timeWindow?.end ?? null,
    },
    sampleSize: sampleSize ?? normalizedSources.length,
    missingness: missingness ?? null,
    versions: {
      generator,
      computationVersion: RECEIPT_COMPUTATION_VERSION,
      generatedAt: new Date().toISOString(),
      model,
      promptVersion,
    },
  };
};

/**
 * Pure. If `insight.receipt` is already set (a generator with a real
 * source set attached a precise receipt), returns `insight` unchanged.
 * Otherwise attaches a window-level fallback receipt: up to
 * `WINDOW_FALLBACK_MAX_SOURCES` most-recent `windowEntries` as sources,
 * `sampleSize = windowEntries.length` (the true window size, not just what's
 * cited).
 *
 * This is the final pass that guarantees the PRD's 100%-receipts
 * invariant: every insight that reaches `active` has a truthy `.receipt`,
 * whether or not its generator knew its exact source set.
 *
 * @param {Object} insight
 * @param {Object} options
 * @param {Array} [options.windowEntries] - the full entry window the
 *   insight was generated from (e.g. Nexus's 30-day `entries`).
 * @param {{spaceId: string}|null} [options.scope]
 * @param {{start: string, end: string}} [options.timeWindow] - defaults to
 *   `computeTimeWindow()` (last 30 days from now) when omitted.
 * @param {string} [options.generator] - fallback generator label used only
 *   when `insight.type` is missing; defaults to 'window_fallback'.
 */
export const applyReceiptDefaults = (insight, { windowEntries = [], scope = null, timeWindow = null, generator = 'window_fallback' } = {}) => {
  if (!insight) return insight;
  if (insight.receipt) return insight;

  const resolvedTimeWindow = timeWindow || computeTimeWindow();
  const sources = (windowEntries || []).map(sourceFromEntry).filter(Boolean);

  const receipt = buildReceipt({
    sources,
    scope,
    timeWindow: resolvedTimeWindow,
    sampleSize: (windowEntries || []).length,
    missingness: computeMissingness(windowEntries, resolvedTimeWindow),
    generator: insight.type || generator,
    maxSources: WINDOW_FALLBACK_MAX_SOURCES,
  });

  return { ...insight, receipt };
};

export default {
  RECEIPT_COMPUTATION_VERSION,
  WINDOW_FALLBACK_MAX_SOURCES,
  excerptFromText,
  toISOTimestamp,
  sourceFromEntry,
  computeTimeWindow,
  computeMissingness,
  buildReceipt,
  applyReceiptDefaults,
};
