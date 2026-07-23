/**
 * `buildWriterBundle` (R4 Phase 2 Task 5) — the Shared-contracts evidence
 * bundle sent to the server `writeClaimWording` callable. Pure; no
 * Firestore, no clock. See `evidenceBuilder.js`'s docblock on this function
 * and the plan's "Shared contracts" section
 * (`docs/superpowers/plans/2026-07-23-r4-phase2-trustworthy-synthesis.md`).
 */
import { describe, it, expect } from 'vitest';
import { buildWriterBundle } from '../evidenceBuilder';

// A representative complete `buildClaim` input, matching what
// `buildEvidenceForCandidate` (evidenceBuilder.js) actually produces —
// mirrors evidenceBuilder.test.js's fixture shape/values so numbers read as
// realistic, not arbitrary.
function baseClaimInput(overrides = {}) {
  return {
    claimType: 'pattern_to_watch',
    subject: 'gym',
    outcome: 'mood',
    direction: 'positive',
    questionWording: 'How did gym and mood move together in your recorded days?',
    wording: 'On days you logged gym, your recorded mood averaged 7.2 points higher (0–100 scale) than days you didn’t — 16 vs 24 days over 40 days.',
    limitations: [
      'Same-day association only — gym and mood were recorded together and something else may explain both.',
      'Recorded days only; days you didn’t journal are not represented.',
    ],
    evidence: {
      sourceEntryIds: ['e2', 'e3', 'e4'],
      hiddenSensitiveSourceCount: 2,
      totalCandidateDayCount: 40,
      exposedDayCount: 16,
      comparisonDayCount: 24,
      observedSpanDays: 40,
      exposureContrast: 0.4,
      effectMoodPoints: 7.23456,
      stabilityInterval: [2.1, 12.4],
      leaveOneDayOutDirectionStable: true,
      exposureCoverage: 0.9,
      outcomeCoverage: 0.95,
      representativeness: 'unknown',
    },
    receipt: {
      sources: [
        { entryId: 'e4', date: '2026-07-10T00:00:00.000Z', excerpt: 'Gym then coffee, good morning.' },
        { entryId: 'e3', date: '2026-07-09T00:00:00.000Z', excerpt: 'Rest day, felt a bit low.' },
        { entryId: 'e2', date: '2026-07-08T00:00:00.000Z', excerpt: 'Gym, then a long walk after.' },
        { entryId: 'e1', date: '2026-07-07T00:00:00.000Z', excerpt: 'Quiet day, read a book.' },
        { entryId: 'e0', date: '2026-07-06T00:00:00.000Z', excerpt: 'Gym in the morning, good energy.' },
        { entryId: 'e5', date: '2026-07-05T00:00:00.000Z', excerpt: 'Slept badly, low mood overall.' },
        { entryId: 'e6', date: '2026-07-04T00:00:00.000Z', excerpt: 'Gym, work was stressful though.' },
        { entryId: 'e7', date: '2026-07-03T00:00:00.000Z', excerpt: 'Cooked dinner, relaxed evening.' },
        { entryId: 'e8', date: '2026-07-02T00:00:00.000Z', excerpt: 'Gym, felt strong today.' },
        { entryId: 'e9', date: '2026-07-01T00:00:00.000Z', excerpt: 'Errands all day, tired by evening.' },
      ],
      scope: null,
      timeWindow: { start: '2026-06-01T00:00:00.000Z', end: '2026-07-10T00:00:00.000Z' },
      sampleSize: 40,
      missingness: '40 of 40 days had both gym status and a mood record',
      versions: {
        generator: 'insight_claims', computationVersion: 1, generatedAt: '2026-07-22T10:00:00.000Z', model: null, promptVersion: null,
      },
    },
    status: 'verified',
    provenance: { generatorVersion: 6, evidenceBuilderVersion: 1, wordingSource: 'deterministic_template_v1' },
    createdAt: '2026-07-22T10:00:00.000Z',
    updatedAt: '2026-07-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('buildWriterBundle', () => {
  it('maps subject/outcome/direction/claimType straight through', () => {
    const bundle = buildWriterBundle(baseClaimInput());
    expect(bundle.subject).toBe('gym');
    expect(bundle.outcome).toBe('mood');
    expect(bundle.direction).toBe('positive');
    expect(bundle.claimType).toBe('pattern_to_watch');
  });

  it('maps the five numbers fields from evidence, rounding effectMoodPoints to 1 decimal while preserving sign', () => {
    const bundle = buildWriterBundle(baseClaimInput());
    expect(bundle.numbers).toEqual({
      exposedDayCount: 16,
      comparisonDayCount: 24,
      observedSpanDays: 40,
      effectMoodPoints: 7.2, // rounded from 7.23456
      hiddenSensitiveSourceCount: 2,
    });
  });

  it('preserves a negative (signed) effectMoodPoints for a negative-direction claim', () => {
    const bundle = buildWriterBundle(baseClaimInput({
      direction: 'negative',
      evidence: { ...baseClaimInput().evidence, effectMoodPoints: -6.049 },
    }));
    expect(bundle.numbers.effectMoodPoints).toBe(-6.0);
  });

  it('copies limitations verbatim as a fresh array (not the same reference)', () => {
    const input = baseClaimInput();
    const bundle = buildWriterBundle(input);
    expect(bundle.limitations).toEqual(input.limitations);
    expect(bundle.limitations).not.toBe(input.limitations);
  });

  it('deterministicWording is exactly claimInput.wording (the style anchor, unmodified)', () => {
    const input = baseClaimInput();
    const bundle = buildWriterBundle(input);
    expect(bundle.deterministicWording).toBe(input.wording);
  });

  it('excerpts are capped at 8 even when receipt.sources has more, taking the first 8 in receipt order (already most-recent-first from buildReceipt)', () => {
    const input = baseClaimInput(); // 10 sources in the fixture
    const bundle = buildWriterBundle(input);
    expect(bundle.excerpts).toHaveLength(8);
    expect(bundle.excerpts).toEqual(
      input.receipt.sources.slice(0, 8).map((s) => ({ date: s.date, excerpt: s.excerpt })),
    );
  });

  it('excerpts drop entryId — only {date, excerpt} reach the bundle', () => {
    const bundle = buildWriterBundle(baseClaimInput());
    for (const excerpt of bundle.excerpts) {
      expect(Object.keys(excerpt).sort()).toEqual(['date', 'excerpt']);
    }
  });

  it('excerpts stay well under the callable\'s 200-char rejection threshold (receipts.js already caps at EXCERPT_MAX_LEN=120; assert no excerpt in this fixture exceeds either bound)', () => {
    const bundle = buildWriterBundle(baseClaimInput());
    for (const { excerpt } of bundle.excerpts) {
      expect(excerpt.length).toBeLessThanOrEqual(120);
      expect(excerpt.length).toBeLessThan(200);
    }
  });

  it('an empty/missing receipt.sources produces an empty excerpts array, not a throw', () => {
    const bundle1 = buildWriterBundle(baseClaimInput({ receipt: { ...baseClaimInput().receipt, sources: [] } }));
    expect(bundle1.excerpts).toEqual([]);
    const bundle2 = buildWriterBundle(baseClaimInput({ receipt: {} }));
    expect(bundle2.excerpts).toEqual([]);
  });

  it('missing limitations produces an empty array rather than throwing', () => {
    const bundle = buildWriterBundle(baseClaimInput({ limitations: undefined }));
    expect(bundle.limitations).toEqual([]);
  });

  it('is pure: does not mutate the input claimInput', () => {
    const input = baseClaimInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    buildWriterBundle(input);
    expect(input).toEqual(snapshot);
  });

  it('is deterministic: same input -> deeply equal output', () => {
    const input = baseClaimInput();
    expect(buildWriterBundle(input)).toEqual(buildWriterBundle(input));
  });
});
