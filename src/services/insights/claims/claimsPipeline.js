/**
 * Claims pipeline (R4 Phase 1). Order is the contract:
 * enumerate -> register in ledger (count-before-analyze) -> freeze plan ->
 * analyze -> write/supersede. Ineligible candidates leave only a ledger mark.
 */
import { buildDailyObservations, enumerateExposures } from '../observations';
import { familyIdForBasic, registerCandidates } from '../testingLedger';
import { resolveDeviceTimezone } from '../../experiments/computeResult';
import { freezeCandidatePlan, buildEvidenceForCandidate } from './evidenceBuilder';
import {
  writeClaim, supersedeClaim, listAllClaims, evidenceEquivalent, setClaimStatus,
} from './claimsService';
import { buildClaim } from './claimSchema';

const ENGINE_BY_KIND = { tag: 'activity', entity: 'people', category: 'category', health: 'health' };
export const engineKeyFor = (spec) => ENGINE_BY_KIND[spec.kind] || spec.kind;

export async function generateClaims(db, uid, entries, { timeZone, now } = {}) {
  const at = now || new Date().toISOString();
  const tz = timeZone || resolveDeviceTimezone();
  const observations = buildDailyObservations(entries, { timeZone: tz });
  const entriesById = new Map((entries || []).filter((e) => e && e.id).map((e) => [e.id, e]));
  const specs = enumerateExposures(observations);

  // 1) Register EVERY candidate before any analysis, grouped by engine-level
  // family (one registerCandidates call per family, covering all specs
  // enumerated for that engine this run). The post-merge testedCount is the
  // family's total distinct candidates and applies to every candidate in it.
  const specsByFamily = new Map();
  for (const spec of specs) {
    const familyId = familyIdForBasic(engineKeyFor(spec));
    if (!specsByFamily.has(familyId)) specsByFamily.set(familyId, []);
    specsByFamily.get(familyId).push(spec);
  }
  const familyCounts = new Map();
  for (const [familyId, familySpecs] of specsByFamily) {
    const keys = familySpecs.map((s) => s.key);
    const { testedCount } = await registerCandidates(db, uid, familyId, keys, { now: at });
    for (const spec of familySpecs) familyCounts.set(spec.key, { familyId, testedCount });
  }

  // 2) Analyze under frozen plans; write/supersede eligible claims.
  const existing = await listAllClaims(db, uid);
  const liveByCandidate = new Map(existing
    .filter((c) => c.supersededByClaimId == null)
    .map((c) => [`${c.analysisPlan.hypothesisFamilyId}|${c.analysisPlan.candidateId}`, c]));

  let written = 0; let superseded = 0; let eligible = 0; let expired = 0;
  for (const spec of specs) {
    const { familyId, testedCount } = familyCounts.get(spec.key);
    const plan = freezeCandidatePlan({
      familyId, candidateId: spec.key, exposureSpec: spec,
      candidateTestsCount: testedCount, timeZone: tz, now: at,
    });
    const result = buildEvidenceForCandidate({ observations, entriesById, exposureSpec: spec, plan });
    const prior = liveByCandidate.get(`${familyId}|${spec.key}`);
    if (!result.eligible) {
      // Retraction: a live VERIFIED claim whose candidate no longer clears
      // the gates (family m grew -> wider ciLevel now includes zero, or new
      // data weakened the effect below the floor) must not keep standing as
      // evidence-backed. Never touch a SUPPRESSED prior — user suppression
      // sticks regardless of what the gates say next run.
      if (prior && prior.status === 'verified') {
        await setClaimStatus(db, uid, prior.id, 'expired', { now: at });
        expired += 1;
      }
      continue;
    }
    eligible += 1;
    if (!prior) {
      await writeClaim(db, uid, { ...result.claimInput, version: 1, parentClaimId: null });
      written += 1;
    } else {
      const candidate = buildClaim({ ...result.claimInput, version: prior.version + 1, parentClaimId: prior.id });
      // Trade-off (accepted): a still-eligible candidate whose evidence is
      // merely equivalent to its prior keeps that prior's frozen (possibly
      // stale) candidateTestsCount/ciLevel metadata rather than refreshing
      // it every run — only the ineligible transition above retracts.
      if (evidenceEquivalent(prior, candidate)) continue; // no churn
      await supersedeClaim(db, uid, prior, candidate);
      written += 1; superseded += 1;
    }
  }
  return {
    written, superseded, candidatesTested: specs.length, eligible, expired,
  };
}

export default { engineKeyFor, generateClaims };
