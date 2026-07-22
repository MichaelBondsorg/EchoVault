/**
 * Gentle Revisit — safety-gated candidate selection (R2 Task 19; hardened
 * further in Michael's direct safety review, Task GR1 —
 * `docs/superpowers/plans/2026-07-22-michael-review-hardening.md`).
 *
 * Resurfaces ONE old positive memory per day, opt-in only, flag
 * `gentleRevisit` (default OFF — stays off until the safety memo at
 * `docs/quality/gentle-revisit-safety.md` is signed off). No LLM/provider
 * calls anywhere in this module: selection is a deterministic heuristic over
 * fields already on the entry document, so there is no AI-consent gate to
 * check (see the memo for the future-LLM-framing caveat).
 *
 * Two halves:
 *   1. `selectRevisitCandidate` — a PURE function (no Firestore/Admin SDK
 *      imports), fully unit-testable with plain-object fixtures. Encodes
 *      the safety rules from the plan/brief (originally six; GR1 adds a
 *      legacy-fail-closed eligibility rule and retunes the mood floor —
 *      see the memo's rule table for the authoritative, current list).
 *   2. `runGentleRevisitDaily` / `gentleRevisitDaily` — the scheduled sweep
 *      that reads real Firestore data, maps it into the plain shape
 *      `selectRevisitCandidate` expects, and writes at most one
 *      `revisit_queue` doc per user per day. Mirrors the `journalReminder`
 *      per-user-loop pattern and the `claimProcessingMarker` idempotency
 *      primitive (`functions/src/triggers/idempotency.js`). GR1 adds two
 *      more per-user "skip today" gates ahead of selection: a current-state
 *      gate (recent safety signals/sustained low mood) and a weekly cadence
 *      gate — see `currentStateGateTripped`/`weeklyCadenceTripped` below.
 *
 * Candidate entry shape consumed by `selectRevisitCandidate` (the scheduled
 * job maps raw entry docs into this before calling it):
 *   {
 *     id: string,
 *     createdAt: Date|number|string,           // any toMillis-coercible value
 *     spaceId: string|null,
 *     safety_flagged: boolean|undefined,       // entry doc field (snake_case);
 *                                               // undefined when the job could
 *                                               // not establish a trustworthy
 *                                               // value (legacy doc, no text to
 *                                               // re-screen) — see GR1 rule below.
 *     has_warning_indicators: boolean|undefined, // same caveat as above.
 *     analysis: { mood_score: number|null },   // entry doc field (snake_case)
 *     tags: string[],                          // topic tags
 *     entities: Array<{id?, name?, category?}>,// memory/entity graph mentions
 *   }
 *
 * `revisit_exclusions` doc shape (matches firestore.rules exactly):
 *   { dimension: 'entry'|'date'|'person'|'tag'|'space'|'family', value: string,
 *     reason: string, permanent: boolean, createdAt, expiresAt? }
 * `permanent:true` exclusions (e.g. "Never show this entry") suppress
 * forever; `permanent:false` exclusions (e.g. "Less like this", ~90-day
 * `expiresAt`) stop suppressing once `expiresAt` passes — see
 * `isExclusionActive`. A malformed/missing `expiresAt` on a non-permanent
 * exclusion fails closed (still suppresses).
 * Dimension → entry-field match:
 *   - entry:  value === entry.id
 *   - date:   entry's createdAt date ('YYYY-MM-DD', UTC) is within ±1 DAY of
 *             `value` (Minor 3+6, R2 final review — see `matchesExclusion`'s
 *             own doc comment for the timezone-seam rationale; exact match
 *             is a special case of this, not a separate branch)
 *   - space:  value === entry.spaceId
 *   - person: an entry.entities item with category 'person' and matching id/name
 *   - tag:    value present in entry.tags
 *   - family: value present in entry.entities (id or name) OR entry.tags —
 *             a broader "hide this whole topic" bucket (Task 20's "Less like
 *             this" writes the entry's top entity/theme here).
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { APP_COLLECTION_ID } from '../shared/constants.js';
import { getServerFlag } from '../shared/flags.js';
import { claimProcessingMarker } from '../triggers/idempotency.js';
import { isCrisisText } from '../safety/crisisKeywords.js';

// --- Rule constants (all non-negotiable per the plan/brief) ----------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_AGE_DAYS = 30;
export const MAX_AGE_DAYS = 400;
export const ADJACENCY_DAYS = 3;
export const DEDUP_WINDOW_DAYS = 60;
// GR1 (Michael's review): the v1 floor of 0.4 was too permissive — it let
// through entries that are merely "not bad" rather than genuinely calm.
// Retuned to 0.6. See the memo's rule 4 amendment for the full rationale.
export const MOOD_FLOOR = 0.6;
// Reconciled against the new 0.6 floor (GR1): leaving this at the old 0.5
// would sit BELOW the new floor and could never fire (every eligible entry
// already clears 0.6 > 0.5), silently collapsing the "preferred" scoring
// tier into a no-op. Raised to 0.7, not just to 0.6, so the tier still
// discriminates: entries scoring 0.6-0.69 (now eligible, since they clear
// the floor) are NOT automatically "preferred" — only genuinely brighter
// entries (>=0.7) get the scoring bonus. Documented in the memo.
const PREFERRED_MOOD = 0.7;
const CANDIDATE_READ_LIMIT = 200;
const FLAGGED_ANCHOR_READ_LIMIT = 50;
// GR1 rule 3b: mirrors FLAGGED_ANCHOR_READ_LIMIT for has_warning_indicators,
// so a far-edge warning-indicator entry can't be sliced out of the padded
// window's 200-cap and silently lose its (now-widened, see
// `isAdjacentToCrisisAnchor`) adjacency-veto power. See the memo's rule 3
// widening note.
const WARNING_ANCHOR_READ_LIMIT = 50;
// GR1 rule 7 (current-state gate): a short, separate, newest-first read used
// ONLY to answer "is anything happening for this user RIGHT NOW that should
// pause Gentle Revisit today?" — deliberately independent of the 30-400 day
// candidate-age window above (that window is about how OLD a resurfaced
// memory is; this one is about how the user is doing TODAY).
export const RECENT_WINDOW_DAYS = 14;
const RECENT_READ_LIMIT = 50;
// Sustained-low-mood sub-rule of the current-state gate: among the user's
// last N mood-SCORED recent entries (not the last N recent entries
// overall — an entry with no mood score contributes nothing to this count
// either way), at least MIN of them below THRESHOLD trips the gate. Pinned
// deliberately separate from MOOD_FLOOR above — this is a "how is the user
// doing lately" signal, not a candidate-selection quality bar, and reusing
// the same constant would silently couple two unrelated policies.
export const LOW_MOOD_LOOKBACK = 7;
export const LOW_MOOD_MIN_SCORED = 3;
export const LOW_MOOD_THRESHOLD = 0.4;
// GR1 rule 9 (weekly cadence): a user is skipped unless no queued/shown
// revisit_queue doc exists with selectedAt within this many days. Separate
// from the 60-day DEDUP_WINDOW_DAYS above, which governs which individual
// ENTRY a fresh selection is allowed to re-pick, not whether a fresh
// selection happens at all.
export const WEEKLY_CADENCE_DAYS = 7;

// GR1 rule 8 (legacy entries fail closed): duplicated from
// `src/config/constants.js` WARNING_INDICATORS, mirroring the existing
// `isCrisisText`/`CRISIS_KEYWORDS_REGEX` duplication pattern in
// `functions/src/safety/crisisKeywords.js` (see that file's own doc comment
// for why the duplication is deliberate — client and server are separate
// deployable packages). Kept in exact lockstep with the client regex by
// hand; a divergence would only affect how a LEGACY (no explicit boolean
// field) entry gets re-screened, since normally-analyzed entries already
// carry a server-computed `has_warning_indicators` value from the real
// analysis pipeline and are never re-screened here.
const WARNING_INDICATORS_REGEX =
  /hopeless|worthless|no point|can't go on|trapped|burden|no way out|give up|falling apart/i;

/** Server-authoritative warning-indicator check on entry text (GR1 rule 8's re-screen). */
function hasWarningIndicatorsText(text) {
  if (!text || typeof text !== 'string') return false;
  return WARNING_INDICATORS_REGEX.test(text);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Coerce a Date/number/ISO-string/Firestore-Timestamp-ish value to epoch ms. NaN if uncoercible. */
function toMillis(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? NaN : parsed;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  return NaN;
}

function dateKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Midnight-UTC epoch ms for a 'YYYY-MM-DD' date key. NaN if malformed. */
function dateKeyToMs(dateKey) {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

function monthKeyUtc(ms) {
  return new Date(ms).toISOString().slice(0, 7);
}

/** Month + year label for the plain, non-clinical revisit_queue `reason` string. */
export function monthYearLabel(ms) {
  const d = new Date(ms);
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function entityValues(entry) {
  return (entry.entities || []).map((e) => e?.id || e?.name).filter(Boolean);
}

/**
 * Whether an exclusion should still suppress selection right now (R2 review
 * follow-up: the 90-day "Less like this" expiry was written by the client
 * but never enforced here, so every `family` exclusion was silently
 * permanent). `permanent === true` exclusions (e.g. "Never show this entry")
 * ignore `expiresAt` entirely — permanence is absolute. A non-permanent
 * exclusion (e.g. "Less like this", `permanent:false` + a ~90-day
 * `expiresAt`) is active only while `expiresAt` is still in the future;
 * once past, it stops suppressing. A non-permanent exclusion with a
 * missing/unparseable `expiresAt` FAILS CLOSED — it keeps excluding rather
 * than risk resurfacing something the user deliberately suppressed over a
 * malformed/legacy doc.
 *
 * @param {object} exclusion - a `revisit_exclusions` doc.
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isExclusionActive(exclusion, nowMs) {
  if (!exclusion) return false;
  if (exclusion.permanent === true) return true;
  const expiresMs = toMillis(exclusion.expiresAt);
  if (!Number.isFinite(expiresMs)) return true; // fail closed
  return expiresMs > nowMs;
}

export function matchesExclusion(entry, exclusion, entryMs) {
  const { dimension, value } = exclusion || {};
  switch (dimension) {
    case 'entry':
      return entry.id === value;
    case 'date': {
      // Minor 3+6 (R2 final review): the client's date-dimension exclusion
      // picker writes `value` from the DEVICE'S LOCAL date, but this compares
      // against the entry's UTC dateKey — a device west of UTC (or a day
      // near midnight UTC) can be off by a day, which used to make an
      // intended exclusion silently not match. Widened to a ±1-day window:
      // over-excluding (occasionally suppressing a neighboring day the user
      // didn't explicitly pick) is the SAFE direction on a "hide this from
      // Gentle Revisit" surface — the cost of a false-positive exclusion is
      // "one extra day never resurfaces," while the cost of a false
      // negative is "a day the user explicitly asked to hide gets
      // resurfaced anyway," which is the actual harm this feature's safety
      // memo (`docs/quality/gentle-revisit-safety.md`) rule 5 exists to
      // prevent. Same-day (0), +1, and -1 all match; ±2 or more does not.
      const entryDateMs = dateKeyToMs(dateKeyUtc(entryMs));
      const valueDateMs = dateKeyToMs(value);
      if (!Number.isFinite(entryDateMs) || !Number.isFinite(valueDateMs)) {
        return dateKeyUtc(entryMs) === value; // malformed value: fall back to exact match
      }
      return Math.abs(entryDateMs - valueDateMs) <= DAY_MS;
    }
    case 'space':
      return entry.spaceId != null && entry.spaceId === value;
    case 'person':
      return (entry.entities || []).some(
        (e) => e?.category === 'person' && (e.id === value || e.name === value),
      );
    case 'tag':
      return Array.isArray(entry.tags) && entry.tags.includes(value);
    case 'family':
      return entityValues(entry).includes(value)
        || (Array.isArray(entry.tags) && entry.tags.includes(value));
    default:
      // Unknown dimension: fail closed by NOT matching (never silently
      // excludes everything on an unrecognized value) — firestore.rules
      // already prevents an unknown dimension from ever being written by a
      // client, so this only guards against future dimension additions
      // this module hasn't been taught yet.
      return false;
  }
}

/**
 * Select at most one Gentle Revisit candidate. PURE — no Firestore/Admin SDK
 * access, safe to unit test with plain-object fixtures.
 *
 * Non-negotiable exclusion rules (all must pass for a candidate to be
 * eligible at all — order does not affect the result, every rule is always
 * applied). Numbered to match the memo (`docs/quality/gentle-revisit-safety.md`);
 * rule 0 is new in GR1 (Michael's review), rules 3/4 were amended in GR1
 * (widened / retuned respectively) — see the memo for full rationale on each:
 *   0. **(GR1) Legacy fail-closed.** `typeof entry.safety_flagged !==
 *      'boolean'` OR `typeof entry.has_warning_indicators !== 'boolean'` →
 *      never. This function is PURE and has no access to entry text, so it
 *      cannot re-screen anything itself — it only enforces that SOMETHING
 *      upstream already established a trustworthy boolean for both fields.
 *      The scheduled job (below) is what does the re-screening, via
 *      `isCrisisText`/`hasWarningIndicatorsText` against the entry's text,
 *      before ever calling this function — see `mapEntryDoc`'s doc comment.
 *   1. `safety_flagged === true` → never.
 *   2. `has_warning_indicators === true` → never.
 *   3. **(GR1: widened)** Created within ±{@link ADJACENCY_DAYS} days of ANY
 *      entry in `entries` with `safety_flagged === true` OR
 *      `has_warning_indicators === true` (crisis-window adjacency) → never.
 *      Originally flagged-only; GR1 adds warning-indicator entries to the
 *      anchor set too, per Michael's "a crisis entry near a candidate could
 *      fall outside the retrieved set" finding — see the memo for why this
 *      is a deliberate conservative widening, not just a completeness fix.
 *   4. **(GR1: retuned)** `analysis.mood_score < {@link MOOD_FLOOR}` (now
 *      0.6, was 0.4) or missing/non-numeric → never.
 *   5. Any `exclusions` match (see `matchesExclusion`) → never.
 *   Additionally: age must be {@link MIN_AGE_DAYS}-{@link MAX_AGE_DAYS} days
 *   old (inclusive), and the entry must not already be in `recentQueue`
 *   within the last {@link DEDUP_WINDOW_DAYS} days.
 *
 * Among the entries that survive every rule, prefers (in this order):
 *   entries with entities/themes present > entries with mood >=
 *   {@link PREFERRED_MOOD} > entries whose month wasn't already surfaced in
 *   the last {@link DEDUP_WINDOW_DAYS} days (variety by month). Ties break
 *   toward the more recently-written entry (deterministic, no randomness).
 *   None of this preference ordering ever loosens or overrides rules 0-5 —
 *   it only orders entries that already passed every rule.
 *
 * @param {object} params
 * @param {Array<object>} [params.entries] - candidate-shaped entries (see
 *   module doc). Should include entries outside the age window too, IF they
 *   are `safety_flagged`/`has_warning_indicators` and might anchor rule 3's
 *   adjacency window for an in-window candidate near the boundary — the
 *   caller (scheduled job) pads its Firestore read window by
 *   {@link ADJACENCY_DAYS} on each side for exactly this reason.
 * @param {Array<object>} [params.exclusions] - `revisit_exclusions` docs.
 * @param {Array<{entryId:string, selectedAt:*}>} [params.recentQueue] - prior
 *   `revisit_queue` selections (any age; this function does its own 60-day
 *   filtering using `now`).
 * @param {Date|number|string} [params.now] - defaults to `Date.now()`.
 * @returns {object|null} the winning candidate entry (from `entries`,
 *   unmodified) or `null` when nothing qualifies. `null` is a correct
 *   result — never padded with a lower-quality pick.
 */
export function selectRevisitCandidate({ entries = [], exclusions = [], recentQueue = [], now = Date.now() } = {}) {
  const nowMs = toMillis(now);

  // Rule 3's anchor set (GR1: widened to flagged OR warning-indicator
  // entries), drawn from the FULL passed-in `entries` array (not just
  // age-eligible candidates).
  const crisisAnchorMs = entries
    .filter((e) => e && (e.safety_flagged === true || e.has_warning_indicators === true))
    .map((e) => toMillis(e.createdAt))
    .filter((ms) => Number.isFinite(ms));

  function isAdjacentToCrisisAnchor(entryMs) {
    return crisisAnchorMs.some((aMs) => Math.abs(entryMs - aMs) <= ADJACENCY_DAYS * DAY_MS);
  }

  // Dedup set + "recently surfaced months" set, both scoped to the last
  // DEDUP_WINDOW_DAYS days of `recentQueue` relative to `now`.
  const recentEntryIds = new Set();
  const recentMonths = new Set();
  for (const item of recentQueue || []) {
    const selMs = toMillis(item?.selectedAt);
    if (!Number.isFinite(selMs)) continue;
    if (nowMs - selMs > DEDUP_WINDOW_DAYS * DAY_MS) continue;
    if (item.entryId) recentEntryIds.add(item.entryId);
    recentMonths.add(monthKeyUtc(selMs));
  }

  const eligible = [];
  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    const entryMs = toMillis(entry.createdAt);
    if (!Number.isFinite(entryMs)) continue;

    const ageDays = (nowMs - entryMs) / DAY_MS;
    if (ageDays < MIN_AGE_DAYS || ageDays > MAX_AGE_DAYS) continue;

    // GR1 rule 0: legacy fail-closed. Only the scheduled job can turn an
    // "unknown" legacy entry into a trustworthy boolean (by re-screening its
    // text); this pure function just refuses to treat "unknown" as "safe".
    if (typeof entry.safety_flagged !== 'boolean' || typeof entry.has_warning_indicators !== 'boolean') continue;

    if (entry.safety_flagged === true) continue; // rule 1
    if (entry.has_warning_indicators === true) continue; // rule 2
    if (isAdjacentToCrisisAnchor(entryMs)) continue; // rule 3 (GR1: widened anchor set)

    const mood = entry.analysis?.mood_score;
    if (typeof mood !== 'number' || Number.isNaN(mood) || mood < MOOD_FLOOR) continue; // rule 4 (GR1: 0.6 floor)

    if ((exclusions || []).some((ex) => isExclusionActive(ex, nowMs) && matchesExclusion(entry, ex, entryMs))) continue; // rule 5

    if (recentEntryIds.has(entry.id)) continue; // dedup vs last-60-day queue

    eligible.push({ entry, entryMs, mood });
  }

  if (eligible.length === 0) return null;

  const scored = eligible.map((c) => {
    const hasContent = entityValues(c.entry).length > 0 || (c.entry.tags || []).length > 0;
    const preferredMood = c.mood >= PREFERRED_MOOD;
    const freshMonth = !recentMonths.has(monthKeyUtc(c.entryMs));
    const score = (hasContent ? 4 : 0) + (preferredMood ? 2 : 0) + (freshMonth ? 1 : 0);
    return { ...c, score };
  });

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.entryMs - a.entryMs));

  return scored[0].entry;
}

