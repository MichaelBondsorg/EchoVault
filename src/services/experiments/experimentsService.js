/**
 * Personal Experiments — client CRUD service (R3 Task 3; `getExperimentPrefs`/
 * `markExplainerSeen` added in Task 6 for the UI's one-time explainer —
 * co-located here rather than in a new file so every experiments-domain
 * Firestore write, including the small `settings/experimentPrefs` doc,
 * stays behind this one service module, per the "zero direct Firestore in
 * UI" global constraint).
 *
 * Mirrors the `(db, uid, ...)` / ISO-string-timestamp / `subscribeX(db, uid,
 * cb, onError)` conventions established by `recipeService.js` and
 * `revisitService.js`. Every write here is char-exact to the
 * firestore.rules `/experiments/{experimentId}` contract (see
 * `firestore.rules`, `experimentUpdateAllowed`/`experimentTransitionAllowed`
 * — commit a47a893 and the "NEW (R3)" match block comment above it):
 *
 *   create hasOnly(['question','template','analysisPlan','scope','status',
 *     'startAt','endAt','durationDays','excludedObservations','result',
 *     'createdAt','updatedAt']), question is string <=200 chars, template is
 *     string, analysisPlan is map, status=='draft', durationDays in
 *     [14,28], excludedObservations is list, and — the plan-freeze
 *     absence guard — `result`/`startAt`/`endAt` must be ABSENT (not null,
 *     not undefined-valued — the KEY itself must not exist) on create. Every
 *     payload this module builds honors that by simply never including
 *     those keys until the write that's allowed to set them.
 *
 *   update: diff().affectedKeys() hasOnly(['status','excludedObservations',
 *     'result','updatedAt','startAt','endAt']); startAt/endAt are only ever
 *     present in a diff on the draft->running transition (startExperiment is
 *     the ONLY function in this module that ever writes them); result is
 *     only ever present in a diff when the post-write status is 'completed'
 *     (writeResult, both the first-completion and completed-rerun paths);
 *     status transitions are constrained to the matrix in
 *     `experimentTransitionAllowed`; a 'stopped' experiment accepts only
 *     `updatedAt` from then on (pause/resume/stop/setObservationExcluded/
 *     writeResult all become illegal once stopped — this module fails fast
 *     client-side in `setObservationExcluded`/`writeResult` rather than
 *     letting a stopped-experiment write reach Firestore and bounce off the
 *     rules with an opaque permission-denied).
 *
 * `scope` write choice (documented, not left implicit): this module writes
 * `scope: scope ?? null` at create — the recipeService/spacesService
 * precedent (`recipeService.js`'s `normalizeRecipeInput`) — rather than
 * omitting the key when no scope is given. The rules' create `hasOnly` list
 * includes `scope` but places NO type or presence constraint on it, so
 * either omission or an explicit `null` satisfies the rules equally; writing
 * `null` was chosen to match the established codebase convention (recipes)
 * and so `scope` is always a readable, present field on every experiment
 * doc (never "missing vs. explicitly unscoped" ambiguity for a caller
 * reading it back).
 *
 * Storage: artifacts/{APP_COLLECTION_ID}/users/{uid}/experiments/{autoId}
 *   {question, template, analysisPlan, scope, status, startAt?, endAt?,
 *    durationDays, excludedObservations, result?, createdAt, updatedAt}
 */
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } from './estimator';

const MAX_QUESTION_LENGTH = 200;
const VALID_DURATIONS = [14, 28];
const DAY_MS = 24 * 60 * 60 * 1000;

function experimentsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/experiments`;
}

function settingsPath(uid) {
  return `artifacts/${APP_COLLECTION_ID}/users/${uid}/settings`;
}

function nowIso() {
  return new Date().toISOString();
}

function toValidDate(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Build the frozen `analysisPlan` map for `createExperiment`, from a
 * template catalog entry (`templates.js`) and its match params. Snapshots
 * the estimator's current spec thresholds (`MIN_PAIRED_OBSERVATIONS`,
 * `COVERAGE_FLOOR`) into the plan at declare-time — per plan-freeze, this
 * value never changes for the life of the experiment even if the estimator
 * module's constants are revised later. `computeResult.js`'s
 * `computeExperimentResult` is what actually READS `plan.minPairedObservations`
 * / `plan.coverageFloor` back (with a `?? MIN_PAIRED_OBSERVATIONS` /
 * `?? COVERAGE_FLOOR` fallback for a legacy plan predating this snapshot) —
 * this function's job is only to write the snapshot; see that module's
 * "FROZEN THRESHOLD SNAPSHOT" doc comment for why this used to be
 * write-only/decorative and is now actually enforced (R3 final review).
 *
 * Also snapshots the template's fixed narrative caveat strings
 * (`confounders`, `whatThisDoesNotProve`) onto the plan (R3 Task 5 review
 * fix). Without this, `computeResult.js` would have to re-look-up these
 * strings from the mutable template catalog by `templateId` at RESULT time
 * — a later catalog edit (wording tweak) or template removal would then
 * silently change or blank out (`undefined` -> `[]`) the safety-caveat text
 * on an already-`completed` result. Snapshotting them here, alongside the
 * plan's other frozen fields, means a result's caveats are exactly what was
 * true when the experiment was created, for its whole lifetime — the same
 * plan-freeze guarantee already applied to `exposure`/`outcome`/`lag`.
 *
 * Also snapshots `template.minExposureContrast` (Michael's round-2
 * statistical review, 2026-07-22, item 1 — see templates.js's own doc
 * comment for the pinned per-template values) onto `plan.minExposureContrast`
 * when the template declares one — the same "declare in the template,
 * freeze onto the plan, never re-derive at result time" pattern as
 * `splitMode`.
 *
 * @param {{id:string, exposure:object, outcome:object, lag:number,
 *   confounders?:string[], whatThisDoesNotProve?:string[]}} template
 * @param {{tag?: string}} [params] - required `params.tag` for the
 *   tag-presence template; ignored for every other template.
 * @returns {{templateId:string, lag:number, exposure:object, outcome:object,
 *   minPairedObservations:number, coverageFloor:number, confounders:string[],
 *   whatThisDoesNotProve:string[]}}
 */
/**
 * Resolve the device's IANA timezone via `Intl.DateTimeFormat`, falling back
 * to `'UTC'` when unavailable (an older/degraded environment, or a runtime
 * that reports an empty string) — never throws. This is called ONCE, here,
 * at plan-build time, and the result is FROZEN onto `analysisPlan.timezone`
 * for the life of the experiment (Michael review hardening, item 2): the
 * user's device timezone at creation time, not whatever timezone a later
 * render/session happens to run in (e.g. after travel) — series building,
 * coverage, and pairing all derive their calendar-day keys in this ONE
 * frozen zone so a single experiment's day boundaries never shift mid-run.
 */
export function resolveDeviceTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

export function buildAnalysisPlan(template, params = {}) {
  if (!template || typeof template.id !== 'string' || !template.exposure || !template.outcome) {
    throw new Error('buildAnalysisPlan: a valid template object is required.');
  }
  const exposure = { ...template.exposure };
  if (template.exposure.source === 'tags') {
    const tag = params?.tag;
    if (typeof tag !== 'string' || !tag) {
      throw new Error('buildAnalysisPlan: tag-presence templates require params.tag.');
    }
    exposure.tag = tag;
  }
  const plan = {
    templateId: template.id,
    lag: template.lag,
    exposure,
    outcome: { ...template.outcome },
    minPairedObservations: MIN_PAIRED_OBSERVATIONS,
    coverageFloor: COVERAGE_FLOOR,
    confounders: [...(template.confounders || [])],
    whatThisDoesNotProve: [...(template.whatThisDoesNotProve || [])],
    // Frozen device timezone (Michael review hardening, item 2) — see
    // `resolveDeviceTimezone`'s doc comment above.
    timezone: resolveDeviceTimezone(),
  };
  // splitMode is a MODE selection, not a threshold (see estimator.js's
  // runAnalysisPlan docblock) — only carried onto the plan when the
  // template itself declares one (today: only tag-presence-mood, via
  // 'binary'). Every other template omits the field entirely, so
  // `runAnalysisPlan`'s own `plan?.splitMode === 'binary' ? 'binary' :
  // 'median'` default still applies unchanged.
  if (template.splitMode === 'binary') {
    plan.splitMode = 'binary';
  }
  // minExposureContrast (Michael's round-2 statistical review, 2026-07-22,
  // item 1) — every REAL v1 template declares its own template-specific,
  // unit-aware minimum (see templates.js); only carried onto the plan when
  // the template actually declares one, mirroring splitMode's convention
  // above, so a hand-built test template that omits it exercises
  // `runAnalysisPlan`'s own `plan.minExposureContrast ?? DEFAULT_MIN_EXPOSURE_CONTRAST`
  // legacy fallback rather than silently writing `undefined` onto the plan.
  if (Number.isFinite(template.minExposureContrast)) {
    plan.minExposureContrast = template.minExposureContrast;
  }
  return plan;
}

