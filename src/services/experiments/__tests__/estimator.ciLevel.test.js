import { describe, it, expect } from 'vitest';
import { runAnalysisPlan } from '../estimator';

// 24 paired days, clear 2-group structure, enough for a stable bootstrap.
// NOTE: exposure carries a tiny deterministic per-index jitter (i * 0.001) on
// top of the two group centers (8 / 5). Without it, exposure only ever takes
// the two exact values 8 and 5, and a bootstrap resample that happens to draw
// entirely from one original value produces a fully degenerate median split
// (empty high or low group) — with only two-valued exposure this happens on
// ~40% of resamples for this seed, tripping `split_unstable` regardless of
// ciLevel. The jitter keeps every exposure value distinct so an
// all-one-cluster resample still has internal spread and splits cleanly,
// while leaving the group means (and therefore the delta/CI) effectively
// unchanged from the two-value version.
const pairs = Array.from({ length: 24 }, (_, i) => ({
  dateKey: `2026-06-${String(i + 1).padStart(2, '0')}`,
  outcomeDateKey: `2026-06-${String(i + 1).padStart(2, '0')}`,
  exposure: (i % 2 === 0 ? 8 : 5) + i * 0.001,
  outcome: (i % 2 === 0 ? 70 : 55) + (i % 3), // deterministic jitter
}));

describe('runAnalysisPlan plan.ciLevel', () => {
  it('default (no ciLevel) reproduces the existing 0.95 interval exactly', () => {
    const base = runAnalysisPlan({ pairs, plan: {} });
    const explicit = runAnalysisPlan({ pairs, plan: { ciLevel: 0.95 } });
    expect(base.status).toBe('ok');
    expect(explicit.estimate.ci).toEqual(base.estimate.ci);
  });

  it('a higher ciLevel produces a strictly wider interval', () => {
    // Strict (not >=): with ciLevel wired up and this fixture/seed the 0.995
    // percentile bounds are strictly outside the 0.95 ones. A >= assertion
    // would pass trivially pre-implementation too (both calls ignore
    // plan.ciLevel and return byte-identical CIs, so equal widths satisfy
    // >=) — that would not be a real RED test.
    const p95 = runAnalysisPlan({ pairs, plan: { ciLevel: 0.95 } });
    const p995 = runAnalysisPlan({ pairs, plan: { ciLevel: 0.995 } });
    const width = (r) => r.estimate.ci[1] - r.estimate.ci[0];
    expect(width(p995)).toBeGreaterThan(width(p95));
  });

  it('invalid ciLevel values fall back to the default', () => {
    for (const bad of [0, 1, -1, 2, NaN, 'wide']) {
      const r = runAnalysisPlan({ pairs, plan: { ciLevel: bad } });
      expect(r.estimate.ci).toEqual(runAnalysisPlan({ pairs, plan: {} }).estimate.ci);
    }
  });
});
