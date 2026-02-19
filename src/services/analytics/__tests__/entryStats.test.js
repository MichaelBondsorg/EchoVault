import { describe, it, expect } from 'vitest';
import { computeEntryStats } from '../entryStats.js';

describe('entryStats', () => {
  describe('computeEntryStats', () => {
    it('counts entries per period', () => {
      const entries = [
        { moodScore: 0.7, category: 'personal', entryType: 'reflection' },
        { moodScore: 0.5, category: 'work', entryType: 'task' },
        { moodScore: 0.9, category: 'personal', entryType: 'mixed' },
      ];
      const stats = computeEntryStats(entries);
      expect(stats.entryCount).toBe(3);
    });

    it('computes mood mean/min/max correctly', () => {
      const entries = [
        { moodScore: 0.3, category: 'personal', entryType: 'vent' },
        { moodScore: 0.7, category: 'personal', entryType: 'reflection' },
        { moodScore: 0.9, category: 'work', entryType: 'mixed' },
      ];
      const stats = computeEntryStats(entries);
      expect(stats.moodMin).toBeCloseTo(0.3);
      expect(stats.moodMax).toBeCloseTo(0.9);
      expect(stats.moodMean).toBeCloseTo(0.633, 2);
    });

    it('tracks category breakdown (personal vs work)', () => {
      const entries = [
        { moodScore: 0.5, category: 'personal', entryType: 'reflection' },
        { moodScore: 0.5, category: 'work', entryType: 'task' },
        { moodScore: 0.5, category: 'personal', entryType: 'vent' },
      ];
      const stats = computeEntryStats(entries);
      expect(stats.categoryBreakdown.personal).toBe(2);
      expect(stats.categoryBreakdown.work).toBe(1);
    });

    it('tracks entry type distribution', () => {
      const entries = [
        { moodScore: 0.5, category: 'personal', entryType: 'task' },
        { moodScore: 0.5, category: 'personal', entryType: 'mixed' },
        { moodScore: 0.5, category: 'work', entryType: 'reflection' },
        { moodScore: 0.5, category: 'work', entryType: 'vent' },
      ];
      const stats = computeEntryStats(entries);
      expect(stats.entryTypeDistribution.task).toBe(1);
      expect(stats.entryTypeDistribution.mixed).toBe(1);
      expect(stats.entryTypeDistribution.reflection).toBe(1);
      expect(stats.entryTypeDistribution.vent).toBe(1);
    });

    it('handles empty period gracefully', () => {
      const stats = computeEntryStats([]);
      expect(stats.entryCount).toBe(0);
      expect(stats.moodMean).toBe(0);
      expect(stats.moodMin).toBe(0);
      expect(stats.moodMax).toBe(0);
      expect(stats.categoryBreakdown.personal).toBe(0);
      expect(stats.categoryBreakdown.work).toBe(0);
    });

    it('handles entries without mood scores', () => {
      const entries = [
        { category: 'personal', entryType: 'reflection' },
        { moodScore: 0.5, category: 'work', entryType: 'task' },
      ];
      const stats = computeEntryStats(entries);
      expect(stats.entryCount).toBe(2);
      expect(stats.moodMean).toBeCloseTo(0.5);
      expect(stats.moodCount).toBe(1);
    });
  });
});
