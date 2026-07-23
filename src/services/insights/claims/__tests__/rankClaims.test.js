import { describe, it, expect } from 'vitest';
import { rankClaims, rankScore, recencyBoost, TYPE_WEIGHT } from '../rankClaims';

const NOW = new Date('2026-07-23T00:00:00.000Z').getTime();

function claim({
  id,
  claimType,
  effectMoodPoints = 5,
  createdAt = '2026-07-20T00:00:00.000Z',
}) {
  return {
    id,
    claimType,
    createdAt,
    evidence: { effectMoodPoints },
  };
}

describe('recencyBoost', () => {
  it('is 999 for a claim created right now', () => {
    expect(recencyBoost('2026-07-23T00:00:00.000Z', NOW)).toBe(999);
  });

  it('decreases monotonically as createdAt gets older', () => {
    const oneDayAgo = recencyBoost('2026-07-22T00:00:00.000Z', NOW);
    const tenDaysAgo = recencyBoost('2026-07-13T00:00:00.000Z', NOW);
    expect(oneDayAgo).toBeLessThan(999);
    expect(tenDaysAgo).toBeLessThan(oneDayAgo);
  });

  it('clamps at 0 for a claim older than 999 days', () => {
    expect(recencyBoost('2020-01-01T00:00:00.000Z', NOW)).toBe(0);
  });

  it('clamps at 999 for a future createdAt (clock skew)', () => {
    expect(recencyBoost('2030-01-01T00:00:00.000Z', NOW)).toBe(999);
  });

  it('resolves an unparseable createdAt to 0 rather than throwing', () => {
    expect(recencyBoost('not-a-date', NOW)).toBe(0);
    expect(recencyBoost(undefined, NOW)).toBe(0);
  });
});

describe('rankScore', () => {
  it('weights claimType above effect size and recency (1e6 step)', () => {
    const experiment = claim({ id: 'a', claimType: 'experiment_result', effectMoodPoints: 0.1, createdAt: '2020-01-01T00:00:00.000Z' });
    const pattern = claim({ id: 'b', claimType: 'pattern_to_watch', effectMoodPoints: 50, createdAt: '2026-07-23T00:00:00.000Z' });
    expect(rankScore(experiment, { now: NOW })).toBeGreaterThan(rankScore(pattern, { now: NOW }));
  });

  it('weights effect size above recency within the same type (1e3 step)', () => {
    const bigEffect = claim({ id: 'a', claimType: 'observation', effectMoodPoints: 10, createdAt: '2020-01-01T00:00:00.000Z' });
    const smallEffect = claim({ id: 'b', claimType: 'observation', effectMoodPoints: 1, createdAt: '2026-07-23T00:00:00.000Z' });
    expect(rankScore(bigEffect, { now: NOW })).toBeGreaterThan(rankScore(smallEffect, { now: NOW }));
  });

  it('caps the effect-size contribution at 50 points', () => {
    const cappedAt50 = claim({ id: 'a', claimType: 'observation', effectMoodPoints: 50 });
    const wayOver = claim({ id: 'b', claimType: 'observation', effectMoodPoints: 500 });
    expect(rankScore(cappedAt50, { now: NOW })).toBe(rankScore(wayOver, { now: NOW }));
  });

  it('uses the absolute value of effectMoodPoints (negative direction ranks the same as positive)', () => {
    const positive = claim({ id: 'a', claimType: 'observation', effectMoodPoints: 8 });
    const negative = claim({ id: 'b', claimType: 'observation', effectMoodPoints: -8 });
    expect(rankScore(positive, { now: NOW })).toBe(rankScore(negative, { now: NOW }));
  });

  it('treats an unrecognized claimType as weight 0 (never throws, ranks lowest)', () => {
    const unknown = claim({ id: 'a', claimType: 'mystery' });
    expect(rankScore(unknown, { now: NOW })).toBeLessThan(TYPE_WEIGHT.observation * 1e6);
  });
});

describe('rankClaims', () => {
  it('orders by claimType weight first: experiment_result > pattern_to_watch > observation', () => {
    const observation = claim({ id: 'obs-1', claimType: 'observation', effectMoodPoints: 40 });
    const pattern = claim({ id: 'pat-1', claimType: 'pattern_to_watch', effectMoodPoints: 1 });
    const experiment = claim({ id: 'exp-1', claimType: 'experiment_result', effectMoodPoints: 0.5 });

    const ranked = rankClaims([observation, pattern, experiment], { now: NOW });
    expect(ranked.map((c) => c.id)).toEqual(['exp-1', 'pat-1', 'obs-1']);
  });

  it('orders by |effectMoodPoints| within the same type', () => {
    const small = claim({ id: 'small', claimType: 'pattern_to_watch', effectMoodPoints: 2 });
    const large = claim({ id: 'large', claimType: 'pattern_to_watch', effectMoodPoints: 12 });
    const medium = claim({ id: 'medium', claimType: 'pattern_to_watch', effectMoodPoints: 6 });

    const ranked = rankClaims([small, large, medium], { now: NOW });
    expect(ranked.map((c) => c.id)).toEqual(['large', 'medium', 'small']);
  });

  it('orders by recency within the same type and effect size', () => {
    const older = claim({ id: 'older', claimType: 'observation', effectMoodPoints: 5, createdAt: '2026-06-01T00:00:00.000Z' });
    const newer = claim({ id: 'newer', claimType: 'observation', effectMoodPoints: 5, createdAt: '2026-07-20T00:00:00.000Z' });

    const ranked = rankClaims([older, newer], { now: NOW });
    expect(ranked.map((c) => c.id)).toEqual(['newer', 'older']);
  });

  it('breaks a full tie by createdAt desc, then id ascending — deterministic regardless of input order', () => {
    const a = claim({ id: 'zzz', claimType: 'observation', effectMoodPoints: 5, createdAt: '2026-07-20T00:00:00.000Z' });
    const b = claim({ id: 'aaa', claimType: 'observation', effectMoodPoints: 5, createdAt: '2026-07-20T00:00:00.000Z' });

    const rankedOneOrder = rankClaims([a, b], { now: NOW });
    const rankedOtherOrder = rankClaims([b, a], { now: NOW });
    expect(rankedOneOrder.map((c) => c.id)).toEqual(['aaa', 'zzz']);
    expect(rankedOtherOrder.map((c) => c.id)).toEqual(['aaa', 'zzz']);
  });

  it('is deterministic across repeated calls on the same input', () => {
    const claims = [
      claim({ id: 'a', claimType: 'observation', effectMoodPoints: 3, createdAt: '2026-07-01T00:00:00.000Z' }),
      claim({ id: 'b', claimType: 'experiment_result', effectMoodPoints: 9, createdAt: '2026-06-01T00:00:00.000Z' }),
      claim({ id: 'c', claimType: 'pattern_to_watch', effectMoodPoints: 3, createdAt: '2026-07-10T00:00:00.000Z' }),
    ];

    const first = rankClaims(claims, { now: NOW }).map((c) => c.id);
    const second = rankClaims(claims, { now: NOW }).map((c) => c.id);
    expect(first).toEqual(second);
  });

  it('does not mutate the input array', () => {
    const claims = [
      claim({ id: 'a', claimType: 'observation' }),
      claim({ id: 'b', claimType: 'experiment_result' }),
    ];
    const original = [...claims];
    rankClaims(claims, { now: NOW });
    expect(claims).toEqual(original);
  });

  it('returns an empty array for non-array input', () => {
    expect(rankClaims(null)).toEqual([]);
    expect(rankClaims(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty input array', () => {
    expect(rankClaims([], { now: NOW })).toEqual([]);
  });
});
