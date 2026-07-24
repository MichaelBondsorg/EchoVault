#!/usr/bin/env node
// Offline model-benchmark harness (product review MOD-01).
//
// Compares candidate model ids for ONE workload using the SAME
// prompt-assembly / response-parsing code production uses (imported
// directly from functions/src/, never reimplemented here) — see the
// per-workload notes below for exactly which production functions are
// reused. Reports latency + output-SHAPE validity + a diff-friendly,
// side-by-side transcript of each candidate's raw output. It does NOT
// invent a quality score — reading the transcripts and judging quality is
// a human (Michael) step, on purpose (see the plan review's MOD-01 intent).
//
// NEVER part of the CI test suite (`npx vitest run src/models` never
// imports this file) — this script makes REAL, optionally-billed network
// calls when run without --dry-run, which would make CI non-hermetic.
//
// Usage (from repo root, no install needed — every module this script
// imports from functions/src/ is dependency-free ESM; see the header
// comments on registry.js/gemini.js/openai.js/claimWriter.js/
// claimVerifier.js for why):
//
//   # Dry run: prompt assembly + fixture loading only, NO network call.
//   node scripts/benchmark-model.mjs --workload insightWriter --dry-run
//
//   # Real comparison (needs GEMINI_API_KEY in the environment):
//   export GEMINI_API_KEY=...
//   node scripts/benchmark-model.mjs --workload insightWriter \
//     --candidates gemini-3.5-flash,gemini-3-flash-preview
//
//   node scripts/benchmark-model.mjs --workload insightVerifier \
//     --candidates gemini-3-flash-preview,gemini-3.5-flash
//
//   # fusedTranscription needs a LOCAL audio file (never committed):
//   node scripts/benchmark-model.mjs --workload fusedTranscription \
//     --candidates gemini-2.5-flash,gemini-3.5-flash \
//     --audio-file ~/Desktop/sample.wav
//
// Flags:
//   --workload <name>       Required. One of: fusedTranscription, insightWriter, insightVerifier.
//   --candidates <a,b,...>  Model ids to compare. Required unless --dry-run
//                           (dry-run defaults to just the workload's current
//                           pinned default from the registry, since no call
//                           is made anyway).
//   --fixtures <path>       Fixtures JSON. Default: scripts/fixtures/benchmark-fixtures.json
//   --audio-file <path>     Local audio file (fusedTranscription real-call only).
//   --dry-run               Assemble prompts + validate fixtures, make NO network call.
//   --timeout-ms <n>        Per-candidate request timeout. Default: 30000.
//
// Output discipline: prints each candidate's model output to the terminal
// for human side-by-side comparison — that's the deliverable — but never
// writes model output into a committed file. Piping stdout to a scratch
// file for your own use is fine; just don't commit it.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fnSrc = path.join(repoRoot, 'functions', 'src');

async function importFn(relPath) {
  return import(pathToFileURL(path.join(fnSrc, relPath)).href);
}

const { WORKLOADS, getModelSync } = await importFn('models/registry.js');
const { callGemini } = await importFn('shared/gemini.js');
const {
  buildGeminiRequestBody,
  parseFusedResponse,
  TRANSCRIPTION_PROMPT,
} = await importFn('transcription/fusedTranscription.js');
const { buildWriterPrompt, writeWording } = await importFn('insights/claimWriter.js');
const { verifyWording, MODEL_SYSTEM_PROMPT } = await importFn('insights/claimVerifier.js');
const { isValidBundle } = await importFn('insights/writeClaimWordingHandler.js');

const SUPPORTED_WORKLOADS = ['fusedTranscription', 'insightWriter', 'insightVerifier'];

