/**
 * `scripts/__tests__/feature-manifest.test.js` — OPS-01 generated-manifest tests.
 *
 * Four concerns, mirroring `check-bundle-budget.test.js`'s precedent of
 * unit-testing the pure logic directly rather than shelling out:
 *
 *   1. The extraction primitives (bracket-balancing + literal eval) behave
 *      correctly on representative inputs, INCLUDING the "prove RED" case:
 *      a parser that is genuinely sensitive to a flag being added/removed
 *      from a FLAG_DEFAULTS-shaped literal (done against synthetic strings —
 *      never by mutating the real src/config/flags.js on disk).
 *   2. The generator is deterministic: building the manifest data twice
 *      from the current source tree and rendering both produces
 *      byte-identical markdown.
 *   3. The drift guard: the committed `docs/ops/feature-manifest.md` is
 *      byte-identical to a fresh regeneration from current source — this is
 *      the check that fails CI when someone edits a flag without
 *      regenerating the manifest.
 *   4. "Monolith blind spot" regression pins (review fix wave): a prior
 *      version of this generator only scanned `functions/src/**`, missing
 *      real call sites in the ~4,900-line `functions/index.js` monolith
 *      (`getModelFlag(db, 'model.embeddingWriteV2')` at index.js:491, and
 *      two `getServerFlag('serverAnalysisOrchestrator')` sites at
 *      index.js:2183/2312) — which produced a manifest row FALSELY
 *      claiming `model.embeddingWriteV2` had "zero callers repo-wide" when
 *      it is in fact live-wired. These tests prove (a) the scan-site
 *      primitives detect a call site living in a FILE root (not just a
 *      directory root) via an isolated fixture, and (b) the real repo's
 *      `functions/index.js` call sites are actually picked up by
 *      `buildManifestData()` today, so this exact regression can't recur
 *      silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ROOT,
  findMatchingBracket,
  extractExportedLiteral,
  scanServerFlagReads,
  scanModelFlagReads,
  scanDarkConstants,
  scanClientFlagReadSites,
  buildManifestData,
  renderManifest,
} from '../generate-feature-manifest.js';

describe('findMatchingBracket', () => {
  it('balances a simple object literal', () => {
    const src = 'const X = { a: 1, b: 2 };';
    const open = src.indexOf('{');
    const close = findMatchingBracket(src, open);
    expect(src[close]).toBe('}');
    expect(src.slice(open, close + 1)).toBe('{ a: 1, b: 2 }');
  });

  it('ignores braces inside a line comment', () => {
    const src = 'const X = { a: 1, // a stray } brace in a comment\n  b: 2 };';
    const open = src.indexOf('{');
    const close = findMatchingBracket(src, open);
    expect(src.slice(open, close + 1)).toBe(src.slice(open, src.lastIndexOf('}') + 1));
  });

  it('ignores braces inside a block comment', () => {
    const src = 'const X = { a: 1, /* nested { { { braces */ b: 2 };';
    const open = src.indexOf('{');
    const close = findMatchingBracket(src, open);
    expect(src.slice(open, close + 1)).toBe(src.slice(open, src.lastIndexOf('}') + 1));
  });

  it('ignores brackets inside a string value', () => {
    const src = "const X = { a: '{{{not a brace}}}', b: 2 };";
    const open = src.indexOf('{');
    const close = findMatchingBracket(src, open);
    expect(src.slice(open, close + 1)).toBe(src.slice(open, src.lastIndexOf('}') + 1));
  });

  it('throws on genuinely unbalanced input', () => {
    const src = 'const X = { a: 1, b: 2 ;';
    const open = src.indexOf('{');
    expect(() => findMatchingBracket(src, open)).toThrow(/unbalanced/);
  });
});

