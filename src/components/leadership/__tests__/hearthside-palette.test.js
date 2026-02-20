/**
 * Hearthside palette verification for leadership components.
 * Ensures off-palette generic Tailwind colors have been replaced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const readComponent = (filename) =>
  readFileSync(join(__dirname, '..', filename), 'utf-8');

describe('PostMortem - Hearthside palette compliance', () => {
  const source = readComponent('PostMortem.jsx');

  it('does not contain off-palette blue classes', () => {
    expect(source).not.toMatch(/\bborder-blue-\d/);
    expect(source).not.toMatch(/\bfrom-blue-\d/);
    expect(source).not.toMatch(/\bto-blue-\d/);
    expect(source).not.toMatch(/\bbg-blue-\d/);
    expect(source).not.toMatch(/\btext-blue-\d/);
    expect(source).not.toMatch(/\bfocus:border-blue/);
    expect(source).not.toMatch(/\bfocus:ring-blue/);
  });

  it('does not contain off-palette rose classes', () => {
    expect(source).not.toMatch(/\bborder-rose-\d/);
    expect(source).not.toMatch(/\bfrom-rose-\d/);
    expect(source).not.toMatch(/\bto-rose-\d/);
    expect(source).not.toMatch(/\bbg-rose-\d/);
    expect(source).not.toMatch(/\btext-rose-\d/);
  });

  it('does not contain off-palette purple classes', () => {
    expect(source).not.toMatch(/\bborder-purple-\d/);
    expect(source).not.toMatch(/\bfrom-purple-\d/);
    expect(source).not.toMatch(/\bto-purple-\d/);
    expect(source).not.toMatch(/\bbg-purple-\d/);
    expect(source).not.toMatch(/\btext-purple-\d/);
    expect(source).not.toMatch(/\bfocus:ring-purple/);
  });

  it('does not contain off-palette amber classes (except in palette names)', () => {
    expect(source).not.toMatch(/\bborder-amber-\d/);
    expect(source).not.toMatch(/\bfrom-amber-\d/);
    expect(source).not.toMatch(/\bto-amber-\d/);
    expect(source).not.toMatch(/\bbg-amber-\d/);
    expect(source).not.toMatch(/\btext-amber-\d/);
  });

  it('does not contain off-palette green classes', () => {
    expect(source).not.toMatch(/\bfrom-green-\d/);
    expect(source).not.toMatch(/\bto-green-\d/);
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\bfocus:border-green/);
    expect(source).not.toMatch(/\bfocus:ring-green/);
  });

  it('does not contain off-palette teal classes', () => {
    expect(source).not.toMatch(/\bborder-teal-\d/);
    expect(source).not.toMatch(/\bfrom-teal-\d/);
    expect(source).not.toMatch(/\bto-teal-\d/);
    expect(source).not.toMatch(/\bbg-teal-\d/);
    expect(source).not.toMatch(/\btext-teal-\d/);
    expect(source).not.toMatch(/\bfocus:border-teal/);
    expect(source).not.toMatch(/\bfocus:ring-teal/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});

describe('LeadershipThreadCard - Hearthside palette compliance', () => {
  const source = readComponent('LeadershipThreadCard.jsx');

  it('does not contain off-palette green classes (excluding red for concerning)', () => {
    expect(source).not.toMatch(/\bbg-green-\d/);
    expect(source).not.toMatch(/\btext-green-\d/);
    expect(source).not.toMatch(/\bborder-green-\d/);
    expect(source).not.toMatch(/\bfocus:border-green/);
  });

  it('does not contain off-palette blue classes', () => {
    expect(source).not.toMatch(/\bbg-blue-\d/);
    expect(source).not.toMatch(/\btext-blue-\d/);
  });

  it('preserves red classes for concerning/danger states', () => {
    expect(source).toMatch(/red-/);
  });

  it('contains dark: variant classes', () => {
    expect(source).toMatch(/dark:/);
  });
});
