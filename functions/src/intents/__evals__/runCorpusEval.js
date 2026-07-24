#!/usr/bin/env node
/**
 * INT-01 raw-text intent-extraction eval harness.
 *
 * Runs the labeled corpus (corpus/cases.json) through the REAL production
 * extraction path — `extractIntentCandidates` (../extractIntents.js) and
 * `decideActivation` (../activationPolicy.js), imported directly, never
 * reimplemented — and scores the result with corpusScoring.js.
 *
 * Two modes:
 *   --live     Real, keyed model call. Requires GEMINI_API_KEY (or --api-key).
 *              Exercises extractIntentCandidates' DEFAULT callModel (the true
 *              production Gemini transport + SYSTEM_PROMPT), so this is a
 *              genuine end-to-end run against the live model.
 *   --replay   Deterministic, hermetic. Reads corpus/replayFixture.json (a
 *              committed snapshot of past raw model output, keyed by case
 *              id) and feeds it to extractIntentCandidates via an injected
 *              `callModel`, so parseCandidatesResponse/normalizeCandidates/
 *              decideActivation still all run for real — only the network
 *              call is stubbed. This is the mode CI runs; CI NEVER makes API
 *              calls.
 *
 * Usage:
 *   node runCorpusEval.js --replay [--fixture <path>] [--cases <path>]
 *   node runCorpusEval.js --live [--api-key <key>] [--model <modelId>]
 *
 * Exit code 0 on a successful run (score table printed) in both modes; a
 * thrown error (missing fixture entry, missing API key, etc.) exits 1.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { extractIntentCandidates } from '../extractIntents.js';
import { decideActivation } from '../activationPolicy.js';
import { scoreCorpus } from './corpusScoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixed clock for scoring determinism: results must never depend on the
// wall-clock time the eval happens to run at. Kept well inside the future
// window every "active"-expecting case's targetAt was authored against.
export const CORPUS_EVAL_NOW = Date.parse('2026-07-24T12:00:00.000Z');

export const DEFAULT_CASES_PATH = path.join(__dirname, 'corpus/cases.json');
export const DEFAULT_FIXTURE_PATH = path.join(__dirname, 'corpus/replayFixture.json');

export function loadCorpus(file = DEFAULT_CASES_PATH) {
  return JSON.parse(readFileSync(file, 'utf8')).cases;
}

export function loadReplayFixture(file = DEFAULT_FIXTURE_PATH) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const { _meta, ...fixtures } = doc;
  return fixtures;
}

/**
 * Builds a `callModel` for extractIntentCandidates that replays a committed
 * fixture instead of calling out to a real model. Each fixture entry pins
 * BOTH the entry text it was captured against and the raw candidates, so a
 * later corpus edit that changes a case's text (while keeping its id) is
 * caught here — replay fails loudly instead of silently scoring a stale
 * fixture against new evidence.
 */
function makeReplayCallModel(fixtureEntry, expectedUserText, caseId) {
  return async ({ userText }) => {
    if (fixtureEntry === undefined) {
      throw new Error(`[corpus-eval] no replay fixture entry for case "${caseId}"`);
    }
    if (fixtureEntry.text !== expectedUserText || userText !== expectedUserText) {
      throw new Error(
        `[corpus-eval] replay fixture mismatch for case "${caseId}": entry text has changed since the fixture was captured — recapture replayFixture.json`
      );
    }
    // JSON.stringify round-trip so replay mode exercises the exact string
    // response path parseCandidatesResponse handles in production (a real
    // Gemini call always returns a string, never a pre-parsed array).
    return JSON.stringify(fixtureEntry.candidates);
  };
}

/**
 * Runs one corpus case through the real extraction + policy pipeline.
 * @returns {Promise<Array<{kind: string, text: string, state: string, reason: string}>>}
 */
export async function runCase(
  testCase,
  { mode, apiKey, modelId = 'gemini-2.5-flash', now = CORPUS_EVAL_NOW, replayFixture } = {}
) {
  const entry = { text: testCase.text };
  const opts = { apiKey, entry, modelId };
  if (mode === 'replay') {
    opts.callModel = makeReplayCallModel((replayFixture || {})[testCase.id], testCase.text, testCase.id);
  }
  const candidates = await extractIntentCandidates(opts);
  return candidates.map((cand) => {
    const { state, reason } = decideActivation(cand, now);
    return { kind: cand.kind, text: cand.sourceSpan.text, state, reason };
  });
}

