/**
 * cloudMigration.test.js
 *
 * The Cloud redesign (docs/superpowers/plans/2026-07-18-cloud-redesign.md) replaces
 * the Hearthside palette with CSS-variable-based Cloud tokens (src/styles/cloud-tokens.css)
 * screen by screen. This file replaces the old "enforce Hearthside palette usage" test
 * suite (hearthside-palette.test.js x2, coreFeaturesPalette.test.js, InsightsPage.palette.test.js)
 * with a migration ratchet:
 *
 * 1. Every file listed in MIGRATED must be fully "Cloud-clean" — no legacy Hearthside
 *    Tailwind classes, no raw hex colors baked into JSX (CSS vars only), no gray-* classes.
 * 2. Every other .jsx file in src/ is tracked by a shrinking budget (LEGACY_BUDGET) of how
 *    many still contain legacy palette classes. Each migration task (Phase B/C/D) should
 *    add its migrated file(s) to MIGRATED and lower LEGACY_BUDGET to match.
 *
 * Kept deliberately fast: raw fs reads, no rendering, no transpilation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../..');

// Global constraint from the Cloud redesign plan: zero honey|terra|sage|lavender|hearth|
// warm|amber|mood-<n> Tailwind classes in migrated files.
const LEGACY_CLASS_RE =
  /\b(bg|text|border|from|via|to|ring|fill|stroke)-(honey|terra|sage|lavender|hearth|warm|amber|mood)-\d+/;

// Legacy palette also leaned on gray-* directly in a few spots; Cloud uses semantic
// tokens (bg-card, text-muted-foreground, etc.) instead, so gray-* is banned outright
// in migrated files.
const GRAY_CLASS_RE = /\bgray-\d+/;

// Raw hex colors baked into JSX (className/style) are banned in migrated files — Cloud
// styling is CSS-variable driven (var(--token)). Hex is still fine inside comments and as
// a var(...) fallback value, e.g. var(--accent, #667fa8).
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

function findPatternViolations(content, regex) {
  const violations = [];
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const re = new RegExp(regex.source, 'g');
    let match;
    while ((match = re.exec(line)) !== null) {
      violations.push(`  line ${idx + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return violations;
}

function isInsideOpenVarFallback(line, hexIndex) {
  const before = line.slice(0, hexIndex);
  const lastVarOpen = before.lastIndexOf('var(');
  if (lastVarOpen === -1) return false;
  const between = line.slice(lastVarOpen, hexIndex);
  const opens = (between.match(/\(/g) || []).length;
  const closes = (between.match(/\)/g) || []).length;
  return opens > closes;
}

function findHexViolations(content) {
  const violations = [];
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // Allow hex inside comments (// line comments, or lines that are part of a block comment)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    HEX_RE.lastIndex = 0;
    let match;
    while ((match = HEX_RE.exec(line)) !== null) {
      const hexIndex = match.index;
      // Skip hex that appears after a // comment marker on the same line
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1 && commentIdx < hexIndex) continue;
      // Allow hex used as a var(...) fallback value
      if (isInsideOpenVarFallback(line, hexIndex)) continue;
      violations.push(`  line ${idx + 1}: ${line.trim().slice(0, 120)}`);
    }
  });
  return violations;
}

// --- MIGRATED: files already fully migrated to the Cloud token system ---

function listCloudKitSourceFiles() {
  const cloudDir = resolve(REPO_ROOT, 'src/components/cloud');
  const out = [];
  for (const entry of readdirSync(cloudDir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    if (entry.isFile() && /\.(jsx?|css)$/.test(entry.name)) {
      out.push(`src/components/cloud/${entry.name}`);
    }
  }
  return out.sort();
}

export const MIGRATED = [
  ...listCloudKitSourceFiles(),
  'src/lib/cn.js',
  'src/styles/cloud-tokens.css',
  'src/components/capture/EntryComposer.jsx',
  // C1 (shell): tab bar, TopBar, LinenWaveBackground mounted in AppLayout.
  'src/components/zen/BottomNavbar.jsx',
  'src/components/zen/TopBar.jsx',
  'src/components/zen/AppLayout.jsx',
];

// --- Ratchet: how many non-migrated .jsx files still use legacy palette classes ---
// Set to the actual count as of A5 (2026-07-18). Every migration task (Phase B/C/D) that
// restyles a screen should add it to MIGRATED and lower this number to match reality —
// it must never go up.
// C1 (2026-07-18): AppLayout.jsx's `dark:bg-hearth-950` was the only remaining legacy-
// class offender among the three shell files migrated in this task (BottomNavbar.jsx/
// TopBar.jsx were already clean); budget drops 77 -> 76.
export const LEGACY_BUDGET = 76;

function collectJsxFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = resolve(dir, entry.name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectJsxFiles(full));
    } else if (entry.name.endsWith('.jsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('MIGRATED files are Cloud-clean', () => {
  MIGRATED.forEach((relPath) => {
    it(`${relPath} has no legacy palette classes, no gray- classes, no raw hex (except .css token source)`, () => {
      const fullPath = resolve(REPO_ROOT, relPath);
      const content = readFileSync(fullPath, 'utf-8');
      const isCss = relPath.endsWith('.css');

      // cloud-tokens.css is the token *definition/bridge* file: it intentionally defines
      // `.text-warm-800 { color: var(--foreground) !important; }`-style selectors so
      // not-yet-migrated screens still resolve through the new tokens. That's bridge
      // plumbing, not "usage" of the legacy palette in JSX — so .css is exempt from all
      // three content rules, not just hex.
      const legacyViolations = isCss ? [] : findPatternViolations(content, LEGACY_CLASS_RE);
      const grayViolations = isCss ? [] : findPatternViolations(content, GRAY_CLASS_RE);
      const hexViolations = isCss ? [] : findHexViolations(content);

      const problems = [];
      if (legacyViolations.length) {
        problems.push(`legacy palette classes:\n${legacyViolations.join('\n')}`);
      }
      if (grayViolations.length) {
        problems.push(`gray- classes:\n${grayViolations.join('\n')}`);
      }
      if (hexViolations.length) {
        problems.push(`raw hex colors:\n${hexViolations.join('\n')}`);
      }

      expect(problems, problems.join('\n\n')).toHaveLength(0);
    });
  });
});

describe('Legacy palette migration ratchet', () => {
  it(`no more than ${LEGACY_BUDGET} non-migrated .jsx files still use legacy palette classes`, () => {
    const migratedFullPaths = new Set(MIGRATED.map((p) => resolve(REPO_ROOT, p)));
    const allJsx = collectJsxFiles(resolve(REPO_ROOT, 'src'));

    const offenders = [];
    for (const file of allJsx) {
      if (migratedFullPaths.has(file)) continue;
      const content = readFileSync(file, 'utf-8');
      if (LEGACY_CLASS_RE.test(content)) {
        offenders.push(file.replace(`${REPO_ROOT}/`, ''));
      }
    }

    offenders.sort();
    if (offenders.length > LEGACY_BUDGET) {
      // eslint-disable-next-line no-console
      console.error(
        `Legacy-palette offenders (${offenders.length}, budget ${LEGACY_BUDGET}):\n` +
          offenders.map((f) => `  ${f}`).join('\n')
      );
    }

    expect(
      offenders.length,
      `Files still using legacy palette classes (budget ${LEGACY_BUDGET}):\n` +
        offenders.map((f) => `  ${f}`).join('\n')
    ).toBeLessThanOrEqual(LEGACY_BUDGET);
  });

  it('LEGACY_BUDGET never increases beyond the current committed value', () => {
    // Guardrail against accidentally bumping the constant up instead of down.
    expect(LEGACY_BUDGET).toBeLessThanOrEqual(76);
  });
});
