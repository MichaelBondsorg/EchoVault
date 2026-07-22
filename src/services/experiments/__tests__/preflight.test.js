/**
 * Personal Experiments — preflight tests (R3 Task 3).
 */
import { describe, it, expect } from 'vitest';
import { preflightExperiment } from '../preflight.js';
import { getTemplateById } from '../templates.js';
import { MIN_PAIRED_OBSERVATIONS } from '../estimator.js';

const NOW = new Date('2026-07-22T12:00:00.000Z'); // fixed reference "today"

const SLEEP_TEMPLATE = getTemplateById('sleep-hours-mood-same-day');
const SUNSHINE_TEMPLATE = getTemplateById('sunshine-percent-mood');
const TAG_TEMPLATE = getTemplateById('tag-presence-mood');
const EXERCISE_TEMPLATE = getTemplateById('exercise-minutes-mood');

function dateKeyDaysAgo(days) {
  const ms = NOW.getTime() - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

/** Build `n` daily entries, most-recent-first, all within the 28-day window, each fully populated. */
function fullyCoveredEntries(n, { tag } = {}) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push({
      createdAt: dateKeyDaysAgo(i),
      healthContext: { sleep: { totalHours: 7 + (i % 3) } },
      environmentContext: { daySummary: { sunshinePercent: 50 + (i % 10) } },
      analysis: { mood_score: 60 + (i % 20) },
      tags: tag ? [tag] : [],
    });
  }
  return entries;
}

describe('preflightExperiment — required inputs', () => {
  it('throws without a valid template', () => {
    expect(() => preflightExperiment({ entries: [], now: NOW })).toThrow();
  });

  it('throws without a valid `now`', () => {
    expect(() => preflightExperiment({ entries: [], template: SLEEP_TEMPLATE })).toThrow();
    expect(() => preflightExperiment({ entries: [], template: SLEEP_TEMPLATE, now: 'not-a-date' })).toThrow();
  });
});

describe('preflightExperiment — empty history', () => {
  it('is not appropriate with zero entries, and reports zero coverage/history', () => {
    const result = preflightExperiment({ entries: [], template: SLEEP_TEMPLATE, now: NOW });
    expect(result.appropriate).toBe(false);
    expect(result.availableHistoryDays).toBe(0);
    expect(result.expectedCoverage.exposure).toEqual({ covered: 0, total: 28, label: '0 of 28 days' });
    expect(result.expectedCoverage.outcome).toEqual({ covered: 0, total: 28, label: '0 of 28 days' });
    expect(result.missingSources).toEqual(expect.arrayContaining(['no_health_data', 'no_mood_data']));
    expect(result.reasons).toContain('projected_pairs_below_minimum');
    expect(result.recommendedDurationDays).toBe(28);
  });

  it('passes the template confounders through unchanged', () => {
    const result = preflightExperiment({ entries: [], template: SLEEP_TEMPLATE, now: NOW });
    expect(result.confounders).toEqual(SLEEP_TEMPLATE.confounders);
    // must be a copy, not the same array reference (defensive — callers must not mutate the catalog)
    expect(result.confounders).not.toBe(SLEEP_TEMPLATE.confounders);
  });
});

