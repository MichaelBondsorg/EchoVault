/**
 * Gentle Revisit — safety-gated candidate selection (R2 Task 19).
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
 *      the six non-negotiable safety rules from the plan/brief.
 *   2. `runGentleRevisitDaily` / `gentleRevisitDaily` — the scheduled sweep
 *      that reads real Firestore data, maps it into the plain shape
 *      `selectRevisitCandidate` expects, and writes at most one
 *      `revisit_queue` doc per user per day. Mirrors the `journalReminder`
 *      per-user-loop pattern and the `claimProcessingMarker` idempotency
 *      primitive (`functions/src/triggers/idempotency.js`).
 *
 * Candidate entry shape consumed by `selectRevisitCandidate` (the scheduled
 * job maps raw entry docs into this before calling it):
 *   {
 *     id: string,
 *     createdAt: Date|number|string,           // any toMillis-coercible value
 *     spaceId: string|null,
 *     safety_flagged: boolean,                 // entry doc field (snake_case)
 *     has_warning_indicators: boolean,         // entry doc field (snake_case)
 *     analysis: { mood_score: number|null },   // entry doc field (snake_case)
 *     tags: string[],                          // topic tags
 *     entities: Array<{id?, name?, category?}>,// memory/entity graph mentions
 *   }
 *
 * `revisit_exclusions` doc shape (matches firestore.rules exactly):
 *   { dimension: 'entry'|'date'|'person'|'tag'|'space'|'family', value: string, ... }
 * Dimension → entry-field match:
 *   - entry:  value === entry.id
 *   - date:   value === entry's createdAt date, 'YYYY-MM-DD' (UTC)
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

// --- Rule constants (all non-negotiable per the plan/brief) ----------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_AGE_DAYS = 30;
export const MAX_AGE_DAYS = 400;
export const ADJACENCY_DAYS = 3;
export const DEDUP_WINDOW_DAYS = 60;
export const MOOD_FLOOR = 0.4;
const PREFERRED_MOOD = 0.5;
const CANDIDATE_READ_LIMIT = 200;

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

function matchesExclusion(entry, exclusion, entryMs) {
  const { dimension, value } = exclusion || {};
  switch (dimension) {
    case 'entry':
      return entry.id === value;
    case 'date':
      return dateKeyUtc(entryMs) === value;
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
 * applied):
 *   1. `safety_flagged === true` → never.
 *   2. `has_warning_indicators === true` → never.
 *   3. Created within ±{@link ADJACENCY_DAYS} days of ANY entry in `entries`
 *      with `safety_flagged === true` (crisis-window adjacency) → never.
 *   4. `analysis.mood_score < {@link MOOD_FLOOR}` or missing/non-numeric → never.
 *   5. Any `exclusions` match (see `matchesExclusion`) → never.
 *   Additionally: age must be {@link MIN_AGE_DAYS}-{@link MAX_AGE_DAYS} days
 *   old (inclusive), and the entry must not already be in `recentQueue`
 *   within the last {@link DEDUP_WINDOW_DAYS} days.
 *
 * Among the entries that survive every rule, prefers (in this order):
 *   entries with entities/themes present > entries with mood >= 0.5 >
 *   entries whose month wasn't already surfaced in the last
 *   {@link DEDUP_WINDOW_DAYS} days (variety by month). Ties break toward the
 *   more recently-written entry (deterministic, no randomness).
 *
 * @param {object} params
 * @param {Array<object>} [params.entries] - candidate-shaped entries (see
 *   module doc). Should include entries outside the age window too, IF they
 *   are `safety_flagged` and might anchor rule 3's adjacency window for an
 *   in-window candidate near the boundary — the caller (scheduled job) pads
 *   its Firestore read window by {@link ADJACENCY_DAYS} on each side for
 *   exactly this reason.
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

  // Rule 3's anchor set: every safety-flagged entry's timestamp, drawn from
  // the FULL passed-in `entries` array (not just age-eligible candidates).
  const flaggedMs = entries
    .filter((e) => e && e.safety_flagged === true)
    .map((e) => toMillis(e.createdAt))
    .filter((ms) => Number.isFinite(ms));

  function isAdjacentToFlagged(entryMs) {
    return flaggedMs.some((fMs) => Math.abs(entryMs - fMs) <= ADJACENCY_DAYS * DAY_MS);
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

    if (entry.safety_flagged === true) continue; // rule 1
    if (entry.has_warning_indicators === true) continue; // rule 2
    if (isAdjacentToFlagged(entryMs)) continue; // rule 3

    const mood = entry.analysis?.mood_score;
    if (typeof mood !== 'number' || Number.isNaN(mood) || mood < MOOD_FLOOR) continue; // rule 4

    if ((exclusions || []).some((ex) => matchesExclusion(entry, ex, entryMs))) continue; // rule 5

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

/** Map a raw Firestore entry doc into the plain shape `selectRevisitCandidate` expects. */
function mapEntryDoc(id, data) {
  return {
    id,
    createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
    spaceId: data.spaceId ?? null,
    safety_flagged: data.safety_flagged === true,
    has_warning_indicators: data.has_warning_indicators === true,
    analysis: { mood_score: typeof data.analysis?.mood_score === 'number' ? data.analysis.mood_score : null },
    tags: Array.isArray(data.tags) ? data.tags : [],
    entities: Array.isArray(data.entities) ? data.entities : [],
  };
}

