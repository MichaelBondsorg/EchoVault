/**
 * Hearthside Palette Verification Tests — Engagement Screens
 *
 * Verifies that off-palette Tailwind color classes have been replaced
 * with Hearthside palette equivalents and dark mode variants are present.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readComponent = (dir, filename) =>
  readFileSync(resolve(__dirname, '..', '..', dir, filename), 'utf-8');

describe('GapPromptCard.jsx — Hearthside palette', () => {
  const src = readComponent('prompts', 'GapPromptCard.jsx');

  it('should not contain gray-* classes', () => {
    expect(src).not.toMatch(/(?<!warm-)bg-gray-/);
    expect(src).not.toMatch(/text-gray-/);
    expect(src).not.toMatch(/border-gray-/);
    expect(src).not.toMatch(/hover:bg-gray-/);
    expect(src).not.toMatch(/hover:text-gray-/);
  });

  it('should not contain text-amber-500', () => {
    expect(src).not.toContain('text-amber-500');
  });

  it('should use warm palette for grays', () => {
    expect(src).toContain('text-warm-500');
    expect(src).toContain('text-warm-400');
  });

  it('should use honey for amber replacement', () => {
    expect(src).toContain('text-honey-500');
  });
});

describe('DismissibleInsight.jsx — Hearthside palette', () => {
  const src = readComponent('insights', 'DismissibleInsight.jsx');

  it('typeConfig should not contain off-palette bg classes', () => {
    expect(src).not.toContain("'bg-purple-50'");
    expect(src).not.toContain("'bg-amber-50'");
    expect(src).not.toContain("'bg-emerald-50'");
    expect(src).not.toContain("'bg-rose-50'");
    expect(src).not.toContain("'bg-blue-50'");
    expect(src).not.toContain("'bg-green-50'");
    expect(src).not.toContain("'bg-slate-50'");
  });

  it('typeConfig should not contain off-palette border classes', () => {
    expect(src).not.toContain("'border-purple-200'");
    expect(src).not.toContain("'border-emerald-200'");
    expect(src).not.toContain("'border-rose-200'");
    expect(src).not.toContain("'border-blue-200'");
    expect(src).not.toContain("'border-green-200'");
    expect(src).not.toContain("'border-slate-200'");
  });

  it('typeConfig should not contain off-palette text classes', () => {
    expect(src).not.toContain("'text-purple-600'");
    expect(src).not.toContain("'text-purple-900'");
    expect(src).not.toContain("'text-emerald-600'");
    expect(src).not.toContain("'text-emerald-900'");
    expect(src).not.toContain("'text-rose-600'");
    expect(src).not.toContain("'text-rose-900'");
    expect(src).not.toContain("'text-blue-600'");
    expect(src).not.toContain("'text-blue-900'");
    expect(src).not.toContain("'text-green-600'");
    expect(src).not.toContain("'text-green-900'");
    expect(src).not.toContain("'text-slate-600'");
    expect(src).not.toContain("'text-slate-900'");
  });

  it('typeConfig should include dark: prefix classes', () => {
    expect(src).toMatch(/dark:bg-lavender-/);
    expect(src).toMatch(/dark:bg-honey-/);
    expect(src).toMatch(/dark:bg-sage-/);
    expect(src).toMatch(/dark:bg-terra-/);
    expect(src).toMatch(/dark:bg-warm-/);
  });

  it('should not contain gray-* in dismiss feedback panel', () => {
    // Check the feedback panel area specifically
    expect(src).not.toContain('text-gray-700');
    expect(src).not.toContain('text-gray-600');
    expect(src).not.toContain('text-gray-500');
    expect(src).not.toContain('text-gray-400');
    expect(src).not.toContain('bg-gray-800');
    expect(src).not.toContain('bg-gray-50');
    expect(src).not.toContain('border-gray-200');
    expect(src).not.toContain('border-gray-300');
  });

  it('exclusion option should not use rose-*, should use terra-*', () => {
    expect(src).not.toContain('bg-rose-50');
    expect(src).not.toContain('text-rose-600');
    expect(src).not.toContain('text-rose-700');
    expect(src).toContain('bg-terra-50');
    expect(src).toContain('text-terra-');
  });
});

describe('EntryInsightsPopup.jsx — Hearthside palette', () => {
  const src = readComponent('modals', 'EntryInsightsPopup.jsx');

  it('getInsightStyle should not contain off-palette classes', () => {
    expect(src).not.toContain('from-green-50');
    expect(src).not.toContain('to-emerald-50');
    expect(src).not.toContain('border-green-200');
    expect(src).not.toContain('text-green-600');
    expect(src).not.toContain('text-green-800');
    expect(src).not.toContain('from-amber-50');
    expect(src).not.toContain('to-yellow-50');
    expect(src).not.toContain('border-amber-200');
    expect(src).not.toContain('text-amber-600');
    expect(src).not.toContain('text-amber-800');
    expect(src).not.toContain('from-teal-50');
    expect(src).not.toContain('to-cyan-50');
    expect(src).not.toContain('border-teal-200');
    expect(src).not.toContain('text-teal-600');
    expect(src).not.toContain('text-teal-800');
    expect(src).not.toContain('from-blue-50');
    expect(src).not.toContain('to-indigo-50');
    expect(src).not.toContain('border-blue-200');
    expect(src).not.toContain('text-blue-600');
    expect(src).not.toContain('text-blue-800');
  });

  it('celebration section should not contain green/emerald', () => {
    expect(src).not.toContain('to-emerald-50');
    expect(src).not.toContain('border-green-100');
    expect(src).not.toContain('text-green-700');
    expect(src).not.toContain('text-green-800');
    expect(src).not.toContain('text-green-600');
  });

  it('CBT section should not contain blue/indigo', () => {
    expect(src).not.toContain('to-indigo-50');
    expect(src).not.toContain('border-blue-400');
    expect(src).not.toContain('text-blue-600');
  });

  it('ACT section should not contain teal/cyan', () => {
    expect(src).not.toContain('bg-teal-50');
    expect(src).not.toContain('border-teal-100');
    expect(src).not.toContain('text-teal-900');
    expect(src).not.toContain('text-teal-800');
    expect(src).not.toContain('text-teal-600');
  });

  it('ACT committed action should not contain amber', () => {
    expect(src).not.toContain('bg-amber-50');
    expect(src).not.toContain('border-amber-100');
    expect(src).not.toContain('text-amber-700');
    expect(src).not.toContain('text-amber-800');
  });

  it('content card should have dark mode variant', () => {
    expect(src).toMatch(/bg-white.*dark:bg-hearth-/);
  });

  it('should keep red for warning insight type', () => {
    expect(src).toContain('from-red-50');
    expect(src).toContain('border-red-200');
    expect(src).toContain('text-red-600');
  });
});

describe('FeedbackLoop.jsx — Hearthside palette', () => {
  const src = readComponent('dashboard/shared', 'FeedbackLoop.jsx');

  it('confetti colors should not contain raw green hex values', () => {
    expect(src).not.toContain('#10b981');
    expect(src).not.toContain('#34d399');
    expect(src).not.toContain('#6ee7b7');
    expect(src).not.toContain('#a7f3d0');
  });

  it('should import HEX_COLORS from colorMap', () => {
    expect(src).toMatch(/import\s*\{[^}]*HEX_COLORS[^}]*\}\s*from/);
  });
});

describe('DetectedStrip.jsx — Hearthside palette', () => {
  const src = readComponent('entries', 'DetectedStrip.jsx');

  it('signal icons should not contain off-palette colors', () => {
    expect(src).not.toContain('text-rose-500');
    expect(src).not.toContain('text-blue-500');
    expect(src).not.toContain('text-amber-500');
    expect(src).not.toContain('text-purple-500');
  });

  it('sentiment indicators should not contain off-palette colors', () => {
    expect(src).not.toContain('text-emerald-500');
    expect(src).not.toContain('text-sky-500');
    expect(src).not.toContain('text-orange-500');
  });

  it('day labels should not contain off-palette colors', () => {
    expect(src).not.toContain('text-amber-600');
    expect(src).not.toContain('text-blue-600');
  });

  it('should use Hearthside palette for signal icons', () => {
    expect(src).toContain('text-terra-');
    expect(src).toContain('text-lavender-');
    expect(src).toContain('text-honey-');
  });

  it('should have dark mode on strip container', () => {
    expect(src).toMatch(/dark:bg-/);
    expect(src).toMatch(/dark:border-/);
  });
});

describe('GuidedSessionPicker.jsx — Hearthside palette', () => {
  const src = readComponent('chat', 'GuidedSessionPicker.jsx');

  it('should not contain off-palette gradient values', () => {
    expect(src).not.toContain('from-amber-400');
    expect(src).not.toContain('to-orange-500');
    expect(src).not.toContain('from-indigo-400');
    expect(src).not.toContain('to-purple-600');
    expect(src).not.toContain('from-pink-400');
    expect(src).not.toContain('to-rose-500');
    expect(src).not.toContain('from-green-400');
    expect(src).not.toContain('to-emerald-600');
    expect(src).not.toContain('from-cyan-400');
    expect(src).not.toContain('to-blue-600');
    expect(src).not.toContain('from-teal-400');
    expect(src).not.toContain('to-cyan-600');
    expect(src).not.toContain('from-violet-400');
  });

  it('should use Hearthside palette gradients', () => {
    expect(src).toContain('from-honey-');
    expect(src).toContain('from-lavender-');
    expect(src).toContain('from-sage-');
    expect(src).toContain('from-terra-');
  });
});

describe('CompanionNudge.jsx — Hearthside dark mode', () => {
  const src = readComponent('zen', 'CompanionNudge.jsx');

  it('should have dark mode variants', () => {
    expect(src).toMatch(/dark:/);
  });

  it('should have dark text variant for honey icon', () => {
    expect(src).toContain('dark:text-honey-400');
  });
});

describe('All engagement files have dark: classes', () => {
  const files = [
    ['reports', 'ReportChart.jsx'],
    ['reports', 'ReportList.jsx'],
    ['reports', 'ReportViewer.jsx'],
    ['reports', 'ReportSection.jsx'],
    ['reports', 'ReportPrivacyEditor.jsx'],
    ['reports', 'ReportShareSheet.jsx'],
    ['prompts', 'GapPromptCard.jsx'],
    ['insights', 'DismissibleInsight.jsx'],
    ['modals', 'EntryInsightsPopup.jsx'],
    ['dashboard/shared', 'FeedbackLoop.jsx'],
    ['entries', 'DetectedStrip.jsx'],
    // GuidedSessionPicker excluded: uses white-on-dark glass styling (always dark background)
    ['zen', 'CompanionNudge.jsx'],
  ];

  files.forEach(([dir, filename]) => {
    it(`${filename} should contain at least one dark: class`, () => {
      const src = readComponent(dir, filename);
      expect(src).toMatch(/dark:/);
    });
  });
});
