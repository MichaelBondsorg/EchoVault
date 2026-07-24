/**
 * Pure scoring/matching logic for the raw-text intent-extraction eval corpus
 * (INT-01, plan `docs/superpowers/plans/2026-07-24-full-product-review.md`).
 *
 * Consumes case rows shaped `{ caseId, expectedIntents, predicted }` where
 * `predicted` has already been produced by running the REAL extraction
 * pipeline (runCorpusEval.js: extractIntentCandidates -> decideActivation) —
 * this module does no I/O, no model calls, and no Firestore access, so it is
 * fully deterministic and directly unit-testable.
 *
 * Precision-first framing (mirrors ../activationPolicy.js's contract):
 *   - a MISFIRE (an expected-abstain span that surfaced anyway) and a
 *     HALLUCINATION (a surfaced candidate with no expected counterpart at
 *     all) are both false positives — the failure mode this eval exists to
 *     catch, since silence is a correct and expected result.
 *   - a MISS (an expected active/suggested item the model never proposed) or
 *     a DEMOTION (proposed, but the policy decided abstain) are false
 *     negatives — recall is reported but is explicitly the secondary metric.
 *   - a KIND CONFUSION (matched evidence, but predicted.kind !== expected.kind)
 *     counts as both: an FN for the expected kind and an FP for the kind the
 *     candidate actually surfaced as.
 */

const SURFACED_STATES = new Set(['active', 'suggested']);