/**
 * Runs the full corpus and scores it.
 * @param {object} opts
 * @param {Array} opts.cases
 * @param {'live'|'replay'} opts.mode
 * @param {object} [opts.replayFixture] - required for replay mode
 * @param {string} [opts.apiKey] - required for live mode
 * @param {string} [opts.modelId]
 * @param {number} [opts.now] - injectable clock, defaults to CORPUS_EVAL_NOW
 * @returns {Promise<{caseResults: Array, report: object}>}
 */
export async function runCorpusEval({ cases, mode, replayFixture, apiKey, modelId = 'gemini-2.5-flash', now = CORPUS_EVAL_NOW } = {}) {
  if (mode !== 'live' && mode !== 'replay') {
    throw new Error(`runCorpusEval: mode must be 'live' or 'replay', got "${mode}"`);
  }
  if (mode === 'live' && !apiKey) {
    throw new Error('runCorpusEval: --live mode requires an apiKey (set GEMINI_API_KEY or pass --api-key)');
  }
  if (mode === 'replay' && !replayFixture) {
    throw new Error('runCorpusEval: --replay mode requires a replayFixture');
  }

  const caseResults = [];
  for (const c of cases) {
    const predicted = await runCase(c, { mode, apiKey, modelId, now, replayFixture });
    caseResults.push({ caseId: c.id, category: c.category, expectedIntents: c.expectedIntents, predicted });
  }
  return { caseResults, report: scoreCorpus(caseResults) };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

/** Renders the score report as plain-text tables (no external deps). */
export function formatReport(report, { mode } = {}) {
  const lines = [];
  lines.push(`INT-01 corpus eval — mode=${mode || '?'} — ${report.totalCases} cases (${report.zeroIntentCases} zero-intent)`);
  lines.push('');
  lines.push('Per-kind (surfaced = active|suggested):');
  lines.push('kind'.padEnd(18) + 'tp'.padEnd(5) + 'fp'.padEnd(5) + 'fn'.padEnd(5) + 'precision'.padEnd(12) + 'recall');
  for (const [kind, s] of Object.entries(report.perKind)) {
    lines.push(kind.padEnd(18) + String(s.tp).padEnd(5) + String(s.fp).padEnd(5) + String(s.fn).padEnd(5) + pct(s.precision).padEnd(12) + pct(s.recall));
  }
  lines.push('');
  lines.push(`Overall: tp=${report.overall.tp} fp=${report.overall.fp} fn=${report.overall.fn} precision=${pct(report.overall.precision)} recall=${pct(report.overall.recall)}`);
  lines.push('');
  lines.push(`Confusion summary: ${report.confusion.misfires.length} misfire(s), ${report.confusion.hallucinations.length} hallucination(s), ${report.confusion.kindConfusions.length} kind-confusion(s), ${report.confusion.misses.length} miss(es)`);
  for (const m of report.confusion.misfires) lines.push(`  MISFIRE     [${m.kind}] case=${m.caseId}`);
  for (const h of report.confusion.hallucinations) lines.push(`  HALLUCINATE [${h.kind}] case=${h.caseId}`);
  for (const k of report.confusion.kindConfusions) lines.push(`  KIND-CONFUSE[${k.kind}] case=${k.caseId} (${k.detail})`);
  for (const ms of report.confusion.misses) lines.push(`  MISS        [${ms.kind}] case=${ms.caseId} (${ms.detail})`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { mode: argv.includes('--live') ? 'live' : 'replay' };
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  args.casesPath = flag('--cases');
  args.fixturePath = flag('--fixture');
  args.apiKey = flag('--api-key') || process.env.GEMINI_API_KEY;
  args.modelId = flag('--model') || 'gemini-2.5-flash';
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = loadCorpus(args.casesPath || DEFAULT_CASES_PATH);

  let replayFixture;
  if (args.mode === 'replay') {
    replayFixture = loadReplayFixture(args.fixturePath || DEFAULT_FIXTURE_PATH);
  } else if (!args.apiKey) {
    console.error('[corpus-eval] --live mode requires GEMINI_API_KEY (env) or --api-key <key>');
    process.exit(1);
    return;
  }

  const { report } = await runCorpusEval({
    cases,
    mode: args.mode,
    replayFixture,
    apiKey: args.apiKey,
    modelId: args.modelId,
  });

  console.log(formatReport(report, { mode: args.mode }));
  process.exit(0);
}

// Only run the CLI when this file is executed directly (not when imported by
// the vitest suite or by the shadow-gate scaffolding).
const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error('[corpus-eval] failed:', err?.stack || err);
    process.exit(1);
  });
}

export default { runCorpusEval, runCase, loadCorpus, loadReplayFixture, formatReport, CORPUS_EVAL_NOW };
