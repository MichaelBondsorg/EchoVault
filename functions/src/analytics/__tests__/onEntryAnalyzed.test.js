/**
 * onEntryAnalyzed Cloud Function Tests
 *
 * Tests for the pure functions exported from onEntryAnalyzed.js.
 * Note: Integration tests for Firestore trigger behavior require
 * the Firebase Emulator Suite and are not covered here.
 *
 * These tests are NOT picked up by the root vitest config (which only
 * covers src/**). They serve as documentation and can be run with:
 *   npx vitest run functions/src/analytics/__tests__/
 * after adding vitest to functions/package.json.
 */
import { describe, it, expect } from 'vitest';
import { mapTagToDomain, computeRecencyWeight, getPeriodKeys } from '../onEntryAnalyzed.js';

describe('onEntryAnalyzed pure functions', () => {
  describe('mapTagToDomain', () => {
    it('maps person tags to relationships', () => {
      expect(mapTagToDomain({ type: 'person', content: 'Sarah' })).toBe('relationships');
    });

    it('maps family person tags to family', () => {
      expect(mapTagToDomain({ type: 'person', content: 'Mom', category: 'family' })).toBe('family');
    });

    it('maps health activities to health', () => {
      expect(mapTagToDomain({ type: 'activity', content: 'morning yoga' })).toBe('health');
    });

    it('returns null for unmappable tags', () => {
      expect(mapTagToDomain({ type: 'unknown' })).toBeNull();
      expect(mapTagToDomain(null)).toBeNull();
    });
  });

  describe('computeRecencyWeight', () => {
    it('returns 1.0 for today', () => {
      expect(computeRecencyWeight(0)).toBeCloseTo(1.0);
    });

    it('returns 0.5 at half-life (14 days)', () => {
      expect(computeRecencyWeight(14)).toBeCloseTo(0.5);
    });

    it('returns 0.25 at two half-lives', () => {
      expect(computeRecencyWeight(28)).toBeCloseTo(0.25);
    });
  });

  describe('getPeriodKeys', () => {
    it('generates correct weekly key for a Monday', () => {
      const keys = getPeriodKeys(new Date('2026-02-16T12:00:00Z')); // Monday
      expect(keys.weekly).toBe('weekly-2026-02-16');
    });

    it('generates correct weekly key for a Wednesday (maps to Monday)', () => {
      const keys = getPeriodKeys(new Date('2026-02-18T12:00:00Z')); // Wednesday
      expect(keys.weekly).toBe('weekly-2026-02-16');
    });

    it('generates correct weekly key for a Sunday (maps to Monday)', () => {
      const keys = getPeriodKeys(new Date('2026-02-22T12:00:00Z')); // Sunday
      expect(keys.weekly).toBe('weekly-2026-02-16');
    });

    it('generates correct monthly key', () => {
      const keys = getPeriodKeys(new Date('2026-02-18T12:00:00Z'));
      expect(keys.monthly).toBe('monthly-2026-02-01');
    });

    it('generates correct quarterly key for Q1', () => {
      const keys = getPeriodKeys(new Date('2026-02-18T12:00:00Z'));
      expect(keys.quarterly).toBe('quarterly-2026-01-01');
    });

    it('generates correct quarterly key for Q2', () => {
      const keys = getPeriodKeys(new Date('2026-04-15T12:00:00Z'));
      expect(keys.quarterly).toBe('quarterly-2026-04-01');
    });

    it('generates correct annual key', () => {
      const keys = getPeriodKeys(new Date('2026-02-18T12:00:00Z'));
      expect(keys.annual).toBe('annual-2026-01-01');
    });

    it('returns all four period keys', () => {
      const keys = getPeriodKeys(new Date('2026-02-18T12:00:00Z'));
      expect(keys).toHaveProperty('weekly');
      expect(keys).toHaveProperty('monthly');
      expect(keys).toHaveProperty('quarterly');
      expect(keys).toHaveProperty('annual');
    });
  });
});
