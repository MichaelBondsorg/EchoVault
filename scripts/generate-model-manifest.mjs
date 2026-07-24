// Regenerate the pinned model manifest (product review MOD-01).
// Usage (from repo root, no install needed — manifest.js/registry.js are
// dependency-free ESM, see the module comments for why):
//   node scripts/generate-model-manifest.mjs
//   node scripts/generate-model-manifest.mjs --check   # exit 1 if stale, writes nothing
//
// Writes functions/src/models/model-manifest.json. Run this any time
// functions/src/models/registry.js's MODEL_DEFAULTS (or manifest.js's
// WORKLOAD_PROMPT_VERSIONS) changes, then commit the diff — the drift test
// (functions/src/models/__tests__/manifestDrift.test.js, run via
// `cd functions && npx vitest run src/models`) fails CI if the checked-in
// file and a fresh generateManifest() disagree.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const manifestModulePath = path.join(repoRoot, 'functions/src/models/manifest.js');
const outPath = path.join(repoRoot, 'functions/src/models/model-manifest.json');

const { generateManifest, serializeManifest } = await import(pathToFileURL(manifestModulePath).href);
const fresh = serializeManifest(generateManifest());

const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  let current = null;
  try {
    current = await readFile(outPath, 'utf8');
  } catch {
    // Missing file counts as stale below.
  }
  if (current === fresh) {
    console.log('[generate-model-manifest] up to date.');
    process.exit(0);
  }
  console.error('[generate-model-manifest] STALE: functions/src/models/model-manifest.json does not match the registry.');
  console.error('Run: node scripts/generate-model-manifest.mjs');
  process.exit(1);
}

await writeFile(outPath, fresh, 'utf8');
console.log(`[generate-model-manifest] wrote ${path.relative(repoRoot, outPath)}`);