// --- Scheduled sweep ---------------------------------------------------

function localDateString(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * Map a raw Firestore entry doc into the plain shape `selectRevisitCandidate`
 * expects.
 *
 * GR1 rule 8 (legacy entries fail closed): the OLD version of this function
 * coerced both flags with `data.safety_flagged === true`, which silently
 * turns a MISSING field into `false` (safe) — exactly backwards for a
 * pre-existing entry the crisis-detection pipeline never actually screened.
 * Fixed here, PER FIELD (not "both or neither" — see below for why that
 * distinction matters):
 *   - a field that is already an explicit boolean on the doc is passed
 *     through UNCHANGED — this is the normal case for every entry written
 *     since crisis-keyword detection shipped, and it is also what the
 *     dedicated flagged/warning anchor queries guarantee for the field they
 *     filter on (Firestore's `== true` filter cannot match a non-boolean, so
 *     an anchor-query result's OWN filtered field is always a real `true`)
 *     — re-deriving it from text instead of trusting the already-known
 *     value could only make things LESS safe, e.g. if the flag was set by
 *     something other than plain keyword matching, or the entry was edited
 *     after analysis and the flag intentionally left in place.
 *   - a field that is missing/non-boolean (legacy entry, or an entry whose
 *     analysis never ran) is RE-SCREENED from `data.text`, using the same
 *     `isCrisisText` the real pipeline uses for safety_flagged, and the
 *     module-local `hasWarningIndicatorsText` (mirrors
 *     `src/config/constants.js` WARNING_INDICATORS) for has_warning_indicators.
 *   - if text is unavailable (missing/empty/non-string) for a field that
 *     needs re-screening, that field is left `undefined` — NOT defaulted to
 *     `false`. `selectRevisitCandidate`'s rule 0 then excludes the entry
 *     entirely (a `typeof` check, so `undefined` fails it), matching the
 *     brief's "text unavailable ... → excluded".
 * A "clean" re-screen (text available, neither check hits) explicitly sets
 * `false` — satisfying rule 0's boolean requirement and making the entry
 * eligible again, subject to every other rule. A screen that DOES hit sets
 * `true`, which rules 1/2 already reject on their own.
 */
function mapEntryDoc(id, data) {
  let safetyFlagged = typeof data.safety_flagged === 'boolean' ? data.safety_flagged : undefined;
  let warningIndicators = typeof data.has_warning_indicators === 'boolean' ? data.has_warning_indicators : undefined;

  if (safetyFlagged === undefined || warningIndicators === undefined) {
    const text = typeof data.text === 'string' && data.text.trim() ? data.text : null;
    if (text) {
      if (safetyFlagged === undefined) safetyFlagged = isCrisisText(text);
      if (warningIndicators === undefined) warningIndicators = hasWarningIndicatorsText(text);
    }
    // else: text unavailable — leave whichever field(s) are still
    // `undefined`; rule 0 excludes the entry entirely.
  }

  return {
    id,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
    spaceId: data.spaceId ?? null,
    safety_flagged: safetyFlagged,
    has_warning_indicators: warningIndicators,
    analysis: { mood_score: typeof data.analysis?.mood_score === 'number' ? data.analysis.mood_score : null },
    tags: Array.isArray(data.tags) ? data.tags : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
  };
}

/**
 * GR1 rule 7 (current-state gate), sustained-low-mood sub-rule.
 *
 * `recentEntries` MUST already be sorted newest-first (the caller's
 * Firestore query is `orderBy('createdAt', 'desc')`) — "last N mood-scored"
 * only means what it says under that ordering.
 *
 * Pinned rule (documented in the memo): among the user's last
 * {@link LOW_MOOD_LOOKBACK} mood-SCORED recent entries, at least
 * {@link LOW_MOOD_MIN_SCORED} below {@link LOW_MOOD_THRESHOLD} trips the
 * gate. FEWER than {@link LOW_MOOD_MIN_SCORED} scored entries in the entire
 * lookback FAILS OPEN (does not trip this sub-rule) — insufficient signal is
 * deliberately not treated as equivalent to vulnerable; see the memo for the
 * reasoning and the acknowledged open question this doesn't resolve (grief/
 * trauma detection remains out of scope for v1 either way).
 *
 * @param {Array<object>} recentEntries - candidate-shaped entries, newest-first.
 * @returns {boolean}
 */
export function sustainedLowMoodTripped(recentEntries) {
  const moodScored = (recentEntries || [])
    .filter((e) => e && typeof e.analysis?.mood_score === 'number' && !Number.isNaN(e.analysis.mood_score))
    .slice(0, LOW_MOOD_LOOKBACK);
  if (moodScored.length < LOW_MOOD_MIN_SCORED) return false; // fail-open: insufficient signal
  const lowCount = moodScored.filter((e) => e.analysis.mood_score < LOW_MOOD_THRESHOLD).length;
  return lowCount >= LOW_MOOD_MIN_SCORED;
}

/**
 * GR1 rule 7 (current-state gate): whether the user's RECENT
 * ({@link RECENT_WINDOW_DAYS}-day) entries show a live safety signal that
 * should pause Gentle Revisit for them today, independent of whether any
 * individual candidate entry (which is always 30+ days old) would otherwise
 * be selectable. Mirrored client-side (defense in depth) in
 * `RevisitWidget.jsx` — see that file's own copy of this same rule for why
 * the logic is duplicated rather than imported (separate deployable
 * package).
 *
 * @param {Array<object>} recentEntries - candidate-shaped entries from the
 *   RECENT_WINDOW_DAYS read, newest-first.
 * @returns {boolean} true → skip this user's selection entirely today.
 */
export function currentStateGateTripped(recentEntries) {
  const entries = recentEntries || [];
  if (entries.some((e) => e && (e.safety_flagged === true || e.has_warning_indicators === true))) return true;
  return sustainedLowMoodTripped(entries);
}

/**
 * GR1 rule 9 (weekly cadence): whether the user already has a live
 * (`queued` or `shown` — NOT `dismissed`) revisit_queue selection within the
 * last {@link WEEKLY_CADENCE_DAYS} days, in which case a fresh selection is
 * skipped today. Deliberately excludes `dismissed` items — a user who
 * dismissed this week's card has effectively asked for nothing more this
 * week either, but that's `revisit_exclusions`/rule 5's job (per-entry, via
 * "Never show"/"Less like this"), not this cadence gate's; a dismissed item
 * with no further exclusion recorded should not itself block next week's
 * (or even a later day's, if the product ever shortens cadence) selection
 * beyond what the dedup/exclusion rules already handle. `dismissed` items
 * ARE still counted by rule 5's 60-day dedup (`recentQueue` in
 * `selectRevisitCandidate`) for the specific entry they named — this gate is
 * a coarser "did we already offer this user something this week at all"
 * check layered on top.
 *
 * @param {Array<{status?:string, selectedAt:*}>} recentQueueWithStatus - the
 *   same last-{@link DEDUP_WINDOW_DAYS}-day `revisit_queue` read used for
 *   rule 5's dedup, extended with each doc's `status` field.
 * @param {number} nowMs
 * @returns {boolean} true → skip this user's selection entirely today.
 */
export function weeklyCadenceTripped(recentQueueWithStatus, nowMs) {
  return (recentQueueWithStatus || []).some((item) => {
    if (item?.status !== 'queued' && item?.status !== 'shown') return false;
    const selMs = toMillis(item?.selectedAt);
    if (!Number.isFinite(selMs)) return false;
    const ageMs = nowMs - selMs;
    return ageMs >= 0 && ageMs <= WEEKLY_CADENCE_DAYS * DAY_MS;
  });
}

/**
 * Per-user, per-day sweep. Testable in isolation (pass a fake `db`); the
 * exported `gentleRevisitDaily` below wraps this with the real Admin SDK
 * Firestore instance on the `onSchedule` trigger.
 *
 * Skip conditions (rule 6): server flag `gentleRevisit` off skips EVERY user
 * without even listing them; per-user, `settings/revisitPrefs.enabled !==
 * true` skips that user. Idempotency: a transactional marker
 * `selectedFor{YYYY-MM-DD}` (America/Los_Angeles calendar day) is claimed on
 * a DEDICATED server-only doc, `revisit_job_state/state` — deliberately NOT
 * on `settings/revisitPrefs`. `firestore.rules`' `settings/{settingId}`
 * block only special-cases a handful of named ids (`consent`,
 * `insightBudget`, `spacePrefs`, `revisitPrefs`); any *other* settingId
 * (which `revisit_job_state` would be, if it lived under `settings/`) falls
 * through to a plain owner-write-anything grant — so this marker MUST live
 * outside `settings/` entirely. `revisit_job_state` has no `match` block of
 * its own anywhere in firestore.rules, so it inherits Firestore's
 * default-deny: a normal authenticated client can neither read nor write
 * it, and only the Admin SDK (which bypasses rules) — i.e. this job — ever
 * touches it. (An earlier version of this job wrongly stored the marker on
 * `settings/revisitPrefs` itself; that made every subsequent CLIENT write to
 * that doc — including `setRevisitEnabled`'s disable path — fail
 * `request.resource.data.keys().hasOnly([...])` after the first run, since
 * that rule evaluates against the doc's full post-merge key set. Fixed here.)
 * A second invocation for the same local day is a no-op (mirrors
 * `claimProcessingMarker`'s at-least-once-delivery contract used elsewhere
 * for entry processing).
 *
 * GR1 (Michael's review) adds two more per-user "skip today" gates, BOTH
 * evaluated AFTER the marker is claimed (so `processed` still counts the
 * attempt — same convention as "no candidate qualifies" below; only
 * `selected` distinguishes an actual write) and BEFORE the expensive padded
 * candidate-window/anchor reads (so a user who is gated skips those reads
 * entirely):
 *   1. Weekly cadence (rule 9, `weeklyCadenceTripped`) — reuses the SAME
 *      `revisit_queue` read rule 5's dedup already needs (just reads
 *      `status` off the same docs too), so this check costs no extra read.
 *   2. Current-state gate (rule 7, `currentStateGateTripped`) — a NEW, small,
 *      separate read of the user's last {@link RECENT_WINDOW_DAYS} days of
 *      entries (independent of the 30-400 day candidate-age window).
 * Checked in that order specifically so a cadence-gated user (common case:
 * most days, for an opted-in user, this is why nothing gets selected) never
 * pays for the current-state read either.
 *
 * @param {object} db - Firestore instance (Admin SDK, or a test double with
 *   the same `.doc`/`.collection`/`.runTransaction` surface).
 * @param {{now?: Date}} [options]
 * @returns {Promise<{processed:number, selected:number, skipped:number}>}
 */
export async function runGentleRevisitDaily(db, { now = new Date() } = {}) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  const flagOn = await getServerFlag(db, 'gentleRevisit', false);
  if (!flagOn) {
    console.log('[gentleRevisitDaily] server flag off — skipping all users');
    return { processed: 0, selected: 0, skipped: 0 };
  }

  const dateStr = localDateString(nowDate, 'America/Los_Angeles');
  const markerField = `selectedFor${dateStr}`;

  const usersSnap = await db.collection(`artifacts/${APP_COLLECTION_ID}/users`).get();

  let processed = 0;
  let selected = 0;
  let skipped = 0;

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;
    const userBase = `artifacts/${APP_COLLECTION_ID}/users/${userId}`;
    try {
      const prefsRef = db.doc(`${userBase}/settings/revisitPrefs`);
      const prefsSnap = await prefsRef.get();
      const prefs = prefsSnap.exists ? (prefsSnap.data() || {}) : {};
      if (prefs.enabled !== true) { skipped++; continue; }

      // Server-only marker doc — see the doc comment above for why this is
      // never `settings/revisitPrefs` (client-writable) or any other
      // `settings/*` id.
      const jobStateRef = db.doc(`${userBase}/revisit_job_state/state`);
      const claimed = await claimProcessingMarker(db, jobStateRef, markerField);
      if (!claimed) { skipped++; continue; } // already selected for this local day

      processed++;

      // GR1 gate 1/2: weekly cadence (rule 9). Read once, reused both here
      // and as `selectRevisitCandidate`'s `recentQueue` dedup input below —
      // no second read for the same collection.
      const recentQueueSnap = await db.collection(`${userBase}/revisit_queue`)
        .where('selectedAt', '>=', new Date(nowMs - DEDUP_WINDOW_DAYS * DAY_MS))
        .get();
      const recentQueue = [];
      recentQueueSnap.forEach((d) => {
        const data = d.data() || {};
        recentQueue.push({
          entryId: data.entryId,
          status: data.status,
          selectedAt: data.selectedAt?.toDate ? data.selectedAt.toDate() : data.selectedAt,
        });
      });
      if (weeklyCadenceTripped(recentQueue, nowMs)) continue; // skip today — already offered this user something this week

      // GR1 gate 2/2: current-state gate (rule 7). A small, separate,
      // newest-first read of the last RECENT_WINDOW_DAYS days — independent
      // of the 30-400 day candidate-age window below.
      const recentWindowSnap = await db.collection(`${userBase}/entries`)
        .where('createdAt', '>=', new Date(nowMs - RECENT_WINDOW_DAYS * DAY_MS))
        .where('createdAt', '<=', new Date(nowMs))
        .orderBy('createdAt', 'desc')
        .limit(RECENT_READ_LIMIT)
        .get();
      const recentWindowEntries = [];
      recentWindowSnap.forEach((d) => recentWindowEntries.push(mapEntryDoc(d.id, d.data() || {})));
      if (currentStateGateTripped(recentWindowEntries)) continue; // skip today — live safety signal or sustained low mood

      // Read window padded by ADJACENCY_DAYS on each side so a
      // safety-flagged/warning-indicator entry just outside the strict
      // 30-400 day candidate window can still veto an in-window neighbor
      // (rule 3).
      const windowStartMs = nowMs - (MAX_AGE_DAYS + ADJACENCY_DAYS) * DAY_MS;
      const windowEndMs = nowMs - (MIN_AGE_DAYS - ADJACENCY_DAYS) * DAY_MS;

      const [entriesSnap, flaggedAnchorSnap, warningAnchorSnap, exclusionsSnap] = await Promise.all([
        db.collection(`${userBase}/entries`)
          .where('createdAt', '>=', new Date(windowStartMs))
          .where('createdAt', '<=', new Date(windowEndMs))
          .orderBy('createdAt', 'desc')
          .limit(CANDIDATE_READ_LIMIT)
          .get(),
        // Rule-3 anchor backfill: the query above takes the CANDIDATE_READ_LIMIT
        // MOST RECENT entries in the padded window. For a user with more than
        // that many entries, an older safety-flagged entry near the far
        // (400+ADJACENCY_DAYS-day) edge can be sliced out of that result even
        // though it's still inside the window — silently starving its veto
        // power over an adjacent, more-recent, in-window candidate. This
        // separate, small-limit, equality-filtered query exists SOLELY to
        // backfill flagged anchors the recency-capped query might have
        // dropped; it is never itself a source of selectable candidates (age
        // window + every other rule is still enforced per-entry inside
        // `selectRevisitCandidate`). Ordered ASC (oldest first) so the limit
        // keeps the FAR-EDGE anchors — the exact region the main query's
        // recency cap starves; recent flagged entries are already covered by
        // the main query's top slice. Composite index:
        // firestore.indexes.json (entries: safety_flagged ASC, createdAt ASC).
        db.collection(`${userBase}/entries`)
          .where('safety_flagged', '==', true)
          .where('createdAt', '>=', new Date(windowStartMs))
          .where('createdAt', '<=', new Date(windowEndMs))
          .orderBy('createdAt', 'asc')
          .limit(FLAGGED_ANCHOR_READ_LIMIT)
          .get(),
        // GR1 rule 3b: mirrors the flagged-anchor backfill above, for
        // has_warning_indicators — same far-edge-of-the-200-cap problem,
        // same fix. Composite index: firestore.indexes.json
        // (entries: has_warning_indicators ASC, createdAt ASC) — provisioned
        // 2026-07-22, verified READY in production; see the runbook's index
        // section. The per-user try/catch below still fails this user
        // closed (skipped, no selection) rather than selecting without this
        // safety data on any future index/query error, same behavior as the
        // existing flagged-anchor index gap already documented there.
        db.collection(`${userBase}/entries`)
          .where('has_warning_indicators', '==', true)
          .where('createdAt', '>=', new Date(windowStartMs))
          .where('createdAt', '<=', new Date(windowEndMs))
          .orderBy('createdAt', 'asc')
          .limit(WARNING_ANCHOR_READ_LIMIT)
          .get(),
        db.collection(`${userBase}/revisit_exclusions`).get(),
      ]);

      const entries = [];
      const seenEntryIds = new Set();
      entriesSnap.forEach((d) => {
        entries.push(mapEntryDoc(d.id, d.data() || {}));
        seenEntryIds.add(d.id);
      });
      flaggedAnchorSnap.forEach((d) => {
        if (seenEntryIds.has(d.id)) return; // already present from the main query
        entries.push(mapEntryDoc(d.id, d.data() || {}));
        seenEntryIds.add(d.id);
      });
      warningAnchorSnap.forEach((d) => {
        if (seenEntryIds.has(d.id)) return; // already present from the main/flagged-anchor query
        entries.push(mapEntryDoc(d.id, d.data() || {}));
        seenEntryIds.add(d.id);
      });

      const exclusions = [];
      exclusionsSnap.forEach((d) => exclusions.push(d.data() || {}));

      const candidate = selectRevisitCandidate({ entries, exclusions, recentQueue, now: nowMs });
      if (!candidate) continue; // correct outcome — no padding, nothing written

      const payload = {
        entryId: candidate.id,
        spaceId: candidate.spaceId ?? null,
        selectedAt: FieldValue.serverTimestamp(),
        dueDate: dateStr,
        status: 'queued',
        reason: `A calm moment from ${monthYearLabel(toMillis(candidate.createdAt))}`,
      };
      await db.collection(`${userBase}/revisit_queue`).doc().set(payload);
      selected++;
    } catch (e) {
      console.error(`[gentleRevisitDaily] failed for ${userId}:`, e.message);
      skipped++;
    }
  }

  console.log(`[gentleRevisitDaily] processed=${processed} selected=${selected} skipped=${skipped} of ${usersSnap.size}`);
  return { processed, selected, skipped };
}

export const gentleRevisitDaily = onSchedule(
  { schedule: 'every day 08:00', timeZone: 'America/Los_Angeles', timeoutSeconds: 300, memory: '256MiB' },
  async () => runGentleRevisitDaily(getFirestore()),
);

export default {
  selectRevisitCandidate,
  runGentleRevisitDaily,
  gentleRevisitDaily,
  monthYearLabel,
  matchesExclusion,
  isExclusionActive,
  currentStateGateTripped,
  sustainedLowMoodTripped,
  weeklyCadenceTripped,
};
