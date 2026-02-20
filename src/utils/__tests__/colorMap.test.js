/**
 * colorMap.js — Centralized Color Mapping Utility Tests
 *
 * Tests all four mapping functions plus HEX_COLORS exports.
 * Pure function tests — no mocking needed.
 */
import { describe, it, expect } from 'vitest';
import {
  getEntryTypeColors,
  getPatternTypeColors,
  getEntityTypeColors,
  getTherapeuticColors,
  HEX_COLORS,
} from '../colorMap';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// --- Helper: validate class string structure ---
function expectLightAndDarkClasses(classString) {
  // Must contain at least one light-mode class and one dark: prefixed class
  expect(classString).toMatch(/\b(bg-|text-|border-)/);
  expect(classString).toMatch(/\bdark:/);
}

describe('getEntryTypeColors', () => {
  it('returns bg and text keys for each known type', () => {
    for (const type of ['task', 'mixed', 'vent', 'reflection']) {
      const result = getEntryTypeColors(type);
      expect(result).toHaveProperty('bg');
      expect(result).toHaveProperty('text');
    }
  });

  it('returns strings containing both light and dark: classes', () => {
    for (const type of ['task', 'mixed', 'vent', 'reflection']) {
      const result = getEntryTypeColors(type);
      expectLightAndDarkClasses(result.bg);
      expectLightAndDarkClasses(result.text);
    }
  });

  it('maps task to honey palette', () => {
    const result = getEntryTypeColors('task');
    expect(result.bg).toMatch(/honey/);
  });

  it('maps vent to terra palette', () => {
    const result = getEntryTypeColors('vent');
    expect(result.bg).toMatch(/terra/);
  });

  it('returns a fallback for unknown type', () => {
    const result = getEntryTypeColors('nonexistent');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('text');
    expectLightAndDarkClasses(result.bg);
  });
});

describe('getPatternTypeColors', () => {
  const allPatterns = [
    'weekly_high', 'best_day', 'positive_activity',
    'worst_day', 'negative_activity',
    'weekly_low', 'trigger_correlation',
    'sentiment_contradiction', 'avoidance_contradiction',
    'goal_abandonment',
    'recovery_pattern',
  ];

  it('returns bg, border, and text keys for each known pattern type', () => {
    for (const pattern of allPatterns) {
      const result = getPatternTypeColors(pattern);
      expect(result).toHaveProperty('bg');
      expect(result).toHaveProperty('border');
      expect(result).toHaveProperty('text');
    }
  });

  it('maps positive patterns to sage palette classes', () => {
    for (const pattern of ['weekly_high', 'best_day', 'positive_activity']) {
      const result = getPatternTypeColors(pattern);
      expect(result.bg).toMatch(/sage/);
    }
  });

  it('maps negative patterns to terra palette classes', () => {
    for (const pattern of ['worst_day', 'negative_activity']) {
      const result = getPatternTypeColors(pattern);
      expect(result.bg).toMatch(/terra/);
    }
  });

  it('maps reflective patterns to lavender palette classes', () => {
    for (const pattern of ['weekly_low', 'trigger_correlation']) {
      const result = getPatternTypeColors(pattern);
      expect(result.bg).toMatch(/lavender/);
    }
  });

  it('returns a fallback for unknown pattern type', () => {
    const result = getPatternTypeColors('nonexistent');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('border');
    expect(result).toHaveProperty('text');
    expectLightAndDarkClasses(result.bg);
  });
});

describe('getEntityTypeColors', () => {
  const allEntities = [
    '@person', '@place', '@goal', '@activity',
    '@event', '@food', '@media',
  ];

  it('returns bg and text keys for each entity type', () => {
    for (const entity of allEntities) {
      const result = getEntityTypeColors(entity);
      expect(result).toHaveProperty('bg');
      expect(result).toHaveProperty('text');
    }
  });

  it('returns a fallback for unknown entity type', () => {
    const result = getEntityTypeColors('@unknown');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('text');
    expectLightAndDarkClasses(result.bg);
  });
});

describe('getTherapeuticColors', () => {
  const allFrameworks = [
    'ACT', 'CBT', 'DBT', 'RAIN',
    'celebration', 'committed_action', 'values',
  ];

  it('returns bg, text, and border keys for each framework', () => {
    for (const framework of allFrameworks) {
      const result = getTherapeuticColors(framework);
      expect(result).toHaveProperty('bg');
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('border');
    }
  });

  it('returns a fallback for unknown framework', () => {
    const result = getTherapeuticColors('unknown');
    expect(result).toHaveProperty('bg');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('border');
    expectLightAndDarkClasses(result.bg);
  });
});

describe('HEX_COLORS', () => {
  it('exports hex strings matching #XXXXXX pattern', () => {
    for (const [name, value] of Object.entries(HEX_COLORS)) {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('includes at least honey, terra, sage, lavender, hearth entries', () => {
    expect(HEX_COLORS).toHaveProperty('honey');
    expect(HEX_COLORS).toHaveProperty('terra');
    expect(HEX_COLORS).toHaveProperty('sage');
    expect(HEX_COLORS).toHaveProperty('lavender');
    expect(HEX_COLORS).toHaveProperty('hearth');
  });
});

describe('class string validity', () => {
  it('all returned class strings contain only valid Tailwind prefixes', () => {
    const validPrefixes = ['bg-', 'text-', 'border-', 'dark:', 'ring-'];
    const allFunctions = [
      () => getEntryTypeColors('task'),
      () => getPatternTypeColors('weekly_high'),
      () => getEntityTypeColors('@person'),
      () => getTherapeuticColors('ACT'),
    ];

    for (const fn of allFunctions) {
      const result = fn();
      for (const value of Object.values(result)) {
        const classes = value.split(/\s+/);
        for (const cls of classes) {
          const hasValidPrefix = validPrefixes.some(p => cls.startsWith(p));
          expect(hasValidPrefix).toBe(true);
        }
      }
    }
  });
});

describe('safelist comment block', () => {
  it('contains every Tailwind class string used in the mappings', () => {
    const source = readFileSync(
      resolve(__dirname, '../colorMap.js'),
      'utf-8'
    );

    // Extract the safelist comment block
    const safelistMatch = source.match(
      /\/\*\s*TAILWIND_SAFELIST[\s\S]*?\*\//
    );
    expect(safelistMatch).not.toBeNull();
    const safelistBlock = safelistMatch[0];

    // Extract all Tailwind classes from mapping objects (bg-*, text-*, border-*, dark:bg-*, etc.)
    const classPattern = /(?:dark:)?(?:bg|text|border|ring)-[\w/-]+/g;
    const allClasses = new Set();

    // Get classes from the rest of the file (outside the safelist block)
    const restOfFile = source.replace(safelistBlock, '');
    const matches = restOfFile.matchAll(classPattern);
    for (const match of matches) {
      allClasses.add(match[0]);
    }

    // Every class used in mappings should appear in the safelist block
    for (const cls of allClasses) {
      expect(safelistBlock).toContain(cls);
    }
  });
});
