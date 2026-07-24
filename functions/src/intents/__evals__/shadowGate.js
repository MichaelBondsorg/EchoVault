/**
 * Shadow-mode gate SCAFFOLDING (INT-01).
 *
 * Infrastructure only: runs a CANDIDATE extractor configuration alongside a
 * PRODUCTION configuration over the same corpus, entirely offline/in-memory,
 * and reports the score delta plus a per-case output diff. This is the
 * harness an engineer runs BEFORE proposing a prompt/model change: does the
 * candidate regress precision or recall on ANY intent kind versus
 * production?
 *
 * Explicitly NOT in scope here (and not built by this task): the runtime
 * shadow-mode FEATURE described in the product review — running a candidate
 * model against real live production traffic without activating it, which
 * would need a background job, a comparison log collection, and a flag.
 * This module never touches Firestore, never flips a flag, and produces no
 * user-visible side effect; its only output is an in-memory diff object /
 * console report for a human (or a future CI step) to read.
 */
import { scoreCorpus } from './corpusScoring.js';

/**
 * Runs the corpus through two configurations and scores each independently.
 * `runProduction`/`runCandidate` are async (case) => predicted[] — typically
 * a thin wrapper around runCorpusEval.js's `runCase` bound to a particular
 * mode/model/fixture, but intentionally left generic here so the caller
 * decides how each side sources its output (live model, a replay fixture, a
 * hand-built stub for a unit test, ...).
 *
 * @param {object} opts
 * @param {Array} opts.cases - corpus cases (see corpus/cases.json)
 * @param {(testCase: object) => Promise<Array>} opts.runProduction
 * @param {(testCase: object) => Promise<Array>} opts.runCandidate
 * @returns {Promise<{productionReport: object, candidateReport: object, regressions: Array, improvements: Array}>}
 */
export async function runShadowComparison({ cases, runProduction, runCandidate }) {
  const productionResults = [];
  const candidateResults = [];
  for (const c of cases) {
    const [prodPredicted, candPredicted] = await Promise.all([runProduction(c), runCandidate(c)]);
    productionResults.push({ caseId: c.id, expectedIntents: c.expectedIntents, predicted: prodPredicted });
    candidateResults.push({ caseId: c.id, expectedIntents: c.expectedIntents, predicted: candPredicted });
  }
  const productionReport = scoreCorpus(productionResults);
  const candidateReport = scoreCorpus(candidateResults);
  const { regressions, improvements } = diffReports(productionReport, candidateReport);
  return { productionReport, candidateReport, regressions, improvements };
}

/**
 * Compares two scoreCorpus() reports kind-by-kind. A kind present in only
 * one report is treated as a perfect (1.0/1.0) baseline on the missing side
 * so an entirely-new or entirely-retired kind doesn't produce a divide-by-
 * nothing artifact.
 *
 * `regressions` lists every kind where the candidate's precision OR recall
 * is strictly lower than production's — the signal a future automated gate
 * would block a rollout on. `improvements` is the mirror image, for
 * visibility (recall improving at the cost of nothing is worth knowing too).
 *
 * @param {object} productionReport - output of scoreCorpus()
 * @param {object} candidateReport - output of scoreCorpus()
 * @returns {{regressions: Array, improvements: Array}}
 */
export function diffReports(productionReport, candidateReport) {
  const kinds = new Set([...Object.keys(productionReport.perKind || {}), ...Object.keys(candidateReport.perKind || {})]);
  const regressions = [];
  const improvements = [];
  for (const kind of kinds) {
    const prod = (productionReport.perKind || {})[kind] || { precision: 1, recall: 1 };
    const cand = (candidateReport.perKind || {})[kind] || { precision: 1, recall: 1 };
    const dPrecision = cand.precision - prod.precision;
    const dRecall = cand.recall - prod.recall;
    if (dPrecision < 0 || dRecall < 0) {
      regressions.push({ kind, dPrecision, dRecall, production: prod, candidate: cand });
    } else if (dPrecision > 0 || dRecall > 0) {
      improvements.push({ kind, dPrecision, dRecall, production: prod, candidate: cand });
    }
  }
  // Deterministic ordering so a report diff is stable across runs.
  regressions.sort((a, b) => a.kind.localeCompare(b.kind));
  improvements.sort((a, b) => a.kind.localeCompare(b.kind));
  return { regressions, improvements };
}

function pctDelta(n) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}pp`;
}

/** Renders a shadow-comparison result as a plain-text report. */
export function formatShadowReport({ regressions, improvements }) {
  const lines = [];
  lines.push(`Shadow-gate comparison: ${regressions.length} regression(s), ${improvements.length} improvement(s)`);
  for (const r of regressions) {
    lines.push(`  REGRESSION [${r.kind}] precision ${pctDelta(r.dPrecision)}, recall ${pctDelta(r.dRecall)}`);
  }
  for (const i of improvements) {
    lines.push(`  IMPROVED   [${i.kind}] precision ${pctDelta(i.dPrecision)}, recall ${pctDelta(i.dRecall)}`);
  }
  if (regressions.length === 0) {
    lines.push('  No kind regressed on precision or recall — candidate clears the shadow-gate scaffold check.');
  }
  return lines.join('\n');
}

export default { runShadowComparison, diffReports, formatShadowReport };
