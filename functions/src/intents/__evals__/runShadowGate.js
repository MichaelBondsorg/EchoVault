#!/usr/bin/env node
/**
 * INT-01 shadow-gate CLI — a thin wiring of runCorpusEval.js's per-case
 * runner into shadowGate.js's comparison, for two REPLAY fixtures (the
 * hermetic, CI-safe path) or two live modelIds against one API key. This is
 * the manual tool an engineer runs offline before proposing a prompt/model
 * change; it is not invoked by the corpus-eval verification path and is not
 * wired into any CI gate — see shadowGate.js's header for why.
 *
 * Usage (replay, hermetic):
 *   node runShadowGate.js \
 *     --production-fixture corpus/replayFixture.json \
 *     --candidate-fixture  corpus/replayFixture.json
 *
 * Usage (live, requires GEMINI_API_KEY):
 *   node runShadowGate.js --live \
 *     --production-model gemini-2.5-flash \
 *     --candidate-model  gemini-2.5-pro
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCorpus, loadReplayFixture, runCase, DEFAULT_CASES_PATH, DEFAULT_FIXTURE_PATH } from './runCorpusEval.js';
import { runShadowComparison, formatShadowReport } from './shadowGate.js';

function parseArgs(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    live: argv.includes('--live'),
    casesPath: flag('--cases'),
    productionFixturePath: flag('--production-fixture'),
    candidateFixturePath: flag('--candidate-fixture'),
    productionModel: flag('--production-model') || 'gemini-2.5-flash',
    candidateModel: flag('--candidate-model') || 'gemini-2.5-flash',
    apiKey: flag('--api-key') || process.env.GEMINI_API_KEY,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = loadCorpus(args.casesPath || DEFAULT_CASES_PATH);

  let runProduction;
  let runCandidate;

  if (args.live) {
    if (!args.apiKey) {
      console.error('[shadow-gate] --live mode requires GEMINI_API_KEY (env) or --api-key <key>');
      process.exit(1);
      return;
    }
    runProduction = (c) => runCase(c, { mode: 'live', apiKey: args.apiKey, modelId: args.productionModel });
    runCandidate = (c) => runCase(c, { mode: 'live', apiKey: args.apiKey, modelId: args.candidateModel });
  } else {
    const productionFixture = loadReplayFixture(args.productionFixturePath || DEFAULT_FIXTURE_PATH);
    const candidateFixture = loadReplayFixture(args.candidateFixturePath || DEFAULT_FIXTURE_PATH);
    runProduction = (c) => runCase(c, { mode: 'replay', replayFixture: productionFixture });
    runCandidate = (c) => runCase(c, { mode: 'replay', replayFixture: candidateFixture });
  }

  const { regressions, improvements } = await runShadowComparison({ cases, runProduction, runCandidate });
  console.log(formatShadowReport({ regressions, improvements }));
  process.exit(0);
}

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || '') === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error('[shadow-gate] failed:', err?.stack || err);
    process.exit(1);
  });
}

export default { main };
