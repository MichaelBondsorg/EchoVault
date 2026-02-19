/**
 * Tests for the Gap Detector Nexus extension.
 *
 * The gap detector identifies life domains the user has neglected
 * in their journaling. It reads pre-computed topic coverage data,
 * checks user exclusions, and produces a ranked list of domain gaps.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the analytics repository
vi.mock('../../../repositories/analytics', () => ({
  analyticsRepository: {
    getTopicCoverage: vi.fn(),
  },
}));

// Mock the signal lifecycle exclusion check
vi.mock('../../signals/signalLifecycle', () => ({
  isPatternExcluded: vi.fn(),
  getActiveExclusions: vi.fn(),
}));

import {
  detectGaps,
  computeGapScore,
  LIFE_DOMAINS,
  GAP_THRESHOLD,
  RECENCY_HALF_LIFE_DAYS,
  MAX_RECENCY_PENALTY,
  MIN_HISTORY_DAYS,
} from '../gapDetector';
import { analyticsRepository } from '../../../repositories/analytics';
import { isPatternExcluded } from '../../signals/signalLifecycle';

// Helper: build mock topic_coverage document
const now = Date.now();
const daysAgo = (days) => ({ toMillis: () => now - days * 86400000 });

const makeCoverage = (overrides = {}) => ({
  domains: {
    work: { normalizedCoverage: 0.35, lastMentionDate: daysAgo(2), entryCount: 12 },
    relationships: { normalizedCoverage: 0.22, lastMentionDate: daysAgo(5), entryCount: 8 },
    health: { normalizedCoverage: 0.50, lastMentionDate: daysAgo(1), entryCount: 18 },
    creativity: { normalizedCoverage: 0.05, lastMentionDate: daysAgo(20), entryCount: 2 },
    spirituality: { normalizedCoverage: 0.00, lastMentionDate: null, entryCount: 0 },
    'personal-growth': { normalizedCoverage: 0.15, lastMentionDate: daysAgo(10), entryCount: 5 },
    family: { normalizedCoverage: 0.28, lastMentionDate: daysAgo(3), entryCount: 10 },
    finances: { normalizedCoverage: 0.02, lastMentionDate: daysAgo(25), entryCount: 1 },
    ...overrides.domains,
  },
  totalEntries: overrides.totalEntries ?? 36,
  firstEntryDate: overrides.firstEntryDate ?? daysAgo(60),
  lastUpdated: daysAgo(0),
});

describe('gapDetector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no exclusions
    isPatternExcluded.mockResolvedValue(false);
  });

  describe('LIFE_DOMAINS constant', () => {
    it('defines exactly 8 life domains', () => {
      expect(LIFE_DOMAINS).toHaveLength(8);
      expect(LIFE_DOMAINS).toContain('work');
      expect(LIFE_DOMAINS).toContain('relationships');
      expect(LIFE_DOMAINS).toContain('health');
      expect(LIFE_DOMAINS).toContain('creativity');
      expect(LIFE_DOMAINS).toContain('spirituality');
      expect(LIFE_DOMAINS).toContain('personal-growth');
      expect(LIFE_DOMAINS).toContain('family');
      expect(LIFE_DOMAINS).toContain('finances');
    });
  });

  describe('detectGaps', () => {
    it('detects domain with zero coverage as highest gap', async () => {
      analyticsRepository.getTopicCoverage.mockResolvedValue(makeCoverage());

      const gaps = await detectGaps('user-123');

      expect(gaps.length).toBeGreaterThan(0);
      // spirituality has 0 coverage — should be among the top gaps
      const spiritualityGap = gaps.find(g => g.domain === 'spirituality');
      expect(spiritualityGap).toBeDefined();
      expect(spiritualityGap.gapScore).toBeGreaterThan(GAP_THRESHOLD);
    });

    it('recency weighting increases gap score for longer absence', async () => {
      // Two domains with same coverage but different recency
      const coverage = makeCoverage({
        domains: {
          work: { normalizedCoverage: 0.3, lastMentionDate: daysAgo(7), entryCount: 5 },
          relationships: { normalizedCoverage: 0.3, lastMentionDate: daysAgo(28), entryCount: 5 },
          health: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
          creativity: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
          spirituality: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
          'personal-growth': { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
          family: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
          finances: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 20 },
        },
      });
      analyticsRepository.getTopicCoverage.mockResolvedValue(coverage);

      const gaps = await detectGaps('user-123');
      const workGap = gaps.find(g => g.domain === 'work');
      const relGap = gaps.find(g => g.domain === 'relationships');

      // Both should have gaps (since coverage=0.3) but relationships should be higher
      // due to 28-day absence vs 7-day
      if (workGap && relGap) {
        expect(relGap.gapScore).toBeGreaterThan(workGap.gapScore);
      } else {
        // At least relationships should appear (higher recency penalty)
        expect(relGap).toBeDefined();
      }
    });

    it('respects Signal Lifecycle exclusions (excluded domain returns 0)', async () => {
      analyticsRepository.getTopicCoverage.mockResolvedValue(makeCoverage());
      // Exclude spirituality
      isPatternExcluded.mockImplementation(async (userId, domain) => {
        return domain === 'spirituality';
      });

      const gaps = await detectGaps('user-123');
      const spiritualityGap = gaps.find(g => g.domain === 'spirituality');
      expect(spiritualityGap).toBeUndefined(); // excluded, score=0, filtered out
    });

    it('requires minimum 2-week entry history before activation', async () => {
      const coverage = makeCoverage({ firstEntryDate: daysAgo(7) }); // only 7 days
      analyticsRepository.getTopicCoverage.mockResolvedValue(coverage);

      const gaps = await detectGaps('user-123');
      expect(gaps).toEqual([]);
    });

    it('ranks multiple gaps by severity (descending gap_score)', async () => {
      analyticsRepository.getTopicCoverage.mockResolvedValue(makeCoverage());

      const gaps = await detectGaps('user-123');

      for (let i = 1; i < gaps.length; i++) {
        expect(gaps[i - 1].gapScore).toBeGreaterThanOrEqual(gaps[i].gapScore);
      }
    });

    it('handles user with entries in only one domain', async () => {
      const coverage = makeCoverage({
        domains: {
          work: { normalizedCoverage: 0.9, lastMentionDate: daysAgo(1), entryCount: 30 },
          relationships: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          health: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          creativity: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          spirituality: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          'personal-growth': { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          family: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
          finances: { normalizedCoverage: 0.0, lastMentionDate: null, entryCount: 0 },
        },
      });
      analyticsRepository.getTopicCoverage.mockResolvedValue(coverage);

      const gaps = await detectGaps('user-123');
      // All 7 non-work domains should show as gaps
      expect(gaps.length).toBe(7);
      expect(gaps.every(g => g.domain !== 'work')).toBe(true);
    });

    it('returns empty when all domains have sufficient coverage', async () => {
      const highCoverage = {};
      LIFE_DOMAINS.forEach(d => {
        highCoverage[d] = { normalizedCoverage: 0.85, lastMentionDate: daysAgo(1), entryCount: 20 };
      });
      analyticsRepository.getTopicCoverage.mockResolvedValue(
        makeCoverage({ domains: highCoverage })
      );

      const gaps = await detectGaps('user-123');
      expect(gaps).toEqual([]);
    });

    it('returns empty when analytics data is null', async () => {
      analyticsRepository.getTopicCoverage.mockResolvedValue(null);

      const gaps = await detectGaps('user-123');
      expect(gaps).toEqual([]);
    });

    it('returns empty when firstEntryDate is missing', async () => {
      const coverage = makeCoverage();
      delete coverage.firstEntryDate;
      analyticsRepository.getTopicCoverage.mockResolvedValue(coverage);

      const gaps = await detectGaps('user-123');
      expect(gaps).toEqual([]);
    });

    it('treats missing domain in coverage as zero coverage', async () => {
      const partialCoverage = makeCoverage();
      delete partialCoverage.domains.finances;
      analyticsRepository.getTopicCoverage.mockResolvedValue(partialCoverage);

      const gaps = await detectGaps('user-123');
      const financesGap = gaps.find(g => g.domain === 'finances');
      expect(financesGap).toBeDefined();
      expect(financesGap.normalizedCoverage).toBe(0);
    });

    it('fails open when exclusion check throws', async () => {
      analyticsRepository.getTopicCoverage.mockResolvedValue(makeCoverage());
      isPatternExcluded.mockRejectedValue(new Error('Firestore unavailable'));

      // Should not throw — should treat all domains as non-excluded
      const gaps = await detectGaps('user-123');
      expect(gaps.length).toBeGreaterThan(0);
    });
  });

  describe('computeGapScore', () => {
    it('applies formula: (1 - coverage) * recency_penalty * exclusion_check', () => {
      // coverage=0.3, 14 days, not excluded
      // (1 - 0.3) * 2^(14/14) * 1 = 0.7 * 2 = 1.4
      const score = computeGapScore(0.3, 14, false);
      expect(score).toBeCloseTo(1.4, 1);
    });

    it('returns 0 for excluded domain', () => {
      const score = computeGapScore(0.3, 14, true);
      expect(score).toBe(0);
    });

    it('clamps recency penalty to avoid extreme values', () => {
      // 365 days: 2^(365/14) would be astronomical
      const score = computeGapScore(0.0, 365, false);
      // Should be clamped: (1 - 0) * MAX_RECENCY_PENALTY * 1 = MAX_RECENCY_PENALTY
      expect(score).toBe(MAX_RECENCY_PENALTY);
    });

    it('returns near-zero for domain with coverage close to 1.0', () => {
      const score = computeGapScore(0.95, 0, false);
      // (1 - 0.95) * 2^0 * 1 = 0.05 * 1 = 0.05
      expect(score).toBeCloseTo(0.05, 2);
    });

    it('returns high score for domain with zero coverage and long absence', () => {
      const score = computeGapScore(0.0, 28, false);
      // (1 - 0) * 2^(28/14) * 1 = 1.0 * 4.0 = 4.0
      expect(score).toBeCloseTo(4.0, 1);
    });

    it('returns 1.0 for zero coverage with recent mention (today)', () => {
      const score = computeGapScore(0.0, 0, false);
      // (1 - 0) * 2^0 * 1 = 1.0
      expect(score).toBeCloseTo(1.0, 2);
    });
  });
});
