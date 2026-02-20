import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const filePath = resolve(__dirname, '../CollapsibleSection.jsx');
const fileContent = readFileSync(filePath, 'utf-8');

// Off-palette color prefixes that should NOT appear in color scheme definitions
const offPalette = {
  indigo: ['indigo'],
  green: ['green', 'emerald'],
  amber: ['amber', 'orange'],
  violet: ['violet', 'purple'],
  rose: ['rose', 'pink'],
  blue: ['blue', 'cyan'],
};

// Hearthside palette names that ARE allowed
const hearthsidePalettes = ['hearth', 'honey', 'terra', 'sage', 'lavender', 'warm'];

describe('CollapsibleSection color schemes', () => {

  it('does not contain off-palette indigo color classes', () => {
    for (const prefix of offPalette.indigo) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('does not contain off-palette green/emerald color classes', () => {
    for (const prefix of offPalette.green) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('does not contain off-palette amber/orange color classes', () => {
    for (const prefix of offPalette.amber) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('does not contain off-palette violet/purple color classes', () => {
    for (const prefix of offPalette.violet) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('does not contain off-palette rose/pink color classes', () => {
    for (const prefix of offPalette.rose) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('does not contain off-palette blue/cyan color classes', () => {
    for (const prefix of offPalette.blue) {
      expect(fileContent).not.toMatch(new RegExp(`from-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`bg-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`text-${prefix}-\\d`));
      expect(fileContent).not.toMatch(new RegExp(`border-${prefix}-\\d`));
    }
  });

  it('retains all 7 color scheme keys for backward compatibility', () => {
    const schemeKeys = ['indigo', 'green', 'amber', 'violet', 'rose', 'blue', 'warm'];
    for (const key of schemeKeys) {
      // Each key should appear as an object property in the colors object
      expect(fileContent).toMatch(new RegExp(`\\b${key}\\s*:\\s*\\{`));
    }
  });

  it('each color scheme includes dark: variant classes', () => {
    // Extract each scheme block and verify dark: variants
    const schemeKeys = ['indigo', 'green', 'amber', 'violet', 'rose', 'blue', 'warm'];
    for (const key of schemeKeys) {
      // Find the scheme block by matching key: { ... }
      const schemeRegex = new RegExp(`${key}\\s*:\\s*\\{([^}]+)\\}`, 's');
      const match = fileContent.match(schemeRegex);
      expect(match, `scheme "${key}" should exist`).toBeTruthy();
      const schemeBlock = match[1];
      expect(schemeBlock, `scheme "${key}" should have dark: variants`).toContain('dark:');
    }
  });

  it('warm color scheme retains warm- palette references', () => {
    const warmRegex = /warm\s*:\s*\{([^}]+)\}/s;
    const match = fileContent.match(warmRegex);
    expect(match).toBeTruthy();
    const warmBlock = match[1];
    expect(warmBlock).toContain('warm-50');
    expect(warmBlock).toContain('warm-100');
    expect(warmBlock).toContain('warm-200');
    expect(warmBlock).toContain('warm-400');
    expect(warmBlock).toContain('warm-600');
    expect(warmBlock).toContain('warm-800');
  });

  it('all color class strings use only Hearthside palette names', () => {
    // Extract color class references from scheme blocks
    const schemesBlock = fileContent.match(/const colors = \{([\s\S]*?)\n  \};/);
    expect(schemesBlock).toBeTruthy();
    const block = schemesBlock[1];

    // Find all color-shade references (e.g., from-xxx-100, bg-xxx-200, text-xxx-300, border-xxx-400)
    const colorRefs = block.match(/(?:from|to|bg|text|border)-([a-z]+)-\d+/g) || [];
    const paletteNames = colorRefs.map(ref => {
      const m = ref.match(/(?:from|to|bg|text|border)-([a-z]+)-\d+/);
      return m ? m[1] : null;
    }).filter(Boolean);

    const allowed = new Set([...hearthsidePalettes, 'white', 'black']);
    for (const name of paletteNames) {
      expect(allowed.has(name), `"${name}" is not a Hearthside palette color`).toBe(true);
    }
  });
});
