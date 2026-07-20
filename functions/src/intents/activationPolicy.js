/**
 * Activation policy engine (PRD 0B, plan task I2) — the heart of the
 * precision-first intent system.
 *
 * `decideActivation` is a PURE function: given a candidate's structural
 * attributes it decides whether the intent may become `active`, be softly
 * `suggested`, or stay silent (`abstain`). The defining property, verified
 * exhaustively by the tests and the eval harness:
 *
 *     MODEL CONFIDENCE ALONE NEVER ACTIVATES.
 *
 * Confidence can only ever DEMOTE (gate the `suggested` path) — it can never
 * promote a candidate to `active`. Activation is purely structural: a candidate
 * with confidence 0.99 but `agency:false` is `abstain`, full stop. Silence is a
 * correct result.
 *
 * Only `task` and `open_loop` candidates can ever surface. Every other kind
 * (event, goal_habit, reflection, external_action, conditional, completed) is
 * context-only and ALWAYS abstains.
 */

// Any one of these being true is a hard veto: the candidate abstains regardless
// of everything else (including confidence). These encode the PRD's precision
// contract — negation, quotation, someone else's ownership, a stated condition,
// ongoing-goal language, or an already-completed action must never activate.
export const HARD_BLOCKERS = Object.freeze([
  'negated',
  'quoted',
  'conditional',
  'goalLanguage',
  'otherOwned',
  'completed',
]);

// Kinds eligible to surface at all.
const SURFACEABLE_KINDS = Object.freeze(['task', 'open_loop']);

// Minimum model confidence to even SUGGEST (never to activate). A soft
// commitment below this floor stays silent.
export const SUGGEST_CONFIDENCE_FLOOR = 0.6;

// Grace window so a target earlier today is not treated as "in the past".
const TEMPORAL_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * A targetAt is "past" only when it parses to a real instant strictly earlier
 * than now (minus a day of grace). null/absent => no temporal constraint (not
 * past). An unparseable string does not veto here — the temporalFit attribute
 * governs that case.
 */
function isPastTarget(targetAt, now) {
  if (targetAt == null) return false;
  const t = Date.parse(targetAt);
  if (Number.isNaN(t)) return false;
  return t < now - TEMPORAL_GRACE_MS;
}

/**
 * Decide the activation state for one extraction candidate.
 *
 * @param {object} candidate
 * @param {string} candidate.kind
 * @param {object} candidate.attributes  the ten booleans
 * @param {number} candidate.confidence  0..1 (only ever demotes)
 * @param {string|null} candidate.targetAt  ISO or null
 * @param {boolean} [candidate.explicitCommand]  task-list syntax / "ask me Friday…"
 * @param {number} [now]  injectable clock for deterministic temporal checks
 * @returns {{state:'active'|'suggested'|'abstain', reason:string}}
 */
export function decideActivation(candidate, now = Date.now()) {
  const kind = candidate?.kind;
  const a = (candidate && candidate.attributes) || {};
  const confidence = typeof candidate?.confidence === 'number' ? candidate.confidence : 0;

  // 1. Only task | open_loop can ever surface; everything else is context-only.
  if (!SURFACEABLE_KINDS.includes(kind)) {
    return { state: 'abstain', reason: `kind:${kind ?? 'unknown'}-context-only` };
  }

  // 2. Hard vetoes. Confidence is irrelevant here — this is the precision gate.
  const blocker = HARD_BLOCKERS.find((k) => a[k] === true);
  if (blocker) {
    return { state: 'abstain', reason: `blocked:${blocker}` };
  }

  // 3. Non-negotiable base: self-ownership + unfinished. Without agency NOTHING
  //    activates, not even at confidence 1.0.
  if (a.agency !== true) return { state: 'abstain', reason: 'no-agency' };
  if (a.unfinished !== true) return { state: 'abstain', reason: 'not-unfinished' };

  const temporalNotPast = !isPastTarget(candidate.targetAt, now);

  // 4. Explicit-command formats (task-list syntax, "ask me Friday how it went")
  //    qualify directly once self-owned + unfinished + no blocker — no
  //    concreteness gate — provided the target isn't already in the past.
  if (candidate.explicitCommand === true && temporalNotPast) {
    return { state: 'active', reason: 'explicit-command' };
  }

  // 5. Soft criteria. ACTIVE requires BOTH: concrete AND a plausible-future fit.
  const concreteOk = a.concrete === true;
  const temporalOk = a.temporalFit === true && temporalNotPast;

  if (concreteOk && temporalOk) {
    return { state: 'active', reason: 'all-criteria-met' };
  }

  // 6. SUGGESTED: a plausible commitment failing EXACTLY ONE soft criterion,
  //    with confidence >= the floor. (Confidence only ever demotes.)
  const softFailures = (concreteOk ? 0 : 1) + (temporalOk ? 0 : 1);
  if (softFailures === 1 && confidence >= SUGGEST_CONFIDENCE_FLOOR) {
    return {
      state: 'suggested',
      reason: concreteOk ? 'soft:temporal-uncertain' : 'soft:not-concrete',
    };
  }

  // 7. Everything else stays silent.
  return { state: 'abstain', reason: 'insufficient-evidence' };
}

export default { decideActivation, HARD_BLOCKERS, SUGGEST_CONFIDENCE_FLOOR };
