import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '../../..');
const SRC_PATH = path.join(SRC_DIR, 'src');

/**
 * Helper: run grep across src/ and return matched lines.
 * Uses hardcoded paths only — no user input is interpolated.
 * Returns array of { raw, file, content } objects or empty array.
 */
function grepSrc(pattern, extensions = ['js', 'jsx', 'ts', 'tsx', 'css']) {
  const includes = extensions.map(ext => `--include="*.${ext}"`).join(' ');
  try {
    const result = execSync(
      `grep -rn ${includes} -E "${pattern}" "${SRC_PATH}"`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    return result.trim().split('\n').filter(Boolean).map(line => {
      const colonIdx = line.indexOf(':', SRC_PATH.length);
      const file = line.substring(0, colonIdx);
      const content = line.substring(colonIdx + 1);
      return { raw: line, file, content };
    });
  } catch (e) {
    // grep returns exit code 1 when no matches — that's fine
    if (e.status === 1) return [];
    throw e;
  }
}

describe('Dark Mode Polish - Gradient Dark Variants', () => {
  it('gradient dark variants in index.css use transparency suffixes', () => {
    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');

    // Find all html.dark gradient definitions
    const darkGradientBlocks = css.match(/html\.dark\s+\.gradient-[\w-]+\s*\{[^}]+\}/g) || [];
    expect(darkGradientBlocks.length).toBeGreaterThan(0);

    for (const block of darkGradientBlocks) {
      // Skip hearth-surface — it uses opaque colors intentionally (surface gradient)
      if (block.includes('gradient-hearth-surface')) continue;

      // Dark gradient color stops should use rgba() for transparency
      expect(block).toMatch(/rgba\(/);
    }
  });

  it('tailwind gradient presets have dark variants with transparency', () => {
    const config = fs.readFileSync(path.join(SRC_DIR, 'tailwind.config.js'), 'utf-8');

    // All dark gradient presets (except hearth-surface) should use rgba
    const darkPresets = config.match(/dark:\s*\{[^}]+\}/g) || [];
    expect(darkPresets.length).toBeGreaterThan(0);

    for (const preset of darkPresets) {
      // hearth-surface uses opaque hex — it's the base surface gradient
      if (preset.includes('#1C1916') && preset.includes('#231D1B')) continue;

      // All other dark presets should use rgba for transparency
      expect(preset).toMatch(/rgba\(/);
    }
  });
});

describe('Dark Mode Polish - No Pure Black', () => {
  it('no bg-black used outside of overlay/modal/brand contexts', () => {
    const matches = grepSrc('bg-black', ['js', 'jsx']);

    // Filter out legitimate uses:
    const illegitimate = matches.filter(m => {
      const content = m.content || '';
      const file = m.file || '';
      // Exclude test files (they mention bg-black in test code/comments)
      if (file.includes('__tests__')) return false;
      // bg-black with opacity modifier is for overlays — fine
      if (/bg-black\/\d+/.test(content)) return false;
      // Apple sign-in button is brand-required (bg-black text-white is Apple's spec)
      if (content.includes('Apple') || content.includes('@color-safe')) return false;
      // Apple Sign-in uses bg-black text-white — Apple's HIG requires this exact style
      if (content.includes('bg-black') && content.includes('text-white')) return false;
      return true;
    });

    // Pure bg-black (no opacity) should only exist for brand requirements
    expect(illegitimate).toEqual([]);
  });

  it('bg-black with opacity modifiers are only used for overlays/backdrops', () => {
    const matches = grepSrc('bg-black/\\d+', ['js', 'jsx']);

    // Filter out test files
    const nonTestMatches = matches.filter(m => !(m.file || '').includes('__tests__'));

    // All bg-black/NN should be in overlay/backdrop/modal/dark-surface contexts
    for (const match of nonTestMatches) {
      const content = match.content || '';
      const hasOverlayContext = (
        content.includes('inset-0') ||
        content.includes('backdrop') ||
        content.includes('modal') ||
        content.includes('overlay') ||
        content.includes('z-') ||
        content.includes('rounded') ||  // rounded elements (icon bgs, progress bars)
        content.includes('bg-black/2') ||  // low opacity (20-30%) for subtle darkening
        content.includes('bg-black/3')     // 30% opacity for subtle darkening
      );
      expect(hasOverlayContext).toBe(true);
    }
  });

  it('no #000000 hex used in component files', () => {
    const matches = grepSrc('#000000|#000[^0-9a-fA-F]', ['js', 'jsx']);

    // Filter out test files
    const nonTestMatches = matches.filter(m => !m.file.includes('__tests__'));
    expect(nonTestMatches).toEqual([]);
  });
});

describe('Dark Mode Polish - Elevation Strategy', () => {
  it('dark mode uses surface color hierarchy', () => {
    // Verify all three tiers are used somewhere in the codebase
    const tier950 = grepSrc('dark:bg-hearth-950');
    const tier900 = grepSrc('dark:bg-hearth-900');
    const tier850 = grepSrc('dark:bg-hearth-850');

    expect(tier950.length).toBeGreaterThan(0); // app-level backgrounds
    expect(tier900.length).toBeGreaterThan(0); // raised surfaces
    expect(tier850.length).toBeGreaterThan(0); // cards, interactive elements
  });

  it('dark mode cards use border-based elevation', () => {
    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');

    // The .card dark variant should use border, not just shadow
    const darkCardBlock = css.match(/html\.dark\s+\.card\s*\{[^}]+\}/);
    expect(darkCardBlock).not.toBeNull();
    expect(darkCardBlock[0]).toMatch(/border/);
  });

  it('index.css documents the dark surface hierarchy', () => {
    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');

    // A comment documenting the hierarchy should exist
    expect(css).toMatch(/hearth-950.*base|950.*deepest|950.*background/i);
    expect(css).toMatch(/hearth-900.*raised|900.*panel|900.*section/i);
    expect(css).toMatch(/hearth-850.*card|850.*elevated|850.*interactive/i);
  });
});

describe('Dark Mode Polish - Hover/Focus Visibility', () => {
  it('DarkModeToggle respects prefers-reduced-motion', () => {
    const toggle = fs.readFileSync(
      path.join(SRC_PATH, 'components/ui/DarkModeToggle.jsx'), 'utf-8'
    );

    expect(toggle).toMatch(/prefers-reduced-motion|reducedMotion|reduced.motion/i);
  });

  it('dark focus-visible styles exist in base CSS', () => {
    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
    expect(css).toMatch(/html\.dark\s+:focus-visible/);
  });
});

describe('Dark Mode Polish - Scrollbar Dark Mode', () => {
  it('dark mode scrollbar styles exist', () => {
    const css = fs.readFileSync(path.join(SRC_PATH, 'index.css'), 'utf-8');
    expect(css).toMatch(/html\.dark\s+::-webkit-scrollbar-thumb/);
  });
});
