/**
 * Shared intent schema, storage shape, and the client-update contract (PRD 0B,
 * plan task I1).
 *
 * An "intent" is the precision-first replacement for the old broad-phrase task
 * classifier. The activation policy (activationPolicy.js) decides an intent's
 * state; server extraction (extractIntents.js) constructs the stored document
 * via `buildIntent`. The client may only make a narrow set of state
 * transitions — encoded here as `validateUserIntentUpdate` (a JS mirror of the
 * firestore.rules `intents` block) so the same contract is testable in both
 * places and the two never drift.
 *
 * Storage:
 *   artifacts/{APP}/users/{uid}/intents/{id}
 *   artifacts/{APP}/users/{uid}/user_decisions/{autoId}
 */

// Semantic category of a captured intent. Only `task` and `open_loop` may ever
// become active/suggested (see activationPolicy.js) — the rest are context-only
// and always abstain.
export const INTENT_KINDS = Object.freeze([
  'task',
  'open_loop',
  'event',
  'goal_habit',
  'reflection',
  'external_action',
  'conditional',
  'completed',
]);

// Lifecycle state. `active` and `suggested` are surfaced to the user; `abstain`
// is captured-but-silent; `dismissed` / `completed_state` are user-terminal;
// `superseded` is a SERVER-ONLY terminal state stamped on a stale intent whose
// entry was re-extracted at a newer inputVersion (orphan reap) and which a
// user_decision still references (so it is retired, not hard-deleted).
export const INTENT_STATES = Object.freeze([
  'active',
  'suggested',
  'abstain',
  'dismissed',
  'completed_state',
  'superseded',
]);

// The ten boolean signals the policy reasons over. Every one is REQUIRED and
// must be a real boolean — a missing/loose attribute must never be coerced into
// a truthy activation.
export const INTENT_ATTRIBUTE_KEYS = Object.freeze([
  'agency',
  'concrete',
  'unfinished',
  'temporalFit',
  'negated',
  'quoted',
  'conditional',
  'goalLanguage',
  'otherOwned',
  'completed',
]);

// Fields a client update may touch. Extraction-owned fields are immutable from
// the client. Kept identical to the firestore.rules affectedKeys allowlist.
//   snoozedUntil: ISO string | null — defer a due loop (state stays `active`).
//   outcome:      {closedAt, kind, answerEntryId} | null — set when closing a
//                 loop; never touches the source entry.
//   userText:     string | null — display override for repair/edit;
//                 `sourceSpan` stays immutable evidence.
export const CLIENT_MUTABLE_KEYS = Object.freeze([
  'state',
  'updatedAt',
  'authorization',
  'snoozedUntil',
  'outcome',
  'userText',
]);

export const DECISION_ACTIONS = Object.freeze([
  'kept',
  'dismissed',
  'not_a_task',
  'completed',
  'snoozed',
  'answered',
  'closed',
]);

const OUTCOME_KEYS = Object.freeze(['closedAt', 'kind', 'answerEntryId']);
const OUTCOME_KINDS = Object.freeze(['answered', 'closed']);

const SCHEMA_VERSION = 1;
const PROMPT_VERSION = 1;

function isBool(v) {
  return v === true || v === false;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateSourceSpan(sourceSpan) {
  if (!sourceSpan || typeof sourceSpan !== 'object') {
    throw new Error('intent: sourceSpan is required');
  }
  const { start, end, text } = sourceSpan;
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || start < 0 || end < start) {
    throw new Error('intent: sourceSpan.start/end must be a valid [start,end] range');
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('intent: sourceSpan.text (the evidence span) is required');
  }
  return { start, end, text };
}

// Requires at minimum the date + hour:minute portion of an ISO-8601
// datetime (`YYYY-MM-DDTHH:MM`, optionally with seconds/ms/offset). A bare
// date ("2026-07-24") or a plain-language phrase ("tomorrow", "next Friday")
// fails this prefix check even where `Date.parse` might loosely accept it in
// some engines — the extraction/build path (I3) must canonicalize to a real
// instant, never a string that merely looks date-ish.
const ISO_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Non-throwing check: is `value` either `null`, or a string matching the ISO
 * date-time prefix shape AND parseable by `Date.parse` into a real instant?
 * Shared by `targetAt` and `snoozedUntil` (via `validateIsoOrNull`) so the two
 * fields can never drift on what counts as a valid due/snooze instant.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isValidIsoOrNull(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  return ISO_PREFIX_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function validateIsoOrNull(value, label) {
  if (!isValidIsoOrNull(value)) {
    throw new Error(`intent: ${label} must be an ISO-8601 string (YYYY-MM-DDTHH:MM...) or null`);
  }
  return value;
}

function validateOutcome(outcome) {
  if (outcome === null) return null;
  if (!outcome || typeof outcome !== 'object') throw new Error('intent: outcome must be an object or null');
  for (const key of Object.keys(outcome)) {
    if (!OUTCOME_KEYS.includes(key)) throw new Error(`intent: outcome has unknown key "${key}"`);
  }
  const { closedAt, kind, answerEntryId } = outcome;
  if (typeof closedAt !== 'string' || !closedAt.trim()) {
    throw new Error('intent: outcome.closedAt must be an ISO string');
  }
  if (!OUTCOME_KINDS.includes(kind)) {
    throw new Error(`intent: outcome.kind must be one of ${OUTCOME_KINDS.join('/')}`);
  }
  if (answerEntryId !== null && typeof answerEntryId !== 'string') {
    throw new Error('intent: outcome.answerEntryId must be a string or null');
  }
  return { closedAt, kind, answerEntryId: answerEntryId ?? null };
}

function validateUserText(userText) {
  if (userText === null) return null;
  if (typeof userText !== 'string') throw new Error('intent: userText must be a string or null');
  return userText;
}

function validateAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') {
    throw new Error('intent: attributes are required');
  }
  const out = {};
  for (const key of INTENT_ATTRIBUTE_KEYS) {
    if (!isBool(attributes[key])) {
      throw new Error(`intent: attribute "${key}" must be a boolean`);
    }
    out[key] = attributes[key];
  }
  return out;
}

