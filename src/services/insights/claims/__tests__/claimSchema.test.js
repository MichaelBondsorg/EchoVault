import { describe, it, expect } from 'vitest';
import {
  buildClaim, claimDocId, CLAIM_TYPES, CLAIM_STATUSES, CLAIM_TOP_LEVEL_KEYS, CAUSAL_RE,
} from '../claimSchema';

const NOW = '2026-07-22T10:00:00.000Z';
const validPlan = {
  frozenAt: NOW, hypothesisFamilyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym',
  candidateTestsCount: 4, ciLevel: 0.9875, outcomeUnit: 'mood_0_100', timezone: 'America/Los_Angeles',
  datePolicy: 'user_local_calendar_day', exposureDefinition: 'day includes tag "gym"',
  outcomeDefinition: 'daily mean mood (0-100)', lagDays: 0, splitMode: 'binary',
  minExposureContrast: 0, minimumTotalDays: 14, minimumSpanDays: 21,
  practicalEffectFloorMoodPoints: 5, adapterVersion: 1, observationSchemaVersion: 1,
  evidenceBuilderVersion: 1,
  estimatorThresholds: { minPairedObservations: 10, minGroupSize: 5, minGroupFraction: 0.25, bootstrapResamples: 2000 },
};
const validEvidence = {
  sourceEntryIds: ['e1', 'e2'], hiddenSensitiveSourceCount: 1,
  totalCandidateDayCount: 24, exposedDayCount: 9, comparisonDayCount: 15,
  observedSpanDays: 34, exposureContrast: 1, effectMoodPoints: 7.2,
  stabilityInterval: [2.1, 12.3], leaveOneDayOutDirectionStable: true,
  exposureCoverage: 0.8, outcomeCoverage: 0.75, representativeness: 'unknown',
};
const valid = () => ({
  version: 1, parentClaimId: null, claimType: 'pattern_to_watch',
  subject: 'gym', outcome: 'mood', direction: 'positive',
  questionWording: 'How did gym days and mood move together in your recorded days?',
  wording: 'On days you logged gym, recorded mood averaged 7 points higher (9 vs 15 days).',
  limitations: ['Same-day association only.'],
  analysisPlan: validPlan, evidence: validEvidence,
  receipt: { sources: [], scope: null, timeWindow: { start: NOW, end: NOW }, sampleSize: 24, missingness: null, versions: { generator: 'insight_claims', computationVersion: 1, generatedAt: NOW, model: null, promptVersion: null } },
  status: 'verified',
  provenance: { generatorVersion: 2, evidenceBuilderVersion: 1, wordingSource: 'deterministic_template_v1' },
  createdAt: NOW, updatedAt: NOW,
});

