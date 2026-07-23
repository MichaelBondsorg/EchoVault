/**
 * Personal Experiments -> `experiment_result` claims (R4 Phase 2, Task 4).
 *
 * `buildExperimentResultClaim` is the THIRD claim-type mapping (alongside
 * `pattern_to_watch` in `src/services/insights/claims/evidenceBuilder.js`,
 * the precedent this module deliberately mirrors). It is PURE deterministic
 * code — no LLM, no Firestore, no ambient clock (`now` is a required
 * explicit argument, mirroring `computeResult.js`'s purity posture) — that
 * projects a completed experiment's `computeResult.js` output onto a
 * complete `buildClaim` input (`src/services/insights/claims/claimSchema.js`).
 *
 * INSUFFICIENCY IS NOT A CLAIM: `computeExperimentResult` returns
 * `status: 'insufficient'` with no `estimate` at all when the data doesn't
 * clear the coverage/paired-observations gates (see that module's doc
 * comment). This function returns `null` for any such result (and for a
 * malformed/estimate-less "ok" result, defensively) — there is nothing
 * truthful to claim about an experiment that never produced a number.
 *
 * NO CLAIM WITHOUT A DIRECTION: `direction` (`claimSchema.js`'s
 * `CLAIM_DIRECTIONS`) is a strict `'positive'|'negative'` enum — there is no
 * third "flat" value. A `delta === 0` result is a genuine (if rare) possible
 * outcome of `computeExperimentResult` (the CI-spans-zero narrative already
 * covers "no clear direction" in prose) but has no direction to report as a
 * claim, so it also returns `null` here rather than defaulting to
 * `'positive'` (which would misrepresent a null result as a real finding).
 *
 * THE CAUSAL-LANGUAGE COLLISION (binding finding, read before touching the
 * wording/questionWording/limitations logic below): `claimSchema.js`'s
 * `CAUSAL_RE` rejects the bare word "caused" (and siblings) in `wording`/
 * `questionWording` with no negation-awareness — two of this codebase's own
 * EXISTING inputs trip it on every real result, and this module handles
 * each differently:
 *   - `computeResult.js`'s `NON_CAUSAL_FRAMING` ("...not proof that one
 *     caused the other.") is unconditionally appended to EVERY
 *     `narrative.summary` — so `result.narrative.summary` will, in
 *     practice, NEVER pass `CAUSAL_RE`. This module still checks it (never
 *     hand-waves the rule away) per the mapping spec, but the check is
 *     expected to always fall through to the rebuilt wording below.
 *   - The user's own `experiment.question` is natural free text ("Does more
 *     sleep improve my mood?") and routinely trips `CAUSAL_RE` too —
 *     unlike `wording`, there is no fallback template to silently swap in
 *     upstream, so an unguarded pass-through used to make `buildClaim`
 *     throw and `writeResult`'s containment swallow it, losing the claim
 *     entirely with no visible error. This module now checks
 *     `experiment.question` itself and substitutes evidenceBuilder.js's
 *     neutral `questionWording` template ("How did {subject} and mood move
 *     together in your recorded days?") whenever the raw question trips the
 *     regex, so a causal-sounding question never silently drops a claim.
 *   - `templates.js`'s `whatThisDoesNotProveFor` bullet #1 ("This does not
 *     show that {exposure} caused the change in {outcome}.") used to trip
 *     the same regex for the same reason (explicitly negating causation
 *     still contains the trigger word) — `claimSchema.js`'s `buildClaim`
 *     now applies a negation-aware strip to `limitations` ONLY (adjudicated
 *     option (c); `wording`/`questionWording` remain fully strict) before
 *     testing for causal language, so legitimate negated-causal disclaimers
 *     like this one pass. This module therefore no longer filters
 *     `whatThisDoesNotProve` at all — every template bullet flows into
 *     `limitations` verbatim.
 * `CAUSAL_RE` is exported by `claimSchema.js` specifically so this module
 * (and any future claim-producing module) can import the SAME regex
 * instance instead of maintaining a duplicate that could drift — the
 * server-side parity test (Task 9) still asserts the shared client pattern
 * matches `functions/src/insights/claimVerifier.js`.
 */
import {
  MIN_PAIRED_OBSERVATIONS, MIN_GROUP_SIZE, MIN_GROUP_FRACTION, BOOTSTRAP_RESAMPLES, SMALL_EFFECT_DELTA,
} from './estimator';
import { ADAPTER_VERSION } from '../insights/entryAdapter';
import { OBSERVATION_SCHEMA_VERSION } from '../insights/observations';
import { EVIDENCE_BUILDER_VERSION } from '../insights/claims/evidenceBuilder';
import { CAUSAL_RE } from '../insights/claims/claimSchema';
import { generatorVersion } from '../insights/generatorVersion';

