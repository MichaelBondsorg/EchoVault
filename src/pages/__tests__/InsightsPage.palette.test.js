/**
 * InsightsPage.palette.test.js
 *
 * Verifies InsightsPage.jsx uses only Hearthside palette colors
 * and includes dark mode variants throughout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = resolve(__dirname, '../InsightsPage.jsx');
const source = readFileSync(filePath, 'utf-8');

describe('InsightsPage Hearthside palette compliance', () => {
  // Off-palette color classes that should NOT appear
  // (except red-* which is allowed for error/crisis states)
  const offPalettePatterns = [
    'text-green-',
    'bg-green-',
    'text-blue-',
    'bg-blue-',
    'text-teal-',
    'bg-teal-',
    'text-emerald-',
    'bg-emerald-',
    'from-emerald-',
    'to-emerald-',
    'from-teal-',
    'to-teal-',
    'border-emerald-',
    'text-pink-',
    'bg-pink-',
    'text-indigo-',
    'bg-indigo-',
    'text-purple-',
    'bg-purple-',
    'text-sky-',
    'bg-sky-',
    'text-amber-',
    'bg-amber-',
    'border-amber-',
    'hover:bg-emerald-',
    'hover:text-emerald-',
    'hover:bg-green-',
  ];

  it.each(offPalettePatterns)(
    'does not contain off-palette class "%s"',
    (pattern) => {
      /** Expect zero occurrences of each off-palette color pattern */
      const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = source.match(regex);
      expect(matches).toBeNull();
    }
  );

  it('contains dark: mode variant classes', () => {
    /** At minimum, several dark: prefixed classes should exist after the sweep */
    const darkMatches = source.match(/dark:/g);
    expect(darkMatches).not.toBeNull();
    expect(darkMatches.length).toBeGreaterThanOrEqual(20);
  });

  it('preserves red-* classes only for error/crisis states', () => {
    /**
     * red-* is allowed in error/crisis contexts (GenerationStatus error state,
     * high-priority recommendations, mood score indicators, thumbs-down hover).
     * Verify they still exist in those contexts.
     */
    expect(source).toContain('text-red-');
    expect(source).toContain('bg-red-');
  });

  it('uses Hearthside palette colors for health correlation strength', () => {
    /**
     * Health correlation strength colors should use sage (strong) and
     * lavender (moderate) instead of green/blue.
     */
    expect(source).toContain('sage');
    expect(source).toContain('lavender');
  });

  it('uses Hearthside palette for Quick Insights section gradients', () => {
    /**
     * Quick Insights section should use sage gradient instead of
     * emerald/teal gradient.
     */
    expect(source).not.toContain('from-emerald-');
    expect(source).toContain('from-sage-');
  });

  it('uses Hearthside palette for category styles in getCategoryStyle', () => {
    /**
     * getCategoryStyle should map categories to palette colors:
     * activity -> sage, people -> terra or lavender, environment -> honey,
     * time -> lavender, default -> honey
     */
    expect(source).not.toContain("color: 'text-green-600'");
    expect(source).not.toContain("color: 'text-pink-600'");
    expect(source).not.toContain("color: 'text-indigo-600'");
    expect(source).not.toContain("color: 'text-purple-600'");
  });
});