describe('preflightExperiment — appropriate/inappropriate boundary', () => {
  it('is appropriate with full 28-day coverage (well above the pairing threshold)', () => {
    const entries = fullyCoveredEntries(28);
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure).toEqual({ covered: 28, total: 28, label: '28 of 28 days' });
    expect(result.expectedCoverage.outcome).toEqual({ covered: 28, total: 28, label: '28 of 28 days' });
    expect(result.appropriate).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.missingSources).toEqual([]);
    expect(result.recommendedDurationDays).toBe(14); // full coverage clears the 14-day pairing bar
  });

  it('is exactly at the appropriate boundary: coverage rate that projects exactly MIN_PAIRED_OBSERVATIONS at 14 days', () => {
    // bindingRate * 14 == MIN_PAIRED_OBSERVATIONS  =>  bindingRate == 10/14
    // Use 20 covered / 28 total = 0.714... which is >= 10/14 (0.7142857...)
    const entries = [];
    for (let i = 0; i < 20; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(20);
    expect(result.expectedCoverage.exposure.total).toBe(28);
    const projected = (20 / 28) * 14;
    expect(projected).toBeGreaterThanOrEqual(MIN_PAIRED_OBSERVATIONS);
    expect(result.appropriate).toBe(true);
  });

  it('is appropriate at exactly the 50% coverage floor (14 of 28 days) — the 28-day duration fallback yields 14 projected pairs', () => {
    const entries = [];
    for (let i = 0; i < 14; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i * 2),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(14);
    expect(result.expectedCoverage.exposure.total).toBe(28);
    expect(result.reasons).not.toContain('coverage_below_floor');
    expect(result.appropriate).toBe(true);
  });

  it('is inappropriate one day below the 50% coverage floor (13 of 28 days)', () => {
    const entries = [];
    for (let i = 0; i < 13; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i * 2),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(13);
    expect(result.reasons).toContain('coverage_below_floor');
    expect(result.appropriate).toBe(false);
  });

  it('flags coverage_below_floor when coverage is under 50% even if raw pair count would otherwise be close', () => {
    // Very sparse but long history: 10 covered days out of 28 = ~35.7%, under the 50% floor.
    const entries = [];
    for (let i = 0; i < 10; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i * 2),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.reasons).toContain('coverage_below_floor');
    expect(result.appropriate).toBe(false);
  });
});

describe('preflightExperiment — missing sources', () => {
  it('reports no_health_data for a health template with zero signal days but present mood data', () => {
    const entries = fullyCoveredEntries(28).map((e) => ({ ...e, healthContext: undefined }));
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.missingSources).toContain('no_health_data');
    expect(result.appropriate).toBe(false);
  });

  it('reports no_environment_data for an environment template with zero signal days', () => {
    const entries = fullyCoveredEntries(28).map((e) => ({ ...e, environmentContext: undefined }));
    const result = preflightExperiment({ entries, template: SUNSHINE_TEMPLATE, now: NOW });
    expect(result.missingSources).toContain('no_environment_data');
  });

  it('reports no_mood_data when no entries carry analysis.mood_score', () => {
    const entries = fullyCoveredEntries(28).map((e) => ({ ...e, analysis: undefined }));
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.missingSources).toContain('no_mood_data');
    expect(result.appropriate).toBe(false);
  });
});

describe('preflightExperiment — tag-presence, zero occurrences', () => {
  it('is not appropriate when the chosen tag never appears, even with full mood coverage', () => {
    const entries = fullyCoveredEntries(28); // no tags set
    const result = preflightExperiment({
      entries,
      template: TAG_TEMPLATE,
      params: { tag: '@person:spencer' },
      now: NOW,
    });
    expect(result.missingSources).toContain('no_tag_occurrences');
    expect(result.reasons).toContain('no_tag_occurrences');
    expect(result.appropriate).toBe(false);
  });

  it('is appropriate when the tag appears on enough days', () => {
    const entries = fullyCoveredEntries(28, { tag: '@person:spencer' });
    const result = preflightExperiment({
      entries,
      template: TAG_TEMPLATE,
      params: { tag: '@person:spencer' },
      now: NOW,
    });
    expect(result.missingSources).not.toContain('no_tag_occurrences');
    expect(result.appropriate).toBe(true);
  });

  it('treats an entry with no tags array as UNKNOWN (dropped), not a known "tag absent" day (Michael review hardening, item 4)', () => {
    const entries = fullyCoveredEntries(28, { tag: '@person:spencer' }).map((e, i) =>
      i % 2 === 0 ? { ...e, tags: undefined } : e,
    );
    const result = preflightExperiment({
      entries,
      template: TAG_TEMPLATE,
      params: { tag: '@person:spencer' },
      now: NOW,
    });
    // Only the half of days with an EXPLICIT tags array count toward
    // exposure coverage — a missing `tags` array means the entry was never
    // actually screened for tags at all, which is a genuinely unknown
    // observation for this variable, not a known absence (item 4 reverses
    // the pre-EX2 "no tags array -> known 0" behavior).
    expect(result.expectedCoverage.exposure.covered).toBe(14);
  });

  it('is not appropriate when no tag param is supplied at all', () => {
    const entries = fullyCoveredEntries(28, { tag: '@person:spencer' });
    const result = preflightExperiment({ entries, template: TAG_TEMPLATE, now: NOW });
    expect(result.missingSources).toContain('no_tag_occurrences');
    expect(result.appropriate).toBe(false);
  });
});