describe('extractExportedLiteral', () => {
  it('extracts a plain exported object literal', () => {
    const src = `
      export const FLAG_DEFAULTS = {
        coreFirstSave: true, // comment
        openLoops: false,
      };
    `;
    expect(extractExportedLiteral(src, 'FLAG_DEFAULTS')).toEqual({
      coreFirstSave: true,
      openLoops: false,
    });
  });

  it('extracts a non-exported const array literal (flip-flag.mjs shape)', () => {
    const src = `const ALLOWED = ['a', 'b', 'c'];`;
    expect(extractExportedLiteral(src, 'ALLOWED')).toEqual(['a', 'b', 'c']);
  });

  it('extracts an object literal wrapped in Object.freeze(...) (registry.js shape)', () => {
    const src = `export const MODEL_DEFAULTS = Object.freeze({\n  chat: 'gpt-4o-mini',\n});`;
    expect(extractExportedLiteral(src, 'MODEL_DEFAULTS')).toEqual({ chat: 'gpt-4o-mini' });
  });

  it('throws a clear error when the declaration is not found', () => {
    expect(() => extractExportedLiteral('const OTHER = {};', 'MISSING')).toThrow(/could not find declaration/);
  });

  // ---- "Prove RED" -------------------------------------------------------
  // Demonstrates the parser is genuinely sensitive to a flag being planted
  // or removed — the property the drift test below depends on to ever
  // fail. This never touches the real src/config/flags.js; it operates on
  // a synthetic string standing in for it.
  it('PROVE RED: reflects a newly planted flag', () => {
    const before = `export const FLAG_DEFAULTS = {\n  coreFirstSave: true,\n};`;
    const planted = `export const FLAG_DEFAULTS = {\n  coreFirstSave: true,\n  brandNewFlag: false,\n};`;

    const beforeParsed = extractExportedLiteral(before, 'FLAG_DEFAULTS');
    const plantedParsed = extractExportedLiteral(planted, 'FLAG_DEFAULTS');

    expect(beforeParsed).not.toHaveProperty('brandNewFlag');
    expect(plantedParsed).toHaveProperty('brandNewFlag', false);
    // The two parses differ — a manifest rendered from `before` would NOT
    // match one rendered from `planted`, which is exactly the drift the
    // real CI check below guards against for the actual flags.js.
    expect(beforeParsed).not.toEqual(plantedParsed);
  });

  it('PROVE RED: removing a flag is reflected too (planted, then removed again)', () => {
    const planted = `export const FLAG_DEFAULTS = {\n  coreFirstSave: true,\n  brandNewFlag: false,\n};`;
    const removed = `export const FLAG_DEFAULTS = {\n  coreFirstSave: true,\n};`;

    const plantedParsed = extractExportedLiteral(planted, 'FLAG_DEFAULTS');
    const removedParsed = extractExportedLiteral(removed, 'FLAG_DEFAULTS');

    expect(plantedParsed).toHaveProperty('brandNewFlag');
    expect(removedParsed).not.toHaveProperty('brandNewFlag');
    expect(removedParsed).toEqual({ coreFirstSave: true });
  });
});

describe('buildManifestData + renderManifest (against the real repo tree)', () => {
  it('is deterministic: two independent builds render byte-identical markdown', () => {
    const a = renderManifest(buildManifestData());
    const b = renderManifest(buildManifestData());
    expect(a).toBe(b);
  });

  it('covers a meaningful number of flags, model workloads, and dark constants', () => {
    const data = buildManifestData();
    expect(data.flagRows.length).toBeGreaterThanOrEqual(15);
    expect(data.workloadRows.length).toBeGreaterThanOrEqual(10);
    expect(data.darkRows.length).toBeGreaterThanOrEqual(2);
  });

  it('spot-check: known flags carry their real default from src/config/flags.js', () => {
    const data = buildManifestData();
    const byName = Object.fromEntries(data.flagRows.map((r) => [r.name, r]));
    expect(byName.coreFirstSave.default).toBe(true);
    expect(byName.openLoops.default).toBe(false);
    expect(byName.personalExperiments.default).toBe(false);
    expect(byName.insightClaims.default).toBe(false);
  });

  it('spot-check: a flag in flip-flag.mjs ALLOWED gets the flip-flag.mjs mechanism, not "NOT WIRED"', () => {
    const data = buildManifestData();
    const gentleRevisit = data.flagRows.find((r) => r.name === 'gentleRevisit');
    expect(gentleRevisit.flipMechanism).toMatch(/node scripts\/flip-flag\.mjs gentleRevisit true/);
    expect(gentleRevisit.rollback).toBe('node scripts/flip-flag.mjs gentleRevisit false');
  });

  it('spot-check: a flag NOT in flip-flag.mjs ALLOWED is marked NOT WIRED (coreFirstSave)', () => {
    const data = buildManifestData();
    const row = data.flagRows.find((r) => r.name === 'coreFirstSave');
    expect(row.flipMechanism).toMatch(/NOT WIRED/);
    expect(row.gaps.join(' ')).toMatch(/No flip-flag\.mjs entry/);
  });

  it('spot-check: intentAbstainAudit is discovered purely from a getServerFlag() call site (not in flags.js)', () => {
    const data = buildManifestData();
    const row = data.flagRows.find((r) => r.name === 'intentAbstainAudit');
    expect(row).toBeDefined();
    expect(row.default).toBe(false);
    expect(row.serverReadFiles.some((f) => f.startsWith('functions/src/intents/extractIntents.js:'))).toBe(true);
  });

  it('spot-check: string-valued model workload overrides pick up STRING_ALLOWED values', () => {
    const data = buildManifestData();
    const writer = data.workloadRows.find((r) => r.workload === 'insightWriter');
    expect(writer.flipMechanism).toMatch(/model\.insightWriter/);
    expect(writer.flipMechanism).toMatch(/gemini-3\.5-flash/);
    expect(writer.defaultModelId).toBe('gemini-3.5-flash');
  });

  it('spot-check: dark code constants are found with their real current value', () => {
    const data = buildManifestData();
    const byName = Object.fromEntries(data.darkRows.map((r) => [r.name, r]));
    expect(byName.LLM_WRITER_ENABLED.value).toBe(false);
    expect(byName.LLM_WRITER_ENABLED.file).toBe('src/services/insights/claims/claimsPipeline.js');
    expect(byName.USE_FUSED_TRANSCRIPTION.value).toBe(true);
    expect(byName.USE_FUSED_TRANSCRIPTION.file).toBe('src/config/ai.js');
  });

  it('does not find a live RISKY_CLAIMS_ENABLED declaration (retired R4 Phase 3)', () => {
    const data = buildManifestData();
    expect(data.darkRows.some((r) => r.name === 'RISKY_CLAIMS_ENABLED')).toBe(false);
    expect(data.reappearedRetired).toEqual([]);
  });
});

