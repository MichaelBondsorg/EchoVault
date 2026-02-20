/**
 * Dashboard Shared Components - Hearthside Palette Verification Tests
 *
 * These tests verify that the dashboard shared components have been
 * updated to use Hearthside palette colors and include dark mode support.
 * They read the actual source files and grep for off-palette classes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SHARED_DIR = resolve(__dirname, '..');

// Helper: read a component file's source
const readComponent = (filename) =>
  readFileSync(resolve(SHARED_DIR, filename), 'utf-8');

// Off-palette color patterns to check for absence
const OFF_PALETTE_PATTERNS = [
  /\bbg-purple-\d+/,
  /\btext-purple-\d+/,
  /\bborder-purple-\d+/,
  /\bbg-blue-\d+/,
  /\btext-blue-\d+/,
  /\bborder-blue-\d+/,
  /\bbg-green-\d+/,
  /\btext-green-\d+/,
  /\bborder-green-\d+/,
  /\bbg-indigo-\d+/,
  /\btext-indigo-\d+/,
  /\bborder-indigo-\d+/,
  /\bbg-violet-\d+/,
  /\btext-violet-\d+/,
  /\bborder-violet-\d+/,
  /\bbg-sky-\d+/,
  /\btext-sky-\d+/,
  /\bbg-emerald-\d+/,
  /\btext-emerald-\d+/,
  /\bbg-cyan-\d+/,
  /\btext-cyan-\d+/,
  /\bbg-teal-\d+/,
  /\btext-teal-\d+/,
  /\bbg-pink-\d+/,
  /\btext-pink-\d+/,
  /\bbg-orange-\d+/,
  /\btext-orange-\d+/,
  /\bfrom-indigo-\d+/,
  /\bfrom-violet-\d+/,
  /\bfrom-sky-\d+/,
  /\bto-indigo-\d+/,
  /\bto-purple-\d+/,
  /\bto-emerald-\d+/,
  /\bto-cyan-\d+/,
  /\bto-pink-\d+/,
  /\bto-orange-\d+/,
];

// Files that should have zero off-palette references after the sweep
const COMPONENT_FILES = [
  'InsightBite.jsx',
  'HeroCard.jsx',
  'CurrentConditions.jsx',
  'SituationTimeline.jsx',
  'InsightsSection.jsx',
  'PeopleSection.jsx',
  'SelfTalkSection.jsx',
  'FeedbackLoop.jsx',
  'GoalsProgress.jsx',
  'WeeklyDigest.jsx',
  'QuickStatsBar.jsx',
  'WinsSection.jsx',
  'TasksSection.jsx',
  'NarrativeDigest.jsx',
  'ReflectionPrompts.jsx',
];

// Helper to find violations excluding @color-safe lines
const findOffPaletteViolations = (source) => {
  const lines = source.split('\n');
  const violations = [];
  lines.forEach((line) => {
    if (line.includes('@color-safe')) return;
    OFF_PALETTE_PATTERNS.forEach((pattern) => {
      const matches = line.match(new RegExp(pattern.source, 'g'));
      if (matches) {
        violations.push(...matches);
      }
    });
  });
  return violations;
};

describe('Dashboard shared components - off-palette removal', () => {
  COMPONENT_FILES.forEach((filename) => {
    it(`${filename} has no off-palette color classes`, () => {
      const source = readComponent(filename);
      const violations = findOffPaletteViolations(source);
      expect(violations, `Off-palette classes found in ${filename}: ${violations.join(', ')}`).toEqual([]);
    });
  });
});

describe('Dashboard shared components - dark mode support', () => {
  COMPONENT_FILES.forEach((filename) => {
    it(`${filename} contains dark: class prefixes`, () => {
      const source = readComponent(filename);
      const darkClasses = source.match(/dark:/g) || [];
      // Every component should have at least some dark mode classes
      expect(darkClasses.length, `${filename} should have dark: classes`).toBeGreaterThan(0);
    });
  });
});

describe('Dashboard shared components - uses Hearthside palette', () => {
  it('InsightBite uses sage/honey/lavender/hearth palette', () => {
    const source = readComponent('InsightBite.jsx');
    expect(source).toMatch(/\b(sage|honey|lavender|terra|hearth|warm)-\d+/);
  });

  it('HeroCard uses Hearthside palette for mode styles', () => {
    const source = readComponent('HeroCard.jsx');
    expect(source).toMatch(/\b(honey|terra|sage|lavender|hearth|warm)-\d+/);
  });

  it('CurrentConditions uses Hearthside palette for weather display', () => {
    const source = readComponent('CurrentConditions.jsx');
    expect(source).toMatch(/\b(lavender|sage|honey|terra|hearth|warm)-\d+/);
  });

  it('SituationTimeline uses Hearthside palette instead of indigo', () => {
    const source = readComponent('SituationTimeline.jsx');
    expect(source).toMatch(/\b(lavender|sage|honey|terra|hearth|warm)-\d+/);
    expect(source).not.toMatch(/\bbg-indigo-\d+/);
    expect(source).not.toMatch(/\btext-indigo-\d+/);
  });
});

// Exception: red-* in safety/crisis contexts is allowed.
// These components should NOT contain red-* for decorative purposes.
// PeopleSection uses red for negative sentiment - this should become terra.
describe('Dashboard shared components - red color audit', () => {
  it('PeopleSection does not use red-* for sentiment display', () => {
    const source = readComponent('PeopleSection.jsx');
    const lines = source.split('\n');
    const decorativeRed = [];
    lines.forEach((line) => {
      if (line.includes('@color-safe')) return;
      const matches = line.match(/\b(bg-red-|text-red-|border-red-)\d+/g);
      if (matches) decorativeRed.push(...matches);
    });
    expect(decorativeRed, 'PeopleSection should not use red for sentiment').toEqual([]);
  });
});
