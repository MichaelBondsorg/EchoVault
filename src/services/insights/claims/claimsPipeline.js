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
import { listSourceExclusions } from '../sourceExclusions';

const ENGINE_BY_KIND = { tag: 'activity', entity: 'people', category: 'category', health: 'health' };
export const engineKeyFor = (spec) => ENGINE_BY_KIND[spec.kind] || spec.kind;

/**
 * Entry ids to drop from a claims run (adjacent gap fix, R4 Phase 1 Task 9
 * review: "claims pipeline ignores source_exclusions"). `getExcludedEntryIds`
 * (sourceExclusions.js) only ever returns `appliesTo === 'all'` exclusions —
 * it deliberately does NOT surface family-scoped ones. But a claim's
 * 'wrong_source' correction (`claimFeedback.js`) writes exactly a
 * family-scoped exclusion: `appliesTo: claim.analysisPlan.hypothesisFamilyId`,
 * which for every candidate this pipeline enumerates is `basic:<engine>:mood`
 * (see `familyIdForBasic`). Using `getExcludedEntryIds` alone would make
 * every 'wrong_source' correction a permanent no-op for claims generation —
 * exactly the routing promise `claimFeedback.js`'s header comment describes
 * as the point of that option.
 *
 * A precise per-family filter (excluding an entry only from the ONE family
 * it was flagged wrong-source for) would require building day-rollups
 * separately per family, which conflicts with `buildDailyObservations` being
 * built once for the whole run below. Deliberate, documented, conservative
 * choice instead: exclude an entry from the WHOLE run (every family, not
 * just the one it was flagged for) whenever ANY exclusion names it — either
 * unscoped (`appliesTo: 'all'`) or family-scoped (`appliesTo` starting with
 * `'basic:'`, this pipeline's only family-id shape). Over-exclusion errs
 * toward the user's correction, never against it.
 *
 * @param {object} db
 * @param {string} uid
 * @returns {Promise<Set<string>>}
 */
async function excludedEntryIdsForClaims(db, uid) {
  const exclusions = await listSourceExclusions(db, uid);
  const ids = new Set();
  for (const exclusion of exclusions) {
    const appliesTo = exclusion?.appliesTo;
    if (exclusion?.entryId && (appliesTo === 'all' || String(appliesTo).startsWith('basic:'))) {
      ids.add(exclusion.entryId);
    }
  }
  return ids;
}

export async function generateClaims(db, uid, entries, { timeZone, now } = {}) {
  const at = now || new Date().toISOString();
  const tz = timeZone || resolveDeviceTimezone();

  // Source Exclusions (adjacent gap fix): read and filter BEFORE anything
  // derives from `entries`. FAIL-CLOSED, deliberately NOT wrapped in a
  // try/catch that degrades to an empty set — mirrors the precedent set by
  // Nexus's own exclusions read (`src/services/nexus/orchestrator.js`): a
  // failed exclusions read must never silently run generation as if no
  // exclusions existed, since that could resurface evidence the user
  // explicitly flagged wrong-source. A failure here propagates to
  // `generateClaims`'s caller; the digest/report orchestration hook that
  // invokes this already wraps its own call in a try/catch, so a read
  // failure correctly skips this run rather than crashing the app.
  const excludedIds = await excludedEntryIdsForClaims(db, uid);
  const filteredEntries = (entries || []).filter((e) => {
    const id = e?.id || e?.entryId;
    return !id || !excludedIds.has(id);
  });

  const observations = buildDailyObservations(filteredEntries, { timeZone: tz });
  const entriesById = new Map(filteredEntries.filter((e) => e && e.id).map((e) => [e.id, e]));
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
