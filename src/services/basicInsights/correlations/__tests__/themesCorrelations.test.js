/**
 * themesCorrelations tests (R4 Task 1).
 *
 * Covers the tri-state discipline for themes/emotions/cognitive_patterns —
 * fields never written by the current pipeline — and confirms the theme
 * sub-analysis still functions via tags/text even while `themes` itself is
 * always UNKNOWN.
 */
import { describe, it, expect } from 'vitest';
import { computeThemesCorrelations } from '../themesCorrelations';
import { normalizeEntryForInsights, isUnknown } from '../../../insights/entryAdapter';

const TZ = 'UTC';
const n = (raw) => normalizeEntryForInsights(raw, { timeZone: TZ });
const dayIso = (day) => `2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`;

describe('computeThemesCorrelations', () => {
  it('sanity: themes/emotions/cognitivePatterns resolve to UNKNOWN on a current-shape entry (never written today)', () => {
    const entry = n({ id: 'e', createdAt: dayIso(1), content: 'a normal day', analysis: { mood_score: 0.5 } });
    expect(isUnknown(entry.themes)).toBe(true);
    expect(isUnknown(entry.emotions)).toBe(true);
    expect(isUnknown(entry.cognitivePatterns)).toBe(true);
  });

  it('theme detection still works via TEXT even though analysis.themes is always UNKNOWN today', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `grat-${i}`, createdAt: dayIso(i), content: 'feeling so grateful today', analysis: { mood_score: 0.9 } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'an ordinary entry', analysis: { mood_score: 0.4 } }));
    }

    const insights = computeThemesCorrelations(entries);
    const gratitude = insights.find(ins => ins.themeKey === 'gratitude');
    expect(gratitude).toBeTruthy();
    expect(gratitude.entryIds.length).toBe(5);
  });

  it('theme detection also matches via a known (legacy) analysis.themes array', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `grat-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.9, themes: ['gratitude'] } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.4 } }));
    }

    const insights = computeThemesCorrelations(entries);
    expect(insights.find(ins => ins.themeKey === 'gratitude')).toBeTruthy();
  });

  it('emotion-intensity sub-analysis drops UNKNOWN-emotions entries entirely (never counts them as "no emotion")', () => {
    const entries = [];
    // 5 entries with a KNOWN emotions array carrying high-intensity joy
    for (let i = 1; i <= 5; i++) {
      entries.push(n({
        id: `joy-${i}`, createdAt: dayIso(i), analysis: { mood_score: 0.95, emotions: [{ name: 'joy', intensity: 'high' }] },
      }));
    }
    // 5 entries with a KNOWN emotions array but no joy (the real complement)
    for (let i = 1; i <= 5; i++) {
      entries.push(n({
        id: `known-plain-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.5, emotions: [] },
      }));
    }
    // 5 entries with an extremely high mood but NO emotions field at all
    // (UNKNOWN) — must NOT leak into the complement group, or it would
    // shrink/hide the joy delta.
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `unknown-${i}`, createdAt: dayIso(i + 20), analysis: { mood_score: 0.99 } }));
    }

    const insights = computeThemesCorrelations(entries);
    const joyInsight = insights.find(ins => ins.emotionKey === 'joy');
    expect(joyInsight).toBeTruthy();
    expect(joyInsight.sampleSize).toBe(5);
    // The complement average must be exactly 0.5 (the known-emotions
    // "plain" group), not diluted upward by the UNKNOWN 0.99 entries.
    // moodDelta = round((0.95 - 0.5) * 100) = 45
    expect(joyInsight.moodDelta).toBe(45);
  });

  it('cognitive-pattern sub-analysis drops UNKNOWN-cognitivePatterns entries entirely', () => {
    const entries = [];
    for (let i = 1; i <= 5; i++) {
      entries.push(n({
        id: `catastrophizing-${i}`, createdAt: dayIso(i),
        analysis: { mood_score: 0.2, cognitive_patterns: [{ type: 'catastrophizing' }] },
      }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `known-plain-${i}`, createdAt: dayIso(i + 10), analysis: { mood_score: 0.6, cognitive_patterns: [] } }));
    }
    for (let i = 1; i <= 5; i++) {
      entries.push(n({ id: `unknown-${i}`, createdAt: dayIso(i + 20), analysis: { mood_score: 0.01 } }));
    }

    const insights = computeThemesCorrelations(entries);
    const patternInsight = insights.find(ins => ins.cognitivePattern === 'catastrophizing');
    expect(patternInsight).toBeTruthy();
    expect(patternInsight.sampleSize).toBe(5);
  });

  it('day-grounding gates theme insights on distinct days', () => {
    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push(n({
        id: `grat-${i}`,
        createdAt: `2026-07-0${(i % 2) + 1}T${8 + i}:00:00.000Z`, // 2 distinct days
        content: 'so grateful', analysis: { mood_score: 0.9 },
      }));
    }
    for (let i = 1; i <= 4; i++) {
      entries.push(n({ id: `plain-${i}`, createdAt: dayIso(i + 10), content: 'plain', analysis: { mood_score: 0.4 } }));
    }

    const insights = computeThemesCorrelations(entries);
    expect(insights.find(ins => ins.themeKey === 'gratitude')).toBeUndefined();
  });
});
