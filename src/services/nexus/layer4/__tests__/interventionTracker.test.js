/**
 * R4 Task 3 — interventionTracker.js: 7-day baseline no longer leaks
 * future entries, Whoop history shape fixed (was indexed as a plain
 * date-keyed object; it's actually `{available, days: [...]}`), and the
 * Mood01-scale effectiveness-score divisor fix.
 */
import { describe, it, expect, vi } from 'vitest';

// interventionTracker.js imports config/firebase directly — mock it so
// this file never touches a real Firebase app.
vi.mock('../../../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  setDoc: vi.fn(async () => {}),
  Timestamp: { now: vi.fn(() => ({})) },
}));

import { calculateInterventionEffectiveness } from '../interventionTracker';

describe('calculateInterventionEffectiveness — baseline excludes future entries', () => {
  it('a future-dated high-mood entry does NOT inflate the baseline for a past occurrence', () => {
    const occurrence = { entryDate: '2026-07-10', entryMood: 0.30 };
    const allEntries = [
      // Prior entries (should count toward baseline): low mood.
      { date: '2026-07-08', mood: 0.30 },
      { date: '2026-07-09', mood: 0.30 },
      // A FUTURE entry relative to the occurrence, with a much higher
      // mood. The old `isWithinDays` (abs distance) would pull this into
      // the "baseline" for 2026-07-10 — look-ahead bias.
      { date: '2026-07-15', mood: 0.95 },
    ];

    const result = calculateInterventionEffectiveness([occurrence], allEntries, null);

    // With the future entry correctly excluded, the baseline is ~0.30 (the
    // two PRIOR entries), so moodDelta is ~0 — not a large positive number
    // that a leaked future 0.95 would have produced.
    expect(Math.abs(result.global.moodDelta.mean)).toBeLessThan(0.05);
  });

  it('a past-dated entry within 7 days DOES count toward the baseline', () => {
    const occurrence = { entryDate: '2026-07-10', entryMood: 0.80 };
    const allEntries = [
      { date: '2026-07-05', mood: 0.20 }, // 5 days before -> counts
    ];

    const result = calculateInterventionEffectiveness([occurrence], allEntries, null);
    // baseline = 0.20 (the one prior entry) -> moodDelta = 0.80 - 0.20 = 0.60
    expect(result.global.moodDelta.mean).toBeCloseTo(0.60, 5);
  });

  it('a same-day mood of exactly 0 is not silently dropped (Mood01 boundary: 0 is valid, not falsy-skip)', () => {
    // No prior entries -> baseline defaults to the neutral 0.5. If `mood: 0`
    // were dropped by an `if (sameDayMood)` truthy check, moodDelta would
    // have zero samples (`.mean` would be `null`) instead of `-0.5`.
    const occurrence = { entryDate: '2026-07-10', entryMood: 0 };
    const result = calculateInterventionEffectiveness([occurrence], [], null);
    expect(result.global.moodDelta).not.toBeNull();
    expect(result.global.moodDelta.mean).toBe(-0.5);
  });
});

describe('calculateInterventionEffectiveness — Whoop history shape (was indexed wrong)', () => {
  it('reads HRV/recovery via `whoopHistory.days[].requestedLocalDate`, not `whoopHistory[date]`', () => {
    const occurrence = { entryDate: '2026-07-10', entryMood: 0.6 };
    const whoopHistory = {
      available: true,
      days: [
        { requestedLocalDate: '2026-07-10', hrv: { average: 50 }, recovery: { score: 40 } },
        { requestedLocalDate: '2026-07-11', hrv: { average: 60 }, recovery: { score: 70 } },
      ],
    };

    const result = calculateInterventionEffectiveness([occurrence], [], whoopHistory);

    // Before the fix, `whoopHistory['2026-07-10']` was `undefined` (the
    // real shape is `{days: [...]}`), so hrvDelta/recoveryDelta were
    // always empty regardless of the data provided.
    expect(result.global.hrvDelta.mean).toBe(10); // 60 - 50
    expect(result.global.nextDayRecovery.mean).toBe(70);
  });

  it('an empty/unavailable whoopHistory does not throw and yields no HRV data', () => {
    const occurrence = { entryDate: '2026-07-10', entryMood: 0.6 };
    const result = calculateInterventionEffectiveness([occurrence], [], { available: false, days: [] });
    expect(result.global.hrvDelta).toBeNull();
  });
});

describe('calculateInterventionEffectiveness — Mood01 scale for the effectiveness score', () => {
  it('a consistently positive mood delta (native 0-1 scale) meaningfully raises the score above neutral', () => {
    // 3 occurrences, each with a healthy +0.30 mood delta (a "30-point"
    // improvement on the 0-100 scale users see) — should raise the score
    // well above the 0.5 neutral baseline. Pre-fix, dividing by 30 instead
    // of 0.30 made mood delta contribute essentially nothing.
    const occurrences = [
      { entryDate: '2026-07-01', entryMood: 0.80 },
      { entryDate: '2026-07-02', entryMood: 0.80 },
      { entryDate: '2026-07-03', entryMood: 0.80 },
    ];
    const allEntries = [
      { date: '2026-06-24', mood: 0.50 },
      { date: '2026-06-25', mood: 0.50 },
      { date: '2026-06-26', mood: 0.50 },
    ];

    const result = calculateInterventionEffectiveness(occurrences, allEntries, null);
    expect(result.global.score).toBeGreaterThan(0.65);
  });
});
