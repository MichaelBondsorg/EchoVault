import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Section 07: colorMap Consumer Verification Tests
 *
 * These tests verify that EntryCard, InsightsPanel, and DailySummaryModal
 * have been migrated from off-palette Tailwind color classes to the
 * centralized colorMap.js semantic color system.
 */

const readComponent = (relativePath) => {
  const fullPath = path.resolve(__dirname, '..', '..', relativePath);
  return fs.readFileSync(fullPath, 'utf-8');
};

/**
 * Helper: checks that none of the given off-palette patterns appear in the source.
 * Patterns are regex strings that match Tailwind class fragments.
 * Returns an array of { pattern, matches } for any violations found.
 */
const findOffPaletteViolations = (source, patterns) => {
  const violations = [];
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'g');
    const matches = source.match(regex);
    if (matches) {
      violations.push({ pattern, matches });
    }
  }
  return violations;
};

describe('Section 07: colorMap Consumer Verification', () => {
  describe('EntryCard.jsx - off-palette color removal', () => {
    let source;

    beforeAll(() => {
      source = readComponent('components/entries/EntryCard.jsx');
    });

    it('should not contain off-palette green classes (entity badges, celebration, CBT)', () => {
      // Match green-50, green-100, green-200, green-500, green-600, green-700, green-800
      // but NOT in comments or import statements
      const violations = findOffPaletteViolations(source, [
        '\\bgreen-50\\b',
        '\\bgreen-100\\b',
        '\\bgreen-600\\b',
        '\\bgreen-700\\b',
        '\\bgreen-800\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette amber classes (entity badges, ACT values)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bamber-50\\b',
        '\\bamber-100\\b',
        '\\bamber-600\\b',
        '\\bamber-700\\b',
        '\\bamber-800\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette blue classes (entity badges, weather)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bblue-50\\b',
        '\\bblue-600\\b',
        '\\bblue-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette purple classes (entity badges, sleep)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bpurple-50\\b',
        '\\bpurple-100\\b',
        '\\bpurple-600\\b',
        '\\bpurple-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette orange classes (entity badges, HRV)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\borange-50\\b',
        '\\borange-100\\b',
        '\\borange-600\\b',
        '\\borange-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette teal classes (ACT framework, mixed entry)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bteal-50\\b',
        '\\bteal-100\\b',
        '\\bteal-300\\b',
        '\\bteal-600\\b',
        '\\bteal-700\\b',
        '\\bteal-800\\b',
        '\\bteal-900\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette pink classes (vent entry type)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bpink-100\\b',
        '\\bpink-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette emerald classes (celebration)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bemerald-50\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette rose classes (self entity)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\brose-50\\b',
        '\\brose-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette slate classes (topic entity)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bslate-50\\b',
        '\\bslate-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette yellow classes (task entry type, task card)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\byellow-50\\b',
        '\\byellow-100\\b',
        '\\byellow-200\\b',
        '\\byellow-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should import colorMap functions', () => {
      expect(source).toMatch(/import\s+.*from\s+['"].*colorMap['"]/);
    });
  });

  describe('InsightsPanel.jsx - off-palette color removal', () => {
    let source;

    beforeAll(() => {
      source = readComponent('components/modals/InsightsPanel.jsx');
    });

    it('should not contain off-palette green classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bgreen-50\\b',
        '\\bgreen-200\\b',
        '\\bgreen-500\\b',
        '\\bgreen-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette amber classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bamber-50\\b',
        '\\bamber-200\\b',
        '\\bamber-500\\b',
        '\\bamber-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette blue classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bblue-50\\b',
        '\\bblue-200\\b',
        '\\bblue-500\\b',
        '\\bblue-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette purple classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bpurple-50\\b',
        '\\bpurple-200\\b',
        '\\bpurple-500\\b',
        '\\bpurple-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette orange classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\borange-50\\b',
        '\\borange-200\\b',
        '\\borange-500\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette violet classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bviolet-50\\b',
        '\\bviolet-200\\b',
        '\\bviolet-500\\b',
        '\\bviolet-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette indigo classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bindigo-50\\b',
        '\\bindigo-200\\b',
        '\\bindigo-500\\b',
        '\\bindigo-600\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette pink classes', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bpink-50\\b',
        '\\bpink-200\\b',
        '\\bpink-500\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should import colorMap functions', () => {
      expect(source).toMatch(/import\s+.*from\s+['"].*colorMap['"]/);
    });
  });

  describe('DailySummaryModal.jsx - off-palette color removal', () => {
    let source;

    beforeAll(() => {
      source = readComponent('components/modals/DailySummaryModal.jsx');
    });

    it('should not contain off-palette yellow classes (task badge)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\byellow-100\\b',
        '\\byellow-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette teal classes (mixed badge)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bteal-100\\b',
        '\\bteal-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should not contain off-palette pink classes (vent badge)', () => {
      const violations = findOffPaletteViolations(source, [
        '\\bpink-100\\b',
        '\\bpink-700\\b',
      ]);
      expect(violations).toEqual([]);
    });

    it('should import colorMap functions', () => {
      expect(source).toMatch(/import\s+.*from\s+['"].*colorMap['"]/);
    });
  });
});
