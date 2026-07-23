/**
 * Claims pipeline (R4 Phase 1). Order is the contract:
 * enumerate -> register in ledger (count-before-analyze) -> freeze plan ->
 * analyze -> write/supersede. Ineligible candidates leave only a ledger mark.
 */
import { buildDailyObservations, enumerateExposures } from '../observations';
import { familyIdForBasic, registerCandidates } from '../testingLedger';
import { resolveDeviceTimezone } from '../../experiments/computeResult';
import { freezeCandidatePlan, buildEvidenceForCandidate, buildWriterBundle } from './evidenceBuilder';
import {
  writeClaim, supersedeClaim, listAllClaims, evidenceEquivalent, setClaimStatus,
} from './claimsService';
import { buildClaim } from './claimSchema';
import { listSourceExclusions } from '../sourceExclusions';
import { writeClaimWordingFn } from '../../../config/firebase';

const ENGINE_BY_KIND = { tag: 'activity', entity: 'people', category: 'category', health: 'health' };
export const engineKeyFor = (spec) => ENGINE_BY_KIND[spec.kind] || spec.kind;

// ============================================================
// LLM WRITER GATE (R4 Phase 2 Task 5 / plan decision P2-D1..D3)
// ============================================================
// The server `writeClaimWording` callable (writer -> verifier, both
// server-side) can author a claim's `wording` in place of the Phase-1
// deterministic template, but ONLY when this constant is true. Production
// always uses this constant (false); Phase 2 ships the writer path DARK
// even with `insightClaims` ON, mirroring the same dark-internal-seam
// pattern `RISKY_CLAIMS_ENABLED` used in `src/services/nexus/orchestrator.js`
// before it retired R4-P3 (docs/superpowers/plans/2026-07-23-r4-phase3-
// action-loop.md, P3-D1) — a single internal seam, no user
// flag yet, flipped only after Michael eyeballs verifier behavior on real
// data (see PROJECT_STATUS.md). The `llmWriterEnabled` override on
// `generateClaims`'s `options` exists ONLY so tests can exercise the writer
// path end-to-end without touching this production default.
//
// The fallback guarantee is absolute and layered: (1) the server verifier
// must PASS before returning a wording at all; (2) ANY callable error,
// timeout, or fail verdict falls back to the deterministic template right
// here; (3) even a `verdict:'pass'` wording is re-validated locally by
// `buildClaim`'s own CAUSAL_RE + shape checks (belt-and-braces — see
// claimSchema.js's docblock) before it can reach a claim doc, and a local
// rejection ALSO falls back to the deterministic template. A claim can
// never fail to exist, and unverified/invalid prose can never reach a doc,
// because the LLM writer misbehaved.
export const LLM_WRITER_ENABLED = false;

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

/**
 * One console.warn per RUN (not per claim) when the LLM writer path is
 * unavailable — a busy run with many eligible candidates and a down
 * callable must not spam the console once per candidate. `warnState` is a
 * single `{ warned: boolean }` object shared across the whole
 * `generateClaims` call.
 */
function warnLlmWriterFallbackOnce(warnState, err) {
  if (warnState.warned) return;
  warnState.warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[claimsPipeline] LLM writer path unavailable this run; falling back to deterministic wording.',
    err,
  );
}

/**
 * Write (or supersede) ONE claim, attempting the LLM writer path first when
 * enabled, with an absolute fallback to the deterministic `claimInput`
 * unchanged. `write(input)` performs the actual Firestore write for a given
 * claimInput (new-claim vs supersede — the two call sites below differ only
 * in what `write` does).
 *
 * Fallback triggers, all -> deterministic `claimInput`, unmodified:
 *   - `llmWriterEnabled` is false (LLM path never attempted).
 *   - `writeClaimWordingFn` rejects/throws/times out.
 *   - the callable resolves but `verdict !== 'pass'`, or `wording` is not a
 *     non-empty string.
 *   - `verdict:'pass'` wording is returned, but writing it throws (belt-
 *     and-braces: `buildClaim`'s own CAUSAL_RE + shape validation, run
 *     again client-side inside `write()`, rejects it) — proves the local
 *     re-validation is load-bearing, not just the server verifier.
 *
 * @returns {Promise<{ usedLlm: boolean }>}
 */
async function writeWithOptionalLlmWording({
  claimInput, write, llmWriterEnabled, warnState,
}) {
  if (!llmWriterEnabled) {
    await write(claimInput);
    return { usedLlm: false };
  }

  let llmInput = null;
  try {
    const bundle = buildWriterBundle(claimInput);
    const response = await writeClaimWordingFn({ bundle });
    const data = response?.data || {};
    if (data.verdict === 'pass' && typeof data.wording === 'string' && data.wording.trim() !== '') {
      llmInput = {
        ...claimInput,
        wording: data.wording,
        provenance: {
          ...claimInput.provenance,
          wordingSource: 'llm_writer_v1',
          writerModel: data.writerModel,
          verifierModel: data.verifierModel,
        },
      };
    } else {
      warnLlmWriterFallbackOnce(warnState, new Error(`writeClaimWording verdict "${data.verdict}"`));
    }
  } catch (err) {
    warnLlmWriterFallbackOnce(warnState, err);
  }

  if (llmInput) {
    try {
      await write(llmInput);
      return { usedLlm: true };
    } catch (err) {
      // Local re-validation is load-bearing: buildClaim (CAUSAL_RE + shape)
      // rejected wording the server verifier passed. Fall back silently to
      // the deterministic template rather than surface a build error for an
      // otherwise-eligible, well-evidenced claim.
      warnLlmWriterFallbackOnce(warnState, err);
    }
  }

  await write(claimInput);
  return { usedLlm: false };
}

