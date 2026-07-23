/**
 * Evidence builder (R4 Phase 1). Implements DR integrity-ladder gates 1-6 in
 * deterministic code. Design validity (gate 2) is structural: the caller
 * freezes the plan — including the family's candidateTestsCount and the
 * Bonferroni ciLevel — BEFORE this module analyzes anything.
 *
 * Gate-by-gate mapping (DR integrity ladder):
 *   Gate 1 (data validity)      — upstream: entryAdapter.js + observations.js
 *                                  reject/normalize bad units before this
 *                                  module ever sees a row.
 *   Gate 2 (design validity)    — freezeCandidatePlan() must run (and the
 *                                  ledger register the candidate) BEFORE
 *                                  buildEvidenceForCandidate(); the latter
 *                                  refuses to run on an unfrozen plan.
 *   Gate 3 (estimability)       — runAnalysisPlan()'s own insufficiency
 *                                  reasons (pair count, degenerate split,
 *                                  group-size/imbalance/contrast guards),
 *                                  plus this module's own minimum-total-days
 *                                  and minimum-span-days floors.
 *   Gate 4 (stability)          — the bootstrap CI must exclude zero, and
 *                                  the leave-one-day-out check must be sign
 *                                  consistent.
 *   Gate 5 (practical relevance)— |delta| must clear
 *                                  PRACTICAL_EFFECT_FLOOR_POINTS.
 *   Gate 6 (evidence integrity) — every contributing day is reconciled: it
 *                                  is either a visible receipt source day or
 *                                  counted in hiddenSensitiveSourceCount —
 *                                  nothing contributes invisibly.
 */
import { pairObservations, runAnalysisPlan } from '../../experiments/estimator';
import { bonferroniCiLevel } from '../testingLedger';
import { buildReceipt, sourceFromEntry } from '../receipts';
import { ADAPTER_VERSION } from '../entryAdapter';
import { OBSERVATION_SCHEMA_VERSION, observationSeriesFor, moodSeriesFor } from '../observations';
import { generatorVersion } from '../generatorVersion';

export const EVIDENCE_BUILDER_VERSION = 1;
export const EMERGING_MIN_TOTAL_DAYS = 14;   // DR "emerging association" floor
export const EMERGING_MIN_SPAN_DAYS = 21;    // spans at least 3 weeks
export const PRACTICAL_EFFECT_FLOOR_POINTS = 5; // = estimator SMALL_EFFECT_DELTA

/**
 * Gate 2 (design validity): freeze the analysis plan — including the
 * family's Bonferroni-corrected ciLevel — BEFORE any analysis runs. Pure;
 * `now` must be supplied by the caller (no ambient clock).
 */
export function freezeCandidatePlan({ familyId, candidateId, exposureSpec, candidateTestsCount, timeZone, now }) {
  if (!now) throw new Error('evidenceBuilder: now is required (no ambient clock)');
  return {
    frozenAt: now,
    hypothesisFamilyId: familyId,
    candidateId,
    candidateTestsCount,
    ciLevel: bonferroniCiLevel(candidateTestsCount),
    outcomeUnit: 'mood_0_100',
    timezone: timeZone || 'UTC',
    datePolicy: 'user_local_calendar_day',
    exposureDefinition: exposureSpec.kind === 'health'
      ? `daily mean ${exposureSpec.label} (median split)`
      : `day includes ${exposureSpec.kind} "${exposureSpec.label}" (present vs known-absent; unknown days omitted)`,
    outcomeDefinition: 'daily mean mood (0-100)',
    lagDays: 0,
    splitMode: exposureSpec.splitMode,
    minExposureContrast: 0,
    minimumTotalDays: EMERGING_MIN_TOTAL_DAYS,
    minimumSpanDays: EMERGING_MIN_SPAN_DAYS,
    practicalEffectFloorMoodPoints: PRACTICAL_EFFECT_FLOOR_POINTS,
    adapterVersion: ADAPTER_VERSION,
    observationSchemaVersion: OBSERVATION_SCHEMA_VERSION,
    evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION,
    estimatorThresholds: {
      minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000,
    },
  };
}