describe('monolith blind spot regression pins (functions/index.js scan coverage)', () => {
  it('scan roots literally include functions/index.js, not just functions/src', () => {
    // buildManifestData() constructs its scan roots internally; the
    // authoritative proof that functions/index.js is actually one of them
    // is that a known-real call site living ONLY in that file (not in
    // functions/src) is detected below. This test additionally asserts the
    // file itself exists at the expected path, so a future rename/move of
    // the monolith fails loud here instead of the scan silently finding
    // nothing.
    const indexPath = join(ROOT, 'functions', 'index.js');
    expect(() => readFileSync(indexPath, 'utf8')).not.toThrow();
  });

  it('fixture: scanServerFlagReads detects a call site living in a FILE root (not a directory)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'feature-manifest-fixture-'));
    try {
      const emptyDir = join(tmp, 'functions-src-stub');
      mkdirSync(emptyDir);
      const monolithFile = join(tmp, 'index.js');
      writeFileSync(
        monolithFile,
        "async function f(db) {\n  return getServerFlag(db, 'fixtureOnlyFlag', true);\n}\n"
      );

      // Directory root alone (mirrors the OLD, blind-spot behavior) must NOT find it.
      const dirOnly = scanServerFlagReads([emptyDir]);
      expect(dirOnly.has('fixtureOnlyFlag')).toBe(false);

      // Directory root + file root (the FIX) must find it.
      const dirPlusFile = scanServerFlagReads([emptyDir, monolithFile]);
      expect(dirPlusFile.has('fixtureOnlyFlag')).toBe(true);
      expect([...dirPlusFile.get('fixtureOnlyFlag').defaults]).toEqual(['true']);
      expect(dirPlusFile.get('fixtureOnlyFlag').files[0]).toMatch(/index\.js:2$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fixture: scanModelFlagReads detects a getModelFlag() call site living in a FILE root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'feature-manifest-fixture-'));
    try {
      const monolithFile = join(tmp, 'index.js');
      writeFileSync(
        monolithFile,
        "async function f(db) {\n  const on = await getModelFlag(db, 'model.fixtureWrite');\n  return on;\n}\n"
      );
      const result = scanModelFlagReads([monolithFile]);
      expect(result.has('model.fixtureWrite')).toBe(true);
      expect(result.get('model.fixtureWrite')[0]).toMatch(/index\.js:2$/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fixture: scanDarkConstants and scanClientFlagReadSites also accept a FILE root', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'feature-manifest-fixture-'));
    try {
      const monolithFile = join(tmp, 'index.js');
      writeFileSync(
        monolithFile,
        "export const FIXTURE_KILL_SWITCH = true;\nfunction g() { return getFlag('fixtureClientFlag'); }\n"
      );
      const darkRows = scanDarkConstants([monolithFile]);
      expect(darkRows.some((r) => r.name === 'FIXTURE_KILL_SWITCH' && r.value === true)).toBe(true);

      const clientSites = scanClientFlagReadSites([monolithFile]);
      expect(clientSites.has('fixtureClientFlag')).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('REAL REPO: model.embeddingWriteV2 is detected as wired via functions/index.js (the exact prior false-negative)', () => {
    const data = buildManifestData();
    const row = data.flagRows.find((r) => r.name === 'model.embeddingWriteV2');
    expect(row).toBeDefined();
    // The load-bearing assertion: at least one real getModelFlag() call site
    // was found, and it lives in functions/index.js (generateEmbeddingInternal),
    // not functions/src — this is exactly what the old functions/src-only scan
    // root missed, producing the false "zero callers" manifest claim.
    expect(row.modelFlagReadFiles.length).toBeGreaterThan(0);
    expect(row.modelFlagReadFiles.some((f) => f.startsWith('functions/index.js:'))).toBe(true);
    // The rendered surface text must no longer assert "zero callers" —
    // pin the absence of the old false claim, not just the presence of a new one.
    expect(row.surface).not.toMatch(/zero callers/i);
    expect(row.surface).toMatch(/functions\/index\.js:\d+/);
  });

  it('REAL REPO: serverAnalysisOrchestrator picks up BOTH functions/index.js call sites the old scan missed', () => {
    const data = buildManifestData();
    const row = data.flagRows.find((r) => r.name === 'serverAnalysisOrchestrator');
    expect(row).toBeDefined();
    const indexJsSites = row.serverReadFiles.filter((f) => f.startsWith('functions/index.js:'));
    // Reviewer found index.js:2183 and index.js:2312 specifically.
    expect(indexJsSites.length).toBeGreaterThanOrEqual(2);
    // functions/src call sites (watchdogGuards.js, entryUpdateAnalysis.js) must still be present too.
    expect(row.serverReadFiles.some((f) => f.startsWith('functions/src/triggers/watchdogGuards.js:'))).toBe(true);
    expect(row.serverReadFiles.some((f) => f.startsWith('functions/src/triggers/entryUpdateAnalysis.js:'))).toBe(true);
  });
});

describe('flip-mechanism cells stay cleanly copy-pasteable (review fix wave, MINOR 1)', () => {
  it('an ALLOWED boolean flag\'s flipMechanism is JUST the command — no trailing prose spliced on', () => {
    const data = buildManifestData();
    const row = data.flagRows.find((r) => r.name === 'gentleRevisit');
    expect(row.flipMechanism).toBe('node scripts/flip-flag.mjs gentleRevisit true');
    // Timing prose lives in its own field/column instead.
    expect(row.takesEffect).toMatch(/next app load|within 60s/);
  });

  it('every flagRow flipMechanism that starts with the CLI command has no parenthetical timing note appended', () => {
    const data = buildManifestData();
    for (const row of data.flagRows) {
      if (row.flipMechanism.startsWith('node scripts/flip-flag.mjs')) {
        expect(row.flipMechanism).not.toMatch(/\(client:|\(server:/);
      }
    }
  });
});

describe('unified flags table never actually reaches the inStringAllowed branch today (review fix wave, MINOR 3)', () => {
  it('"STRING_ALLOWED-only" property: no name in the unified flagRows table is a STRING_ALLOWED key', () => {
    // Direct evidence for the one-line comment in buildManifestData()
    // explaining why the `inStringAllowed` branch at that point in the loop
    // is unreachable with current data (STRING_ALLOWED's keys are read via
    // getModel()'s template-literal getServerFlag call, which
    // scanServerFlagReads' string-literal regex deliberately never matches,
    // and none of them are declared in FLAG_DEFAULTS/MODEL_FLAG_DEFAULTS
    // either) — kept as a real, re-checked assertion rather than just prose,
    // so if this ever DOES become reachable (e.g. a future flag is both a
    // plain boolean AND string-overridable), this test goes red as a
    // deliberate signal to re-read that branch rather than trust stale prose.
    const data = buildManifestData();
    const flipFlagSrc = readFileSync(join(ROOT, 'scripts', 'flip-flag.mjs'), 'utf8');
    const STRING_ALLOWED = extractExportedLiteral(flipFlagSrc, 'STRING_ALLOWED');
    const stringAllowedNames = new Set(Object.keys(STRING_ALLOWED));
    const overlap = data.flagRows.filter((r) => stringAllowedNames.has(r.name));
    expect(overlap).toEqual([]);
  });
});

describe('committed manifest drift guard', () => {
  it('docs/ops/feature-manifest.md matches a fresh regeneration from current source (run `node scripts/generate-feature-manifest.js` and commit if this fails)', () => {
    const committed = readFileSync(join(ROOT, 'docs', 'ops', 'feature-manifest.md'), 'utf8');
    const fresh = renderManifest(buildManifestData());
    expect(committed).toBe(fresh);
  });
});
