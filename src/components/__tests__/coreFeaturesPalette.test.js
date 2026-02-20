import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Verify that core feature components use only Hearthside palette colors.
 * These are file-content grep tests -- they read JSX source and assert
 * that off-palette Tailwind color classes have been replaced.
 */

const readComponent = (relativePath) =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf-8');

describe('RealtimeConversation.jsx palette compliance', () => {
  const source = readComponent('chat/RealtimeConversation.jsx');

  it('should not contain off-palette indigo/purple gradient classes', () => {
    expect(source).not.toMatch(/from-indigo-/);
    expect(source).not.toMatch(/to-indigo-/);
    expect(source).not.toMatch(/to-purple-/);
    expect(source).not.toMatch(/via-purple-/);
    expect(source).not.toMatch(/from-purple-/);
    expect(source).not.toMatch(/to-orange-/);
    expect(source).not.toMatch(/from-orange-/);
  });

  it('should not contain off-palette status indicator colors', () => {
    expect(source).not.toMatch(/bg-gray-400/);
    expect(source).not.toMatch(/bg-yellow-400/);
    expect(source).not.toMatch(/bg-green-400/);
    expect(source).not.toMatch(/bg-green-500/);
    expect(source).not.toMatch(/bg-indigo-500/);
  });

  it('should not contain focus:border-indigo-500', () => {
    expect(source).not.toMatch(/focus:border-indigo-/);
  });

  it('should not contain bg-indigo-600 or bg-indigo-500/20 for buttons/tags', () => {
    expect(source).not.toMatch(/bg-indigo-600/);
    expect(source).not.toMatch(/bg-indigo-500\/20/);
  });

  it('should not contain any text-indigo classes', () => {
    expect(source).not.toMatch(/text-indigo-/);
  });

  it('should not contain hover:bg-indigo classes', () => {
    expect(source).not.toMatch(/hover:bg-indigo-/);
  });

  it('should not contain off-palette gray button colors', () => {
    expect(source).not.toMatch(/bg-gray-700/);
    expect(source).not.toMatch(/bg-gray-500/);
    expect(source).not.toMatch(/hover:bg-gray-600/);
    expect(source).not.toMatch(/bg-gray-800/);
  });

  it('should not contain off-palette energy indicator colors', () => {
    expect(source).not.toMatch(/text-yellow-400/);
    expect(source).not.toMatch(/text-green-400/);
    expect(source).not.toMatch(/text-blue-400/);
  });

  it('should not contain off-palette mood slider colors', () => {
    expect(source).not.toMatch(/text-red-400/);
    expect(source).not.toMatch(/from-red-500 via-yellow-500 to-green-500/);
  });

  it('should not contain shadow-purple or shadow-green', () => {
    expect(source).not.toMatch(/shadow-purple-/);
    expect(source).not.toMatch(/shadow-green-/);
  });

  it('should use palette gradient for main background (hearth/lavender)', () => {
    expect(source).toMatch(/from-hearth-900/);
    expect(source).toMatch(/to-hearth-950/);
  });

  it('should use palette status colors (sage, honey, lavender, hearth)', () => {
    expect(source).toMatch(/bg-sage-400/);
    expect(source).toMatch(/bg-honey-400/);
    expect(source).toMatch(/bg-lavender-500/);
    expect(source).toMatch(/bg-hearth-400/);
  });

  it('should preserve red-500 for end-call button', () => {
    expect(source).toMatch(/bg-red-500/);
    expect(source).toMatch(/shadow-red-500/);
  });

  it('should preserve red in error display', () => {
    expect(source).toMatch(/bg-red-500\/20/);
    expect(source).toMatch(/border-red-400\/30/);
    expect(source).toMatch(/text-red-200/);
    expect(source).toMatch(/text-red-300/);
  });
});

describe('WeeklyReport.jsx palette compliance', () => {
  const source = readComponent('modals/WeeklyReport.jsx');

  it('should not contain text-indigo-600', () => {
    expect(source).not.toMatch(/text-indigo-600/);
  });

  it('should not contain text-gray classes', () => {
    expect(source).not.toMatch(/text-gray-/);
  });

  it('should contain dark: variant classes for modal background and text', () => {
    expect(source).toMatch(/dark:bg-hearth-/);
    expect(source).toMatch(/dark:text-hearth-/);
  });

  it('should use lavender for heading color', () => {
    expect(source).toMatch(/text-lavender-600/);
  });
});

describe('ErrorBoundary.jsx palette compliance', () => {
  const source = readComponent('ErrorBoundary.jsx');

  it('should not contain from-blue-50 or to-purple-50 gradients', () => {
    expect(source).not.toMatch(/from-blue-50/);
    expect(source).not.toMatch(/to-purple-50/);
  });

  it('should not contain bg-blue-600 for primary button', () => {
    expect(source).not.toMatch(/bg-blue-600/);
    expect(source).not.toMatch(/hover:bg-blue-700/);
  });

  it('should not contain bg-amber-100 for icon background', () => {
    expect(source).not.toMatch(/bg-amber-100/);
  });

  it('should not contain text-amber-600 for icon color', () => {
    expect(source).not.toMatch(/text-amber-600/);
  });

  it('should not contain off-palette gray classes', () => {
    expect(source).not.toMatch(/text-gray-900/);
    expect(source).not.toMatch(/text-gray-600/);
    expect(source).not.toMatch(/text-gray-700/);
    expect(source).not.toMatch(/text-gray-500/);
    expect(source).not.toMatch(/bg-gray-100/);
    expect(source).not.toMatch(/hover:bg-gray-200/);
  });

  it('should contain dark: variant classes throughout', () => {
    const darkCount = (source.match(/dark:/g) || []).length;
    expect(darkCount).toBeGreaterThanOrEqual(8);
  });

  it('should use warm/hearth palette for backgrounds and text', () => {
    expect(source).toMatch(/from-warm-50/);
    expect(source).toMatch(/bg-honey-/);
    expect(source).toMatch(/text-hearth-/);
  });

  it('should preserve red-50/red-700/red-800 in dev error details', () => {
    expect(source).toMatch(/bg-red-50/);
    expect(source).toMatch(/text-red-800/);
    expect(source).toMatch(/text-red-700/);
  });
});