function parseArgs(argv) {
  const args = { candidates: null, fixtures: null, audioFile: null, dryRun: false, timeoutMs: 30_000, workload: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workload') args.workload = argv[++i];
    else if (a === '--candidates') args.candidates = argv[++i];
    else if (a === '--fixtures') args.fixtures = argv[++i];
    else if (a === '--audio-file') args.audioFile = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage: node scripts/benchmark-model.mjs --workload <${SUPPORTED_WORKLOADS.join('|')}> [--candidates a,b] [--dry-run] [--fixtures path] [--audio-file path] [--timeout-ms n]

Known registry workloads: ${Object.values(WORKLOADS).join(', ')}
Only ${SUPPORTED_WORKLOADS.join(', ')} have a real prompt-builder integration in this harness today — those are the ones with a dedicated, importable prompt-assembly function in functions/src/ (see the script header). Extend SUPPORTED_WORKLOADS + a run<Workload>() function + the branch in main() to add another.`);
}

async function loadFixtures(fixturesPath) {
  const p = fixturesPath || path.join(repoRoot, 'scripts', 'fixtures', 'benchmark-fixtures.json');
  const raw = await readFile(p, 'utf8');
  return JSON.parse(raw);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// --- fusedTranscription -----------------------------------------------
// Real prod path: buildGeminiRequestBody(...) -> Gemini generateContent ->
// parseFusedResponse(...). Both functions imported verbatim from
// functions/src/transcription/fusedTranscription.js (never reimplemented).
async function runFusedTranscription({ candidates, fixture, dryRun, audioFile, apiKey, timeoutMs }) {
  const { mimeType, properNouns, markers, durationMs } = fixture;

  if (dryRun || !audioFile) {
    if (!dryRun && !audioFile) {
      console.log('No --audio-file supplied for a real fusedTranscription run — falling back to prompt-assembly-only mode (no network call). Pass --audio-file <local-path> for a real comparison.\n');
    }
    const placeholderBase64 = Buffer.from('benchmark-harness-placeholder-not-real-audio').toString('base64');
    const results = [];
    for (const modelId of candidates) {
      const body = buildGeminiRequestBody(placeholderBase64, mimeType, properNouns, markers, durationMs);
      const promptText = body.contents[0].parts.find((p) => p.text)?.text || '';
      const shapeValid =
        Array.isArray(body.contents) &&
        body.contents[0]?.parts?.some((p) => p.inline_data) &&
        typeof promptText === 'string' && promptText.length > 0 &&
        body.generationConfig?.responseMimeType === 'application/json';
      results.push({
        modelId,
        latencyMs: null,
        shapeValid,
        detail: `request body assembled OK; prompt length ${promptText.length} chars; base prompt matches TRANSCRIPTION_PROMPT: ${promptText.startsWith(TRANSCRIPTION_PROMPT.slice(0, 40))}`,
        output: null,
      });
    }
    return results;
  }

  const audioBuffer = await readFile(audioFile);
  const base64 = audioBuffer.toString('base64');
  const results = [];
  for (const modelId of candidates) {
    const body = buildGeminiRequestBody(base64, mimeType, properNouns, markers, durationMs);
    const startedAt = Date.now();
    try {
      const res = await withTimeout(
        fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        timeoutMs,
        `fusedTranscription/${modelId}`
      );
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        results.push({ modelId, latencyMs, shapeValid: false, detail: `HTTP ${res.status}`, output: errText.slice(0, 500) });
        continue;
      }
      const json = await res.json();
      const parsed = parseFusedResponse(json, { markers, durationMs });
      const shapeValid = !!parsed && typeof parsed.transcript === 'string';
      results.push({ modelId, latencyMs, shapeValid, detail: shapeValid ? 'parseFusedResponse OK' : 'parseFusedResponse returned null (malformed response)', output: parsed });
    } catch (e) {
      results.push({ modelId, latencyMs: Date.now() - startedAt, shapeValid: false, detail: e.message, output: null });
    }
  }
  return results;
}

// --- insightWriter -------------------------------------------------------
// Real prod path: writeWording(bundle, {callModel}) from
// functions/src/insights/claimWriter.js, exactly as
// writeClaimWordingHandler.js composes it — same buildWriterPrompt +
// parseWriterResponse under the hood.
async function runInsightWriter({ candidates, fixture, dryRun, apiKey, timeoutMs }) {
  const { bundle } = fixture;
  if (!isValidBundle(bundle)) {
    throw new Error('Fixture insightWriter.bundle failed isValidBundle() — fix the fixture, this is the same gate production uses.');
  }
  const { systemPrompt, userPrompt } = buildWriterPrompt(bundle);

  if (dryRun) {
    return candidates.map((modelId) => ({
      modelId,
      latencyMs: null,
      shapeValid: typeof systemPrompt === 'string' && systemPrompt.length > 0 && userPrompt === JSON.stringify(bundle),
      detail: `prompt assembled OK; systemPrompt ${systemPrompt.length} chars, userPrompt ${userPrompt.length} chars`,
      output: null,
    }));
  }

  const results = [];
  for (const modelId of candidates) {
    const startedAt = Date.now();
    try {
      const wording = await withTimeout(
        writeWording(bundle, { callModel: ({ systemPrompt: sp, userPrompt: up }) => callGemini(apiKey, sp, up, modelId) }),
        timeoutMs,
        `insightWriter/${modelId}`
      );
      results.push({
        modelId,
        latencyMs: Date.now() - startedAt,
        shapeValid: typeof wording === 'string' && wording.length > 0,
        detail: wording ? 'writeWording produced non-empty wording' : 'writeWording returned null (model call or parse failed)',
        output: wording,
      });
    } catch (e) {
      results.push({ modelId, latencyMs: Date.now() - startedAt, shapeValid: false, detail: e.message, output: null });
    }
  }
  return results;
}

// --- insightVerifier -------------------------------------------------------
// Real prod path: verifyWording(wording, bundle, {callModel}) from
// functions/src/insights/claimVerifier.js — runs the SAME cheap-first
// deterministic layer + fail-closed LLM entailment layer production uses,
// against each fixture candidateWording, once per candidate model.
async function runInsightVerifier({ candidates, fixture, dryRun, apiKey, timeoutMs }) {
  const { bundle, candidateWordings } = fixture;
  if (!Array.isArray(candidateWordings) || candidateWordings.length === 0) {
    throw new Error('Fixture insightVerifier.candidateWordings must be a non-empty array.');
  }

  if (dryRun) {
    const results = [];
    for (const modelId of candidates) {
      const userPrompt = JSON.stringify({ bundle, wording: candidateWordings[0] });
      results.push({
        modelId,
        latencyMs: null,
        shapeValid: typeof MODEL_SYSTEM_PROMPT === 'string' && MODEL_SYSTEM_PROMPT.length > 0 && userPrompt.length > 0,
        detail: `verifier prompt assembled OK (systemPrompt ${MODEL_SYSTEM_PROMPT.length} chars); ${candidateWordings.length} fixture wording(s) available`,
        output: null,
      });
    }
    return results;
  }

  const results = [];
  for (const modelId of candidates) {
    const perWording = [];
    const startedAt = Date.now();
    for (const wording of candidateWordings) {
      const callModel = ({ systemPrompt, wording: w, bundle: b }) =>
        callGemini(apiKey, systemPrompt, JSON.stringify({ bundle: b, wording: w }), modelId);
      // eslint-disable-next-line no-await-in-loop -- sequential per-model, small fixture set, latency clarity > parallelism here
      const verdict = await withTimeout(verifyWording(wording, bundle, { callModel }), timeoutMs, `insightVerifier/${modelId}`);
      perWording.push({ wording, verdict: verdict.verdict, reasons: verdict.reasons });
    }
    results.push({
      modelId,
      latencyMs: Date.now() - startedAt,
      shapeValid: perWording.every((r) => r.verdict === 'pass' || r.verdict === 'fail'),
      detail: `${perWording.length} fixture wording(s) verified`,
      output: perWording,
    });
  }
  return results;
}

function printResults(workload, results) {
  console.log(`\n=== Benchmark: ${workload} ===\n`);
  for (const r of results) {
    console.log(`--- candidate: ${r.modelId} ---`);
    console.log(`  latencyMs:   ${r.latencyMs === null ? 'n/a (dry-run)' : r.latencyMs}`);
    console.log(`  shapeValid:  ${r.shapeValid}`);
    console.log(`  detail:      ${r.detail}`);
    if (r.output !== null && r.output !== undefined) {
      console.log('  output:');
      console.log(JSON.stringify(r.output, null, 2).split('\n').map((l) => `    ${l}`).join('\n'));
    }
    console.log('');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.workload) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  if (!SUPPORTED_WORKLOADS.includes(args.workload)) {
    console.error(`Unsupported workload for this harness: ${args.workload}`);
    usage();
    process.exit(1);
  }

  const fixtures = await loadFixtures(args.fixtures);
  const fixture = fixtures[args.workload];
  if (!fixture) {
    console.error(`No fixture found for workload "${args.workload}" in ${args.fixtures || 'scripts/fixtures/benchmark-fixtures.json'}`);
    process.exit(1);
  }

  let candidates;
  if (args.candidates) {
    candidates = args.candidates.split(',').map((s) => s.trim()).filter(Boolean);
  } else if (args.dryRun) {
    candidates = [getModelSync(args.workload)];
    console.log(`No --candidates given; dry-run defaulting to the current pinned default: ${candidates[0]}\n`);
  } else {
    console.error('--candidates is required for a real (non-dry-run) benchmark.');
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY || null;
  if (!args.dryRun && !apiKey) {
    console.error('GEMINI_API_KEY is not set in the environment. Either set it, or pass --dry-run.');
    process.exit(1);
  }

  console.log(`Workload: ${args.workload}`);
  console.log(`Candidates: ${candidates.join(', ')}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no network calls)' : 'REAL (live API calls, may incur cost)'}`);

  let results;
  if (args.workload === 'fusedTranscription') {
    results = await runFusedTranscription({ candidates, fixture, dryRun: args.dryRun, audioFile: args.audioFile, apiKey, timeoutMs: args.timeoutMs });
  } else if (args.workload === 'insightWriter') {
    results = await runInsightWriter({ candidates, fixture, dryRun: args.dryRun, apiKey, timeoutMs: args.timeoutMs });
  } else if (args.workload === 'insightVerifier') {
    results = await runInsightVerifier({ candidates, fixture, dryRun: args.dryRun, apiKey, timeoutMs: args.timeoutMs });
  }

  printResults(args.workload, results);

  const allShapeValid = results.every((r) => r.shapeValid);
  if (!allShapeValid) {
    console.error('One or more candidates produced an invalid output shape (see shapeValid:false above).');
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[benchmark-model] fatal:', e?.stack || e);
  process.exit(1);
});