describe('buildClaim', () => {
  it('accepts a fully valid claim and stamps id + supersededByClaimId:null', () => {
    const claim = buildClaim(valid());
    expect(claim.id).toBe(claimDocId({ familyId: validPlan.hypothesisFamilyId, candidateId: validPlan.candidateId, version: 1 }));
    expect(claim.supersededByClaimId).toBeNull();
  });
  it('rejects unknown claimType/status/direction', () => {
    expect(() => buildClaim({ ...valid(), claimType: 'insight' })).toThrow();
    expect(() => buildClaim({ ...valid(), status: 'shipped' })).toThrow();
    expect(() => buildClaim({ ...valid(), direction: 'mixed' })).toThrow();
  });
  it('rejects causal verbs in wording/questionWording (communication integrity, DR gate 7)', () => {
    for (const bad of ['gym boosts your mood', 'walking causes better mood', 'sleep improves your mood']) {
      expect(() => buildClaim({ ...valid(), wording: bad })).toThrow(/causal/i);
    }
  });
  it('rejects evidence with non-finite numbers or missing reconciliation fields', () => {
    expect(() => buildClaim({ ...valid(), evidence: { ...validEvidence, effectMoodPoints: NaN } })).toThrow();
    const { hiddenSensitiveSourceCount, ...rest } = validEvidence;
    expect(() => buildClaim({ ...valid(), evidence: rest })).toThrow(/hiddenSensitiveSourceCount/);
  });
  it('rejects a plan whose frozenAt is missing (design validity, DR gate 2)', () => {
    const { frozenAt, ...plan } = validPlan;
    expect(() => buildClaim({ ...valid(), analysisPlan: plan })).toThrow(/frozenAt/);
  });
  it('CLAIM_TOP_LEVEL_KEYS matches exactly the keys buildClaim emits (rules parity source)', () => {
    expect(Object.keys(buildClaim(valid())).sort()).toEqual([...CLAIM_TOP_LEVEL_KEYS].sort());
  });

  it('rejects version 1 with a non-null parentClaimId (lineage integrity)', () => {
    expect(() => buildClaim({ ...valid(), version: 1, parentClaimId: 'claim_prior_v1' })).toThrow();
  });

  it('rejects version 2 with a null parentClaimId (lineage integrity)', () => {
    expect(() => buildClaim({
      ...valid(), version: 2, parentClaimId: null, analysisPlan: { ...validPlan, candidateId: 'tag:gym' },
    })).toThrow();
  });

  it('rejects an unknown key in evidence (closes the nested-map seam)', () => {
    expect(() => buildClaim({
      ...valid(), evidence: { ...validEvidence, note: 'gym causes better mood' },
    })).toThrow(/note/);
  });

  it('rejects an unknown key in analysisPlan (closes the nested-map seam)', () => {
    expect(() => buildClaim({
      ...valid(), analysisPlan: { ...validPlan, sneaky: 'gym causes better mood' },
    })).toThrow(/sneaky/);
  });

  it('rejects causal verbs in limitations (communication integrity extends beyond wording)', () => {
    expect(() => buildClaim({
      ...valid(), limitations: ['Same-day association only.', 'This clearly causes lower motivation.'],
    })).toThrow(/causal/i);
  });

  it('accepts a negated-causal disclaimer in limitations (negation-aware check, adjudicated option c)', () => {
    expect(() => buildClaim({
      ...valid(),
      limitations: ['This does not show that sleep hours caused the change in mood.'],
    })).not.toThrow();
  });

  it('still rejects an affirmative (non-negated) causal claim in limitations', () => {
    expect(() => buildClaim({
      ...valid(), limitations: ['Sleep causes better mood.'],
    })).toThrow(/causal/i);
  });

  it('rejects a limitation that smuggles an affirmative causal claim before a negated clause', () => {
    expect(() => buildClaim({
      ...valid(), limitations: ['Sleep boosts mood but this does not prove it.'],
    })).toThrow(/causal/i);
  });

  it('still rejects negated-causal phrasing in wording/questionWording (strictness unchanged there)', () => {
    expect(() => buildClaim({
      ...valid(), wording: 'This does not show that sleep hours caused the change in mood.',
    })).toThrow(/causal/i);
    expect(() => buildClaim({
      ...valid(), questionWording: 'This does not show that sleep hours caused the change in mood.',
    })).toThrow(/causal/i);
  });

  it('returns a deep-frozen claim (immutable fact once built)', () => {
    const claim = buildClaim(valid());
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.evidence)).toBe(true);
    expect(Object.isFrozen(claim.evidence.stabilityInterval)).toBe(true);
    expect(Object.isFrozen(claim.analysisPlan)).toBe(true);
    expect(Object.isFrozen(claim.analysisPlan.estimatorThresholds)).toBe(true);
    expect(Object.isFrozen(claim.limitations)).toBe(true);
    expect(Object.isFrozen(claim.provenance)).toBe(true);
    expect(() => { claim.status = 'suppressed'; }).toThrow(TypeError);
  });
});

describe('buildClaim — sourceExperimentId/sourceCompletedAt (final review Important 1, closure wave: run-identity fix)', () => {
  it('a plan with neither key still builds fine (optional — pipeline/basic: claims and legacy experiment claims never carry them)', () => {
    const claim = buildClaim(valid());
    expect(claim.analysisPlan).not.toHaveProperty('sourceExperimentId');
    expect(claim.analysisPlan).not.toHaveProperty('sourceCompletedAt');
  });

  it('accepts both keys as non-empty strings', () => {
    const plan = { ...validPlan, sourceExperimentId: 'exp-1', sourceCompletedAt: '2026-07-01T00:00:00.000Z' };
    const claim = buildClaim({ ...valid(), analysisPlan: plan });
    expect(claim.analysisPlan.sourceExperimentId).toBe('exp-1');
    expect(claim.analysisPlan.sourceCompletedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects a non-string/empty sourceExperimentId when present', () => {
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceExperimentId: '' } })).toThrow(/sourceExperimentId/);
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceExperimentId: 42 } })).toThrow(/sourceExperimentId/);
  });

  it('rejects a non-string/empty sourceCompletedAt when present', () => {
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceCompletedAt: '' } })).toThrow(/sourceCompletedAt/);
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceCompletedAt: 42 } })).toThrow(/sourceCompletedAt/);
  });

  it('accepts one key present without the other (independently optional)', () => {
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceExperimentId: 'exp-1' } })).not.toThrow();
    expect(() => buildClaim({ ...valid(), analysisPlan: { ...validPlan, sourceCompletedAt: '2026-07-01T00:00:00.000Z' } })).not.toThrow();
  });
});

describe('CAUSAL_RE export', () => {
  it('is exported for reuse by other claim-producing modules (e.g. experimentClaim.js)', () => {
    expect(CAUSAL_RE.test('this causes better mood')).toBe(true);
    expect(CAUSAL_RE.test('a neutral sentence')).toBe(false);
  });
});

describe('claimDocId', () => {
  it('produces different ids for candidateIds that collide under fold-only slugging', () => {
    const a = claimDocId({ familyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym-time', version: 1 });
    const b = claimDocId({ familyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym_time', version: 1 });
    expect(a).not.toBe(b);
  });

  it('is deterministic for identical inputs', () => {
    const a = claimDocId({ familyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym', version: 2 });
    const b = claimDocId({ familyId: 'basic:activity:tag:gym:mood', candidateId: 'tag:gym', version: 2 });
    expect(a).toBe(b);
  });
});
