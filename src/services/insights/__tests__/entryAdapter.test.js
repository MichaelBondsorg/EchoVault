/**
 * entryAdapter contract tests (R4 Task 1).
 *
 * Fixtures cover three shapes an entry can arrive in:
 *  - CURRENT: what `functions/src/analysis/orchestrator.js` writes today
 *    (top-level tags/entry_type/category, analysis.mood_score, never any
 *    analysis.themes/emotions/cognitive_patterns/entities).
 *  - LEGACY: the pre-this-pipeline shape the deep review flagged (fields
 *    nested under analysis.*).
 *  - EXPORT: a data-export-shaped entry with a full Whoop/HealthKit
 *    healthContext.activity OBJECT (the shape that crashed
 *    activityCorrelations' `.toLowerCase()` call).
 */
import { describe, it, expect } from 'vitest';
import {
  ADAPTER_VERSION,
  UNKNOWN,
  isUnknown,
  normalizeEntryForInsights,
  normalizeEntriesForInsights,
} from '../entryAdapter';

const TZ = 'UTC';

describe('entryAdapter', () => {
  describe('isUnknown / UNKNOWN sentinel', () => {
    it('UNKNOWN is not null, undefined, or an empty array', () => {
      expect(UNKNOWN).not.toBeNull();
      expect(UNKNOWN).not.toBeUndefined();
      expect(UNKNOWN).not.toEqual([]);
      expect(isUnknown(UNKNOWN)).toBe(true);
    });

    it('isUnknown is false for null, undefined, [], and real values', () => {
      expect(isUnknown(null)).toBe(false);
      expect(isUnknown(undefined)).toBe(false);
      expect(isUnknown([])).toBe(false);
      expect(isUnknown('reflection')).toBe(false);
    });
  });

  describe('CURRENT shape (functions/src/analysis/orchestrator.js output)', () => {
    const current = {
      id: 'e1',
      createdAt: '2026-07-10T12:00:00.000Z',
      content: 'Went for a yoga class today.',
      category: 'health',
      entry_type: 'reflection',
      tags: ['@activity:yoga', '@person:spencer'],
      analysis: { mood_score: 0.8, framework: 'general' },
    };

    it('resolves entryType/category/tags from their top-level locations', () => {
      const n = normalizeEntryForInsights(current, { timeZone: TZ });
      expect(n.entryType).toBe('reflection');
      expect(n.category).toBe('health');
      expect(n.tags).toEqual(['@activity:yoga', '@person:spencer']);
    });

    it('resolves mood01 from analysis.mood_score, unchanged 0-1 scale', () => {
      const n = normalizeEntryForInsights(current, { timeZone: TZ });
      expect(n.mood01).toBe(0.8);
    });

    it('resolves dateKey as the local calendar day', () => {
      const n = normalizeEntryForInsights(current, { timeZone: TZ });
      expect(n.dateKey).toBe('2026-07-10');
    });

    it('fields never written today (themes/emotions/cognitive_patterns/entities) resolve to UNKNOWN, not [] or null', () => {
      const n = normalizeEntryForInsights(current, { timeZone: TZ });
      expect(isUnknown(n.themes)).toBe(true);
      expect(isUnknown(n.emotions)).toBe(true);
      expect(isUnknown(n.cognitivePatterns)).toBe(true);
      expect(isUnknown(n.entities)).toBe(true);
    });

    it('stamps the adapter version', () => {
      const n = normalizeEntryForInsights(current, { timeZone: TZ });
      expect(n.adapterVersion).toBe(ADAPTER_VERSION);
    });
  });

  describe('LEGACY shape (analysis.* nested fields)', () => {
    const legacy = {
      id: 'legacy1',
      createdAt: '2026-05-01T08:00:00.000Z',
      text: 'Rough day at work.',
      analysis: {
        mood_score: 0.3,
        entry_type: 'vent',
        tags: ['@activity:exercise'],
      },
      classification: { primary_category: 'work' },
    };

    it('falls back to analysis.entry_type when top-level entry_type is absent', () => {
      const n = normalizeEntryForInsights(legacy, { timeZone: TZ });
      expect(n.entryType).toBe('vent');
    });

    it('falls back to analysis.tags when top-level tags is absent', () => {
      const n = normalizeEntryForInsights(legacy, { timeZone: TZ });
      expect(n.tags).toEqual(['@activity:exercise']);
    });

    it('falls back to classification.primary_category when top-level category is absent', () => {
      const n = normalizeEntryForInsights(legacy, { timeZone: TZ });
      expect(n.category).toBe('work');
    });
  });

  describe('tri-state: UNKNOWN vs known-empty', () => {
    it('an explicit empty tags array is known-empty, not UNKNOWN', () => {
      const entry = { id: 'e2', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 }, tags: [] };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(isUnknown(n.tags)).toBe(false);
      expect(n.tags).toEqual([]);
    });

    it('no tags field anywhere resolves to UNKNOWN, not []', () => {
      const entry = { id: 'e3', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 } };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(isUnknown(n.tags)).toBe(true);
    });

    it('entry_type as an empty string is treated as absent (UNKNOWN), never a real type', () => {
      const entry = { id: 'e4', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 }, entry_type: '' };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(isUnknown(n.entryType)).toBe(true);
    });
  });

  describe('mood01 domain validation (never fabricated, never rescaled)', () => {
    it('missing mood_score resolves to null', () => {
      const entry = { id: 'e5', createdAt: '2026-06-01T00:00:00Z' };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.mood01).toBeNull();
    });

    it('an out-of-domain mood_score (e.g. an already-0-100 value) is REJECTED, never divided/clamped', () => {
      const entry = { id: 'e6', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 80 } };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.mood01).toBeNull();
    });

    it('a negative mood_score is REJECTED', () => {
      const entry = { id: 'e7', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: -0.1 } };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.mood01).toBeNull();
    });

    it('falls back to localAnalysis.mood_score when analysis has none', () => {
      const entry = { id: 'e8', createdAt: '2026-06-01T00:00:00Z', localAnalysis: { mood_score: 0.65 } };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.mood01).toBe(0.65);
    });

    it('boundary values 0 and 1 are valid (not rejected as falsy/out-of-range)', () => {
      const zero = normalizeEntryForInsights({ id: 'z', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0 } }, { timeZone: TZ });
      const one = normalizeEntryForInsights({ id: 'o', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 1 } }, { timeZone: TZ });
      expect(zero.mood01).toBe(0);
      expect(one.mood01).toBe(1);
    });
  });

  describe('EXPORT shape: healthContext.activity is an OBJECT (the live crash site)', () => {
    const exportEntry = {
      id: 'export1',
      createdAt: '2026-07-15T09:00:00.000Z',
      content: 'Ran 5k this morning.',
      analysis: { mood_score: 0.85 },
      healthContext: {
        sleep: { totalHours: 7.5, score: 82, stages: { deep: 1.6, rem: 1.9 } },
        heart: { hrv: 55, restingRate: 58 },
        recovery: { score: 70 },
        strain: { score: 14.2 },
        activity: {
          stepsToday: 9000,
          hasWorkout: true,
          totalExerciseMinutes: 35,
          activeCalories: 520,
          totalCalories: 2400,
          distance: 5.1,
          workouts: [{ type: 'Running', durationMinutes: 32 }],
        },
      },
    };

    it('does not throw normalizing an object-shaped healthContext.activity', () => {
      expect(() => normalizeEntryForInsights(exportEntry, { timeZone: TZ })).not.toThrow();
    });

    it('derives lowercased activityTypes from healthContext.activity.workouts, never .toLowerCase()-ing the object itself', () => {
      const n = normalizeEntryForInsights(exportEntry, { timeZone: TZ });
      expect(n.healthSignals.activityTypes).toEqual(['running']);
    });

    it('carries the extended health fields healthExtendedCorrelations needs', () => {
      const n = normalizeEntryForInsights(exportEntry, { timeZone: TZ });
      expect(n.healthSignals.strainScore).toBe(14.2);
      expect(n.healthSignals.deepSleepHours).toBe(1.6);
      expect(n.healthSignals.remSleepHours).toBe(1.9);
      expect(n.healthSignals.activeCalories).toBe(520);
      expect(n.healthSignals.totalCalories).toBe(2400);
      expect(n.healthSignals.exerciseMinutes).toBe(35);
      expect(n.healthSignals.distance).toBe(5.1);
    });

    it('healthSignals is null when there is no healthContext at all', () => {
      const n = normalizeEntryForInsights({ id: 'nohc', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 } }, { timeZone: TZ });
      expect(n.healthSignals).toBeNull();
    });

    it('activityTypes is [] (known-empty, not UNKNOWN/null) when healthContext.activity has no workouts', () => {
      const entry = {
        id: 'noworkout',
        createdAt: '2026-06-01T00:00:00Z',
        analysis: { mood_score: 0.5 },
        healthContext: { activity: { stepsToday: 100 } },
      };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.healthSignals.activityTypes).toEqual([]);
    });
  });

  describe('normalizeEntriesForInsights (batch)', () => {
    it('drops null/non-object entries and normalizes the rest', () => {
      const entries = [
        { id: 'a', createdAt: '2026-06-01T00:00:00Z', analysis: { mood_score: 0.5 } },
        null,
        undefined,
        { id: 'b', createdAt: '2026-06-02T00:00:00Z', analysis: { mood_score: 0.6 } },
      ];
      const normalized = normalizeEntriesForInsights(entries, { timeZone: TZ });
      expect(normalized.length).toBe(2);
      expect(normalized.map((e) => e.id)).toEqual(['a', 'b']);
    });

    it('normalizeEntryForInsights returns null for a non-object entry', () => {
      expect(normalizeEntryForInsights(null)).toBeNull();
      expect(normalizeEntryForInsights(undefined)).toBeNull();
      expect(normalizeEntryForInsights('not an entry')).toBeNull();
    });
  });

  describe('id resolution', () => {
    it('falls back to entryId when id is absent', () => {
      const n = normalizeEntryForInsights({ entryId: 'legacy-id', createdAt: '2026-06-01T00:00:00Z' }, { timeZone: TZ });
      expect(n.id).toBe('legacy-id');
    });

    it('is null when neither id nor entryId is present', () => {
      const n = normalizeEntryForInsights({ createdAt: '2026-06-01T00:00:00Z' }, { timeZone: TZ });
      expect(n.id).toBeNull();
    });
  });

  describe('dateKey', () => {
    it('is null for an entry with no date fields', () => {
      const n = normalizeEntryForInsights({ id: 'nodate' }, { timeZone: TZ });
      expect(n.dateKey).toBeNull();
    });

    it('prefers effectiveDate over createdAt', () => {
      const entry = {
        id: 'e',
        effectiveDate: '2026-01-05T00:00:00.000Z',
        createdAt: '2026-01-09T00:00:00.000Z',
      };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.dateKey).toBe('2026-01-05');
    });
  });

  describe('timestampMs', () => {
    it('is the exact instant behind dateKey (effectiveDate ?? createdAt), not just the truncated day', () => {
      const entry = { id: 'e', createdAt: '2026-07-10T14:30:00.000Z' };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.timestampMs).toBe(Date.parse('2026-07-10T14:30:00.000Z'));
    });

    it('is null when there is no usable date', () => {
      const n = normalizeEntryForInsights({ id: 'nodate' }, { timeZone: TZ });
      expect(n.timestampMs).toBeNull();
    });

    it('prefers effectiveDate over createdAt, same as dateKey', () => {
      const entry = { id: 'e', effectiveDate: '2026-01-05T08:00:00.000Z', createdAt: '2026-01-09T20:00:00.000Z' };
      const n = normalizeEntryForInsights(entry, { timeZone: TZ });
      expect(n.timestampMs).toBe(Date.parse('2026-01-05T08:00:00.000Z'));
    });
  });
});
