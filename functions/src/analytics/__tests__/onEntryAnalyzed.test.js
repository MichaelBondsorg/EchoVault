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
import { mapTagToDomain, computeRecencyWeight, getPeriodKeys, extractAnalyticsFields } from '../onEntryAnalyzed.js';

describe('onEntryAnalyzed pure functions', () => {
  describe('extractAnalyticsFields (R4 Task 1: corrected field locations)', () => {
    it('reads tags from the TOP-LEVEL location (current write pipeline shape), not analysis.tags', () => {
      const after = {
        tags: ['@person:sam', '@activity:yoga'],
        analysis: { mood_score: 0.7, tags: ['should-not-be-used'] },
        entry_type: 'reflection',
        category: 'personal',
      };
      const fields = extractAnalyticsFields(after);
      expect(fields.tags).toEqual(['@person:sam', '@activity:yoga']);
    });

    it('reads entry_type from the TOP-LEVEL location (authoritative post-analysis), not the stale localAnalysis pre-analysis guess', () => {
      const after = {
        entry_type: 'vent', // set by orchestrator.js's buildSuccessPayload once analysis completes
        localAnalysis: { entry_type: 'reflection' }, // stale pre-analysis local guess
        analysis: { mood_score: 0.3 },
      };
      const fields = extractAnalyticsFields(after);
      expect(fields.entryType).toBe('vent');
    });

    it('reads category from the TOP-LEVEL location (set at entry creation)', () => {
      const after = { category: 'work', analysis: { mood_score: 0.5 } };
      expect(extractAnalyticsFields(after).category).toBe('work');
    });

    it('falls back to analysis.tags / localAnalysis.entry_type when top-level is absent (legacy shape)', () => {
      const after = {
        analysis: { mood_score: 0.6, tags: ['@activity:reading'] },
        localAnalysis: { entry_type: 'reflection' },
      };
      const fields = extractAnalyticsFields(after);
      expect(fields.tags).toEqual(['@activity:reading']);
      expect(fields.entryType).toBe('reflection');
    });

    it('defaults tags/entities to [] and category/entryType to their fallback strings when nothing is present', () => {
      const fields = extractAnalyticsFields({});
      expect(fields.tags).toEqual([]);
      expect(fields.entities).toEqual([]);
      expect(fields.category).toBe('personal');
      expect(fields.entryType).toBe('mixed');
      expect(fields.moodScore).toBeNull();
    });

    it('resolves moodScore from analysis.mood_score, falling back to localAnalysis.mood_score', () => {
      expect(extractAnalyticsFields({ analysis: { mood_score: 0.42 } }).moodScore).toBe(0.42);
      expect(extractAnalyticsFields({ localAnalysis: { mood_score: 0.1 } }).moodScore).toBe(0.1);
    });
  });

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
