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
 *
 * R4 Phase 3 Task 3 (action confirmation v1) adds a nested subcollection:
 *   .../experiments/{experimentId}/confirmations/{dateKey}
 *     {dateKey, done, createdAt}
 *   — the explicit daily check-in for a tag-template experiment opted into
 *   `analysisPlan.exposureMode: 'confirmed'` at create (frozen, like every
 *   other plan field). See `setConfirmation`/`clearConfirmation`/
 *   `listConfirmations` below and `computeResult.js`'s confirmed-mode series
 *   builder.
 *
 * R4 Phase 3 Task 6 (repeated trials) adds two things:
 *   - `listFamilyRuns` — a read-only client-side filter over the SAME
 *     `subscribeExperiments` collection/ordering (no new query, no new
 *     index) that surfaces every COMPLETED experiment sharing a
 *     `hypothesisFamilyId`, for the result view's family-history section.
 *   - `writeOrSupersedeExperimentResultClaim` — the shared find-live-prior-
 *     and-decide helper both `writeResult` and `writeAdjustedResult` now
 *     call for their `experiment_result` claim write. This is the REPEAT-RUN
 *     LINEAGE FIX: see that function's own doc comment for the defect it
 *     closes (a repeat run's claim used to collide on a deterministic doc
 *     id, get rules-denied, and silently vanish).
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
  getDocs,
  setDoc,
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { MIN_PAIRED_OBSERVATIONS, COVERAGE_FLOOR } from './estimator';
import { familyIdForExperiment, registerCandidates, readLedgerCounts, bonferroniCiLevel } from '../insights/testingLedger';
import { buildExperimentResultClaim } from './experimentClaim';
import { writeClaim, supersedeClaim, listAllClaims } from '../insights/claims/claimsService';

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
  // exposureMode (R4 Phase 3 Task 3, action confirmation v1): opt-in
  // confirmed-exposure daily check-ins. `params.exposureMode === 'confirmed'`
  // is accepted ONLY for the tag-presence template — the same
  // `template.splitMode === 'binary'` discriminator already used above (the
  // only v1 template that declares it) — every other template ignores the
  // param entirely, and a tag template with no `exposureMode`/any value
  // other than `'confirmed'` stays passive BY OMISSION, never a written
  // `'passive'` key, matching `splitMode`/`minExposureContrast`'s own
  // "only carried when non-default" convention just above. This keeps every
  // legacy/passive plan byte-identical to a plan built before this field
  // existed. `computeResult.js` reads `plan.exposureMode === 'confirmed'` —
  // anything else, including absence, is passive tag-scanning, unchanged.
  if (template.splitMode === 'binary' && params?.exposureMode === 'confirmed') {
    plan.exposureMode = 'confirmed';
  }
  // Hypothesis-family testing ledger (R4 Phase 1 retrofit, DR stat-req 9) —
  // ALWAYS stamped, deterministic from template id + tag alone (see
  // `testingLedger.js`'s `familyIdForExperiment`: no tag -> 'experiment:{id}',
  // a tag -> ':tag:{lowercased}'). This is what lets repeated experiments of
  // the SAME hypothesis (same template+tag, possibly a different time
  // window) share one ledger candidate instead of each independently
  // inflating the family's multiple-testing burden (m).
  plan.hypothesisFamilyId = familyIdForExperiment(template.id, params.tag ?? null);
  // ciLevel is set here ONLY when the caller already knows the family's
  // prior-tested count (finite, >= 1 — i.e. at least one candidate was
  // tested before this one). Absence is intentional: `runAnalysisPlan`'s own
  // `plan?.ciLevel ?? CI_LEVEL` fallback then applies the unadjusted 0.95
  // default, which is exactly what every existing/legacy plan (predating
  // this retrofit) already computes with — this keeps them byte-identical.
  // In practice `createExperiment` (below) is where this actually gets
  // computed for real, from a FRESH ledger read taken at create time; a
  // caller building a plan ahead of that read (as this function's own
  // signature allows) simply won't have a priorTestedCount yet and will
  // correctly get no ciLevel here.
  if (Number.isFinite(params.priorTestedCount) && params.priorTestedCount >= 1) {
    // +1: this experiment itself is one of the m tested candidates.
    plan.ciLevel = bonferroniCiLevel(params.priorTestedCount + 1);
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

  // Hypothesis-family testing ledger (R4 Phase 1 retrofit): read the
  // family's CURRENT tested count and freeze the Bonferroni-adjusted
  // ciLevel onto the plan at create time — this IS the freeze moment; once
  // this doc is written, plan-freeze forbids ever editing analysisPlan
  // again, so whatever ciLevel is decided here is permanent for the
  // experiment's whole life.
  //
  // FAIL-CLOSED (deliberate posture, not an oversight): if the ledger read
  // throws (network error, permissions, etc.), this function does NOT
  // catch it — the throw propagates and createExperiment fails outright.
  // The alternative (swallow the error, fall back to the unadjusted 0.95
  // default) would silently under-adjust for multiple testing, and because
  // that ciLevel gets frozen into an immutable doc, a silent miscount could
  // never be corrected later. A failed create, by contrast, costs the user
  // nothing but a retry (no experiment doc was ever written). Match the
  // repo's existing fail-closed conventions elsewhere (e.g. AI consent
  // revocation) rather than fail-open here.
  let finalAnalysisPlan = analysisPlan;
  if (typeof analysisPlan.hypothesisFamilyId === 'string' && analysisPlan.hypothesisFamilyId) {
    const counts = await readLedgerCounts(db, uid, [analysisPlan.hypothesisFamilyId]);
    const priorTestedCount = counts.get(analysisPlan.hypothesisFamilyId) ?? 0;
    if (Number.isFinite(priorTestedCount) && priorTestedCount >= 1) {
      // +1: this experiment itself is one of the m tested candidates.
      finalAnalysisPlan = { ...analysisPlan, ciLevel: bonferroniCiLevel(priorTestedCount + 1) };
    }
  }

  const now = nowIso();
  const payload = {
    question: trimmedQuestion,
    template: templateId,
    analysisPlan: finalAnalysisPlan,
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

  // Hypothesis-family testing ledger (R4 Phase 1 retrofit): register this
  // experiment as a tested candidate ONLY now that it has actually started
  // running — a draft that's created and never started (deleted, abandoned)
  // must never count toward the family's multiple-testing burden. This is
  // strictly AFTER the status-transition write above succeeds (a failed
  // transition must not register a candidate either).
  //
  // This re-reads the just-updated doc rather than accepting an
  // `analysisPlan` parameter here — the latter would change this function's
  // signature and require updating every call site (out of this task's
  // scope); reading it back keeps the existing single-file contract intact.
  // A legacy experiment (created before this retrofit; no
  // `hypothesisFamilyId` on its frozen plan) is silently skipped — it never
  // joined the ledger and this retrofit does not retroactively enroll it.
  //
  // CONTAINMENT, NOT PROPAGATION (Important review finding, fix wave 1): by
  // this point the status-transition `updateDoc` above has ALREADY
  // COMMITTED, and the rules' update `hasOnly` list forbids adding any
  // "registration pending"/retry-marker key to the experiment doc — there is
  // no legal way to persist "start succeeded but ledger registration
  // didn't" onto the doc itself. So a throw out of this block can only ever
  // be a LIE to the caller: the UI's catch would say "Could not start that
  // experiment. Please try again." when the experiment plainly DID start,
  // and a well-meaning retry would then create a DUPLICATE experiment —
  // while the real, recoverable problem (a transient ledger read/write
  // failure) goes unaddressed. Given that constraint, the only sound design
  // is containment (catch + warn, never rethrow) paired with an idempotent
  // retry: `registerCandidates` is transactional and distinct-counting by
  // candidateId, so re-registering the SAME candidateId again later (in
  // `writeResult`, below) is harmless — `testedCount` (the actual family
  // size the Bonferroni adjustment reads) is unchanged, only the cosmetic
  // `timesTested` counter bumps. That later retry is the real recovery path
  // for whatever fails here; this catch's job is only to stop a transient
  // ledger failure from lying to the user about whether their experiment
  // started.
  let hypothesisFamilyId = null;
  try {
    const startedSnap = await getDoc(doc(db, experimentsPath(uid), experimentId));
    hypothesisFamilyId = startedSnap.exists() ? startedSnap.data()?.analysisPlan?.hypothesisFamilyId : null;
    if (typeof hypothesisFamilyId === 'string' && hypothesisFamilyId) {
      await registerCandidates(db, uid, hypothesisFamilyId, [hypothesisFamilyId], { now: startAt });
    }
  } catch (err) {
    console.warn(
      `startExperiment: testing-ledger registration failed for experiment ${experimentId}`
        + (typeof hypothesisFamilyId === 'string' && hypothesisFamilyId ? ` (family ${hypothesisFamilyId})` : ' (family unknown — read-back failed)')
        + '; testing-ledger registration failed — family tested-count will undercount until re-registration — retried automatically at result time.',
      err,
    );
  }
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
 * Shared find-live-prior-and-decide helper (R4 Phase 3 Task 6) used by BOTH
 * `writeResult` (every completion — first run AND every repeat run of the
 * same hypothesis) and `writeAdjustedResult` (a post-result exclusion-toggle
 * recompute) for their `experiment_result` claim write. Before this task,
 * each writer independently decided what to do with a freshly built claim
 * input; `writeAdjustedResult` already found-and-decided correctly (R4
 * Phase 2, Task 4 / F1 hardening) while `writeResult` called `writeClaim`
 * directly, bare — the two now have IDENTICAL semantics, so there is exactly
 * one implementation:
 *   - no live claim exists yet for this candidate -> write `claimInput`
 *     as-is (v1, `parentClaimId: null`)
 *   - the live claim is `'suppressed'` -> SKIP entirely, no write, no
 *     supersede (system-wide invariant, `claimsPipeline.js`/matrix row
 *     R4P1-j: suppression is a user decision — do_not_analyze feedback —
 *     that outlives evidence drift and is lifted only through the explicit
 *     user path; a fresh computation must never auto-resurrect it)
 *   - the live claim is `'verified'` or `'expired'` -> supersede:
 *     `version: existing.version + 1`, `parentClaimId: existing.id`
 *     (expired -> verified-again is the documented revival path)
 *   - EXCEPT (final review Important 1, closure wave — the RUN-IDENTITY
 *     FIX): if the incoming claim's run is OLDER than the live claim's run
 *     (both carry `analysisPlan.sourceCompletedAt` and the incoming's is the
 *     smaller/earlier value, per a DIFFERENT `sourceExperimentId`) -> SKIP
 *     entirely instead of superseding. See the function body's own comment
 *     block for the full reasoning and `experimentClaim.js`'s "RUN IDENTITY"
 *     doc comment for why the ordering field is the run's immutable
 *     `frozenAt`, not a wall-clock timestamp.
 *
 * THE REPEAT-RUN LINEAGE FIX (the load-bearing defect this task closes):
 * `writeClaim`'s doc id is DETERMINISTIC — `hypothesisFamilyId +
 * candidateId + version` (`claimSchema.js`'s `claimDocId`). Before this
 * helper existed, `writeResult` called `writeClaim` directly with a
 * claimInput that always has `version: 1` (`buildExperimentResultClaim`
 * always produces a first-version shape) — so a SECOND completed run of the
 * SAME hypothesis (same template+tag, hence the same `candidateId`, per
 * `experimentClaim.js`'s "candidateId: hypothesisFamilyId" convention)
 * produced the exact SAME doc id as the first run's already-existing claim.
 * `writeClaim`'s `setDoc` has no `merge`, and firestore.rules' create-only
 * `affectedKeys` allow-list denies a write against an already-existing doc
 * id as an illegal update -> the write was rules-denied -> `writeResult`'s
 * containing try/catch swallowed it as a `console.warn` -> the repeat run's
 * claim was silently NEVER written, with no visible error to the user.
 * Routing `writeResult` through this SAME find-prior-and-decide logic
 * `writeAdjustedResult` already used closes that gap: a second (or Nth)
 * run's claim now SUPERSEDES the prior run's, with real, inspectable
 * lineage (`version: N, parentClaimId`), instead of silently vanishing.
 *
 * CONTAINMENT IS THE CALLER'S JOB: this function is allowed to throw. Both
 * `writeResult` and `writeAdjustedResult` already wrap their own call site
 * in a try/catch that warns rather than rethrows — by the time either calls
 * this, the experiment doc's own `result` field has already committed, so a
 * throw out of this function must never surface as a failed `writeResult`/
 * `writeAdjustedResult` call (that would falsely tell the caller the result
 * wasn't saved, and a well-meaning retry would just re-attempt the same
 * idempotent claim decision).
 *
 * @param {object} db
 * @param {string} uid
 * @param {{experiment:object, experimentId:string, result:object, now:string|Date}} args
 *   `result` is a SINGLE bare `computeExperimentResult` output — the caller
 *   unwraps the storage-layer `{original, adjusted, exclusionHistory}`
 *   wrapper before calling (`writeResult` passes the bare result it was
 *   given; `writeAdjustedResult` passes `resultField.adjusted`).
 * @returns {Promise<void>}
 */
export async function writeOrSupersedeExperimentResultClaim(db, uid, {
  experiment, experimentId, result, now,
}) {
  const claimInput = buildExperimentResultClaim({
    experiment, experimentId, result, now,
  });
  if (!claimInput) return;
  const existingClaims = await listAllClaims(db, uid);
  const existing = existingClaims.find((c) => c.claimType === 'experiment_result'
    && c.analysisPlan?.candidateId === claimInput.analysisPlan.candidateId
    && c.supersededByClaimId == null);
  if (existing?.status === 'suppressed') {
    // no-op: prior stays exactly as-is, no new claim is written (invariant
    // above — suppression is never auto-touched by a fresh computation).
  } else if (existing) {
    // RUN-IDENTITY GUARD (final review Important 1, closure wave): before
    // superseding, check whether `existing` was produced by a genuinely
    // NEWER run than the one `claimInput` describes. Without this, a
    // post-completion exclusion adjustment on an OLD run (allowed any time —
    // `setObservationExcluded` only forbids a `stopped` experiment, not an
    // old completed one) would unconditionally supersede whatever is
    // currently live, even a SECOND run's already-current claim — silently
    // making stale data look like the family's latest result, with no way
    // for a reader to tell.
    //
    // `sourceExperimentId`/`sourceCompletedAt` are the run-identity/ordering
    // stamps `experimentClaim.js`'s `buildExperimentResultClaim` puts on
    // `analysisPlan` (see that function's own "RUN IDENTITY" doc comment for
    // why `sourceCompletedAt` is the run's immutable `frozenAt`, not a
    // wall-clock "now" that would drift on every later adjustment).
    const incomingRunId = claimInput.analysisPlan?.sourceExperimentId;
    const incomingCompletedAt = claimInput.analysisPlan?.sourceCompletedAt;
    const existingRunId = existing.analysisPlan?.sourceExperimentId;
    const existingCompletedAt = existing.analysisPlan?.sourceCompletedAt;

    // SAME-RUN ADJUSTMENT ALWAYS SUPERSEDES: a claim being rebuilt for the
    // SAME experiment that produced the currently-live claim is just this
    // run's own recomputation (a fresh completion re-run, or an exclusion
    // toggle on the run that IS the live claim) — never gated on ordering.
    const sameRun = typeof incomingRunId === 'string' && incomingRunId && incomingRunId === existingRunId;

    // LEGACY (no stamps) SELF-HEALS: a claim written before this fix carries
    // neither key. With no ordering information to compare, this preserves
    // the pre-fix behavior (always supersede) rather than guessing — the
    // very next write for this candidate (this one) stamps real run-identity
    // fields going forward, so the gap closes itself on first touch.
    const bothHaveOrderingStamps = typeof incomingCompletedAt === 'string' && incomingCompletedAt
      && typeof existingCompletedAt === 'string' && existingCompletedAt;

    const incomingIsFromAnOlderRun = !sameRun && bothHaveOrderingStamps && incomingCompletedAt < existingCompletedAt;
    if (incomingIsFromAnOlderRun) {
      // SKIP entirely: no write, no supersede. The newer run's claim stays
      // exactly as-is and remains the family's latest. The adjusted old
      // result itself is NOT lost — it's still fully visible on its own
      // experiment doc (`writeAdjustedResult`'s `result.adjusted` /
      // `exclusionHistory`); only the derivative claim declines to overwrite
      // a newer run's already-current claim.
      return;
    }
    await supersedeClaim(db, uid, existing, {
      ...claimInput,
      version: existing.version + 1,
      parentClaimId: existing.id,
    });
  } else {
    await writeClaim(db, uid, claimInput);
  }
}

/**
 * Write a FIRST-completion result and mark the experiment `completed` in ONE
 * update (running/paused -> completed). Only ever called for a fresh
 * completion (auto-completion, `ExperimentsScreen.jsx`) — a result that
 * has never been shown to the user yet, so there is no "adjusted after
 * seeing the result" concern for this path. **Also the ONLY completion
 * writer for a REPEAT run of the same hypothesis** — a repeat run is, from
 * this function's perspective, just another fresh completion (a new
 * experiment doc, `draft -> running -> completed` all over again); the
 * REPEAT-RUN LINEAGE FIX below is what makes its claim actually land instead
 * of silently colliding with the prior run's.
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
  const ref = doc(db, experimentsPath(uid), experimentId);
  const completedAt = nowIso();
  await updateDoc(ref, {
    result: { original: result, exclusionHistory: [] },
    status: 'completed',
    updatedAt: completedAt,
  });

  // Single post-write read-back (contained), reused by BOTH the idempotent
  // testing-ledger re-registration retry below AND the experiment_result
  // claim write further below — both need the just-completed experiment's
  // frozen analysisPlan, and both are containment-only: a failure here must
  // never fail the result save that already committed above.
  let experimentData = null;
  try {
    const snap = await getDoc(ref);
    experimentData = snap.exists() ? snap.data() : null;
  } catch (err) {
    console.warn(
      `writeResult: post-write read-back failed for experiment ${experimentId}; testing-ledger re-registration and the experiment_result claim write were both skipped.`,
      err,
    );
  }

  // IDEMPOTENT RETRY for start-time testing-ledger registration (Important
  // review finding, fix wave 1 — see `startExperiment`'s containment
  // comment above for the full reasoning behind why that registration is
  // allowed to fail silently). Every experiment that reaches a result has,
  // by definition, actually run — so re-attempt `registerCandidates` here,
  // unconditionally, for any completed experiment whose frozen plan carries
  // a `hypothesisFamilyId`. This is safe to run even when start-time
  // registration already succeeded: `registerCandidates` is transactional
  // and distinct-counting by candidateId, so re-registering the same
  // candidateId is a no-op on `testedCount` (only a cosmetic `timesTested`
  // bump) — and it GUARANTEES that any experiment producing a result ends
  // up registered even if the original start-time attempt was
  // contained/swallowed. A legacy experiment (no `hypothesisFamilyId` on
  // its frozen plan) is skipped silently — no warn — matching
  // `startExperiment`'s own legacy-skip behavior; it never joined the
  // ledger and this retrofit does not retroactively enroll it. Failure here
  // is contained the same way as in `startExperiment` (warn, never
  // rethrow) — the result write above has already committed, so a throw
  // here would be the same "lies to the UI, provokes a retry/duplicate"
  // problem this whole fix wave exists to avoid.
  const hypothesisFamilyId = experimentData?.analysisPlan?.hypothesisFamilyId ?? null;
  if (typeof hypothesisFamilyId === 'string' && hypothesisFamilyId) {
    try {
      await registerCandidates(db, uid, hypothesisFamilyId, [hypothesisFamilyId], { now: nowIso() });
    } catch (err) {
      console.warn(
        `writeResult: testing-ledger re-registration failed for experiment ${experimentId} (family ${hypothesisFamilyId}); family tested-count may remain undercounted.`,
        err,
      );
    }
  }

  // EXPERIMENT_RESULT CLAIM (R4 Phase 2, Task 4; lineage fixed R4 Phase 3,
  // Task 6): the third claim type (`experimentClaim.js`'s
  // `buildExperimentResultClaim`), built from PURE deterministic prose only
  // — no LLM. Routed through the SAME find-live-prior-and-decide helper
  // `writeAdjustedResult` uses below (`writeOrSupersedeExperimentResultClaim`
  // — see its doc comment for the repeat-run lineage defect this closes: a
  // bare `writeClaim` here used to collide on a deterministic doc id for
  // every repeat run of the same hypothesis, get rules-denied, and silently
  // lose the claim). CONTAINED the same way as the ledger retry above: the
  // result save already committed above, so a claim-write failure must
  // never surface as a failed `writeResult` call (that would falsely tell
  // the caller the result wasn't saved, and a well-meaning retry would just
  // re-attempt the same idempotent claim decision).
  // `buildExperimentResultClaim` (called inside the helper) returns `null`
  // for an insufficient result, a zero-delta result, or a legacy plan with
  // no `hypothesisFamilyId` — no claim is written in any of those cases.
  if (experimentData) {
    try {
      await writeOrSupersedeExperimentResultClaim(db, uid, {
        experiment: { id: experimentId, ...experimentData },
        experimentId,
        result,
        now: completedAt,
      });
    } catch (err) {
      console.warn(
        `writeResult: experiment_result claim write failed for experiment ${experimentId}; the result was still saved.`,
        err,
      );
    }
  }
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
  const ref = doc(db, experimentsPath(uid), experimentId);
  const updatedAt = nowIso();
  await updateDoc(ref, {
    result: resultField,
    updatedAt,
  });

  // EXPERIMENT_RESULT CLAIM SUPERSEDE (R4 Phase 2, Task 4; extracted into
  // the shared `writeOrSupersedeExperimentResultClaim` helper R4 Phase 3
  // Task 6, `writeResult` now uses the SAME helper for its own — previously
  // buggy — claim write, see that function's doc comment): an adjusted
  // (post-result exclusion toggle) recomputation supersedes the
  // experiment's existing, current (non-superseded) `experiment_result`
  // claim, if one exists, with a new version built from the ADJUSTED
  // estimate — this module's own original/adjusted result lineage,
  // projected onto claims' version/parentClaimId lineage. When no prior
  // claim exists for this candidate (e.g. the original result was
  // insufficient or zero-delta and never produced one), a fresh v1 is
  // written instead of superseding nothing. A SUPPRESSED prior is never
  // auto-touched (system-wide invariant, `claimsPipeline.js`/matrix row
  // R4P1-j — see the helper's doc comment). CONTAINED the same way as
  // `writeResult`'s claim write above: the adjusted result save already
  // committed, so a failure here must never surface as a failed
  // `writeAdjustedResult` call.
  try {
    const snap = await getDoc(ref);
    const experimentData = snap.exists() ? snap.data() : null;
    if (experimentData) {
      await writeOrSupersedeExperimentResultClaim(db, uid, {
        experiment: { id: experimentId, ...experimentData },
        experimentId,
        result: resultField.adjusted,
        now: updatedAt,
      });
    }
  } catch (err) {
    console.warn(
      `writeAdjustedResult: experiment_result claim write failed for experiment ${experimentId}; the adjusted result was still saved.`,
      err,
    );
  }
}

/**
 * Confirmations subcollection path — `experiments/{experimentId}/
 * confirmations/{dateKey}` (R4 Phase 3 Task 3). Doc id equals the `dateKey`
 * field, matching `firestore.rules`' nested `confirmations/{dateKey}` match
 * block.
 */
function confirmationsPath(uid, experimentId) {
  return `${experimentsPath(uid)}/${experimentId}/confirmations`;
}

/**
 * Confirmed-exposure daily check-ins (R4 Phase 3 Task 3, action
 * confirmation v1) — the explicit "did you do it" answer for one calendar
 * day of a `analysisPlan.exposureMode === 'confirmed'` experiment. One doc
 * per `dateKey`, `{dateKey, done, createdAt}`, char-exact to
 * `firestore.rules`' nested `confirmations/{dateKey}` `hasOnly` list.
 *
 * A day with NO doc here is UNKNOWN, not "no" — `computeResult.js`'s
 * confirmed-mode series builder OMITS a missing dateKey entirely (tri-state:
 * done:true -> 1, done:false -> 0, no doc -> omitted). `setConfirmation`
 * always writes a fresh `createdAt` (the doc's shape has no immutability
 * requirement on that field — a re-answered day is simply overwritten, same
 * "last write wins" posture as every other mutable field this module owns).
 *
 * RUNNING-STATUS-ONLY GUARD (client-enforced, mirrors
 * `setObservationExcluded`'s stopped-guard above): a fresh read of the
 * parent experiment doc gates the write BEFORE it's attempted, failing fast
 * with a clear message rather than letting a status-guarded write reach
 * Firestore's rules (which do not themselves restrict this subcollection by
 * parent status — see `firestore.rules`' comment on that block) and bounce
 * back some other way. Confirmations on a stopped/completed experiment are
 * frozen history — once running ends, no further check-in (add or clear) is
 * legal.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {string} dateKey - 'YYYY-MM-DD'.
 * @param {boolean} done
 */
export async function setConfirmation(db, uid, experimentId, dateKey, done) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('setConfirmation: experimentId is required.');
  }
  if (typeof dateKey !== 'string' || !dateKey) {
    throw new Error('setConfirmation: dateKey is required.');
  }
  if (typeof done !== 'boolean') {
    throw new Error('setConfirmation: done must be a boolean.');
  }
  const experimentSnap = await getDoc(doc(db, experimentsPath(uid), experimentId));
  if (!experimentSnap.exists()) {
    throw new Error(`setConfirmation: experiment ${experimentId} not found.`);
  }
  if (experimentSnap.data()?.status !== 'running') {
    throw new Error('setConfirmation: can only check in while the experiment is running.');
  }
  await setDoc(doc(db, confirmationsPath(uid, experimentId), dateKey), {
    dateKey,
    done,
    createdAt: nowIso(),
  });
}

/**
 * Un-answer a day — deletes its confirmation doc, restoring it to UNKNOWN
 * (never "no"). Same running-status-only guard as `setConfirmation`.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @param {string} dateKey
 */
export async function clearConfirmation(db, uid, experimentId, dateKey) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('clearConfirmation: experimentId is required.');
  }
  if (typeof dateKey !== 'string' || !dateKey) {
    throw new Error('clearConfirmation: dateKey is required.');
  }
  const experimentSnap = await getDoc(doc(db, experimentsPath(uid), experimentId));
  if (!experimentSnap.exists()) {
    throw new Error(`clearConfirmation: experiment ${experimentId} not found.`);
  }
  if (experimentSnap.data()?.status !== 'running') {
    throw new Error('clearConfirmation: can only clear a check-in while the experiment is running.');
  }
  await deleteDoc(doc(db, confirmationsPath(uid, experimentId), dateKey));
}

/**
 * Read every confirmation doc for one experiment, unordered (caller sorts /
 * indexes by `dateKey` as needed — `computeResult.js`'s series builder does
 * its own dateKey-sorted mapping). No status guard — reading confirmations
 * for a stopped/completed experiment is always allowed (frozen history is
 * still readable).
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} experimentId
 * @returns {Promise<Array<{id:string, dateKey:string, done:boolean, createdAt:string}>>}
 */
export async function listConfirmations(db, uid, experimentId) {
  if (typeof experimentId !== 'string' || !experimentId) {
    throw new Error('listConfirmations: experimentId is required.');
  }
  const snap = await getDocs(collection(db, confirmationsPath(uid, experimentId)));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

/**
 * Family history (R4 Phase 3 Task 6, repeated trials): every COMPLETED
 * experiment sharing the given `hypothesisFamilyId`, sorted OLDEST-first by
 * `createdAt` (so "run N of M" numbering reads chronologically, the current/
 * most-recent run last). A pure client-side filter over the exact same
 * collection/ordering `subscribeExperiments` already reads (`orderBy
 * 'createdAt'`) — deliberately NO new query shape and NO new Firestore
 * index, per the brief. `completedAt` has no dedicated stored field on the
 * experiment doc; `updatedAt` is used as the documented best-available proxy
 * — it is stamped to the completion instant by `writeResult` at first
 * completion, though a LATER post-result exclusion toggle
 * (`writeAdjustedResult`) also bumps it, so for an experiment with
 * exclusion-adjusted history this is "last touched," not strictly "first
 * completed." `delta`/`status` are read from `result.original` (never
 * `result.adjusted`) — the family-history line is about what each ORIGINAL
 * run found, matching the brief's exact field mapping.
 *
 * SORT KEY FIX (R4 Phase 3 backlog, review item B): the list is ordered by
 * `createdAt` — immutable once an experiment leaves `draft` (plan-freeze) —
 * NOT `updatedAt`. `updatedAt` is still what's SHOWN as `completedAt` above
 * (the display value is unchanged), but it must never be the ORDER key: a
 * later exclusion-adjustment on an EARLIER run bumps that run's `updatedAt`
 * to a time after a more-recent run's own completion, which used to
 * silently misorder "Run N of M" labels (an earlier run could reshuffle
 * past a later one just because someone toggled an excluded day on it).
 * `createdAt` never moves after creation, so the run order — and therefore
 * every "Run N of M" label — stays fixed for the life of the family.
 *
 * Never throws on a malformed doc (a missing/non-object `result` simply
 * yields `delta: null, status: 'unknown'` for that run) — the caller
 * (`ExperimentResultView`) treats an outright read failure (network/
 * permissions) as "hide the section silently," per the brief; this function
 * itself only guards against a shape surprise within an otherwise-successful
 * read.
 *
 * @param {object} db
 * @param {string} uid
 * @param {string} hypothesisFamilyId
 * @returns {Promise<Array<{id:string, completedAt:string|null, delta:number|null, status:string}>>}
 */
export async function listFamilyRuns(db, uid, hypothesisFamilyId) {
  if (typeof hypothesisFamilyId !== 'string' || !hypothesisFamilyId) return [];
  const q = query(collection(db, experimentsPath(uid)), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  const runs = [];
  snap.forEach((d) => {
    const data = d.data() || {};
    if (data.status !== 'completed') return;
    if (data.analysisPlan?.hypothesisFamilyId !== hypothesisFamilyId) return;
    const original = data.result && typeof data.result === 'object' ? data.result.original : null;
    runs.push({
      id: d.id,
      // Sort key ONLY — immutable, never displayed directly; stripped from
      // the returned shape below. `completedAt` (displayed) stays sourced
      // from `updatedAt`, unchanged.
      _createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
      completedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      delta: Number.isFinite(original?.estimate?.delta) ? original.estimate.delta : null,
      status: typeof original?.status === 'string' ? original.status : 'unknown',
    });
  });
  runs.sort((a, b) => {
    if (!a._createdAt) return 1;
    if (!b._createdAt) return -1;
    return a._createdAt < b._createdAt ? -1 : a._createdAt > b._createdAt ? 1 : 0;
  });
  return runs.map(({ _createdAt, ...run }) => run);
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
  writeOrSupersedeExperimentResultClaim,
  listFamilyRuns,
  getExperimentPrefs,
  markExplainerSeen,
  setConfirmation,
  clearConfirmation,
  listConfirmations,
};