function roundToOneDecimal(n) {
  return Math.round(n * 10) / 10;
}

/** `covered/total` in [0,1]; `computeCoverage` always returns `total >= 1`. */
function coverageRatio(coverage) {
  return coverage && coverage.total > 0 ? coverage.covered / coverage.total : 0;
}

function toIso(now) {
  if (now instanceof Date) return now.toISOString();
  const parsed = new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('buildExperimentResultClaim: now must be a valid Date/ISO string.');
  }
  return parsed.toISOString();
}

/**
 * A frozen, deterministic description of the exposure variable — mirrors
 * `evidenceBuilder.js`'s `freezeCandidatePlan`'s `exposureDefinition`
 * convention (health/environment variables: continuous, median/binary
 * split; tags: present-vs-known-absent).
 */
function exposureDefinitionFor(exposure, splitMode) {
  if (exposure?.source === 'tags') {
    const tagLabel = typeof exposure.tag === 'string' && exposure.tag ? exposure.tag : (exposure.label || 'this tag');
    return `day includes tag "${tagLabel}" (present vs known-absent; unknown days omitted)`;
  }
  return `daily mean ${exposure?.label || 'this variable'} (${splitMode === 'binary' ? 'binary' : 'median'} split)`;
}

/**
 * Rebuilt Phase-1-template-style wording, deliberately WITHOUT
 * `NON_CAUSAL_FRAMING` (see module doc comment's causal-language section) —
 * mirrors `evidenceBuilder.js`'s own `wording` construction (numbers-only,
 * no causal-adjacent copy at all) rather than `computeResult.js`'s
 * `buildSummary` (which always appends the causal-tripping framing).
 */
function fallbackWording({
  subject, outcomeLabel, delta, nHigh, nLow, n, splitMode,
}) {
  const direction = delta > 0 ? 'higher' : 'lower';
  const magnitude = roundToOneDecimal(Math.abs(delta));
  if (splitMode === 'binary') {
    return `On days you logged ${subject}, your recorded ${outcomeLabel} averaged ${magnitude} points ${direction} `
      + `(0-100 scale) than on days you didn't — ${nHigh} vs ${nLow} paired days (${n} total).`;
  }
  return `On days with more ${subject} than usual, your recorded ${outcomeLabel} averaged ${magnitude} points ${direction} `
    + `(0-100 scale) than on days with less — ${nHigh} vs ${nLow} paired days (${n} total).`;
}

/**
 * Build a complete `buildClaim` input for a completed experiment's result,
 * or `null` when there is nothing truthful to claim (insufficient result,
 * malformed/estimate-less "ok" result, zero-delta result, or a legacy plan
 * with no `hypothesisFamilyId` to key the claim on).
 *
 * Always produces a FIRST-version shape (`version: 1, parentClaimId: null`)
 * — a caller writing a SUPERSEDING version (`writeAdjustedResult`) is
 * responsible for overriding those two fields before calling
 * `supersedeClaim`, exactly like `evidenceBuilder.js`'s `claimInput` leaves
 * lineage fields for its own pipeline caller.
 *
 * @param {Object} args
 * @param {Object} args.experiment - the experiment doc (`question`,
 *   `analysisPlan` (frozen, with `hypothesisFamilyId`), `durationDays`,
 *   `createdAt`).
 * @param {string} args.experimentId - stamped onto
 *   `analysisPlan.sourceExperimentId` (see the RUN IDENTITY note below;
 *   final review Important 1, closure wave) — WHEN a non-empty string, a
 *   hand-built/legacy caller that omits it simply gets no stamp, matching
 *   this field's optional status in `claimSchema.js`.
 * @param {Object} args.result - a single `computeExperimentResult` output
 *   (`result.original` or `result.adjusted` — the caller unwraps the
 *   storage-layer `{original, adjusted, exclusionHistory}` wrapper; this
 *   function only ever sees one bare result at a time).
 * @param {Date|string} args.now - required; no ambient clock.
 * @returns {Object|null} a `buildClaim`-shaped input, or `null`.
 */
