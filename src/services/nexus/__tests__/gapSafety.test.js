import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Gap prompt safety tests.
 *
 * Validates that gap prompts respect user safety state:
 * - Elevated longitudinal risk suppresses prompts
 * - Safety-flagged domain entries produce gentler prompts
 * - Crisis-adjacent domains are never prompted
 *
 * CRITICAL: These tests are essential for a mental health application.
 */

vi.mock('../../safety', () => ({
  checkLongitudinalRisk: vi.fn(),
}));

import { checkLongitudinalRisk } from '../../safety';
import {
  shouldShowGapPrompt,
  filterGapsForSafety,
  getPromptStyleForDomain,
} from '../gapSafety';

describe('Gap Prompt Safety (gapSafety.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldShowGapPrompt', () => {
    it('returns false when longitudinal risk is elevated', () => {
      checkLongitudinalRisk.mockReturnValue({
        isAtRisk: true,
        reason: 'sustained_decline',
        flags: { isSustainedDecline: true, isAcuteDecline: false, isLowAvgMood: false },
      });

      const recentEntries = [
        { createdAt: new Date(), analysis: { mood_score: 0.3 } },
      ];
      const result = shouldShowGapPrompt('user-1', recentEntries);
      expect(result).toBe(false);
      expect(checkLongitudinalRisk).toHaveBeenCalledWith(recentEntries);
    });

    it('returns true when longitudinal risk is normal', () => {
      checkLongitudinalRisk.mockReturnValue({
        isAtRisk: false,
        reason: null,
      });

      const recentEntries = [
        { createdAt: new Date(), analysis: { mood_score: 0.7 } },
      ];
      const result = shouldShowGapPrompt('user-1', recentEntries);
      expect(result).toBe(true);
    });

    it('returns true when insufficient longitudinal data', () => {
      checkLongitudinalRisk.mockReturnValue({
        isAtRisk: false,
        reason: 'insufficient_data',
        entriesAnalyzed: 2,
      });

      const result = shouldShowGapPrompt('user-1', []);
      expect(result).toBe(true);
    });

    it('returns true when recentEntries is empty', () => {
      checkLongitudinalRisk.mockReturnValue({
        isAtRisk: false,
        reason: 'insufficient_data',
      });

      const result = shouldShowGapPrompt('user-1', []);
      expect(result).toBe(true);
    });

    it('returns false when acute decline detected', () => {
      checkLongitudinalRisk.mockReturnValue({
        isAtRisk: true,
        reason: 'acute_decline',
        flags: { isAcuteDecline: true },
      });

      const result = shouldShowGapPrompt('user-1', [{ createdAt: new Date() }]);
      expect(result).toBe(false);
    });

    it('fails closed when risk check throws', () => {
      checkLongitudinalRisk.mockImplementation(() => {
        throw new Error('Malformed entry data');
      });

      const result = shouldShowGapPrompt('user-1', []);
      expect(result).toBe(false);
    });
  });

  describe('filterGapsForSafety', () => {
    it('removes domains where most recent entry is safety_flagged', () => {
      const gaps = [
        { domain: 'work', gapScore: 0.9 },
        { domain: 'relationships', gapScore: 0.85 },
        { domain: 'health', gapScore: 0.8 },
      ];
      const domainEntryMap = {
        work: [
          { safety_flagged: false, has_warning_indicators: false, createdAt: new Date('2026-02-10') },
        ],
        relationships: [
          { safety_flagged: false, createdAt: new Date('2026-02-08') },
          { safety_flagged: true, createdAt: new Date('2026-02-15') }, // most recent is flagged
        ],
        health: [
          { safety_flagged: false, has_warning_indicators: false, createdAt: new Date('2026-02-12') },
        ],
      };

      const result = filterGapsForSafety(gaps, domainEntryMap);
      expect(result).toHaveLength(2);
      expect(result.map(g => g.domain)).toEqual(['work', 'health']);
    });

    it('domain re-enabled after non-flagged entries appear', () => {
      const gaps = [
        { domain: 'relationships', gapScore: 0.85 },
      ];
      const domainEntryMap = {
        relationships: [
          { safety_flagged: true, createdAt: new Date('2026-02-08') }, // older, flagged
          { safety_flagged: false, createdAt: new Date('2026-02-15') }, // newer, safe
        ],
      };

      const result = filterGapsForSafety(gaps, domainEntryMap);
      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe('relationships');
    });

    it('warning-indicator entries do not suppress domain', () => {
      const gaps = [
        { domain: 'work', gapScore: 0.9 },
      ];
      const domainEntryMap = {
        work: [
          { safety_flagged: false, has_warning_indicators: true, createdAt: new Date('2026-02-15') },
        ],
      };

      const result = filterGapsForSafety(gaps, domainEntryMap);
      expect(result).toHaveLength(1);
      expect(result[0].domain).toBe('work');
    });

    it('handles domain with no entries in map', () => {
      const gaps = [
        { domain: 'creativity', gapScore: 0.75 },
      ];

      const result = filterGapsForSafety(gaps, {});
      expect(result).toHaveLength(1);
    });

    it('handles empty gaps list', () => {
      const result = filterGapsForSafety([], { work: [] });
      expect(result).toEqual([]);
    });

    it('handles domain with empty entries array', () => {
      const gaps = [{ domain: 'work', gapScore: 0.9 }];
      const result = filterGapsForSafety(gaps, { work: [] });
      expect(result).toHaveLength(1);
    });
  });

  describe('getPromptStyleForDomain', () => {
    it('returns gentle when most recent entry has warning indicators', () => {
      const domainEntries = [
        { has_warning_indicators: false, createdAt: new Date('2026-02-08') },
        { has_warning_indicators: true, createdAt: new Date('2026-02-15') },
      ];

      const result = getPromptStyleForDomain('work', domainEntries, { preferredStyle: 'action' });
      expect(result).toBe('gentle');
    });

    it('returns user preferred style when no warning indicators', () => {
      const domainEntries = [
        { has_warning_indicators: false, createdAt: new Date('2026-02-15') },
      ];

      const result = getPromptStyleForDomain('work', domainEntries, { preferredStyle: 'action' });
      expect(result).toBe('action');
    });

    it('returns null when no entries and no preferences', () => {
      const result = getPromptStyleForDomain('work', [], null);
      expect(result).toBeNull();
    });

    it('returns null when domain entries are empty and no preferences', () => {
      const result = getPromptStyleForDomain('work', [], {});
      expect(result).toBeNull();
    });

    it('returns gentle even when user prefers action', () => {
      const domainEntries = [
        { has_warning_indicators: true, createdAt: new Date('2026-02-15') },
      ];

      const result = getPromptStyleForDomain('health', domainEntries, { preferredStyle: 'exploratory' });
      expect(result).toBe('gentle');
    });

    it('does not override to gentle if older entry had warning but recent is clear', () => {
      const domainEntries = [
        { has_warning_indicators: true, createdAt: new Date('2026-02-08') },
        { has_warning_indicators: false, createdAt: new Date('2026-02-15') },
      ];

      const result = getPromptStyleForDomain('work', domainEntries, { preferredStyle: 'reflective' });
      expect(result).toBe('reflective');
    });
  });
});
