/**
 * In-process smoke test for the INT-01 corpus harness (../__evals__/
 * runCorpusEval.js), run in --replay mode against the COMMITTED fixture
 * (corpus/replayFixture.json) — the same hermetic path CI/the `npx vitest`
 * verification command exercises, just invoked as a function instead of a
 * CLI subprocess so failures show up as normal vitest assertions.
 *
 * This is intentionally NOT a "corpus scores >= X%" gate: the committed
 * fixture is a hand-authored stand-in for a captured-from-a-live-run
 * snapshot (see replayFixture.json's `_meta.provenance`) and deliberately
 * contains three known imperfections to exercise the scoring machinery
 * end-to-end (see `_meta.intentionalImperfections`). What this suite DOES
 * assert as a hard invariant is the precision-first trust contract: zero
 * misfires — no hard-negative case may ever surface as active/suggested,
 * no matter what else changes in the fixture.
 */
import { describe, it, expect } from 'vitest';
import { runCorpusEval, loadCorpus, loadReplayFixture, formatReport } from '../__evals__/runCorpusEval.js';

describe('runCorpusEval — replay mode against the committed fixture', () => {
  const cases = loadCorpus();
  const replayFixture = loadReplayFixture();

  it('has a corpus of 30-50 labeled cases per INT-01', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(cases.length).toBeLessThanOrEqual(50);
  });

  it('every case has at least one zero-intent representative (the empty case matters for precision)', () => {
    const zeroIntentCases = cases.filter((c) => (c.expectedIntents || []).length === 0);
    expect(zeroIntentCases.length).toBeGreaterThanOrEqual(3);
  });

  it('runs end-to-end through the REAL extraction + policy pipeline without throwing', async () => {
    const { caseResults, report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(caseResults).toHaveLength(cases.length);
    expect(report.totalCases).toBe(cases.length);
  });

  it('NEVER surfaces a hard-negative case as active/suggested (zero misfires — the trust contract)', async () => {
    const { report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(report.confusion.misfires).toEqual([]);
  });

  it('reproduces exactly the three intentional imperfections documented in the fixture', async () => {
    const { report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(report.confusion.hallucinations).toEqual([{ caseId: 'zero-2', kind: 'task' }]);
    expect(report.confusion.misses.some((m) => m.caseId === 'temporal-4' && m.detail === 'not-proposed')).toBe(true);
    expect(report.confusion.kindConfusions.filter((k) => k.caseId === 'openloop-clear-3')).toHaveLength(2);
  });

  it('produces per-kind precision/recall for both surfaceable kinds', async () => {
    const { report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(report.perKind.task).toBeDefined();
    expect(report.perKind.open_loop).toBeDefined();
    for (const stats of Object.values(report.perKind)) {
      expect(stats.precision).toBeGreaterThanOrEqual(0);
      expect(stats.precision).toBeLessThanOrEqual(1);
      expect(stats.recall).toBeGreaterThanOrEqual(0);
      expect(stats.recall).toBeLessThanOrEqual(1);
    }
  });

  it('overall precision stays high despite the injected imperfections (single-digit false-positive count)', async () => {
    const { report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(report.overall.fp).toBeLessThanOrEqual(3);
    expect(report.overall.precision).toBeGreaterThan(0.8);
  });

  it('formatReport renders a non-empty table including the per-kind header and overall line', async () => {
    const { report } = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    const text = formatReport(report, { mode: 'replay' });
    expect(text).toContain('Overall:');
    expect(text).toContain('precision');
    expect(text).toContain('recall');
  });

  it('is deterministic: two runs over the same fixture produce byte-identical reports', async () => {
    const runA = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    const runB = await runCorpusEval({ cases, mode: 'replay', replayFixture });
    expect(runA.report).toEqual(runB.report);
  });

  it('rejects an invalid mode', async () => {
    await expect(runCorpusEval({ cases, mode: 'bogus' })).rejects.toThrow(/mode must be/);
  });

  it('rejects --live mode without an apiKey', async () => {
    await expect(runCorpusEval({ cases, mode: 'live' })).rejects.toThrow(/apiKey/);
  });

  it('rejects --replay mode without a replayFixture', async () => {
    await expect(runCorpusEval({ cases, mode: 'replay' })).rejects.toThrow(/replayFixture/);
  });

  it('throws a clear error when a replay fixture entry is missing for a case', async () => {
    const oneCase = [{ id: 'no-such-fixture', text: 'anything', expectedIntents: [] }];
    await expect(runCorpusEval({ cases: oneCase, mode: 'replay', replayFixture: {} })).rejects.toThrow(/no replay fixture entry/);
  });

  it('throws when the corpus text has drifted from the fixture it was captured against', async () => {
    const oneCase = [{ id: 'task-clear-1', text: 'this text does not match the fixture anymore', expectedIntents: [] }];
    await expect(runCorpusEval({ cases: oneCase, mode: 'replay', replayFixture })).rejects.toThrow(/fixture mismatch/);
  });
});
