/**
 * InsightClaim schema (R4 Phase 1, DR "canonical claim object", adapted to
 * Engram's receipts/plan-freeze primitives). buildClaim is the single
 * construction path: deterministic code authors evidence; an LLM may (in
 * Phase 2) author `wording` ONLY — and even that is validated here for
 * causal language before a claim can exist.
 */
export const CLAIM_TYPES = Object.freeze(['observation', 'pattern_to_watch', 'experiment_result']);
export const CLAIM_STATUSES = Object.freeze(['candidate', 'verified', 'suppressed', 'expired']);
export const CLAIM_DIRECTIONS = Object.freeze(['positive', 'negative']);

// Keep identical to the firestore.rules insight_claims create hasOnly list.
export const CLAIM_TOP_LEVEL_KEYS = Object.freeze([
  'id', 'version', 'parentClaimId', 'supersededByClaimId', 'claimType',
  'subject', 'outcome', 'direction', 'questionWording', 'wording',
  'limitations', 'analysisPlan', 'evidence', 'receipt', 'status',
  'provenance', 'createdAt', 'updatedAt',
]);

// Non-causal copy is an integrity surface (DR gate 7). Deterministic Phase-1
// wording never uses these; the check also protects Phase-2 LLM wording.
// Sync: byte-identical copy of this regex lives server-side as CAUSAL_RE in
// functions/src/insights/claimVerifier.js (cross-package duplicate, same
// precedent as dismissalKey.js <-> insightDismissal.js — see that pair's
// doc comments). A parity test (Task 9) asserts the two stay identical.
// Exported so other claim-producing modules (e.g.
// `src/services/experiments/experimentClaim.js`) can reuse the SAME regex
// instance rather than maintaining a byte-identical duplicate that could
// drift. The regex text/behavior itself must stay unchanged for the
// server-side parity test above — only the export keyword is new.
export const CAUSAL_RE = /\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i;

