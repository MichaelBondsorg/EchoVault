/**
 * peopleCorrelations tests (R4 Task 1).
 *
 * Covers the UNKNOWN-entities sentinel (never written by the current
 * pipeline — detection still functions via tags/text), the complement
 * baseline, and day-grounding.
 */
import { describe, it, expect } from 'vitest';
import { computePeopleCorrelations } from '../peopleCorrelations';
import { normalizeEntryForInsights, isUnknown } from '../../../insights/entryAdapter';

const TZ = 'UTC';
const n = (raw) => normalizeEntryForInsights(raw, { timeZone: TZ });
const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

describe('computePeopleCorrelations', () => {
  it('sanity: entities resolves to UNKNOWN on a current-shape entry (never written today)', () => {
    const entry = n({ id: 'e', createdAt: dayIso(1), content: 'a normal day', analysis: { mood_score: 0.5 } });
    expect(isUnknown(entry.entities)).toBe(true);
  });

  it('detects a group via structured tags (@person:/family keyword) and correlates it', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `fam-${i}`, createdAt: dayIso(i), content: 'had dinner with family tonight', analysis: { mood_score: 0.9 } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'a quiet solo evening', analysis: { mood_score: 0.4 } }));
    }

    const insights = computePeopleCorrelations(entries);
    const family = insights.find(ins => ins.entityKey === 'family');
    expect(family).toBeTruthy();
    expect(family.entryIds.length).toBe(5);
    expect(family.insight).toContain('correlates with');
    expect(family.insight.toLowerCase()).not.toContain('boosts');
  });

  it('detects a specific person via a known (legacy) analysis.entities array even though top-level entities is UNKNOWN', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({
        id: `sam-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.9, entities: [{ name: 'Sam', type: 'person' }] },
      }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 } }));
    }

    const insights = computePeopleCorrelations(entries);
    expect(insights.find(ins => ins.entityKey === 'sam')).toBeTruthy();
  });

  it('uses a non-overlapping complement baseline', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `fam-${i}`, createdAt: dayIso(i), content: 'family time', analysis: { mood_score: 0.9 } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'solo evening', analysis: { mood_score: 0.5 } }));
    }

    const insights = computePeopleCorrelations(entries);
    const family = insights.find(ins => ins.entityKey === 'family');
    // Complement (non-family) average is exactly 0.5 -> delta = 40, not the
    // all-entries average (0.7 -> would read as delta 20).
    expect(family.moodDelta).toBe(40);
  });

  it('day-grounding: no insight when the group spans fewer than MIN_UNIQUE_DAYS distinct days', () => {
    const entries = [];
    for (let i = 0; i < 5; i++) {
      entries.push(n({
        id: `fam-${i}`,
        createdAt: `2026-07-0${(i % 2) + 1}T${8 + i}:00:00.000Z`, // 2 distinct days
        content: 'family time', analysis: { mood_score: 0.9 },
      }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'solo', analysis: { mood_score: 0.4 } }));
    }

    const insights = computePeopleCorrelations(entries);
    expect(insights.find(ins => ins.entityKey === 'family')).toBeUndefined();
  });
});
