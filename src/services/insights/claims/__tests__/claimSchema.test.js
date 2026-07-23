import { describe, it, expect } from 'vitest';
import { buildClaim, claimDocId, CLAIM_TYPES, CLAIM_STATUSES, CLAIM_TOP_LEVEL_KEYS } from '../claimSchema';

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
});
