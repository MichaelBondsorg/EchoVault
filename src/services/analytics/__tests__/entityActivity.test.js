import { describe, it, expect } from 'vitest';
import { computeRecencyWeight } from '../topicCoverage.js';
import { computeEntityActivity } from '../entityActivity.js';

describe('entityActivity', () => {
  describe('computeEntityActivity', () => {
    it('tracks mention count per entity', () => {
      const entries = [
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 0 },
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 1 },
        { entities: [{ id: 'e2', name: 'Alex', category: 'person' }], daysAgo: 0 },
      ];
      const activity = computeEntityActivity(entries);
      expect(activity['e1'].mentionCount).toBe(2);
      expect(activity['e2'].mentionCount).toBe(1);
    });

    it('updates last mention date', () => {
      const entries = [
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 5 },
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 0 },
      ];
      const activity = computeEntityActivity(entries);
      expect(activity['e1'].lastMentionDaysAgo).toBe(0);
    });

    it('recency score decays for stale entities', () => {
      const entries = [
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 0 },
        { entities: [{ id: 'e2', name: 'Old Friend', category: 'person' }], daysAgo: 30 },
      ];
      const activity = computeEntityActivity(entries);
      expect(activity['e1'].recencyScore).toBeGreaterThan(activity['e2'].recencyScore);
    });

    it('preserves entity metadata', () => {
      const entries = [
        { entities: [{ id: 'e1', name: 'Sarah', category: 'person' }], daysAgo: 0 },
      ];
      const activity = computeEntityActivity(entries);
      expect(activity['e1'].name).toBe('Sarah');
      expect(activity['e1'].category).toBe('person');
    });

    it('handles entries without entities', () => {
      const entries = [
        { entities: [], daysAgo: 0 },
        { daysAgo: 1 },
      ];
      const activity = computeEntityActivity(entries);
      expect(Object.keys(activity)).toHaveLength(0);
    });
  });
});
