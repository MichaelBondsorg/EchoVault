import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterForPersonalView,
  filterForShareableContent,
  filterForExport,
  filterSectionsForSharing,
  applySafetyFiltering,
} from '../privacy.js';

/**
 * Report privacy/safety filtering tests.
 *
 * Validates that crisis-flagged content is properly handled
 * in report generation and export. Safety-critical for a
 * mental health application.
 */

describe('Report Safety Filtering (privacy.js)', () => {
  let normalEntry, flaggedEntry, warningEntry, mixedEntries;

  beforeEach(() => {
    normalEntry = {
      id: 'entry-1',
      text: 'Had a good day at work today.',
      moodScore: 0.7,
      safety_flagged: false,
      has_warning_indicators: false,
    };
    flaggedEntry = {
      id: 'entry-2',
      text: 'I feel like ending it all.',
      moodScore: 0.1,
      safety_flagged: true,
      has_warning_indicators: true,
    };
    warningEntry = {
      id: 'entry-3',
      text: 'I feel so hopeless and trapped.',
      moodScore: 0.25,
      safety_flagged: false,
      has_warning_indicators: true,
    };
    mixedEntries = [normalEntry, flaggedEntry, warningEntry];
  });

  describe('filterForPersonalView', () => {
    it('preserves all entries including safety-flagged ones', () => {
      const result = filterForPersonalView(mixedEntries);
      expect(result).toHaveLength(3);
      expect(result).toContainEqual(flaggedEntry);
      expect(result).toContainEqual(warningEntry);
    });

    it('returns a new array (does not mutate input)', () => {
      const result = filterForPersonalView(mixedEntries);
      expect(result).not.toBe(mixedEntries);
      expect(mixedEntries).toHaveLength(3);
    });

    it('handles empty array', () => {
      expect(filterForPersonalView([])).toEqual([]);
    });
  });

  describe('filterForShareableContent', () => {
    it('removes entries with safety_flagged from shareable content', () => {
      const result = filterForShareableContent(mixedEntries);
      expect(result).toHaveLength(2);
      expect(result.find(e => e.id === 'entry-2')).toBeUndefined();
      expect(result.find(e => e.id === 'entry-1')).toBeDefined();
      expect(result.find(e => e.id === 'entry-3')).toBeDefined();
    });

    it('does not mutate the original array', () => {
      const original = [...mixedEntries];
      filterForShareableContent(mixedEntries);
      expect(mixedEntries).toEqual(original);
    });

    it('returns all entries when none are flagged', () => {
      const safe = [normalEntry, warningEntry];
      const result = filterForShareableContent(safe);
      expect(result).toHaveLength(2);
    });

    it('returns empty when all are flagged', () => {
      const result = filterForShareableContent([flaggedEntry]);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterForExport', () => {
    it('removes safety_flagged AND warning_indicator entries', () => {
      const result = filterForExport(mixedEntries);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('entry-1');
    });

    it('does not mutate the original array', () => {
      const original = [...mixedEntries];
      filterForExport(mixedEntries);
      expect(mixedEntries).toEqual(original);
    });

    it('returns all entries when none are flagged or warned', () => {
      const result = filterForExport([normalEntry]);
      expect(result).toHaveLength(1);
    });

    it('returns empty when all entries have flags', () => {
      const result = filterForExport([flaggedEntry, warningEntry]);
      expect(result).toHaveLength(0);
    });
  });

  describe('filterSectionsForSharing', () => {
    it('removes crisis_resources section', () => {
      const sections = [
        { id: 'mood_trend', title: 'Mood Trend', narrative: 'Your mood...' },
        { id: 'crisis_resources', title: 'Crisis Resources', narrative: 'If you need help...' },
        { id: 'summary', title: 'Summary', narrative: 'Overall...' },
      ];
      const result = filterSectionsForSharing(sections);
      expect(result).toHaveLength(2);
      expect(result.find(s => s.id === 'crisis_resources')).toBeUndefined();
    });

    it('returns all sections when no crisis_resources present', () => {
      const sections = [
        { id: 'mood_trend', title: 'Mood Trend' },
        { id: 'summary', title: 'Summary' },
      ];
      const result = filterSectionsForSharing(sections);
      expect(result).toHaveLength(2);
    });

    it('does not mutate original array', () => {
      const sections = [
        { id: 'crisis_resources', title: 'Crisis' },
      ];
      const original = [...sections];
      filterSectionsForSharing(sections);
      expect(sections).toEqual(original);
    });

    it('handles empty array', () => {
      expect(filterSectionsForSharing([])).toEqual([]);
    });
  });

  describe('applySafetyFiltering', () => {
    it('removes entryRefs pointing to safety-flagged entries', () => {
      const sections = [
        {
          id: 'mood_trend',
          narrative: 'A weekly overview.',
          entryRefs: ['entry-1', 'entry-2', 'entry-3'],
        },
      ];
      const entryMetadata = {
        'entry-1': { safety_flagged: false, has_warning_indicators: false },
        'entry-2': { safety_flagged: true, has_warning_indicators: true },
        'entry-3': { safety_flagged: false, has_warning_indicators: true },
      };
      const result = applySafetyFiltering(sections, entryMetadata);
      expect(result[0].entryRefs).toEqual(['entry-1', 'entry-3']);
    });

    it('handles report with no flagged entries (no-op)', () => {
      const sections = [
        {
          id: 'summary',
          narrative: 'All good.',
          entryRefs: ['entry-1'],
        },
      ];
      const entryMetadata = {
        'entry-1': { safety_flagged: false, has_warning_indicators: false },
      };
      const result = applySafetyFiltering(sections, entryMetadata);
      expect(result[0].entryRefs).toEqual(['entry-1']);
      expect(result[0].narrative).toBe('All good.');
    });

    it('handles report where all entries are flagged', () => {
      const sections = [
        {
          id: 'mood_trend',
          narrative: 'Content here.',
          entryRefs: ['entry-2'],
        },
      ];
      const entryMetadata = {
        'entry-2': { safety_flagged: true },
      };
      const result = applySafetyFiltering(sections, entryMetadata);
      expect(result[0].entryRefs).toEqual([]);
    });

    it('preserves sections without entryRefs', () => {
      const sections = [
        { id: 'overview', narrative: 'General overview.' },
      ];
      const result = applySafetyFiltering(sections, {});
      expect(result[0].narrative).toBe('General overview.');
    });

    it('does not mutate original sections', () => {
      const sections = [
        { id: 'test', entryRefs: ['entry-2'] },
      ];
      const entryMetadata = { 'entry-2': { safety_flagged: true } };
      const originalRefs = [...sections[0].entryRefs];
      applySafetyFiltering(sections, entryMetadata);
      expect(sections[0].entryRefs).toEqual(originalRefs);
    });

    it('excludes unknown entries (fail-closed for safety)', () => {
      const sections = [
        { id: 'test', entryRefs: ['entry-1', 'entry-2'] },
      ];
      const result = applySafetyFiltering(sections, {});
      // Unknown entries are excluded (fail-closed for safety)
      expect(result[0].entryRefs).toEqual([]);
    });
  });
});
