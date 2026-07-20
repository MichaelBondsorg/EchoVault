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
// is captured-but-silent; `dismissed` / `completed_state` are user-terminal.
export const INTENT_STATES = Object.freeze([
  'active',
  'suggested',
  'abstain',
  'dismissed',
  'completed_state',
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
export const CLIENT_MUTABLE_KEYS = Object.freeze(['state', 'updatedAt', 'authorization']);

export const DECISION_ACTIONS = Object.freeze(['kept', 'dismissed', 'not_a_task', 'completed']);

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
  createdAt,
  updatedAt,
}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('intent: id is required');
  if (typeof ownerId !== 'string' || !ownerId.trim()) throw new Error('intent: ownerId is required');
  if (typeof entryId !== 'string' || !entryId.trim()) throw new Error('intent: entryId is required');
  if (!INTENT_KINDS.includes(kind)) throw new Error(`intent: unknown kind "${kind}"`);
  if (!INTENT_STATES.includes(state)) throw new Error(`intent: unknown state "${state}"`);
  if (!isFiniteNumber(confidence) || confidence < 0 || confidence > 1) {
    throw new Error('intent: confidence must be a number in [0,1]');
  }
  if (targetAt !== null && (typeof targetAt !== 'string' || !targetAt.trim())) {
    throw new Error('intent: targetAt must be an ISO string or null');
  }
  if (typeof model !== 'string' || !model.trim()) throw new Error('intent: model (provenance) is required');

  const span = validateSourceSpan(sourceSpan);
  const attrs = validateAttributes(attributes);
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
    versions: {
      extraction: 1,
      model,
      prompt: PROMPT_VERSION,
      schema: SCHEMA_VERSION,
    },
    createdAt: createdAt || now,
    updatedAt: updatedAt || now,
    decidedBy: 'policy',
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
};
