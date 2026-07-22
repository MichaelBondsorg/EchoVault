/**
 * categoryCorrelations tests (R4 Task 1).
 *
 * Covers the specific verified bug: `entry_type` is stored TOP-LEVEL by
 * the write pipeline, but the pre-R4 engine read `analysis.entry_type`
 * (never written there) — so entry-type correlations silently never
 * fired. Also covers UNKNOWN-category/type entries being dropped from the
 * analysis, the complement baseline, and day-grounding.
 */
import { describe, it, expect } from 'vitest';
import { computeCategoryCorrelations } from '../categoryCorrelations';
import { normalizeEntryForInsights } from '../../../insights/entryAdapter';

const TZ = 'UTC';
const n = (raw) => normalizeEntryForInsights(raw, { timeZone: TZ });
const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

describe('computeCategoryCorrelations', () => {
  it('resolves entry_type from its TOP-LEVEL location (current write pipeline shape)', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `vent-${i}`, createdAt: dayIso(i), entry_type: 'vent', analysis: { mood_score: 0.2 } }));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `reflect-${i}`, createdAt: dayIso(i + 10), entry_type: 'reflection', analysis: { mood_score: 0.8 } }));
    }

    const insights = computeCategoryCorrelations(entries);
    const ventInsight = insights.find(ins => ins.entryType === 'vent');
    expect(ventInsight).toBeTruthy();
    expect(ventInsight.entryIds.length).toBe(6);
  });

  it('also resolves entry_type from the LEGACY analysis.entry_type location when top-level is absent', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `vent-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.2, entry_type: 'vent' } }));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `reflect-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.8, entry_type: 'reflection' } }));
    }

    const insights = computeCategoryCorrelations(entries);
    expect(insights.find(ins => ins.entryType === 'vent')).toBeTruthy();
  });

  it('drops UNKNOWN-category entries from the analysis entirely (never counted present or absent)', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `work-${i}`, createdAt: dayIso(i), category: 'work', analysis: { mood_score: 0.2 } }));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `personal-${i}`, createdAt: dayIso(i + 10), category: 'personal', analysis: { mood_score: 0.8 } }));
    }
    // 6 entries with NO category field anywhere -> UNKNOWN, must not be
    // silently folded into either group.
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `nocat-${i}`, createdAt: dayIso(i + 20), analysis: { mood_score: 0.99 } }));
    }

    const insights = computeCategoryCorrelations(entries);
    const workInsight = insights.find(ins => ins.id.includes('category_work'));
    expect(workInsight).toBeTruthy();
    // If the UNKNOWN-category (very high mood) entries leaked into the
    // "personal" complement group used as work's absent baseline, the
    // delta would be diluted/distorted. sampleSize/entryIds must be
    // exactly the 6 known "work" entries.
    expect(workInsight.sampleSize).toBe(6);
    expect(workInsight.entryIds.sort()).toEqual(['work-1', 'work-2', 'work-3', 'work-4', 'work-5', 'work-6']);
  });

  it('day-grounding gates category insights on distinct days, not just entry count', () => {
    const entries = [];
    for (let i = 0; i < 6; i++) {
      entries.push(n({
        id: `work-${i}`,
        createdAt: `2026-07-0${(i % 2) + 1}T${8 + i}:00:00.000Z`, // only 2 distinct days
        category: 'work', analysis: { mood_score: 0.2 },
      }));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `personal-${i}`, createdAt: dayIso(i + 10), category: 'personal', analysis: { mood_score: 0.8 } }));
    }

    const insights = computeCategoryCorrelations(entries);
    expect(insights.find(ins => ins.id.includes('category_work'))).toBeUndefined();
  });

  it('wording uses "than your other entries" (complement), never a causal claim', () => {
    const entries = [];
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `work-${i}`, createdAt: dayIso(i), category: 'work', analysis: { mood_score: 0.2 } }));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push(n({ id: `personal-${i}`, createdAt: dayIso(i + 10), category: 'personal', analysis: { mood_score: 0.8 } }));
    }

    const insights = computeCategoryCorrelations(entries);
    const workInsight = insights.find(ins => ins.id.includes('category_work'));
    expect(workInsight.insight).toContain('than your other entries');
  });
});
