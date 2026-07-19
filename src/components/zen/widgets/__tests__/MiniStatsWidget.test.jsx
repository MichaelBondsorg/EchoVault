/**
 * Regression coverage for MiniStatsWidget's Streak cell (D4b reviewer
 * follow-up, Important I2): the cell used to compute its own inline streak
 * with a 30-day cap, which could disagree with StreakCelebration's
 * uncapped `calculateStreak()` at streak lengths >= 31. Both now read from
 * the same `calculateStreak()` helper (services/dashboard/index.js).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// MiniStatsWidget imports calculateStreak from services/dashboard, whose
// index imports the real firebase config at module scope — that throws in
// CI where VITE_FIREBASE_API_KEY isn't set. Stub the config module out.
vi.mock('../../../../config/firebase', () => ({
  db: {},
  doc: vi.fn(),
  setDoc: vi.fn(),
  Timestamp: { now: vi.fn(), fromDate: vi.fn() },
  deleteDoc: vi.fn(),
}));

import MiniStatsWidget from '../MiniStatsWidget';

// Build `count` consecutive daily entries ending today (local calendar
// days), matching the shape calculateStreak()/the widget both read
// (effectiveDate as a JS Date; Firestore Timestamps also expose `.toDate()`
// but a plain Date satisfies both call sites here).
function buildConsecutiveDailyEntries(count) {
  const entries = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    entries.push({ id: `e${i}`, effectiveDate: d, analysis: { mood_score: 0.6 } });
  }
  return entries;
}

describe('MiniStatsWidget streak cell', () => {
  it('renders a streak within the old 30-day cap correctly', () => {
    render(<MiniStatsWidget entries={buildConsecutiveDailyEntries(10)} />);
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('renders a streak beyond the old 30-day cap (regression: was capped at 30)', () => {
    render(<MiniStatsWidget entries={buildConsecutiveDailyEntries(35)} />);
    expect(screen.getByText('35')).toBeTruthy();
    expect(screen.queryByText('30')).toBeNull();
  });

  it('renders 0 when there are no entries', () => {
    render(<MiniStatsWidget entries={[]} />);
    expect(screen.getByText('0')).toBeTruthy();
  });
});
