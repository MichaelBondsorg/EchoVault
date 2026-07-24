/**
 * `scripts/__tests__/feature-manifest.test.js` — OPS-01 generated-manifest tests.
 *
 * Three concerns, mirroring `check-bundle-budget.test.js`'s precedent of
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
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ROOT,
  findMatchingBracket,
  extractExportedLiteral,
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
    expect(row.serverReadFiles).toContain('functions/src/intents/extractIntents.js');
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

describe('committed manifest drift guard', () => {
  it('docs/ops/feature-manifest.md matches a fresh regeneration from current source (run `node scripts/generate-feature-manifest.js` and commit if this fails)', () => {
    const committed = readFileSync(join(ROOT, 'docs', 'ops', 'feature-manifest.md'), 'utf8');
    const fresh = renderManifest(buildManifestData());
    expect(committed).toBe(fresh);
  });
});
