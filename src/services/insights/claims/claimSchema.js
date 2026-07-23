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
const CAUSAL_RE = /\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i;

const REQUIRED_PLAN_KEYS = ['frozenAt', 'hypothesisFamilyId', 'candidateId',
  'candidateTestsCount', 'ciLevel', 'outcomeUnit', 'timezone', 'datePolicy',
  'exposureDefinition', 'outcomeDefinition', 'lagDays', 'splitMode',
  'minimumTotalDays', 'minimumSpanDays', 'practicalEffectFloorMoodPoints',
  'adapterVersion', 'observationSchemaVersion', 'evidenceBuilderVersion',
  'estimatorThresholds'];

const EVIDENCE_NUMBER_KEYS = ['hiddenSensitiveSourceCount', 'totalCandidateDayCount',
  'exposedDayCount', 'comparisonDayCount', 'observedSpanDays', 'exposureContrast',
  'effectMoodPoints', 'exposureCoverage', 'outcomeCoverage'];

function req(cond, msg) { if (!cond) throw new Error(`claim: ${msg}`); }
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isFin = (v) => typeof v === 'number' && Number.isFinite(v);

export function claimDocId({ familyId, candidateId, version }) {
  const slug = `${familyId}_${candidateId}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `claim_${slug}_v${version}`;
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

  req(analysisPlan && typeof analysisPlan === 'object', 'analysisPlan required');
  for (const k of REQUIRED_PLAN_KEYS) req(analysisPlan[k] !== undefined && analysisPlan[k] !== null, `analysisPlan.${k} required (frozen before analysis)`);
  req(isFin(analysisPlan.ciLevel) && analysisPlan.ciLevel > 0 && analysisPlan.ciLevel < 1, 'analysisPlan.ciLevel in (0,1)');

  req(evidence && typeof evidence === 'object', 'evidence required');
  req(Array.isArray(evidence.sourceEntryIds) && evidence.sourceEntryIds.every(isStr), 'evidence.sourceEntryIds must be string[]');
  for (const k of EVIDENCE_NUMBER_KEYS) req(isFin(evidence[k]), `evidence.${k} must be a finite number (deterministic code authors evidence)`);
  req(Array.isArray(evidence.stabilityInterval) && evidence.stabilityInterval.length === 2
    && evidence.stabilityInterval.every(isFin), 'evidence.stabilityInterval must be [lo, hi]');
  req(typeof evidence.leaveOneDayOutDirectionStable === 'boolean', 'evidence.leaveOneDayOutDirectionStable must be boolean');
  req(evidence.representativeness === 'unknown' || evidence.representativeness === 'limited', 'evidence.representativeness');

  req(receipt && typeof receipt === 'object' && Array.isArray(receipt.sources), 'receipt required (buildReceipt shape)');
  req(provenance && isFin(provenance.generatorVersion) && isFin(provenance.evidenceBuilderVersion)
    && isStr(provenance.wordingSource), 'provenance required');
  req(isStr(createdAt) && isStr(updatedAt), 'createdAt/updatedAt required');

  return {
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
}
