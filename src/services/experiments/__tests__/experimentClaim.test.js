/**
 * experimentClaim.js — experiment results become `experiment_result` claims
 * (R4 Phase 2, Task 4). Pure mapping tests: no Firestore, no LLM. Every
 * output is validated end-to-end through the REAL `buildClaim` (the
 * construction path is the validator, per claimSchema.js's own doc comment)
 * so a schema drift in either module fails loudly here.
 */
import { describe, it, expect } from 'vitest';
import { buildExperimentResultClaim } from '../experimentClaim';
import { buildClaim, claimDocId } from '../../insights/claims/claimSchema';

const NOW = '2026-07-22T12:00:00.000Z';

const SLEEP_PLAN = {
  templateId: 'sleep-hours-mood-same-day',
  lag: 0,
  exposure: { source: 'health', field: 'sleepHours', label: 'sleep hours' },
  outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
  minPairedObservations: 10,
  coverageFloor: 0.5,
  confounders: ['Confounder one.', 'Confounder two.'],
  whatThisDoesNotProve: [
    'This does not show that sleep hours caused the change in mood.',
    'Other things that changed around the same time could explain some or all of this difference.',
    "Your own habits and days aren't a controlled experiment — this is a pattern in your own data, not a scientific study of what works for everyone.",
    'Running many experiments makes a chance pattern more likely somewhere; treat any single result as one observation, not a verdict.',
  ],
  timezone: 'America/Los_Angeles',
  hypothesisFamilyId: 'experiment:sleep-hours-mood-same-day',
};

const TAG_PLAN = {
  templateId: 'tag-presence-mood',
  lag: 0,
  exposure: { source: 'tags', field: 'tags', label: 'tag presence', tag: '@person:spencer' },
  outcome: { field: 'analysis.mood_score', label: 'mood', unit: 'mood_0_100' },
  minPairedObservations: 10,
  coverageFloor: 0.5,
  splitMode: 'binary',
  minExposureContrast: 1,
  confounders: [],
  whatThisDoesNotProve: ['Other things happening on the same days this tag appears could explain the mood difference.'],
  timezone: 'UTC',
  hypothesisFamilyId: 'experiment:tag-presence-mood:tag:@person:spencer',
};