/**
 * Validate + construct a stored intent document. Throws on any malformed input
 * — extraction must never persist a half-formed intent.
 *
 * @returns {object} The intent document (sans autoId; `id` is caller-supplied).
 */
export function buildIntent({
  id,
  ownerId,
  entryId,
  kind,
  state,
  sourceSpan,
  attributes,
  confidence,
  activationReason,
  targetAt = null,
  model,
  authorization,
  inputVersion = 0,
  createdAt,
  updatedAt,
  snoozedUntil = null,
  outcome = null,
  userText = null,
}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('intent: id is required');
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('intent: ownerId is required');
  if (typeof entryId !== 'string' || !entryId.trim()) throw new Error('intent: entryId is required');
  if (!isFiniteNumber(inputVersion) || inputVersion < 0) throw new Error('intent: inputVersion must be a non-negative number');
  if (!INTENT_KINDS.includes(kind)) throw new Error(`intent: unknown kind "${kind}"`);
  if (!INTENT_STATES.includes(state)) throw new Error(`intent: unknown state "${state}"`);
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('intent: confidence must be a number in [0,1]');
  }
  validateIsoOrNull(targetAt, 'targetAt');
  if (typeof model !== 'string' || !model.trim()) throw new Error('intent: model (provenance) is required');

  const span = validateSourceSpan(sourceSpan);
  const attrs = validateAttributes(attributes);
  const snoozed = validateIsoOrNull(snoozedUntil, 'snoozedUntil');
  const validatedOutcome = validateOutcome(outcome);
  const validatedUserText = validateUserText(userText);
  const now = new Date().toISOString();

  // authorization defaults CLOSED: no notification authority is granted at
  // extraction time. A user keeping an open_loop is what later grants it.
  const auth = { notifications: false };
  if (authorization && authorization.notifications === true) auth.notifications = true;

  return {
    id,
    ownerId,
    entryId,
    kind,
    state,
    sourceSpan: span,
    attributes: attrs,
    confidence,
    activationReason: typeof activationReason === 'string' ? activationReason : '',
    targetAt: targetAt ?? null,
    authorization: auth,
    // Entry inputVersion at extraction time — the reap key: a re-extraction at
    // version N retires every intent for this entry with inputVersion < N.
    inputVersion,
    versions: {
      extraction: 1,
      model,
      prompt: PROMPT_VERSION,
      schema: SCHEMA_VERSION,
    },
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    decidedBy: 'policy',
    snoozedUntil: snoozed,
    outcome: validatedOutcome,
    userText: validatedUserText,
  };
}

/**
 * Is `to` reachable from `from` by a client-initiated transition?
 *   - any        -> dismissed        (user says "not a task" / dismisses)
 *   - suggested  -> active           (user keeps a suggestion)
 *   - active     -> completed_state  (user completes an active task)
 *   - from == to                     (authorization-only change, no state move)
 * Every hard-negative that lands in `abstain` is structurally unreachable to
 * `active` from the client: `abstain` is not `suggested`, so no keep path exists.
 */
export function isClientTransitionAllowed(from, to) {
  if (to === 'dismissed') return true;
  if (from === 'suggested' && to === 'active') return true;
  if (from === 'active' && to === 'completed_state') return true;
  return from === to;
}

/**
 * JS mirror of the firestore.rules `intents` update guard. Returns true iff the
 * client is permitted to turn `before` into `after`: only state/updatedAt/
 * authorization may change, and the state move must be client-allowed.
 */
export function validateUserIntentUpdate(before, after) {
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;

  // Every changed key must be in the mutable allowlist.
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]);
    if (changed && !CLIENT_MUTABLE_KEYS.includes(key)) return false;
  }

  return isClientTransitionAllowed(before.state, after.state);
}

/**
 * Validate + construct a user_decisions document (append-only audit of a user's
 * keep/dismiss/complete action). Throws on malformed input.
 */
export function buildUserDecision({ targetId, action, reasonCode = null, createdAt }) {
  if (typeof targetId !== 'string' || !targetId.trim()) throw new Error('decision: targetId is required');
  if (!DECISION_ACTIONS.includes(action)) throw new Error(`decision: unknown action "${action}"`);
  return {
    targetId,
    targetType: 'intent',
    action,
    reasonCode: reasonCode ?? null,
    createdAt: createdAt || new Date().toISOString(),
    reversible: true,
  };
}

export default {
  INTENT_KINDS,
  INTENT_STATES,
  INTENT_ATTRIBUTE_KEYS,
  CLIENT_MUTABLE_KEYS,
  DECISION_ACTIONS,
  buildIntent,
  isClientTransitionAllowed,
  validateUserIntentUpdate,
  buildUserDecision,
  isValidIsoOrNull,
};
