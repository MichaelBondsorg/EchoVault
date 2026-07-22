/**
 * R4 Task 1: countUniqueDays / computeComplementBaseline tests.
 *
 * computeComplementBaseline math is hand-computed here (not just asserted
 * against the implementation) per the R4 plan's "complement-baseline math
 * (hand-computed fixture)" requirement.
 */
import { describe, it, expect } from 'vitest';
import { countUniqueDays, computeComplementBaseline } from '../statisticalHelpers';

describe('countUniqueDays', () => {
  it('counts distinct dateKeys, collapsing same-day repeats', () => {
    const items = [
      { dateKey: '2026-07-01' },
      { dateKey: '2026-07-01' },
      { dateKey: '2026-07-02' },
      { dateKey: '2026-07-03' },
    ];
    expect(countUniqueDays(items)).toBe(3);
  });

  it('ignores entries with no dateKey', () => {
    expect(countUniqueDays([{ dateKey: null }, { dateKey: undefined }, {}])).toBe(0);
  });

  it('returns 0 for an empty/undefined list', () => {
    expect(countUniqueDays([])).toBe(0);
    expect(countUniqueDays(undefined)).toBe(0);
  });
});

describe('computeComplementBaseline', () => {
  it('hand-computed: present=[0.9,0.8,0.9,0.9] (avg 0.875), absent=[0.5,0.4,0.6] (avg 0.5) -> delta = round((0.875-0.5)*100) = 38', () => {
    const result = computeComplementBaseline({
      presentMoods: [0.9, 0.8, 0.9, 0.9],
      absentMoods: [0.5, 0.4, 0.6],
    });
    expect(result.insufficient).toBe(false);
    expect(result.presentMood).toBeCloseTo(0.875);
    expect(result.absentMood).toBeCloseTo(0.5);
    expect(result.moodDelta).toBe(38);
  });

  it('is insufficient (never a fabricated zero-delta) when the absent group is empty', () => {
    const result = computeComplementBaseline({ presentMoods: [0.9, 0.8], absentMoods: [] });
    expect(result.insufficient).toBe(true);
    expect(result.moodDelta).toBeNull();
  });

  it('is insufficient when the present group is empty', () => {
    const result = computeComplementBaseline({ presentMoods: [], absentMoods: [0.5, 0.4] });
    expect(result.insufficient).toBe(true);
    expect(result.moodDelta).toBeNull();
  });

  it('is insufficient when both groups are empty/undefined', () => {
    expect(computeComplementBaseline({}).insufficient).toBe(true);
    expect(computeComplementBaseline(undefined).insufficient).toBe(true);
  });

  it('never returns a delta computed against a fabricated average([])===0 baseline', () => {
    // Regression guard for the healthCorrelations-class bug: if this used
    // average([]) -> 0 as the "absent" baseline, a present-only group would
    // read as a huge (fabricated) positive delta instead of insufficient.
    const result = computeComplementBaseline({ presentMoods: [0.9, 0.9, 0.9], absentMoods: [] });
    expect(result.insufficient).toBe(true);
    expect(result.absentMood).toBeNull();
  });
});