function experimentFor(plan, overrides = {}) {
  return {
    question: 'Does how much I sleep affect my mood?',
    analysisPlan: plan,
    durationDays: 14,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function okResult(overrides = {}) {
  return {
    status: 'ok',
    estimate: {
      meanHigh: 70,
      meanLow: 60,
      delta: 10,
      ci: [4, 16],
      n: 20,
      pearsonR: 0.3,
      nHigh: 10,
      nLow: 10,
      splitThreshold: 7,
      exposureContrast: 2.5,
      resampleDiscardCount: 0,
      stability: { signConsistent: true },
    },
    coverage: {
      exposure: { covered: 20, total: 20, label: '20 of 20 days' },
      outcome: { covered: 20, total: 20, label: '20 of 20 days' },
    },
    receipt: {
      sources: [{ entryId: 'e1', date: '2026-07-10T00:00:00.000Z', excerpt: 'slept well' }],
      scope: null,
      timeWindow: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z' },
      sampleSize: 20,
      missingness: 'Exposure: 20 of 20 days. Outcome: 20 of 20 days.',
      versions: {
        generator: 'experiment_v1', computationVersion: 1, generatedAt: '2026-07-20T00:00:00.000Z', model: null, promptVersion: null,
      },
      computation: {
        nHigh: 10, nLow: 10, splitThreshold: 7, exposureContrast: 2.5,
      },
    },
    sensitiveObservationCount: 1,
    invalidObservationCount: 0,
    narrative: {
      summary: 'On days with more sleep hours than usual, mood averaged 10.0 points (0-100) higher than on '
        + 'days with less (based on 20 paired days). This is an association, not proof that one caused the other.',
      alternatives: ['Confounder one.'],
      whatThisDoesNotProve: SLEEP_PLAN.whatThisDoesNotProve,
    },
    ...overrides,
  };
}

describe('buildExperimentResultClaim — null cases (no claim without real evidence and a direction)', () => {
  it('returns null for an insufficient result (insufficiency is not a claim)', () => {
    const result = {
      status: 'insufficient',
      reasons: ['insufficient_paired_observations'],
      coverage: { exposure: { covered: 2, total: 20, label: '2 of 20 days' }, outcome: { covered: 2, total: 20, label: '2 of 20 days' } },
      receipt: { sources: [], scope: null, timeWindow: { start: null, end: null }, sampleSize: 0, missingness: null, versions: {} },
      narrative: { alternatives: [], whatThisDoesNotProve: [], insufficiency: 'not enough data' },
    };
    expect(buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW })).toBeNull();
  });

  it('returns null for a malformed "ok" result with no estimate (defensive)', () => {
    expect(buildExperimentResultClaim({
      experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result: { status: 'ok' }, now: NOW,
    })).toBeNull();
  });

  it('returns null for a zero-delta ok result — no claim without a direction', () => {
    const result = okResult({ estimate: { ...okResult().estimate, delta: 0 } });
    expect(buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW })).toBeNull();
  });

  it('returns null when the frozen plan has no hypothesisFamilyId (legacy plan, nothing to key the claim on)', () => {
    const legacyPlan = { ...SLEEP_PLAN, hypothesisFamilyId: undefined };
    const result = okResult();
    expect(buildExperimentResultClaim({ experiment: experimentFor(legacyPlan), experimentId: 'exp-1', result, now: NOW })).toBeNull();
  });

  it('throws when experiment is missing', () => {
    expect(() => buildExperimentResultClaim({ experiment: null, experimentId: 'exp-1', result: okResult(), now: NOW })).toThrow();
  });

  it('throws when now is missing (no ambient clock)', () => {
    expect(() => buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result: okResult() })).toThrow();
  });
});