export async function generateClaims(db, uid, entries, { timeZone, now, llmWriterEnabled } = {}) {
  const at = now || new Date().toISOString();
  const tz = timeZone || resolveDeviceTimezone();
  const useLlmWriter = llmWriterEnabled ?? LLM_WRITER_ENABLED;
  const warnState = { warned: false };

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
  const enumeratedKeys = new Set(); // `${familyId}|${spec.key}` for every candidate THIS run can even see
  for (const spec of specs) {
    const familyId = familyIdForBasic(engineKeyFor(spec));
    if (!specsByFamily.has(familyId)) specsByFamily.set(familyId, []);
    specsByFamily.get(familyId).push(spec);
    enumeratedKeys.add(`${familyId}|${spec.key}`);
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

  let written = 0; let superseded = 0; let eligible = 0; let expired = 0; let llmWordings = 0;
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
    // Suppression is a user decision (do_not_analyze feedback), not a data
    // judgment: it outlives evidence drift and is lifted only through the
    // explicit user path (Control Center / feedback), after which the next
    // run re-derives normally. A live SUPPRESSED prior must never be
    // superseded just because re-eligible evidence moved — skip before
    // evidenceEquivalent/supersede/writeClaim so no new claim is written,
    // no supersede happens, and the prior's status/updatedAt are untouched.
    if (prior && prior.status === 'suppressed') continue;
    if (!prior) {
      const { usedLlm } = await writeWithOptionalLlmWording({
        claimInput: result.claimInput,
        write: (input) => writeClaim(db, uid, { ...input, version: 1, parentClaimId: null }),
        llmWriterEnabled: useLlmWriter,
        warnState,
      });
      written += 1;
      if (usedLlm) llmWordings += 1;
    } else {
      const candidate = buildClaim({ ...result.claimInput, version: prior.version + 1, parentClaimId: prior.id });
      // Trade-off (accepted): a still-eligible candidate whose evidence is
      // merely equivalent to its prior keeps that prior's frozen (possibly
      // stale) candidateTestsCount/ciLevel metadata rather than refreshing
      // it every run — only the ineligible transition above retracts.
      //
      // F2 (closure-wave final review): this no-churn skip must apply ONLY
      // to a VERIFIED prior. An EXPIRED prior re-deriving with merely
      // equivalent evidence must still supersede — expired claims are
      // documented as revivable (see the retraction sweep below and
      // claimsService.js's header comment), and skipping here on status
      // alone would leave an expired claim expired forever the moment its
      // re-eligible evidence happens to land within the equivalence band,
      // exactly the realistic "exclusion lift" scenario this fix closes.
      if (prior.status === 'verified' && evidenceEquivalent(prior, candidate)) continue; // no churn
      const { usedLlm } = await writeWithOptionalLlmWording({
        claimInput: result.claimInput,
        write: (input) => supersedeClaim(
          db, uid, prior, buildClaim({ ...input, version: prior.version + 1, parentClaimId: prior.id }),
        ),
        llmWriterEnabled: useLlmWriter,
        warnState,
      });
      written += 1; superseded += 1;
      if (usedLlm) llmWordings += 1;
    }
  }

  // Vanished-candidate retraction (Task 9 re-review gap fix): the loop above
  // only retracts a live VERIFIED claim when its candidate is enumerated AND
  // analysis finds it ineligible. But source-exclusions (or plain data
  // drift, e.g. a tag's present-day count dropping below minPresentDays)
  // can remove a candidate from `enumerateExposures`'s output ENTIRELY —
  // that candidate is never visited by the loop above, so its live claim
  // would otherwise keep standing forever, citing entries the user may have
  // just flagged wrong-source. `enumeratedKeys` and the analyze loop's
  // ineligible-retraction are mutually exclusive by construction (a key is
  // either in `enumeratedKeys`, handled above, or not, handled here), so no
  // claim can be expired twice in one run. Never touch a SUPPRESSED prior
  // (user suppression sticks), and never touch a non-`basic:` family (e.g.
  // `experiment:*`) — this sweep is scoped to this pipeline's own claims.
  // Retraction principle: a claim whose candidate can no longer even be
  // enumerated from current data is not currently derivable — expire it;
  // revival stays possible via the supersede lineage, same as the
  // ineligible-but-enumerated case above.
  for (const [key, claim] of liveByCandidate) {
    if (enumeratedKeys.has(key)) continue;
    if (claim.status !== 'verified') continue;
    if (!String(claim.analysisPlan?.hypothesisFamilyId || '').startsWith('basic:')) continue;
    await setClaimStatus(db, uid, claim.id, 'expired', { now: at });
    expired += 1;
  }

  return {
    written, superseded, candidatesTested: specs.length, eligible, expired, llmWordings,
  };
}

export default { engineKeyFor, generateClaims };
