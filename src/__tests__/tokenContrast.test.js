/**
 * A11Y-01 (2026-07-24 product review) — automated WCAG contrast checks for
 * the Cloud design system's text tokens.
 *
 * This is pure math over the CSS custom properties declared in
 * src/styles/cloud-tokens.css — no rendering, no jsdom computed-style
 * lookups. It parses the bare `:root { ... }` (light) and `:root.dark
 * { ... }` (dark) blocks, resolves one level of `var(--x)` indirection
 * (enough for this file's `--muted-foreground: var(--text-secondary)`
 * style aliases), and computes WCAG 2.x relative-luminance contrast ratios
 * against the two documented backgrounds a text token can sit on:
 * `--background` (page background) and `--card` (card/sheet surface).
 *
 * Token tiers (see cloud-tokens.css comments for full rationale):
 *   --text-secondary / --muted-foreground / --faint  → readable text
 *     (captions, timestamps, helper copy, card metadata). Must clear the
 *     WCAG 1.4.3 normal-text floor: >= 4.5:1.
 *   --text-placeholder                               → input placeholders /
 *     disabled affordances. Not required to hit 4.5:1 (WCAG's normal-text
 *     floor doesn't apply to placeholder or disabled content), but held to
 *     a >= 3:1 floor so it stays legible.
 *   --text-decorative                                → non-text ornaments
 *     (illustrative icons, disabled icon glyphs, decorative status dots).
 *     WCAG 1.4.11 non-text contrast doesn't apply to pure decoration or to
 *     disabled controls, so this tier is intentionally unconstrained — no
 *     ratio assertion, just a sanity check that it parses to a real color.
 *
 * `--muted-foreground` and `--faint` are asserted to literally resolve to
 * `--text-secondary` (not just "happen to pass 4.5:1") — that alias is the
 * whole point of the smallest-diff migration direction chosen for A11Y-01
 * (see .superpowers/sdd/task-a11y01-report.md): repointing those two
 * long-established Tailwind utility names at a compliant color fixes every
 * existing `text-muted-foreground` / `text-faint` call site's contrast
 * globally, without touching the ~50 component files that consume them.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = path.resolve(__dirname, '../styles/cloud-tokens.css');

// ─── WCAG 2.x relative luminance / contrast ratio ──────────────────────────

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const int = parseInt(full, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function channelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [lighter, darker] = lA >= lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// ─── Tiny CSS custom-property parser ───────────────────────────────────────

/**
 * Extracts the FIRST bare `:root { ... }` (or `:root.dark { ... }`) block's
 * body. Deliberately does NOT match `:root[data-accent='blue'] { ... }`
 * variants — the `\s*\{` right after the selector requires the brace to
 * follow immediately (only whitespace between), which the `[...]`
 * attribute-selector blocks break.
 */
function extractBlock(css, selector) {
  const re = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`);
  const match = css.match(re);
  if (!match) throw new Error(`Could not find "${selector} { ... }" block in cloud-tokens.css`);
  return match[1];
}

function parseVars(blockBody) {
  const vars = {};
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockBody)) !== null) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

/** Resolves a value that may itself be `var(--other-name)`, one level deep. */
function resolveVar(name, vars, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Circular var() reference detected at --${name}`);
  seen.add(name);
  const raw = vars[name];
  if (raw === undefined) throw new Error(`--${name} not found in parsed token block`);
  const refMatch = raw.match(/^var\(--([\w-]+)\)$/);
  if (refMatch) return resolveVar(refMatch[1], vars, seen);
  return raw;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

let lightVars;
let darkVars;

beforeAll(() => {
  const css = fs.readFileSync(TOKENS_PATH, 'utf-8');
  lightVars = parseVars(extractBlock(css, ':root'));
  darkVars = parseVars(extractBlock(css, ':root.dark'));
});

const READABLE_TOKENS = ['text-secondary', 'muted-foreground', 'faint'];
const PLACEHOLDER_TOKENS = ['text-placeholder'];
const DECORATIVE_TOKENS = ['text-decorative'];

const READABLE_FLOOR = 4.5; // WCAG 1.4.3 normal-text minimum
const PLACEHOLDER_FLOOR = 3.0; // house floor; WCAG doesn't mandate a minimum here