/**
 * Per-user, per-day sweep. Testable in isolation (pass a fake `db`); the
 * exported `gentleRevisitDaily` below wraps this with the real Admin SDK
 * Firestore instance on the `onSchedule` trigger.
 *
 * Skip conditions (rule 6): server flag `gentleRevisit` off skips EVERY user
 * without even listing them; per-user, `settings/revisitPrefs.enabled !==
 * true` skips that user. Idempotency: a transactional marker
 * `revisit.selectedFor{YYYY-MM-DD}` (America/Los_Angeles calendar day) is
 * claimed on the prefs doc before any candidate read — a second invocation
 * for the same local day is a no-op (mirrors `claimProcessingMarker`'s
 * at-least-once-delivery contract used elsewhere for entry processing).
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
  const markerField = `revisit.selectedFor${dateStr}`;

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

      const claimed = await claimProcessingMarker(db, prefsRef, markerField);
      if (!claimed) { skipped++; continue; } // already selected for this local day

      processed++;

      // Read window padded by ADJACENCY_DAYS on each side so a
      // safety-flagged entry just outside the strict 30-400 day candidate
      // window can still veto an in-window neighbor (rule 3).
      const windowStartMs = nowMs - (MAX_AGE_DAYS + ADJACENCY_DAYS) * DAY_MS;
      const windowEndMs = nowMs - (MIN_AGE_DAYS - ADJACENCY_DAYS) * DAY_MS;

      const [entriesSnap, exclusionsSnap, recentQueueSnap] = await Promise.all([
        db.collection(`${userBase}/entries`)
          .where('createdAt', '>=', new Date(windowStartMs))
          .where('createdAt', '<=', new Date(windowEndMs))
          .orderBy('createdAt', 'desc')
          .limit(CANDIDATE_READ_LIMIT)
          .get(),
        db.collection(`${userBase}/revisit_exclusions`).get(),
        db.collection(`${userBase}/revisit_queue`)
          .where('selectedAt', '>=', new Date(nowMs - DEDUP_WINDOW_DAYS * DAY_MS))
          .get(),
      ]);

      const entries = [];
      entriesSnap.forEach((d) => entries.push(mapEntryDoc(d.id, d.data() || {})));

      const exclusions = [];
      exclusionsSnap.forEach((d) => exclusions.push(d.data() || {}));

      const recentQueue = [];
      recentQueueSnap.forEach((d) => {
        const data = d.data() || {};
        recentQueue.push({
          entryId: data.entryId,
          selectedAt: data.selectedAt?.toDate ? data.selectedAt.toDate() : data.selectedAt,
        });
      });

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
};