const spanDays = (dateKeys) => {
  if (dateKeys.length < 2) return dateKeys.length;
  const sorted = [...dateKeys].sort();
  const ms = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) - Date.parse(`${sorted[0]}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
};

/**
 * PURE — no Firestore, no clock (all times derive from plan.frozenAt).
 * Returns `{ eligible: false, reasons: string[] }` on any gate failure, or
 * `{ eligible: true, claimInput }` where claimInput is a complete buildClaim
 * input (version/lineage fields left for the pipeline).
 */
export function buildEvidenceForCandidate({ observations, entriesById, exposureSpec, plan }) {
  // Gate 1 (data validity) is upstream: adapter + observations reject bad units.
  // Gate 2 (design validity): refuse to run without a frozen plan.
  if (!plan?.frozenAt || !Number.isFinite(plan.candidateTestsCount)) {
    return { eligible: false, reasons: ['plan_not_frozen'] };
  }
  const exposureSeries = observationSeriesFor(observations, exposureSpec);
  const outcomeSeries = moodSeriesFor(observations);
  const pairs = pairObservations({ exposureSeries, outcomeSeries, lag: plan.lagDays });

  const reasons = [];
  const pairedDateKeys = pairs.map((p) => p.dateKey);
  if (pairs.length < plan.minimumTotalDays) reasons.push('below_minimum_total_days');
  if (spanDays(pairedDateKeys) < plan.minimumSpanDays) reasons.push('below_minimum_span_days');

  // Gate 3 (estimability) + gate 4 (stability interval): the estimator.
  const result = runAnalysisPlan({
    pairs,
    plan: { lag: plan.lagDays, splitMode: plan.splitMode, minExposureContrast: plan.minExposureContrast, ciLevel: plan.ciLevel },
  });
  if (result.status !== 'ok') {
    return { eligible: false, reasons: [...new Set([...reasons, ...result.reasons])] };
  }
  const { estimate } = result;
  const [lo, hi] = estimate.ci;
  if (lo <= 0 && hi >= 0) reasons.push('interval_includes_zero');
  if (!estimate.stability.signConsistent) reasons.push('leave_one_day_out_unstable');
  // Gate 5 (practical relevance).
  if (Math.abs(estimate.delta) < plan.practicalEffectFloorMoodPoints) reasons.push('below_practical_floor');
  if (reasons.length) return { eligible: false, reasons: [...new Set(reasons)] };

  // Gate 6 (evidence integrity): reconcile every contributing day.
  const pairedKeySet = new Set(pairedDateKeys);
  const contributing = observations.filter((o) => pairedKeySet.has(o.dateKey));
  const visible = contributing.filter((o) => !o.sensitive);
  const hidden = contributing.filter((o) => o.sensitive);
  const sourceEntryIds = visible.flatMap((o) => o.entryIds);
  const sortedKeys = [...pairedDateKeys].sort();

  const direction = estimate.delta > 0 ? 'positive' : 'negative';
  const effectAbs = Math.round(Math.abs(estimate.delta) * 10) / 10;
  const subject = exposureSpec.label;
  const wording = exposureSpec.splitMode === 'binary'
    ? `On days you logged ${subject}, your recorded mood averaged ${effectAbs} points ${direction === 'positive' ? 'higher' : 'lower'} (0–100 scale) than days you didn't — ${estimate.nHigh} vs ${estimate.nLow} days over ${spanDays(pairedDateKeys)} days.`
    : `On days with higher ${subject}, your recorded mood averaged ${effectAbs} points ${direction === 'positive' ? 'higher' : 'lower'} (0–100 scale) than lower-${subject} days — ${estimate.nHigh} vs ${estimate.nLow} days over ${spanDays(pairedDateKeys)} days.`;

  const receipt = buildReceipt({
    sources: visible.flatMap((o) => o.entryIds.map((id) => sourceFromEntry(entriesById.get(id))).filter(Boolean)),
    scope: null,
    timeWindow: { start: `${sortedKeys[0]}T00:00:00.000Z`, end: `${sortedKeys[sortedKeys.length - 1]}T00:00:00.000Z` },
    sampleSize: pairs.length,
    missingness: `${pairs.length} of ${spanDays(pairedDateKeys)} days had both ${subject} status and a mood record`,
    generator: 'insight_claims',
  });
  receipt.computation = {
    nHigh: estimate.nHigh, nLow: estimate.nLow, splitThreshold: estimate.splitThreshold,
    exposureContrast: estimate.exposureContrast, hiddenSensitiveSourceCount: hidden.length,
  };
  // buildReceipt() stamps versions.generatedAt from an ambient clock
  // (`new Date().toISOString()`), which this module may not use — it is
  // PURE and every timestamp must derive from plan.frozenAt (no ambient
  // clock; see module docblock / gate 2). Pin it here rather than in
  // receipts.js (shared T2 contract, not this task's file to touch).
  receipt.versions.generatedAt = plan.frozenAt;

  return {
    eligible: true,
    claimInput: {
      claimType: 'pattern_to_watch',
      subject, outcome: 'mood', direction,
      questionWording: `How did ${subject} and mood move together in your recorded days?`,
      wording,
      limitations: [
        `Same-day association only — ${subject} and mood were recorded together and something else may explain both.`,
        'Recorded days only; days you didn’t journal are not represented.',
      ],
      analysisPlan: plan,
      evidence: {
        sourceEntryIds,
        hiddenSensitiveSourceCount: hidden.length,
        totalCandidateDayCount: contributing.length,
        exposedDayCount: estimate.nHigh,
        comparisonDayCount: estimate.nLow,
        observedSpanDays: spanDays(pairedDateKeys),
        exposureContrast: estimate.exposureContrast ?? 0,
        effectMoodPoints: estimate.delta,
        stabilityInterval: estimate.ci,
        leaveOneDayOutDirectionStable: estimate.stability.signConsistent,
        exposureCoverage: exposureSeries.length / Math.max(observations.length, 1),
        outcomeCoverage: outcomeSeries.length / Math.max(observations.length, 1),
        representativeness: 'unknown',
      },
      receipt,
      status: 'verified', // deterministic wording: verified by construction (D2)
      provenance: { generatorVersion, evidenceBuilderVersion: EVIDENCE_BUILDER_VERSION, wordingSource: 'deterministic_template_v1' },
      createdAt: plan.frozenAt,
      updatedAt: plan.frozenAt,
    },
  };
}

export default {
  EVIDENCE_BUILDER_VERSION,
  EMERGING_MIN_TOTAL_DAYS,
  EMERGING_MIN_SPAN_DAYS,
  PRACTICAL_EFFECT_FLOOR_POINTS,
  freezeCandidatePlan,
  buildEvidenceForCandidate,
};
