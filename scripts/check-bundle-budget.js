/**
 * Production Bundle Budget Gate (PERF-01)
 *
 * Fails the build when the main entry chunk (the module `<script>` Vite
 * points `dist/index.html` at — everything a cold launch must download
 * before React can even start rendering) exceeds a byte budget. This is
 * separate from `check-bundle-endpoints.js`'s content-forbidding scan: this
 * script only ever looks at ONE file's size, not file contents.
 *
 * ---- The budget number, and how it was measured -------------------------
 *
 * BUDGET_BYTES = 900,000 (≈ 878.9 KiB)
 *
 * Measured 2026-07-24 via `npm run build` immediately after PERF-01's
 * route-level split (InsightsPage/SettingsPage tabs +
 * ExperimentsScreen/RecipesScreen/SessionPrepScreen/InsightControlCenter
 * flag-gated overlays moved off the main chunk into their own lazy
 * chunks — see `src/components/lazy.jsx` and
 * `src/components/zen/AppLayout.jsx`). The resulting entry chunk
 * (`dist/assets/index-BlDmqzu3.js` at that build) was 815,809 bytes.
 * Before the split it was 1,035,674 bytes (~1.02 MB, matching the product
 * review's "Main bundle ~1.02MB" finding). 815,809 * 1.10 ≈ 897,390; this
 * budget rounds that up to a clean 900,000 bytes (~10.3% headroom over the
 * measured post-split size) — enough slack for normal day-to-day growth
 * without masking a real regression back toward the pre-split size.
 *
 * When this fails for a legitimate reason (a genuinely new capture-path
 * dependency), re-measure with `npm run build` and update both the
 * constant below and this comment in the same change — don't just bump the
 * number to make CI green.
 *
 * Usage: node scripts/check-bundle-budget.js
 * Exit code: 0 = under budget, 1 = over budget (or dist/ missing/malformed).
 */

import { readFile, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_DIR = join(ROOT, 'dist');
const INDEX_HTML = join(DIST_DIR, 'index.html');

export const BUDGET_BYTES = 900_000;

/**
 * Pull the entry chunk's asset path out of dist/index.html. Vite emits
 * exactly one `<script type="module" ... src="...">` tag for the entry;
 * everything else (the boot-theme inline bootstrap, route/flag-gated lazy
 * chunks) is either non-module or loaded dynamically, so it never appears
 * here as a top-level module script.
 */
export function findEntryScriptSrc(html) {
  const matches = [...html.matchAll(/<script\b[^>]*type="module"[^>]*>/gi)];
  const withSrc = matches
    .map((m) => m[0].match(/\bsrc="([^"]+)"/i)?.[1])
    .filter(Boolean);

  if (withSrc.length === 0) {
    throw new Error('No <script type="module" src="..."> tag found in dist/index.html.');
  }
  if (withSrc.length > 1) {
    throw new Error(
      `Expected exactly one entry module script, found ${withSrc.length}: ${withSrc.join(', ')}`
    );
  }
  return withSrc[0];
}

/**
 * Pure pass/fail decision, kept separate from I/O so it's directly
 * unit-testable (see scripts/__tests__/check-bundle-budget.test.js).
 */
export function evaluateBudget(sizeBytes, budgetBytes) {
  return {
    pass: sizeBytes <= budgetBytes,
    sizeBytes,
    budgetBytes,
    overBytes: Math.max(0, sizeBytes - budgetBytes),
  };
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

async function main() {
  let html;
  try {
    html = await readFile(INDEX_HTML, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`[check-bundle-budget] dist/index.html not found at ${INDEX_HTML} — run vite build first.`);
      process.exit(1);
    }
    throw error;
  }

  const entrySrc = findEntryScriptSrc(html);
  // entrySrc is an absolute site path like "/assets/index-XXXX.js".
  const entryPath = join(DIST_DIR, entrySrc.replace(/^\//, ''));

  let sizeBytes;
  try {
    ({ size: sizeBytes } = await stat(entryPath));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`[check-bundle-budget] Entry chunk referenced by index.html not found on disk: ${entryPath}`);
      process.exit(1);
    }
    throw error;
  }

  const result = evaluateBudget(sizeBytes, BUDGET_BYTES);

  if (!result.pass) {
    console.error(
      `[check-bundle-budget] FAIL — entry chunk ${entrySrc} is ${formatKiB(result.sizeBytes)} ` +
        `(${result.sizeBytes} bytes), over the ${formatKiB(BUDGET_BYTES)} budget by ${formatKiB(result.overBytes)}.`
    );
    console.error(
      '[check-bundle-budget] If this growth is legitimate, re-measure with `npm run build` and update ' +
        'BUDGET_BYTES + its header comment in scripts/check-bundle-budget.js in the same change.'
    );
    process.exit(1);
  }

  console.log(
    `[check-bundle-budget] OK — entry chunk ${entrySrc} is ${formatKiB(result.sizeBytes)} ` +
      `(${result.sizeBytes} bytes), within the ${formatKiB(BUDGET_BYTES)} budget.`
  );
}

// Only run when invoked directly (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[check-bundle-budget] Unexpected failure:', error);
    process.exit(1);
  });
}
