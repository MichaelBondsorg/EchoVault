/**
 * Activation-policy eval harness (PRD 0B, plan task I3).
 *
 * Runs every labeled fixture through the pure activation policy and reports
 * precision/recall for the `active` state plus a per-category breakdown. The
 * defining assertion (see eval.test.js): ZERO hard-negative fixtures may land
 * `active`, and active precision must be exactly 1.0 on the fixture set.
 *
 * Fixtures carry the honest structural labeling; `normalizeFixtureCandidate`
 * fills any omitted attribute as `false` (mirroring the extraction normalizer)
 * so a fixture can list only its TRUE attributes.
 */
import { INTENT_ATTRIBUTE_KEYS } from '../intentSchema.js';
import { decideActivation } from '../activationPolicy.js';

export function normalizeFixtureCandidate(candidate = {}) {
  const attributes = {};
  const src = candidate.attributes || {};
  for (const k of INTENT_ATTRIBUTE_KEYS) attributes[k] = src[k] === true;
  return {
    kind: candidate.kind,
    attributes,
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
    targetAt: typeof candidate.targetAt === 'string' ? candidate.targetAt : null,
    explicitCommand: candidate.explicitCommand === true,
  };
}

/**
 * @param {Array} fixtures  fixture objects ({ id, category, expectedState, hardNegative, candidate })
 * @param {object} [opts]
 * @param {Function} [opts.decide]     activation decider (defaults to decideActivation)
 * @param {Function} [opts.normalize]  candidate normalizer
 * @param {number}   [opts.now]        injectable clock for deterministic temporal checks
 * @returns {{activePrecision:number, activeRecall:number, perCategory:object, activeMisfires:string[], counts:object, results:Array}}
 */
export function evaluate(fixtures, { decide = decideActivation, normalize = normalizeFixtureCandidate, now } = {}) {
  let truePos = 0;
  let falsePos = 0;
  let falseNeg = 0;
  const perCategory = {};
  const activeMisfires = [];
  const results = [];

  for (const fx of fixtures) {
    const candidate = normalize(fx.candidate);
    const { state, reason } = decide(candidate, now);
    const expected = fx.expectedState;

    const cat = perCategory[fx.category] || (perCategory[fx.category] = { total: 0, active: 0, suggested: 0, abstain: 0, correct: 0 });
    cat.total += 1;
    cat[state] += 1;
    if (state === expected) cat.correct += 1;

    if (state === 'active' && expected === 'active') truePos += 1;
    if (state === 'active' && expected !== 'active') falsePos += 1;
    if (state !== 'active' && expected === 'active') falseNeg += 1;

    // The trust contract: a hard-negative that goes active is a product failure.
    if (state === 'active' && fx.hardNegative === true) activeMisfires.push(fx.id);

    results.push({ id: fx.id, category: fx.category, expected, actual: state, reason, hardNegative: fx.hardNegative === true });
  }

  const activePrecision = truePos + falsePos === 0 ? 1 : truePos / (truePos + falsePos);
  const activeRecall = truePos + falseNeg === 0 ? 1 : truePos / (truePos + falseNeg);

  return {
    activePrecision,
    activeRecall,
    perCategory,
    activeMisfires,
    counts: { truePos, falsePos, falseNeg, total: fixtures.length },
    results,
  };
}

export default { evaluate, normalizeFixtureCandidate };
