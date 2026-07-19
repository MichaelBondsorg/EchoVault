/**
 * Regression coverage for the streak-celebration decision logic (D4b
 * reviewer fix, 2026-07-18):
 *  - CRITICAL C1 / IMPORTANT I1: shouldCelebrateNewStreak() must never
 *    return true for a safety-flagged or warning-flagged save, so
 *    StreakCelebration can't collide with CrisisResourcesScreen or
 *    DecompressionScreen on the same save.
 *  - IMPORTANT I2: calculateStreak() is uncapped (unlike the old
 *    MiniStatsWidget inline calc, which was capped at 30 days), so streaks
 *    beyond 30 days compute correctly.
 */
import { describe, it, expect } from 'vitest';
import { calculateStreak, shouldCelebrateNewStreak } from '../index';

function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function buildConsecutiveDailyEntries(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    effectiveDate: daysAgo(i)
  }));
}

describe('calculateStreak', () => {
  it('is uncapped: a 35-day streak reports 35, not 30', () => {
    const result = calculateStreak(buildConsecutiveDailyEntries(35));
    expect(result.currentStreak).toBe(35);
    expect(result.longestStreak).toBe(35);
  });

  it('returns zeros for no entries', () => {
    expect(calculateStreak([])).toEqual({ currentStreak: 0, longestStreak: 0, lastEntryDate: null });
  });
});

describe('shouldCelebrateNewStreak', () => {
  const newRecord = { currentStreak: 8, longestStreak: 8 };
  const priorBest = { currentStreak: 7, longestStreak: 7 };

  it('celebrates a genuine new personal best with no safety flags', () => {
    expect(shouldCelebrateNewStreak(priorBest, newRecord, {})).toBe(true);
  });

  it('does NOT celebrate when safetyFlagged is true (CRITICAL C1 regression)', () => {
    expect(
      shouldCelebrateNewStreak(priorBest, newRecord, { safetyFlagged: true })
    ).toBe(false);
  });

  it('does NOT celebrate when hasWarning is true (IMPORTANT I1 regression)', () => {
    expect(
      shouldCelebrateNewStreak(priorBest, newRecord, { hasWarning: true })
    ).toBe(false);
  });

  it('does NOT celebrate when both flags are true', () => {
    expect(
      shouldCelebrateNewStreak(priorBest, newRecord, { safetyFlagged: true, hasWarning: true })
    ).toBe(false);
  });

  it('does NOT celebrate a first-ever entry (0 -> 1, no safety flags)', () => {
    expect(
      shouldCelebrateNewStreak(
        { currentStreak: 0, longestStreak: 0 },
        { currentStreak: 1, longestStreak: 1 },
        {}
      )
    ).toBe(false);
  });

  it('does NOT celebrate when the streak did not beat the prior best', () => {
    expect(
      shouldCelebrateNewStreak(
        { currentStreak: 8, longestStreak: 8 },
        { currentStreak: 5, longestStreak: 8 },
        {}
      )
    ).toBe(false);
  });
});
