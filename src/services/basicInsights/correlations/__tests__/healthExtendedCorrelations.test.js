/**
 * healthExtendedCorrelations tests (R4 Task 1).
 *
 * Verifies the engine reads `entry.healthSignals` (adapter output, built
 * via the REAL extractHealthSignals) rather than raw healthContext.*, the
 * empty-group `average([])`->`0` guard, and day-grounding.
 */
import { describe, it, expect } from 'vitest';
import { computeExtendedHealthCorrelations } from '../healthExtendedCorrelations';
import { normalizeEntryForInsights } from '../../../insights/entryAdapter';

const TZ = 'UTC';
const n = (raw) => normalizeEntryForInsights(raw, { timeZone: TZ });
const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

describe('computeExtendedHealthCorrelations', () => {
  it('detects a strain correlation via entry.healthSignals (adapter-derived, real healthContext shape)', () => {
    const entries = [];
    for (let i = 1; i <= 4; i++) {
      entries.push(n({
        id: `high-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.85 },
        healthContext: { strain: { score: 17 } },
      }));
    }
    for (let i = 1; i <= 4; i++) {
      entries.push(n({
        id: `low-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 },
        healthContext: { strain: { score: 5 } },
      }));
    }

    const insights = computeExtendedHealthCorrelations(entries);
    const strainInsight = insights.find(ins => ins.id.includes('strain'));
    expect(strainInsight).toBeTruthy();
    expect(strainInsight.entryIds.length).toBe(4);
  });

  it('detects activeCalories/distance from healthContext.activity — fields the shared extractHealthSignals does not itself expose', () => {
    const entries = [];
    for (let i = 1; i <= 4; i++) {
      entries.push(n({
        id: `active-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.85 },
        healthContext: { activity: { activeCalories: 600 } },
      }));
    }
    for (let i = 1; i <= 4; i++) {
      entries.push(n({
        id: `low-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 },
        healthContext: { activity: { activeCalories: 100 } },
      }));
    }

    const insights = computeExtendedHealthCorrelations(entries);
    expect(insights.find(ins => ins.id.includes('active_calories'))).toBeTruthy();
  });

  it('empty-group guard: no insight when a metric never has a low-group (average([])->0 must never fabricate a delta)', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({
        id: `high-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.85 },
        healthContext: { strain: { score: 18 } }, // all high, no entries below the low cutoff (10)
      }));
    }

    const insights = computeExtendedHealthCorrelations(entries);
    expect(insights.find(ins => ins.id.includes('strain'))).toBeUndefined();
  });

  it('day-grounding: no insight when the high-value group spans fewer than MIN_UNIQUE_DAYS distinct days', () => {
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push(n({
        id: `high-${i}`,
        createdAt: `2026-07-0${(i % 2) + 1}T${8 + i}:00:00.000Z`, // 2 distinct days
        analysis: { mood_score: 0.85 },
        healthContext: { strain: { score: 17 } },
      }));
    }
    for (let i = 1; i <= 4; i++) {
      entries.push(n({ id: `low-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 }, healthContext: { strain: { score: 5 } } }));
    }

    const insights = computeExtendedHealthCorrelations(entries);
    expect(insights.find(ins => ins.id.includes('strain'))).toBeUndefined();
  });

  it('recommendation wording avoids asserting personal causation ("tends to appear alongside", not "seems to boost")', () => {
    const entries = [];
    for (let i = 1; i <= 4; i++) {
      entries.push(n({ id: `high-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.85 }, healthContext: { strain: { score: 17 } } }));
    }
    for (let i = 1; i <= 4; i++) {
      entries.push(n({ id: `low-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 }, healthContext: { strain: { score: 5 } } }));
    }

    const insights = computeExtendedHealthCorrelations(entries);
    const strainInsight = insights.find(ins => ins.id.includes('strain'));
    expect(strainInsight.recommendation.toLowerCase()).not.toContain('seems to boost');
  });
});