function normalizeForMatch(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy evidence-text match: true when the two (normalized) strings are
 * equal, one contains the other, or their token sets overlap at least 60%
 * (Jaccard-ish, order-independent). Case- and punctuation-insensitive.
 * Either empty string never matches.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function fuzzyTextMatch(a, b) {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && inter / union >= 0.6;
}

/**
 * Greedily pairs each expected intent (in order) with the best still-unused
 * predicted candidate whose evidence text fuzzy-matches — independent of
 * kind, so a kind mismatch on matched evidence is recorded as a confusion
 * rather than treated as "no match at all".
 *
 * @param {{expectedIntents?: Array, predicted?: Array}} caseResult
 * @returns {{pairs: Array<{expected: object, actual: object}>, unmatchedExpected: Array, unmatchedPredicted: Array}}
 */
export function matchCase({ expectedIntents = [], predicted = [] } = {}) {
  const usedPredicted = new Set();
  const pairs = [];
  const unmatchedExpected = [];

  for (const exp of expectedIntents) {
    let bestIdx = -1;
    for (let i = 0; i < predicted.length; i++) {
      if (usedPredicted.has(i)) continue;
      if (fuzzyTextMatch(predicted[i].text, exp.evidenceContains)) {
        bestIdx = i;
        break;
      }
    }
    if (bestIdx >= 0) {
      usedPredicted.add(bestIdx);
      pairs.push({ expected: exp, actual: predicted[bestIdx] });
    } else {
      unmatchedExpected.push(exp);
    }
  }

  const unmatchedPredicted = predicted.filter((_, i) => !usedPredicted.has(i));
  return { pairs, unmatchedExpected, unmatchedPredicted };
}

/**
 * Score one case's matched/unmatched sets into per-kind confusion events.
 * @param {{caseId?: string, expectedIntents?: Array, predicted?: Array}} caseResult
 * @returns {Array<{kind: string, type: 'tp'|'fp'|'fn', detail: string, caseId?: string}>}
 */
export function scoreCase(caseResult) {
  const { pairs, unmatchedExpected, unmatchedPredicted } = matchCase(caseResult);
  const caseId = caseResult && caseResult.caseId;
  const events = [];

  for (const { expected, actual } of pairs) {
    const expSurfaced = SURFACED_STATES.has(expected.expectedState);
    const actSurfaced = SURFACED_STATES.has(actual.state);
    const kindMatch = expected.kind === actual.kind;

    if (!expSurfaced && actSurfaced) {
      events.push({ kind: actual.kind, type: 'fp', detail: 'misfire', caseId });
      continue;
    }
    if (expSurfaced && !actSurfaced) {
      events.push({ kind: expected.kind, type: 'fn', detail: 'demoted-to-abstain', caseId });
      continue;
    }
    if (expSurfaced && actSurfaced) {
      if (kindMatch) {
        events.push({ kind: expected.kind, type: 'tp', detail: 'match', caseId });
      } else {
        events.push({ kind: expected.kind, type: 'fn', detail: `kind-confused-as-${actual.kind}`, caseId });
        events.push({ kind: actual.kind, type: 'fp', detail: `kind-confused-from-${expected.kind}`, caseId });
      }
      continue;
    }
    // Both abstain on a matched span: correct silence, nothing to score.
  }

  for (const exp of unmatchedExpected) {
    if (SURFACED_STATES.has(exp.expectedState)) {
      events.push({ kind: exp.kind, type: 'fn', detail: 'not-proposed', caseId });
    }
    // An unmatched expected abstain means the model correctly said nothing
    // about that span at all — also correct, no event.
  }

  for (const pred of unmatchedPredicted) {
    if (SURFACED_STATES.has(pred.state)) {
      events.push({ kind: pred.kind, type: 'fp', detail: 'hallucinated', caseId });
    }
    // An unmatched predicted abstain candidate is silent context; irrelevant
    // to precision/recall of the surfaced set.
  }

  return events;
}

/**
 * Aggregate scoring across the whole corpus: per-kind precision/recall, an
 * overall roll-up, and a confusion summary (misfires / hallucinations /
 * kind-confusions / misses) suitable for a console report or a future CI
 * regression gate.
 *
 * @param {Array<{caseId?: string, expectedIntents?: Array, predicted?: Array}>} caseResults
 * @returns {{perKind: object, overall: object, confusion: object, totalCases: number, zeroIntentCases: number}}
 */
export function scoreCorpus(caseResults = []) {
  const perKind = {};
  const confusion = { misfires: [], hallucinations: [], kindConfusions: [], misses: [] };

  const bump = (kind, key) => {
    if (!perKind[kind]) perKind[kind] = { tp: 0, fp: 0, fn: 0 };
    perKind[kind][key] += 1;
  };

  for (const cr of caseResults) {
    const events = scoreCase(cr);
    for (const ev of events) {
      bump(ev.kind, ev.type);
      if (ev.type === 'fp' && ev.detail === 'misfire') confusion.misfires.push({ caseId: ev.caseId, kind: ev.kind });
      if (ev.type === 'fp' && ev.detail === 'hallucinated') confusion.hallucinations.push({ caseId: ev.caseId, kind: ev.kind });
      if (typeof ev.detail === 'string' && ev.detail.startsWith('kind-confused')) {
        confusion.kindConfusions.push({ caseId: ev.caseId, kind: ev.kind, detail: ev.detail });
      }
      if (ev.type === 'fn' && (ev.detail === 'not-proposed' || ev.detail === 'demoted-to-abstain')) {
        confusion.misses.push({ caseId: ev.caseId, kind: ev.kind, detail: ev.detail });
      }
    }
  }

  const perKindScored = {};
  let totalTp = 0;
  let totalFp = 0;
  let totalFn = 0;
  for (const [kind, { tp, fp, fn }] of Object.entries(perKind)) {
    perKindScored[kind] = {
      tp,
      fp,
      fn,
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    };
    totalTp += tp;
    totalFp += fp;
    totalFn += fn;
  }

  return {
    perKind: perKindScored,
    overall: {
      tp: totalTp,
      fp: totalFp,
      fn: totalFn,
      precision: totalTp + totalFp === 0 ? 1 : totalTp / (totalTp + totalFp),
      recall: totalTp + totalFn === 0 ? 1 : totalTp / (totalTp + totalFn),
    },
    confusion,
    totalCases: caseResults.length,
    zeroIntentCases: caseResults.filter((c) => (c.expectedIntents || []).length === 0).length,
  };
}

export default { fuzzyTextMatch, matchCase, scoreCase, scoreCorpus };