export function buildExperimentResultClaim({
  experiment, experimentId, result, now,
} = {}) {
  if (!experiment || typeof experiment !== 'object') {
    throw new Error('buildExperimentResultClaim: experiment is required.');
  }
  if (now == null) {
    throw new Error('buildExperimentResultClaim: now is required (no ambient clock).');
  }
  const nowIso = toIso(now);

  // Insufficiency is not a claim; nor is a malformed "ok" result missing
  // its estimate (defensive — computeResult.js's own contract guarantees
  // this never happens for a real `status: 'ok'` result).
  if (!result || result.status !== 'ok' || !result.estimate) return null;

  const { estimate } = result;
  const { delta } = estimate;
  // No claim without a direction (see module doc comment) — includes the
  // zero-delta case, which is a real possible estimator output but has no
  // 'positive'/'negative' to report.
  if (!Number.isFinite(delta) || delta === 0) return null;
  const direction = delta > 0 ? 'positive' : 'negative';

  const plan = experiment.analysisPlan || {};
  const hypothesisFamilyId = plan.hypothesisFamilyId;
  if (typeof hypothesisFamilyId !== 'string' || !hypothesisFamilyId) return null; // legacy plan, no family to key the claim on

  const subject = plan.exposure?.label || 'this variable';
  const outcomeLabel = plan.outcome?.label || 'mood';
  const splitMode = plan.splitMode === 'binary' ? 'binary' : 'median';

  const summary = typeof result.narrative?.summary === 'string' ? result.narrative.summary : '';
  const wording = summary && !CAUSAL_RE.test(summary)
    ? summary
    : fallbackWording({
      subject, outcomeLabel, delta, nHigh: estimate.nHigh, nLow: estimate.nLow, n: estimate.n, splitMode,
    });

  // The user's raw question is natural free text and routinely trips
  // CAUSAL_RE (see module doc comment's causal-language section) — silently
  // passing it through used to make buildClaim throw and writeResult's
  // containment swallow the whole claim with no visible error. Substitute
  // evidenceBuilder.js's own neutral questionWording template whenever the
  // raw question trips the regex; pass it through verbatim otherwise.
  const rawQuestion = typeof experiment.question === 'string' ? experiment.question : '';
  const questionWording = rawQuestion && CAUSAL_RE.test(rawQuestion)
    ? `How did ${subject} and mood move together in your recorded days?`
    : rawQuestion;

  // No longer filtered for CAUSAL_RE (see module doc comment's
  // causal-language section): claimSchema.js's negation-aware limitations
  // check now accepts legitimate negated-causal disclaimers like bullet #1,
  // so every template bullet flows into limitations verbatim.
  const whatThisDoesNotProve = Array.isArray(plan.whatThisDoesNotProve)
    ? plan.whatThisDoesNotProve.filter((l) => typeof l === 'string')
    : [];
  const coverageCaveat = typeof result.receipt?.missingness === 'string' && result.receipt.missingness
    ? result.receipt.missingness
    : `Exposure: ${result.coverage?.exposure?.label || 'unknown coverage'}. Outcome: ${result.coverage?.outcome?.label || 'unknown coverage'}.`;
  const limitations = [...whatThisDoesNotProve, coverageCaveat];

  const frozenAt = typeof experiment.createdAt === 'string' && experiment.createdAt ? experiment.createdAt : nowIso;

  const analysisPlan = {
    frozenAt,
    hypothesisFamilyId,
    candidateId: hypothesisFamilyId,
    candidateTestsCount: 1,
    ciLevel: Number.isFinite(plan.ciLevel) && plan.ciLevel > 0 && plan.ciLevel < 1 ? plan.ciLevel : 0.95,
    outcomeUnit: plan.outcome?.unit || 'mood_0_100',
    timezone: plan.timezone || 'UTC',
    datePolicy: 'user_local_calendar_day',
    exposureDefinition: exposureDefinitionFor(plan.exposure, splitMode),
    outcomeDefinition: `daily mean ${outcomeLabel} (0-100)`,
    lagDays: Number.isFinite(plan.lag) ? plan.lag : 0,
    splitMode,
    minimumTotalDays: Number.isFinite(plan.minPairedObservations) ? plan.minPairedObservations : MIN_PAIRED_OBSERVATIONS,
    minimumSpanDays: Number.isFinite(experiment.durationDays) ? experiment.durationDays : MIN_PAIRED_OBSERVATIONS,
    practicalEffectFloorMoodPoints: SMALL_EFFECT_DELTA,
    adapterVersion: ADAPTER_VERSION,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION,
    estimatorThresholds: {
      minPairedObservations: Number.isFinite(plan.minPairedObservations) ? plan.minPairedObservations : MIN_PAIRED_OBSERVATIONS,
      minGroupSize: MIN_GROUP_SIZE,
      minGroupFraction: MIN_GROUP_FRACTION,
      bootstrapResamples: BOOTSTRAP_RESAMPLES,
    },
  };
  if (Number.isFinite(plan.minExposureContrast)) {
    analysisPlan.minExposureContrast = plan.minExposureContrast;
  }

  // RUN IDENTITY (final review Important 1, closure wave): every
  // experiment_result claim now carries WHICH RUN produced it
  // (`sourceExperimentId`) and an ORDERING marker (`sourceCompletedAt`), so
  // `experimentsService.js`'s `writeOrSupersedeExperimentResultClaim` can
  // tell a genuinely NEWER run's completion apart from a post-hoc exclusion
  // adjustment on an OLDER, already-superseded run — without this, adjusting
  // an old run's exclusions (allowed any time post-completion) could
  // overwrite a since-completed second run's claim as the family's
  // "latest," with no way to tell the two apart.
  //
  // `sourceCompletedAt` deliberately reuses `frozenAt` (== `experiment.
  // createdAt`, IMMUTABLE the instant the experiment leaves `draft` —
  // plan-freeze) rather than this function's own `now` argument.  `now` is
  // the WALL-CLOCK MOMENT THIS PARTICULAR CLAIM BUILD RAN — for a fresh
  // `writeResult` call that happens to equal the run's real completion
  // instant, but for a `writeAdjustedResult` call on an OLD run it is
  // whatever much-LATER moment the user happened to open that old result and
  // toggle an exclusion, which can easily be after a second run has already
  // completed. Using it directly would make an old run's adjusted claim look
  // "newer" than the second run's claim purely because the adjustment
  // happened later in wall-clock time — exactly the defect this fix closes.
  // `frozenAt` is stamped once per run and NEVER changes across any later
  // adjustment of that SAME run, so two claims for the SAME run always
  // compare equal and two claims for DIFFERENT runs compare in true run
  // order — mirrors `experimentsService.js`'s `listFamilyRuns` "SORT KEY
  // FIX" precedent (`createdAt`, not `updatedAt`, is the immutable ORDER
  // key), for the identical reason.
  //
  // Guarded on `experimentId` being a real, non-empty string (defensive —
  // every real caller always passes one; see this function's own JSDoc) so
  // a hand-built/legacy call simply omits both keys rather than writing a
  // malformed `sourceExperimentId`. Both keys are OPTIONAL in
  // `claimSchema.js` (never required) precisely so an absent pair here is a
  // valid claim, not a validation failure.
  if (typeof experimentId === 'string' && experimentId) {
    analysisPlan.sourceExperimentId = experimentId;
    analysisPlan.sourceCompletedAt = frozenAt;
  }

  const sourceEntryIds = Array.isArray(result.receipt?.sources)
    ? result.receipt.sources.map((s) => s?.entryId).filter((id) => typeof id === 'string' && id)
    : [];

  const evidence = {
    sourceEntryIds,
    hiddenSensitiveSourceCount: Number.isFinite(result.sensitiveObservationCount) ? result.sensitiveObservationCount : 0,
    totalCandidateDayCount: estimate.n,
    exposedDayCount: estimate.nHigh,
    comparisonDayCount: estimate.nLow,
    // NOTE: here `observedSpanDays` is the experiment WINDOW length (total
    // days in `result.coverage.exposure`, i.e. coverage denominator) — not
    // the paired-day span the pipeline's own evidenceBuilder.js means by
    // the same field name. computeResult.js does not expose per-pair
    // dateKeys, so there is no narrower span to compute here; `estimate.n`
    // (paired observations) is the closest available fallback.
    observedSpanDays: Number.isFinite(result.coverage?.exposure?.total) ? result.coverage.exposure.total : estimate.n,
    exposureContrast: estimate.exposureContrast,
    effectMoodPoints: estimate.delta,
    exposureCoverage: coverageRatio(result.coverage?.exposure),
    outcomeCoverage: coverageRatio(result.coverage?.outcome),
    stabilityInterval: estimate.ci,
    leaveOneDayOutDirectionStable: !!estimate.stability?.signConsistent,
    representativeness: 'unknown',
  };

  return {
    version: 1,
    parentClaimId: null,
    claimType: 'experiment_result',
    subject,
    outcome: outcomeLabel,
    direction,
    questionWording,
    wording,
    limitations,
    analysisPlan,
    evidence,
    receipt: result.receipt,
    status: 'verified', // deterministic wording: verified by construction (D2, same posture as evidenceBuilder.js)
    provenance: {
      generatorVersion,
      evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION,
      wordingSource: 'deterministic_template_v1',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export default {
  buildExperimentResultClaim,
};
