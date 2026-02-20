/**
 * Hearthside palette verification for values components.
 * Ensures off-palette generic Tailwind colors have been replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readComponent = (filename) =>
  readFileSync(join(__dirname, '..', filename), 'utf-8');

describe('ValuesDashboard - Hearthside palette compliance', () => {
  const source = readComponent('ValuesDashboard.jsx');

  it('does not contain off-palette green/emerald classes', () => {
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
    expect(source).not.toMatch(/\bborder-green-\d/);
    expect(source).not.toMatch(/\bfrom-green-\d/);
    expect(source).not.toMatch(/\bto-emerald-\d/);
    expect(source).not.toMatch(/\bfrom-emerald-\d/);
  });

  it('does not contain off-palette amber classes', () => {
    expect(source).not.toMatch(/\bbg-amber-\d/);
    expect(source).not.toMatch(/\btext-amber-\d/);
  });

  it('does not contain off-palette rose classes', () => {
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-rose-\d/);
  });

  it('preserves red for declining/danger states', () => {
    expect(source).toMatch(/red-/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('ValueGapCard - Hearthside palette compliance', () => {
  const source = readComponent('ValueGapCard.jsx');

  it('does not contain off-palette blue/sky classes', () => {
    expect(source).not.toMatch(/\btext-blue-\d/);
    expect(source).not.toMatch(/\bfrom-blue-\d/);
    expect(source).not.toMatch(/\bto-sky-\d/);
    expect(source).not.toMatch(/\bborder-blue-\d/);
  });

  it('does not contain off-palette amber/orange classes', () => {
    expect(source).not.toMatch(/\btext-amber-\d/);
    expect(source).not.toMatch(/\bfrom-amber-\d/);
    expect(source).not.toMatch(/\bto-orange-\d/);
    expect(source).not.toMatch(/\bborder-amber-\d/);
  });

  it('does not contain off-palette rose/pink classes', () => {
    expect(source).not.toMatch(/\btext-rose-\d/);
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-pink-\d/);
    expect(source).not.toMatch(/\bborder-rose-\d/);
  });

  it('does not contain off-palette green classes', () => {
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('ValuesRadarChart - Hearthside palette compliance', () => {
  const source = readComponent('ValuesRadarChart.jsx');

  it('does not contain raw green/amber/red hex colors', () => {
    expect(source).not.toMatch(/#22c55e/i);
    expect(source).not.toMatch(/#f59e0b/i);
    expect(source).not.toMatch(/#16a34a/i);
    expect(source).not.toMatch(/#d97706/i);
  });
});