describe('buildExperimentResultClaim — a positive-delta ok result maps to a valid experiment_result claim', () => {
  const result = okResult();
  const input = buildExperimentResultClaim({
    experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW,
  });
  // Validated end-to-end through the REAL buildClaim — construction is the
  // validator; this throws on any schema violation.
  const claim = buildClaim(input);

  it('is a version-1 experiment_result claim with the right identity fields', () => {
    expect(claim.claimType).toBe('experiment_result');
    expect(claim.version).toBe(1);
    expect(claim.parentClaimId).toBeNull();
    expect(claim.status).toBe('verified');
    expect(claim.direction).toBe('positive');
    expect(claim.subject).toBe('sleep hours');
    expect(claim.outcome).toBe('mood');
    expect(claim.questionWording).toBe('Does how much I sleep affect my mood?');
  });

  it('falls back to a rebuilt (non-causal) wording — narrative.summary always contains NON_CAUSAL_FRAMING\'s "caused", which trips CAUSAL_RE', () => {
    expect(result.narrative.summary).toMatch(/caused/i); // sanity: the real summary DOES trip the regex
    expect(claim.wording).not.toBe(result.narrative.summary);
    expect(claim.wording).not.toMatch(/\b(boosts?|causes?|caused|improves?|improved|makes? you|leads? to|results? in|because of your)\b/i);
    expect(claim.wording).toContain('sleep hours');
    expect(claim.wording).toContain('10 vs 10');
  });

  it('maps evidence numbers from estimate/coverage/sensitiveObservationCount exactly', () => {
    expect(claim.evidence.totalCandidateDayCount).toBe(20);
    expect(claim.evidence.exposedDayCount).toBe(10);
    expect(claim.evidence.comparisonDayCount).toBe(10);
    expect(claim.evidence.effectMoodPoints).toBe(10);
    expect(claim.evidence.exposureContrast).toBe(2.5);
    expect(claim.evidence.hiddenSensitiveSourceCount).toBe(1);
    expect(claim.evidence.observedSpanDays).toBe(20);
    expect(claim.evidence.exposureCoverage).toBe(1);
    expect(claim.evidence.outcomeCoverage).toBe(1);
    expect(claim.evidence.stabilityInterval).toEqual([4, 16]);
    expect(claim.evidence.leaveOneDayOutDirectionStable).toBe(true);
    expect(claim.evidence.sourceEntryIds).toEqual(['e1']);
    expect(claim.evidence.representativeness).toBe('unknown');
  });

  it('maps analysisPlan fills exactly per the mapping spec', () => {
    expect(claim.analysisPlan.hypothesisFamilyId).toBe('experiment:sleep-hours-mood-same-day');
    expect(claim.analysisPlan.candidateId).toBe('experiment:sleep-hours-mood-same-day');
    expect(claim.analysisPlan.candidateTestsCount).toBe(1);
    expect(claim.analysisPlan.ciLevel).toBe(0.95); // plan carries no ciLevel -> fallback
    expect(claim.analysisPlan.outcomeUnit).toBe('mood_0_100');
    expect(claim.analysisPlan.timezone).toBe('America/Los_Angeles');
    expect(claim.analysisPlan.datePolicy).toBe('user_local_calendar_day');
    expect(claim.analysisPlan.lagDays).toBe(0);
    expect(claim.analysisPlan.splitMode).toBe('median');
    expect(claim.analysisPlan.minimumTotalDays).toBe(10);
    expect(claim.analysisPlan.minimumSpanDays).toBe(14); // experiment's own durationDays
    expect(claim.analysisPlan.practicalEffectFloorMoodPoints).toBe(5);
    expect(claim.analysisPlan.frozenAt).toBe('2026-07-01T00:00:00.000Z'); // experiment.createdAt
    expect(typeof claim.analysisPlan.adapterVersion).toBe('number');
    expect(typeof claim.analysisPlan.observationSchemaVersion).toBe('number');
    expect(typeof claim.analysisPlan.evidenceBuilderVersion).toBe('number');
    expect(claim.analysisPlan.estimatorThresholds).toEqual({
      minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000,
    });
  });

  it('passes every whatThisDoesNotProve bullet through verbatim (negation-aware limitations check accepts the disclaimer) and appends the coverage caveat', () => {
    expect(claim.limitations).toHaveLength(5); // 4 template bullets (incl. the negated-causal disclaimer) + 1 coverage caveat
    expect(claim.limitations.slice(0, 4)).toEqual(SLEEP_PLAN.whatThisDoesNotProve);
    expect(claim.limitations[0]).toMatch(/\bcaused\b/i); // the disclaimer bullet survives verbatim, negation and all
    expect(claim.limitations[claim.limitations.length - 1]).toBe('Exposure: 20 of 20 days. Outcome: 20 of 20 days.');
  });

  it('carries the receipt through unchanged and stamps provenance', () => {
    expect(claim.receipt).toBe(result.receipt);
    expect(claim.provenance.wordingSource).toBe('deterministic_template_v1');
    expect(typeof claim.provenance.generatorVersion).toBe('number');
    expect(typeof claim.provenance.evidenceBuilderVersion).toBe('number');
    expect(claim.createdAt).toBe(NOW);
    expect(claim.updatedAt).toBe(NOW);
  });
});

describe('buildExperimentResultClaim — negative delta', () => {
  it('direction is negative and wording says "lower"', () => {
    const result = okResult({ estimate: { ...okResult().estimate, delta: -8, meanHigh: 55, meanLow: 63 } });
    const input = buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW });
    const claim = buildClaim(input);
    expect(claim.direction).toBe('negative');
    expect(claim.wording).toContain('lower');
  });
});