// LIMITATIONS-ONLY negation strip (adjudicated option (c)): a limitation
// bullet exists to tell the user what the result does NOT show, so an
// explicitly negated causal clause ("This does not show that X caused Y")
// is the whole point of a limitation, not a violation of the causal-language
// rule. Before running CAUSAL_RE on a limitation string, strip clauses that
// open with a negation word directly followed by a claim-verb ("does not
// show/prove/mean/establish/imply/demonstrate/tell us") and run to the next
// sentence boundary ([^.!?]*) — narrowly anchored so it only ever removes
// the negated clause itself. It intentionally does NOT touch wording/
// questionWording (those stay fully strict — no legitimate reason for a
// headline claim to contain causal language, negated or not) and it is
// clause-bounded so an affirmative causal claim earlier in the same
// sentence (e.g. "Sleep boosts mood but this does not prove it.") survives
// the strip and still trips CAUSAL_RE on the remainder.
const NEGATED_CAUSAL_CLAUSE_RE = /\b(does not|doesn't|do not|don't|cannot|can't|won't|did not|didn't)\s+(show|prove|mean|establish|imply|demonstrate|tell us)\b[^.!?]*/gi;

function stripNegatedCausalClauses(str) {
  return str.replace(NEGATED_CAUSAL_CLAUSE_RE, '');
}

const REQUIRED_PLAN_KEYS = ['frozenAt', 'hypothesisFamilyId', 'candidateId',
  'candidateTestsCount', 'ciLevel', 'outcomeUnit', 'timezone', 'datePolicy',
  'exposureDefinition', 'outcomeDefinition', 'lagDays', 'splitMode',
  'minimumTotalDays', 'minimumSpanDays', 'practicalEffectFloorMoodPoints',
  'adapterVersion', 'observationSchemaVersion', 'evidenceBuilderVersion',
  'estimatorThresholds'];

const EVIDENCE_NUMBER_KEYS = ['hiddenSensitiveSourceCount', 'totalCandidateDayCount',
  'exposedDayCount', 'comparisonDayCount', 'observedSpanDays', 'exposureContrast',
  'effectMoodPoints', 'exposureCoverage', 'outcomeCoverage'];

// Non-numeric evidence fields (the rest of evidence's shape, beyond the
// finite-number fields above). Together these are the ONLY keys evidence
// may carry — buildClaim rejects anything else (closes the nested-map seam:
// an unvetted key like `evidence.note` could otherwise smuggle freeform,
// possibly-causal text past the wording/questionWording causal check).
const EVIDENCE_NON_NUMBER_KEYS = ['sourceEntryIds', 'stabilityInterval',
  'leaveOneDayOutDirectionStable', 'representativeness'];
const EVIDENCE_ALLOWED_KEYS = new Set([...EVIDENCE_NUMBER_KEYS, ...EVIDENCE_NON_NUMBER_KEYS]);

// analysisPlan may carry every REQUIRED_PLAN_KEYS field plus a small set of
// optional keys the plan legitimately produces but does not require:
//   - minExposureContrast (present on real plans, not gated by buildClaim
//     because a zero-contrast plan is still a valid frozen plan).
//   - sourceExperimentId / sourceCompletedAt (final review Important 1,
//     closure wave — the run-identity fix): stamped ONLY by
//     `experimentClaim.js`'s `buildExperimentResultClaim` onto every
//     `experiment_result` claim it builds going forward; ABSENT on every
//     pipeline (`basic:`-family) claim from `evidenceBuilder.js` and on any
//     `experiment_result` claim already written before this fix shipped
//     (a "legacy" claim in the sense used by
//     `experimentsService.js`'s `writeOrSupersedeExperimentResultClaim` doc
//     comment). Optional here (not in REQUIRED_PLAN_KEYS) precisely because
//     both call sites are real and permanent, not a migration in progress.
// Do not add keys here beyond what the module already documents/requires.
const OPTIONAL_PLAN_KEYS = ['minExposureContrast', 'sourceExperimentId', 'sourceCompletedAt'];
const ANALYSIS_PLAN_ALLOWED_KEYS = new Set([...REQUIRED_PLAN_KEYS, ...OPTIONAL_PLAN_KEYS]);

function req(cond, msg) { if (!cond) throw new Error(`claim: ${msg}`); }
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isFin = (v) => typeof v === 'number' && Number.isFinite(v);

/** FNV-1a 32-bit string hash, rendered as 8 lowercase hex chars. Pure,
 * deterministic, no dependencies (mirrors the precedent in
 * src/services/experiments/estimator.js, kept self-contained here). */
function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deep-freeze an object/array tree in place. No-ops on non-objects and
 * already-frozen nodes (avoids infinite loops on shared references). */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function claimDocId({ familyId, candidateId, version }) {
  const slug = `${familyId}_${candidateId}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // Slug alone collides ('tag:gym-time' and 'tag:gym_time' both fold to
  // '...-gym-time-...'). Append a content hash of the UNfolded identity so
  // distinct candidateIds always produce distinct doc ids.
  const hash = fnv1aHex(`${familyId}|${candidateId}`);
  return `claim_${slug}_${hash}_v${version}`;
}

export function buildClaim(input) {
  req(input && typeof input === 'object', 'input required');
  const {
    version, parentClaimId = null, claimType, subject, outcome, direction,
    questionWording, wording, limitations, analysisPlan, evidence, receipt,
    status, provenance, createdAt, updatedAt,
  } = input;

  req(Number.isInteger(version) && version >= 1, 'version must be an integer >= 1');
  req(parentClaimId === null || isStr(parentClaimId), 'parentClaimId must be string|null');
  req(version === 1 ? parentClaimId === null : isStr(parentClaimId),
    'version 1 has no parent; version > 1 requires parentClaimId');
  req(CLAIM_TYPES.includes(claimType), `unknown claimType "${claimType}"`);
  req(CLAIM_STATUSES.includes(status), `unknown status "${status}"`);
  req(CLAIM_DIRECTIONS.includes(direction), `unknown direction "${direction}"`);
  req(isStr(subject) && isStr(outcome), 'subject/outcome required');
  req(isStr(questionWording) && isStr(wording), 'questionWording/wording required');
  req(!CAUSAL_RE.test(wording) && !CAUSAL_RE.test(questionWording),
    'causal language rejected in claim wording');
  req(Array.isArray(limitations) && limitations.every(isStr), 'limitations must be string[]');
  // Negation-aware: strip explicitly-negated causal clauses (the point of a
  // limitation) before checking the remainder for affirmative causal
  // language — see NEGATED_CAUSAL_CLAUSE_RE's doc comment above.
  req(limitations.every((l) => !CAUSAL_RE.test(stripNegatedCausalClauses(l))), 'causal language rejected in claim limitations');

  req(analysisPlan && typeof analysisPlan === 'object', 'analysisPlan required');
  for (const k of REQUIRED_PLAN_KEYS) req(analysisPlan[k] !== undefined && analysisPlan[k] !== null, `analysisPlan.${k} required (frozen before analysis)`);
  req(isFin(analysisPlan.ciLevel) && analysisPlan.ciLevel > 0 && analysisPlan.ciLevel < 1, 'analysisPlan.ciLevel in (0,1)');
  // sourceExperimentId / sourceCompletedAt (run-identity fix, closure wave):
  // OPTIONAL — absent on a pipeline claim and on any pre-fix legacy
  // experiment_result claim — but a non-empty string WHEN present, same
  // "when present" posture as minExposureContrast's finite-number check
  // just below/elsewhere in this module never applying to an absent key.
  if (analysisPlan.sourceExperimentId !== undefined) req(isStr(analysisPlan.sourceExperimentId), 'analysisPlan.sourceExperimentId must be a non-empty string when present');
  if (analysisPlan.sourceCompletedAt !== undefined) req(isStr(analysisPlan.sourceCompletedAt), 'analysisPlan.sourceCompletedAt must be a non-empty string when present');
  for (const k of Object.keys(analysisPlan)) req(ANALYSIS_PLAN_ALLOWED_KEYS.has(k), `analysisPlan.${k} is not a recognized key`);

  req(evidence && typeof evidence === 'object', 'evidence required');
  req(Array.isArray(evidence.sourceEntryIds) && evidence.sourceEntryIds.every(isStr), 'evidence.sourceEntryIds must be string[]');
  for (const k of EVIDENCE_NUMBER_KEYS) req(isFin(evidence[k]), `evidence.${k} must be a finite number (deterministic code authors evidence)`);
  req(Array.isArray(evidence.stabilityInterval) && evidence.stabilityInterval.length === 2
    && evidence.stabilityInterval.every(isFin), 'evidence.stabilityInterval must be [lo, hi]');
  req(typeof evidence.leaveOneDayOutDirectionStable === 'boolean', 'evidence.leaveOneDayOutDirectionStable must be boolean');
  req(evidence.representativeness === 'unknown' || evidence.representativeness === 'limited', 'evidence.representativeness');
  for (const k of Object.keys(evidence)) req(EVIDENCE_ALLOWED_KEYS.has(k), `evidence.${k} is not a recognized key`);

  req(receipt && typeof receipt === 'object' && Array.isArray(receipt.sources), 'receipt required (buildReceipt shape)');
  req(provenance && isFin(provenance.generatorVersion) && isFin(provenance.evidenceBuilderVersion)
    && isStr(provenance.wordingSource), 'provenance required');
  req(isStr(createdAt) && isStr(updatedAt), 'createdAt/updatedAt required');

  const claim = {
    id: claimDocId({ familyId: analysisPlan.hypothesisFamilyId, candidateId: analysisPlan.candidateId, version }),
    version,
    parentClaimId,
    supersededByClaimId: null,
    claimType, subject, outcome, direction, questionWording, wording,
    limitations: [...limitations],
    analysisPlan: { ...analysisPlan },
    evidence: { ...evidence, sourceEntryIds: [...evidence.sourceEntryIds] },
    receipt, status,
    provenance: { ...provenance },
    createdAt, updatedAt,
  };
  // Claims are immutable facts once built. Deep-freeze everything except
  // `receipt`: it is stored by reference (not cloned) and Firestore's SDK
  // may need to walk/serialize it in ways a frozen tree could interfere
  // with, so it is left mutable at the object-contents level (the top-level
  // freeze below still prevents `claim.receipt` from being reassigned).
  deepFreeze(claim.limitations);
  deepFreeze(claim.analysisPlan);
  deepFreeze(claim.evidence);
  deepFreeze(claim.provenance);
  return Object.freeze(claim);
}
