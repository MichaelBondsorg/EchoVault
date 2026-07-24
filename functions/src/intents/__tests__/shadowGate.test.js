/**
 * Deterministic unit tests for the INT-01 shadow-gate scaffolding
 * (../__evals__/shadowGate.js). Uses hand-built synthetic runProduction/
 * runCandidate functions — no model calls, no fixtures, no I/O — so this
 * suite is fully hermetic and asserts the diff math directly.
 */
import { describe, it, expect } from 'vitest';
import { runShadowComparison, diffReports, formatShadowReport } from '../__evals__/shadowGate.js';

const CASES = [
  { id: 'c1', expectedIntents: [{ kind: 'task', expectedState: 'active', evidenceContains: 'call the dentist' }] },
  { id: 'c2', expectedIntents: [{ kind: 'task', expectedState: 'abstain', evidenceContains: 'go for a run' }] },
  { id: 'c3', expectedIntents: [{ kind: 'open_loop', expectedState: 'active', evidenceContains: 'remind me' }] },
];

describe('runShadowComparison', () => {
  it('scores production and candidate independently and reports no diff when they agree', async () => {
    const runBoth = async (c) => {
      if (c.id === 'c1') return [{ kind: 'task', text: 'call the dentist', state: 'active' }];
      if (c.id === 'c2') return [{ kind: 'task', text: 'go for a run', state: 'abstain' }];
      return [{ kind: 'open_loop', text: 'remind me', state: 'active' }];
    };
    const { productionReport, candidateReport, regressions, improvements } = await runShadowComparison({
      cases: CASES,
      runProduction: runBoth,
      runCandidate: runBoth,
    });
    expect(productionReport.overall).toEqual(candidateReport.overall);
    expect(regressions).toEqual([]);
    expect(improvements).toEqual([]);
  });

  it('flags a regression when the candidate introduces a misfire production did not have', async () => {
    const runProduction = async (c) => {
      if (c.id === 'c2') return [{ kind: 'task', text: 'go for a run', state: 'abstain' }]; // correct
      return [];
    };
    const runCandidate = async (c) => {
      if (c.id === 'c2') return [{ kind: 'task', text: 'go for a run', state: 'active' }]; // misfire!
      return [];
    };
    const { regressions } = await runShadowComparison({ cases: [CASES[1]], runProduction, runCandidate });
    expect(regressions).toHaveLength(1);
    expect(regressions[0].kind).toBe('task');
    expect(regressions[0].dPrecision).toBeLessThan(0);
  });

  it('flags an improvement when the candidate recovers a recall miss production had', async () => {
    const runProduction = async () => []; // production never proposes it -> fn
    const runCandidate = async () => [{ kind: 'task', text: 'call the dentist', state: 'active' }]; // candidate does
    const { improvements } = await runShadowComparison({ cases: [CASES[0]], runProduction, runCandidate });
    expect(improvements).toHaveLength(1);
    expect(improvements[0].kind).toBe('task');
    expect(improvements[0].dRecall).toBeGreaterThan(0);
  });

  it('runs production and candidate for the same case concurrently, not sequentially by side', async () => {
    const order = [];
    const runProduction = async (c) => { order.push(`prod:${c.id}`); return []; };
    const runCandidate = async (c) => { order.push(`cand:${c.id}`); return []; };
    await runShadowComparison({ cases: CASES, runProduction, runCandidate });
    // Both sides of case c1 must appear before either side of c2 begins (per-case Promise.all).
    const c1ProdIdx = order.indexOf('prod:c1');
    const c1CandIdx = order.indexOf('cand:c1');
    const c2Idx = Math.min(order.indexOf('prod:c2'), order.indexOf('cand:c2'));
    expect(Math.max(c1ProdIdx, c1CandIdx)).toBeLessThan(c2Idx);
  });
});

describe('diffReports', () => {
  it('treats a kind present only on one side as a perfect (1.0/1.0) baseline on the other', () => {
    const production = { perKind: {} };
    const candidate = { perKind: { task: { tp: 1, fp: 0, fn: 0, precision: 1, recall: 1 } } };
    const { regressions, improvements } = diffReports(production, candidate);
    expect(regressions).toEqual([]);
    expect(improvements).toEqual([]);
  });

  it('detects a recall regression even when precision is unchanged', () => {
    const production = { perKind: { task: { precision: 1, recall: 1 } } };
    const candidate = { perKind: { task: { precision: 1, recall: 0.5 } } };
    const { regressions } = diffReports(production, candidate);
    expect(regressions).toEqual([{ kind: 'task', dPrecision: 0, dRecall: -0.5, production: production.perKind.task, candidate: candidate.perKind.task }]);
  });

  it('sorts regressions and improvements deterministically by kind', () => {
    const production = { perKind: { task: { precision: 1, recall: 1 }, open_loop: { precision: 1, recall: 1 } } };
    const candidate = { perKind: { task: { precision: 0.5, recall: 1 }, open_loop: { precision: 0.5, recall: 1 } } };
    const { regressions } = diffReports(production, candidate);
    expect(regressions.map((r) => r.kind)).toEqual(['open_loop', 'task']);
  });
});

describe('formatShadowReport', () => {
  it('reports a clean pass when there are no regressions', () => {
    const text = formatShadowReport({ regressions: [], improvements: [] });
    expect(text).toContain('0 regression(s)');
    expect(text).toContain('clears the shadow-gate scaffold check');
  });

  it('lists each regression and improvement on its own line', () => {
    const text = formatShadowReport({
      regressions: [{ kind: 'task', dPrecision: -0.1, dRecall: 0 }],
      improvements: [{ kind: 'open_loop', dPrecision: 0, dRecall: 0.2 }],
    });
    expect(text).toContain('REGRESSION [task]');
    expect(text).toContain('IMPROVED   [open_loop]');
  });
});