describe('buildExperimentResultClaim — binary split (tag-presence template)', () => {
  it('builds a valid claim with the tag-style exposureDefinition and wording', () => {
    const result = okResult();
    const input = buildExperimentResultClaim({ experiment: experimentFor(TAG_PLAN), experimentId: 'exp-2', result, now: NOW });
    const claim = buildClaim(input);
    expect(claim.subject).toBe('tag presence');
    expect(claim.analysisPlan.splitMode).toBe('binary');
    expect(claim.analysisPlan.exposureDefinition).toContain('@person:spencer');
    expect(claim.analysisPlan.minExposureContrast).toBe(1);
    expect(claim.wording).toContain('you didn\'t');
  });
});

describe('buildExperimentResultClaim — prefers a real narrative.summary when it does not trip CAUSAL_RE', () => {
  it('uses result.narrative.summary verbatim if it is already causal-language-free', () => {
    const safeSummary = 'A deterministic sentence about sleep hours and mood with no risky wording at all.';
    const result = okResult({ narrative: { summary: safeSummary, alternatives: [], whatThisDoesNotProve: [] } });
    const input = buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW });
    expect(input.wording).toBe(safeSummary);
  });
});

describe('buildExperimentResultClaim — causal-question substitution (Fix 1: no silent claim loss)', () => {
  it('substitutes a neutral questionWording when the user\'s raw question trips CAUSAL_RE (no throw, no lost claim)', () => {
    const experiment = experimentFor(SLEEP_PLAN, { question: 'Does more sleep improve my mood?' });
    const result = okResult();
    let input;
    expect(() => { input = buildExperimentResultClaim({
      experiment, experimentId: 'exp-1', result, now: NOW,
    }); }).not.toThrow();
    expect(input.questionWording).toBe('How did sleep hours and mood move together in your recorded days?');
    expect(() => buildClaim(input)).not.toThrow();
  });

  it('substitutes a neutral questionWording for another natural causal phrasing ("boost")', () => {
    const experiment = experimentFor(SLEEP_PLAN, { question: 'Does exercise boost my mood?' });
    const result = okResult();
    const input = buildExperimentResultClaim({
      experiment, experimentId: 'exp-1', result, now: NOW,
    });
    expect(input.questionWording).toBe('How did sleep hours and mood move together in your recorded days?');
    expect(() => buildClaim(input)).not.toThrow();
  });

  it('passes a neutral (non-causal) question through verbatim', () => {
    const experiment = experimentFor(SLEEP_PLAN, { question: 'What is the relationship between my sleep and mood?' });
    const result = okResult();
    const input = buildExperimentResultClaim({
      experiment, experimentId: 'exp-1', result, now: NOW,
    });
    expect(input.questionWording).toBe('What is the relationship between my sleep and mood?');
  });
});

describe('buildExperimentResultClaim — determinism (idempotent doc id)', () => {
  it('produces the SAME claim doc id for two builds of the same result', () => {
    const result = okResult();
    const input1 = buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW });
    const input2 = buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: '2026-07-23T00:00:00.000Z' });
    const id1 = claimDocId({ familyId: input1.analysisPlan.hypothesisFamilyId, candidateId: input1.analysisPlan.candidateId, version: input1.version });
    const id2 = claimDocId({ familyId: input2.analysisPlan.hypothesisFamilyId, candidateId: input2.analysisPlan.candidateId, version: input2.version });
    expect(id1).toBe(id2);
  });
});

describe('buildExperimentResultClaim — plan.ciLevel and minExposureContrast passthrough', () => {
  it('uses the plan\'s actual ciLevel when present', () => {
    const plan = { ...SLEEP_PLAN, ciLevel: 0.975 };
    const result = okResult();
    const input = buildExperimentResultClaim({ experiment: experimentFor(plan), experimentId: 'exp-1', result, now: NOW });
    expect(input.analysisPlan.ciLevel).toBe(0.975);
  });

  it('omits minExposureContrast from analysisPlan when the plan does not declare one', () => {
    const result = okResult();
    const input = buildExperimentResultClaim({ experiment: experimentFor(SLEEP_PLAN), experimentId: 'exp-1', result, now: NOW });
    expect(input.analysisPlan).not.toHaveProperty('minExposureContrast');
    expect(() => buildClaim(input)).not.toThrow();
  });
});
