/**
 * Hearthside Palette Verification Tests — Reports
 *
 * Verifies that off-palette Tailwind color classes have been replaced
 * with Hearthside palette equivalents and dark mode variants are present.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readComponent = (filename) =>
  readFileSync(resolve(__dirname, '..', filename), 'utf-8');

describe('ReportChart.jsx — Hearthside palette', () => {
  const src = readComponent('ReportChart.jsx');

  it('should not contain raw off-palette hex colors in COLORS array', () => {
    expect(src).not.toContain('#6366f1');
    expect(src).not.toContain('#8b5cf6');
    expect(src).not.toContain('#14b8a6');
    expect(src).not.toContain('#f59e0b');
    expect(src).not.toContain('#ec4899');
    expect(src).not.toContain('#06b6d4');
  });

  it('should import HEX_COLORS from colorMap', () => {
    expect(src).toMatch(/import\s*\{[^}]*HEX_COLORS[^}]*\}\s*from/);
  });

  it('should add dark variant to bar chart container', () => {
    expect(src).toMatch(/dark:bg-warm-/);
  });
});

describe('ReportList.jsx — Hearthside palette', () => {
  const src = readComponent('ReportList.jsx');

  it('CADENCE_STYLES should not contain off-palette badge colors', () => {
    expect(src).not.toContain('bg-blue-100');
    expect(src).not.toContain('text-blue-700');
    expect(src).not.toContain('bg-indigo-100');
    expect(src).not.toContain('text-indigo-700');
    expect(src).not.toContain('bg-purple-100');
    expect(src).not.toContain('text-purple-700');
    expect(src).not.toContain('bg-amber-100');
    expect(src).not.toContain('text-amber-700');
  });

  it('should use Hearthside palette badge colors', () => {
    expect(src).toContain('bg-sage-100');
    expect(src).toContain('bg-lavender-100');
    expect(src).toContain('bg-honey-100');
    expect(src).toContain('bg-terra-100');
  });

  it('should include dark mode variants in CADENCE_STYLES', () => {
    expect(src).toMatch(/dark:bg-sage-/);
    expect(src).toMatch(/dark:bg-lavender-/);
    expect(src).toMatch(/dark:bg-honey-/);
    expect(src).toMatch(/dark:bg-terra-/);
  });

  it('should keep text-red-500 for failed state', () => {
    expect(src).toContain('text-red-500');
  });
});

describe('ReportPrivacyEditor.jsx — Hearthside palette', () => {
  const src = readComponent('ReportPrivacyEditor.jsx');

  it('should not contain indigo classes', () => {
    expect(src).not.toContain('text-indigo-500');
    expect(src).not.toContain('text-indigo-600');
    expect(src).not.toContain('focus:ring-indigo-500');
  });

  it('should use lavender replacements', () => {
    expect(src).toContain('text-lavender-500');
    expect(src).toContain('text-lavender-600');
  });
});

describe('ReportShareSheet.jsx — Hearthside palette', () => {
  const src = readComponent('ReportShareSheet.jsx');

  it('should not contain indigo or off-palette green', () => {
    expect(src).not.toContain('text-indigo-500');
    expect(src).not.toContain('text-green-500');
  });

  it('should use lavender and sage replacements', () => {
    expect(src).toContain('text-lavender-500');
    expect(src).toContain('text-sage-500');
  });

  it('should keep text-red-500 for error state', () => {
    expect(src).toContain('text-red-500');
  });
});

describe('ReportSection.jsx — Hearthside dark mode', () => {
  const src = readComponent('ReportSection.jsx');

  it('should have dark mode variants for entry ref badges', () => {
    expect(src).toMatch(/dark:text-honey-/);
    expect(src).toMatch(/dark:bg-honey-/);
  });
});

describe('ReportViewer.jsx — Hearthside dark mode', () => {
  const src = readComponent('ReportViewer.jsx');

  it('should have dark hover states on buttons', () => {
    expect(src).toMatch(/dark:hover:bg-warm-/);
  });

  it('should keep text-red-400 for failure state', () => {
    expect(src).toContain('text-red-400');
  });
});
