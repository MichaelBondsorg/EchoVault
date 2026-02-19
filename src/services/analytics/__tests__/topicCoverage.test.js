import { describe, it, expect } from 'vitest';
import { mapTagToDomain, computeRecencyWeight, computeCoverageScores, LIFE_DOMAINS } from '../topicCoverage.js';

describe('topicCoverage', () => {
  describe('LIFE_DOMAINS', () => {
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

  describe('mapTagToDomain', () => {
    it('maps @person tag to relationships domain', () => {
      expect(mapTagToDomain({ type: 'person', content: 'friend' })).toBe('relationships');
    });

    it('maps @person tag with family context to family domain', () => {
      expect(mapTagToDomain({ type: 'person', category: 'family' })).toBe('family');
    });

    it('maps @activity tag to work domain for work activities', () => {
      expect(mapTagToDomain({ type: 'activity', content: 'meeting' })).toBe('work');
      expect(mapTagToDomain({ type: 'activity', content: 'presentation' })).toBe('work');
    });

    it('maps @activity tag to health domain for exercise/medical', () => {
      expect(mapTagToDomain({ type: 'activity', content: 'exercise' })).toBe('health');
      expect(mapTagToDomain({ type: 'activity', content: 'running' })).toBe('health');
      expect(mapTagToDomain({ type: 'activity', content: 'doctor' })).toBe('health');
    });

    it('maps @activity tag to creativity domain for creative activities', () => {
      expect(mapTagToDomain({ type: 'activity', content: 'painting' })).toBe('creativity');
      expect(mapTagToDomain({ type: 'activity', content: 'writing' })).toBe('creativity');
      expect(mapTagToDomain({ type: 'activity', content: 'music' })).toBe('creativity');
    });

    it('maps @goal tag to work domain for career goals', () => {
      expect(mapTagToDomain({ type: 'goal', content: 'promotion' })).toBe('work');
      expect(mapTagToDomain({ type: 'goal', content: 'career' })).toBe('work');
    });

    it('maps @goal tag to personal-growth domain for personal goals', () => {
      expect(mapTagToDomain({ type: 'goal', content: 'self-improvement' })).toBe('personal-growth');
      expect(mapTagToDomain({ type: 'goal', content: 'learn' })).toBe('personal-growth');
    });

    it('returns null for unmappable tags', () => {
      expect(mapTagToDomain({ type: 'unknown' })).toBeNull();
    });
  });

  describe('computeRecencyWeight', () => {
    it('returns ~1.0 for entries today', () => {
      const weight = computeRecencyWeight(0);
      expect(weight).toBeCloseTo(1.0, 2);
    });

    it('returns ~0.5 for entries 14 days ago (half-life)', () => {
      const weight = computeRecencyWeight(14);
      expect(weight).toBeCloseTo(0.5, 2);
    });

    it('returns ~0.25 for entries 28 days ago', () => {
      const weight = computeRecencyWeight(28);
      expect(weight).toBeCloseTo(0.25, 2);
    });

    it('recent entries have higher coverage score than old entries', () => {
      const recentWeight = computeRecencyWeight(1);
      const oldWeight = computeRecencyWeight(30);
      expect(recentWeight).toBeGreaterThan(oldWeight);
    });
  });

  describe('computeCoverageScores', () => {
    it('domain with zero entries returns 0 coverage', () => {
      const entries = [
        { domains: ['work'], daysAgo: 0 },
        { domains: ['work'], daysAgo: 1 },
      ];
      const scores = computeCoverageScores(entries);
      expect(scores.spirituality).toBe(0);
      expect(scores.creativity).toBe(0);
    });

    it('domain with entries today returns near-1.0 relative coverage', () => {
      const entries = [
        { domains: ['work'], daysAgo: 0 },
      ];
      const scores = computeCoverageScores(entries);
      expect(scores.work).toBeCloseTo(1.0, 1);
    });

    it('normalizes scores across all domains', () => {
      const entries = [
        { domains: ['work'], daysAgo: 0 },
        { domains: ['health'], daysAgo: 0 },
      ];
      const scores = computeCoverageScores(entries);
      expect(scores.work).toBeCloseTo(0.5, 1);
      expect(scores.health).toBeCloseTo(0.5, 1);
    });

    it('applies recency weighting to scores', () => {
      const entries = [
        { domains: ['work'], daysAgo: 0 },
        { domains: ['health'], daysAgo: 28 },
      ];
      const scores = computeCoverageScores(entries);
      // work should have much higher score since it's recent
      expect(scores.work).toBeGreaterThan(scores.health);
    });
  });
});