/**
 * Subscribe to the user's experiments, newest first. Returns the
 * onSnapshot unsubscribe function.
 *
 * @param {object} db
 * @param {string} uid
 * @param {(experiments:Array)=>void} cb  called with [{id, ...data}]
 * @param {(err:Error)=>void} [onError]
 * @returns {Function} unsubscribe
 */
export function subscribeExperiments(db, uid, cb, onError) {
  const q = query(collection(db, experimentsPath(uid)), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snap) => {
      const experiments = [];
      snap.forEach((d) => experiments.push({ id: d.id, ...d.data() }));
      cb(experiments);
    },
    (err) => {
      if (typeof onError === 'function') onError(err);
    },
  );
}

/**
 * Create a new draft experiment. `result`/`startAt`/`endAt` keys are never
 * included in this payload (create-time absence guard).
 *
 * @param {object} db
 * @param {string} uid
 * @param {{question:string, template:string|{id:string}, analysisPlan:object,
 *   scope?:{spaceId:string}|null, durationDays:14|28}} input
 * @returns {Promise<object>} the created experiment, `{id, ...payload}`
 */
export async function createExperiment(db, uid, { question, template, analysisPlan, scope = null, durationDays } = {}) {
  const trimmedQuestion = typeof question === 'string' ? question.trim() : '';
  if (!trimmedQuestion) {
    throw new Error('createExperiment: question is required.');
  }
  if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
    throw new Error(`createExperiment: question must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }
  const templateId = typeof template === 'string' ? template : template?.id;
  if (typeof templateId !== 'string' || !templateId) {
    throw new Error('createExperiment: template (id or template object with an id) is required.');
  }
  if (!analysisPlan || typeof analysisPlan !== 'object' || Array.isArray(analysisPlan)) {
    throw new Error('createExperiment: analysisPlan (a plain object) is required.');
  }
  if (!VALID_DURATIONS.includes(durationDays)) {
    throw new Error(`createExperiment: durationDays must be one of ${VALID_DURATIONS.join(', ')}.`);
  }

  const now = nowIso();
  const payload = {
    question: trimmedQuestion,
    template: templateId,
    analysisPlan,
    scope: scope ?? null,
    status: 'draft',
    durationDays,
    excludedObservations: [],
    createdAt: now,
    updatedAt: now,
  };
  const docRef = await addDoc(collection(db, experimentsPath(uid)), payload);
  return { id: docRef.id, ...payload };
}

/**
 * The freeze moment: draft -> running, stamping `startAt`/`endAt` from
 * `durationDays`. This is the ONLY function in this module (or, per the
 * rules, the only legal client write at all) that ever touches
 * `startAt`/`endAt` — see the rules' `experimentUpdateAllowed` comment for
 * why that makes them writable exactly once, ever.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {14|28} durationDays - the experiment's own `durationDays` (not
 *   re-derived from the stored doc — callers already have it from the
 *   experiment object they're viewing).
 * @param {Date} [now] - injectable for deterministic tests; defaults to
 *   `new Date()`.
 */
export async function startExperiment(db, uid, experimentId, durationDays, now = new Date()) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('startExperiment: experimentId is required.');
  }
  if (!VALID_DURATIONS.includes(durationDays)) {
    throw new Error(`startExperiment: durationDays must be one of ${VALID_DURATIONS.join(', ')}.`);
  }
  const nowDate = toValidDate(now);
  if (!nowDate) {
    throw new Error('startExperiment: now must be a valid Date.');
  }
  const startAt = nowDate.toISOString();
  const endAt = new Date(nowDate.getTime() + durationDays * DAY_MS).toISOString();
  await updateDoc(doc(db, experimentsPath(uid), experimentId), {
    status: 'running',
    startAt,
    endAt,
    updatedAt: startAt,
  });
}

async function setStatus(db, uid, experimentId, status) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('setStatus: experimentId is required.');
  }
  await updateDoc(doc(db, experimentsPath(uid), experimentId), { status, updatedAt: nowIso() });
}

/** running -> paused. Immediate; never touches entries. */
export async function pauseExperiment(db, uid, experimentId) {
  await setStatus(db, uid, experimentId, 'paused');
}

/** paused -> running. Immediate; never touches entries. */
export async function resumeExperiment(db, uid, experimentId) {
  await setStatus(db, uid, experimentId, 'running');
}

/**
 * {running,paused} -> stopped. Immediate; never touches entries. Stop is a
 * hard finalize per firestore.rules — once stopped, no further status
 * change or excludedObservations/result edit is possible (see the rules'
 * `experimentUpdateAllowed` comment).
 */
export async function stopExperiment(db, uid, experimentId) {
  await setStatus(db, uid, experimentId, 'stopped');
}

/**
 * Delete the experiment doc. Never touches the `entries` collection — an
 * experiment's source entries are the user's own journal entries, untouched
 * by any experiment lifecycle action (PRD acceptance).
 */
export async function deleteExperiment(db, uid, experimentId) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('deleteExperiment: experimentId is required.');
  }
  await deleteDoc(doc(db, experimentsPath(uid), experimentId));
}

/**
 * Read-modify-write the `excludedObservations` list for one experiment (the
 * inspect/exclude seam). Dedupes on add (no-op if already excluded) and
 * removes on un-exclude — the round trip is idempotent either direction.
 * Fails fast, client-side, if the experiment is `stopped` (the rules would
 * reject this write too, but with an opaque permission-denied rather than a
 * clear message).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {string} dateKey - 'YYYY-MM-DD' paired-observation date to
 *   include/exclude.
 * @param {boolean} excluded - true to exclude, false to restore.
 * @returns {Promise<string[]>} the resulting excludedObservations list.
 */
export async function setObservationExcluded(db, uid, experimentId, dateKey, excluded) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('setObservationExcluded: experimentId is required.');
  }
  if (typeof dateKey !== 'string' || !dateKey) {
    throw new Error('setObservationExcluded: dateKey is required.');
  }
  const ref = doc(db, experimentsPath(uid), experimentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error(`setObservationExcluded: experiment ${experimentId} not found.`);
  }
  const data = snap.data() || {};
  if (data.status === 'stopped') {
    throw new Error('setObservationExcluded: cannot modify observations on a stopped experiment.');
  }
  const current = Array.isArray(data.excludedObservations) ? data.excludedObservations : [];
  const withoutDate = current.filter((k) => k !== dateKey);
  const next = excluded ? [...withoutDate, dateKey] : withoutDate;
  await updateDoc(ref, { excludedObservations: next, updatedAt: nowIso() });
  return next;
}

/**
 * Write a FIRST-completion result and mark the experiment `completed` in ONE
 * update (running/paused -> completed). Only ever called for a fresh
 * completion (auto-completion, `ExperimentsScreen.jsx`) — a result that
 * has never been shown to the user yet, so there is no "adjusted after
 * seeing the result" concern for this path.
 *
 * RESULT INTEGRITY (Michael review hardening, item 3): the stored `result`
 * field is NOT the bare `computeExperimentResult` output — it is wrapped as
 * `{original: result, exclusionHistory: []}`. `original` is written exactly
 * once, here, and is never overwritten again by anything in this module;
 * every later exclusion-driven rerun goes through `writeAdjustedResult`
 * below, which writes `result.adjusted` (never touching `original`) and
 * appends to `exclusionHistory`. See `computeResult.js`'s module doc
 * comment — `computeExperimentResult` itself stays a pure function that
 * returns the bare (unwrapped) result shape; this wrapping is a
 * storage-layer concern only, owned entirely by this module.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {object} result - the computed result object (`computeResult.js`'s
 *   `computeExperimentResult` output); this module does not validate its
 *   internal shape, only that it's a plain object.
 */
export async function writeResult(db, uid, experimentId, result) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('writeResult: experimentId is required.');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('writeResult: result (a plain object) is required.');
  }
  await updateDoc(doc(db, experimentsPath(uid), experimentId), {
    result: { original: result, exclusionHistory: [] },
    status: 'completed',
    updatedAt: nowIso(),
  });
}

/**
 * The reason enum a post-result exclusion toggle must supply (Michael
 * review hardening, item 3) — `'other'` is meant to be paired with an
 * optional free-text note in the UI dialog (stored as `note` on the history
 * entry; not itself validated/length-capped here, matching this module's
 * existing posture of trusting caller-shaped `result`/`analysisPlan`
 * payloads rather than deep-validating their contents).
 */
export const EXCLUSION_REASONS = Object.freeze(['wrong_data', 'wrong_date', 'other']);

/**
 * Pure helper (no Firestore) — builds the next `result` field value for a
 * post-result exclusion toggle, given the EXISTING stored `result` field
 * (whatever shape it's currently in — see the legacy-shape note below) and
 * the new adjusted computation.
 *
 * IMMUTABILITY (binding): `original` is carried through UNCHANGED from
 * whatever the existing stored value's `original` already is — this
 * function has no code path that replaces it. `exclusionHistory` is
 * APPENDED to (never replaced/truncated), and `adjusted` is the only field
 * that's ever overwritten wholesale (by design: it should always reflect
 * the MOST RECENT recomputation, not accumulate its own history).
 *
 * LEGACY BARE-SHAPE FALLBACK: if `existingResultField` does not carry an
 * `original` key at all (a result written before this wrapping existed —
 * none in prod today, `personalExperiments` is flag-gated OFF, but a
 * defensive fallback per the plan), the ENTIRE existing value is treated as
 * the original (matching `writeResult`'s own wrapping convention) and
 * `exclusionHistory` starts fresh at `[]`.
 *
 * @param {object} existingResultField - `experiment.result` as currently
 *   stored (either `{original, adjusted?, exclusionHistory}` or, for a
 *   legacy doc, the bare computed-result shape itself).
 * @param {{adjusted:object, dateKey:string, excluded:boolean, reason:string, at:string, note?:string}} args
 *   `note` is an OPTIONAL free-text elaboration, meant to be paired with
 *   `reason: 'other'` (not enforced — a note alongside a different reason
 *   is harmless and not rejected).
 * @returns {{original:object, adjusted:object, exclusionHistory:object[]}}
 */
export function buildAdjustedResultUpdate(existingResultField, { adjusted, dateKey, excluded, reason, at, note }) {
  if (!adjusted || typeof adjusted !== 'object') {
    throw new Error('buildAdjustedResultUpdate: adjusted (a plain object) is required.');
  }
  if (typeof dateKey !== 'string' || !dateKey) {
    throw new Error('buildAdjustedResultUpdate: dateKey is required.');
  }
  if (!EXCLUSION_REASONS.includes(reason)) {
    throw new Error(`buildAdjustedResultUpdate: reason must be one of ${EXCLUSION_REASONS.join(', ')}.`);
  }
  const original = existingResultField && typeof existingResultField === 'object' && 'original' in existingResultField
    ? existingResultField.original
    : existingResultField;
  const priorHistory = Array.isArray(existingResultField?.exclusionHistory) ? existingResultField.exclusionHistory : [];
  const historyEntry = { dateKey, excluded, reason, at: at || nowIso() };
  if (typeof note === 'string' && note.trim()) {
    historyEntry.note = note.trim();
  }
  return {
    original,
    adjusted,
    exclusionHistory: [...priorHistory, historyEntry],
  };
}

/**
 * Write an ADJUSTED (post-result exclusion toggle) recomputation. Status is
 * NOT included in this write's payload — the experiment is already
 * `completed` (a precondition of this ever being called; the rules'
 * `experimentTransitionAllowed` treats `completed -> completed` as a legal
 * no-op transition either way) — only `result`/`updatedAt` are touched,
 * matching the update allow-list exactly.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {{original:object, adjusted:object, exclusionHistory:object[]}} resultField
 *   - the FULL next value for the `result` field, e.g. from
 *   `buildAdjustedResultUpdate`.
 */
export async function writeAdjustedResult(db, uid, experimentId, resultField) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('writeAdjustedResult: experimentId is required.');
  }
  if (!resultField || typeof resultField !== 'object' || Array.isArray(resultField)) {
    throw new Error('writeAdjustedResult: resultField (a plain object) is required.');
  }
  await updateDoc(doc(db, experimentsPath(uid), experimentId), {
    result: resultField,
    updatedAt: nowIso(),
  });
}

/**
 * Read `settings/experimentPrefs` (the revisitPrefs twin — see
 * firestore.rules' `settingId != 'experimentPrefs'` clause comment): records
 * only whether the user has seen the one-time "associations, not proof"
 * explainer before their first experiment create flow. Experiments
 * themselves are NOT tracked here (they live in their own `experiments`
 * collection) — this doc is only the explainer flag.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<{enabled: boolean}>} `enabled: false` (not yet seen)
 *   when the doc doesn't exist.
 */
export async function getExperimentPrefs(db, uid) {
  const snap = await getDoc(doc(db, settingsPath(uid), 'experimentPrefs'));
  if (!snap.exists()) return { enabled: false };
  const data = snap.data() || {};
  return { enabled: data.enabled === true };
}

/**
 * Mark the one-time "associations, not proof" explainer as seen. Mirrors
 * `revisitService.js`'s `setRevisitEnabled(true)` first-opt-in-timestamp
 * convention: `optInAt` is set only once (preserved across repeat calls,
 * never overwritten to a later "last seen" time) via `merge: true` +
 * checking the existing doc first.
 *
 * @param {object} db
 * @param {string} uid
 */
export async function markExplainerSeen(db, uid) {
  const prefsRef = doc(db, settingsPath(uid), 'experimentPrefs');
  const existing = await getDoc(prefsRef);
  const now = nowIso();
  const payload = { enabled: true, updatedAt: now };
  if (!existing.exists() || !existing.data()?.optInAt) {
    payload.optInAt = now;
  }
  await setDoc(prefsRef, payload, { merge: true });
}

export default {
  resolveDeviceTimezone,
  buildAnalysisPlan,
  subscribeExperiments,
  createExperiment,
  startExperiment,
  pauseExperiment,
  resumeExperiment,
  stopExperiment,
  deleteExperiment,
  setObservationExcluded,
  writeResult,
  EXCLUSION_REASONS,
  buildAdjustedResultUpdate,
  writeAdjustedResult,
  getExperimentPrefs,
  markExplainerSeen,
};