describe('A11Y-01: token contrast — light theme (:root)', () => {
  it('resolves --background and --card to real hex colors', () => {
    expect(resolveVar('background', lightVars)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolveVar('card', lightVars)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  for (const token of READABLE_TOKENS) {
    it(`--${token} clears ${READABLE_FLOOR}:1 on --background and --card`, () => {
      const fg = resolveVar(token, lightVars);
      for (const bgName of ['background', 'card']) {
        const bg = resolveVar(bgName, lightVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `--${token} (${fg}) vs --${bgName} (${bg}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(READABLE_FLOOR);
      }
    });
  }

  for (const token of PLACEHOLDER_TOKENS) {
    it(`--${token} clears ${PLACEHOLDER_FLOOR}:1 on --background and --card`, () => {
      const fg = resolveVar(token, lightVars);
      for (const bgName of ['background', 'card']) {
        const bg = resolveVar(bgName, lightVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `--${token} (${fg}) vs --${bgName} (${bg}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(PLACEHOLDER_FLOOR);
      }
    });
  }

  for (const token of DECORATIVE_TOKENS) {
    it(`--${token} parses to a real color (unconstrained by design)`, () => {
      expect(resolveVar(token, lightVars)).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it('--muted-foreground and --faint both alias --text-secondary (migration direction lock)', () => {
    expect(resolveVar('muted-foreground', lightVars)).toBe(resolveVar('text-secondary', lightVars));
    expect(resolveVar('faint', lightVars)).toBe(resolveVar('text-secondary', lightVars));
  });
});

describe('A11Y-01: token contrast — dark theme (:root.dark)', () => {
  it('resolves --background and --card to real hex colors', () => {
    expect(resolveVar('background', darkVars)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(resolveVar('card', darkVars)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  for (const token of READABLE_TOKENS) {
    it(`--${token} clears ${READABLE_FLOOR}:1 on --background and --card`, () => {
      const fg = resolveVar(token, darkVars);
      for (const bgName of ['background', 'card']) {
        const bg = resolveVar(bgName, darkVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `--${token} (${fg}) vs --${bgName} (${bg}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(READABLE_FLOOR);
      }
    });
  }

  for (const token of PLACEHOLDER_TOKENS) {
    it(`--${token} clears ${PLACEHOLDER_FLOOR}:1 on --background and --card`, () => {
      const fg = resolveVar(token, darkVars);
      for (const bgName of ['background', 'card']) {
        const bg = resolveVar(bgName, darkVars);
        const ratio = contrastRatio(fg, bg);
        expect(ratio, `--${token} (${fg}) vs --${bgName} (${bg}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(PLACEHOLDER_FLOOR);
      }
    });
  }

  for (const token of DECORATIVE_TOKENS) {
    it(`--${token} parses to a real color (unconstrained by design)`, () => {
      expect(resolveVar(token, darkVars)).toMatch(/^#[0-9a-f]{6}$/i);
    });
  }

  it('--muted-foreground and --faint both alias --text-secondary (migration direction lock)', () => {
    expect(resolveVar('muted-foreground', darkVars)).toBe(resolveVar('text-secondary', darkVars));
    expect(resolveVar('faint', darkVars)).toBe(resolveVar('text-secondary', darkVars));
  });
});

describe('A11Y-01: regression guards on the raw failing values from the review', () => {
  // The review measured: --text-muted ~3.64:1 on white / 3.36:1 on main
  // light bg; --text-faint ~2.27:1; dark faint ~3.09:1. These map to this
  // codebase's --muted-foreground / --faint tokens. Assert the OLD failing
  // hex values are no longer what those tokens resolve to, so a careless
  // revert of the alias (reintroducing a raw hex) gets caught even if the
  // ratio assertions above were somehow loosened.
  it('light --muted-foreground / --faint no longer use the pre-fix hex values', () => {
    expect(resolveVar('muted-foreground', lightVars).toLowerCase()).not.toBe('#8a867b');
    expect(resolveVar('faint', lightVars).toLowerCase()).not.toBe('#b0aca1');
  });

  it('dark --faint no longer uses the pre-fix hex value', () => {
    expect(resolveVar('faint', darkVars).toLowerCase()).not.toBe('#6a6b6e');
  });
});
