/**
 * Claims pipeline (R4 Phase 1). Order is the contract:
 * enumerate -> register in ledger (count-before-analyze) -> freeze plan ->
 * analyze -> write/supersede. Ineligible candidates leave only a ledger mark.
 */
import { buildDailyObservations, enumerateExposures } from '../observations';
import { familyIdForBasic, registerCandidates } from '../testingLedger';
import { resolveDeviceTimezone } from '../../experiments/computeResult';
import { freezeCandidatePlan, buildEvidenceForCandidate } from './evidenceBuilder';
import { writeClaim, supersedeClaim, listAllClaims, evidenceEquivalent } from './claimsService';
import { buildClaim } from './claimSchema';

const ENGINE_BY_KIND = { tag: 'activity', entity: 'people', category: 'category', health: 'health' };
export const engineKeyFor = (spec) => ENGINE_BY_KIND[spec.kind] || spec.kind;

export async function generateClaims(db, uid, entries, { timeZone, now } = {}) {
  const at = now || new Date().toISOString();
  const tz = timeZone || resolveDeviceTimezone();
  const observations = buildDailyObservations(entries, { timeZone: tz });
  const entriesById = new Map((entries || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const specs = enumerateExposures(observations);

  // 1) Register EVERY candidate before any analysis.
  const familyCounts = new Map();
  for (const spec of specs) {
    const familyId = familyIdForBasic(engineKeyFor(spec), spec.key);
    const { testedCount } = await registerCandidates(db, uid, familyId, [spec.key], { now: at });
    familyCounts.set(spec.key, { familyId, testedCount });
  }

  // 2) Analyze under frozen plans; write/supersede eligible claims.
  const existing = await listAllClaims(db, uid);
  const liveByCandidate = new Map(existing
    .filter((c) => c.supersededByClaimId == null)
    .map((c) => [`${c.analysisPlan.hypothesisFamilyId}|${c.analysisPlan.candidateId}`, c]));

  let written = 0; let superseded = 0; let eligible = 0;
  for (const spec of specs) {
    const { familyId, testedCount } = familyCounts.get(spec.key);
    const plan = freezeCandidatePlan({
      familyId, candidateId: spec.key, exposureSpec: spec,
      candidateTestsCount: testedCount, timeZone: tz, now: at,
    });
    const result = buildEvidenceForCandidate({ observations, entriesById, exposureSpec: spec, plan });
    if (!result.eligible) continue;
    eligible += 1;
    const prior = liveByCandidate.get(`${familyId}|${spec.key}`);
    if (!prior) {
      await writeClaim(db, uid, { ...result.claimInput, version: 1, parentClaimId: null });
      written += 1;
    } else {
      const candidate = buildClaim({ ...result.claimInput, version: prior.version + 1, parentClaimId: prior.id });
      if (evidenceEquivalent(prior, candidate)) continue; // no churn
      await supersedeClaim(db, uid, prior, candidate);
      written += 1; superseded += 1;
    }
  }
  return { written, superseded, candidatesTested: specs.length, eligible };
}

export default { engineKeyFor, generateClaims };
