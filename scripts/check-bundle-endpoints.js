/**
 * Production Bundle Endpoint Guard
 *
 * Scans the built dist/ bundle for strings that would mean a production
 * build silently shipped a developer-only endpoint (a bare `ws://` relay
 * URL, or the local relay dev server `localhost:8080`). If either shows up
 * in the JS output, something upstream (missing env var, broken fallback)
 * let an insecure/local endpoint leak into a bundle real users load.
 *
 * Usage: node scripts/check-bundle-endpoints.js
 * Exit code: 0 = clean, 1 = offending strings found (or dist/ missing).
 */

import { readdir, readFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_DIR = join(ROOT, 'dist');

const FORBIDDEN_STRINGS = ['ws://', 'localhost:8080'];

async function listJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJsFiles(fullPath)));
    } else if (entry.isFile() && fullPath.endsWith('.js')) {
      // Source maps live alongside as *.js.map, which this extension check
      // already excludes — they are never scanned.
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  let jsFiles;
  try {
    jsFiles = await listJsFiles(DIST_DIR);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`[check-bundle-endpoints] dist/ not found at ${DIST_DIR} — run vite build first.`);
      process.exit(1);
    }
    throw error;
  }

  const offenders = [];
  for (const file of jsFiles) {
    const content = await readFile(file, 'utf8');
    const matches = FORBIDDEN_STRINGS.filter((needle) => content.includes(needle));
    if (matches.length > 0) {
      offenders.push({ file: relative(ROOT, file), matches });
    }
  }

  if (offenders.length > 0) {
    console.error('[check-bundle-endpoints] Production bundle contains forbidden local/insecure relay endpoints:');
    for (const { file, matches } of offenders) {
      console.error(`  - ${file}: ${matches.join(', ')}`);
    }
    console.error(
      '[check-bundle-endpoints] This usually means VITE_VOICE_RELAY_URL was missing or invalid at build time.'
    );
    process.exit(1);
  }

  console.log(`[check-bundle-endpoints] OK — scanned ${jsFiles.length} file(s), no forbidden endpoints found.`);
}

main().catch((error) => {
  console.error('[check-bundle-endpoints] Unexpected failure:', error);
  process.exit(1);
});