describe('preflightExperiment — known-zero activity fix (R3 Task 5 carry-forward, shared helper)', () => {
  it('counts a zero-exercise day as covered, not missing — `healthContext.activity` present, `totalExerciseMinutes: 0`', () => {
    const entries = [];
    for (let i = 0; i < 14; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i),
        // Real zero: the user logged a workout-free day and Whoop/HealthKit
        // reported it. Pre-fix, `extractHealthSignals`'s `|| null` coercion
        // made this indistinguishable from "no activity data at all".
        healthContext: { activity: { totalExerciseMinutes: 0, stepsToday: 0 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: EXERCISE_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(14);
    expect(result.missingSources).not.toContain('no_health_data');
  });

  it('still treats a day with NO healthContext.activity at all as missing (dropped, not a known zero)', () => {
    const entries = [];
    for (let i = 0; i < 14; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i),
        healthContext: { sleep: { totalHours: 7 } }, // no `activity` key at all
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: EXERCISE_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(0);
    expect(result.missingSources).toContain('no_health_data');
  });
});

describe('preflightExperiment — scope filtering (strict, via scopeFilter)', () => {
  it('a scoped preflight counts only scoped entries — unscoped and other-space entries are excluded', () => {
    const scopedEntries = fullyCoveredEntries(28).map((e) => ({ ...e, spaceId: 'space-work' }));
    const unscopedEntries = fullyCoveredEntries(28).map((e) => ({ ...e, spaceId: undefined }));
    const otherSpaceEntries = fullyCoveredEntries(28).map((e) => ({ ...e, spaceId: 'space-personal' }));

    const allEntries = [...scopedEntries, ...unscopedEntries, ...otherSpaceEntries];

    const scopedResult = preflightExperiment({
      entries: allEntries,
      template: SLEEP_TEMPLATE,
      scope: { spaceId: 'space-work' },
      now: NOW,
    });
    // Only the 28 space-work entries count — coverage should be identical to
    // running preflight on JUST scopedEntries, not 3x that.
    const isolatedResult = preflightExperiment({
      entries: scopedEntries,
      template: SLEEP_TEMPLATE,
      now: NOW,
    });
    expect(scopedResult.expectedCoverage).toEqual(isolatedResult.expectedCoverage);
    expect(scopedResult.availableHistoryDays).toBe(isolatedResult.availableHistoryDays);
  });

  it('an unscoped (scope=null) preflight sees every entry regardless of spaceId', () => {
    const mixedEntries = [
      ...fullyCoveredEntries(14).map((e) => ({ ...e, spaceId: 'space-work' })),
      ...fullyCoveredEntries(14, {}).map((e, i) => ({
        ...e,
        createdAt: dateKeyDaysAgo(14 + i),
        spaceId: undefined,
      })),
    ];
    const result = preflightExperiment({ entries: mixedEntries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.expectedCoverage.exposure.covered).toBe(28);
  });
});

describe('preflightExperiment — recommendedDurationDays', () => {
  it('recommends 14 when 14 days of projected pairs already clears the minimum', () => {
    const result = preflightExperiment({ entries: fullyCoveredEntries(28), template: SLEEP_TEMPLATE, now: NOW });
    expect(result.recommendedDurationDays).toBe(14);
  });

  it('recommends 28 when 14 days would not clear the minimum but 28 might', () => {
    // ~40% coverage: 14 of 28 covered projects to 5.6 pairs at 14 days (fails)
    // but 11.2 pairs at 28 days is closer — still under floor though, so appropriate stays false,
    // but recommendedDurationDays should still prefer the longer window.
    const entries = [];
    for (let i = 0; i < 11; i++) {
      entries.push({
        createdAt: dateKeyDaysAgo(i * 2),
        healthContext: { sleep: { totalHours: 7 } },
        analysis: { mood_score: 60 },
      });
    }
    const result = preflightExperiment({ entries, template: SLEEP_TEMPLATE, now: NOW });
    expect(result.recommendedDurationDays).toBe(28);
  });
});
