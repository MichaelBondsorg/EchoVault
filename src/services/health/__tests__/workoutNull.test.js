import { describe, it, expect } from 'vitest';
import { analyzeHealthMoodCorrelations } from '../healthMoodCorrelation';

// hasWorkout may now be null ("unknown") instead of a fabricated `false`.
// analyzeWorkoutCorrelation must count only explicit true/false days so an
// unknown reading never inflates the rest-day bucket (which would skew the
// workout-vs-mood correlation).
const makeDay = (day, moodScore, hasWorkout) => ({
  date: `2026-07-${String(day).padStart(2, '0')}`,
  moodScore,
  hasWorkout,
});

const buildInputs = (days) => {
  const entries = days.map((d) => ({
    createdAt: new Date(`${d.date}T12:00:00.000Z`),
    analysis: { mood_score: d.moodScore },
  }));
  const healthHistory = days.map((d) => ({
    date: d.date,
    hasWorkout: d.hasWorkout,
    // Null sub-metrics so the sibling correlations bail as "insufficient"
    // rather than throwing — this test isolates the workout branch.
    sleep: { totalHours: null },
    hrv: { average: null },
    activity: { stepsToday: null },
    recovery: null,
    strain: null,
  }));
  return { entries, healthHistory };
};

describe('workout-mood correlation with null (unknown) workout state', () => {
  it('excludes null workout days from BOTH the workout and rest buckets', () => {
    const days = [
      makeDay(1, 0.9, true),
      makeDay(2, 0.85, true),
      makeDay(3, 0.8, true),
      makeDay(4, 0.4, false),
      makeDay(5, 0.45, false),
      makeDay(6, 0.5, false),
      // Unknown days: under the old `!hasWorkout` logic these would be counted
      // as rest days and drag the rest-day average toward these low moods.
      makeDay(7, 0.1, null),
      makeDay(8, 0.1, null),
      makeDay(9, 0.1, null),
    ];
    const { entries, healthHistory } = buildInputs(days);

    const result = analyzeHealthMoodCorrelations(entries, healthHistory);
    const workout = result.correlations.workout;

    expect(workout.available).toBe(true);
    expect(workout.workoutDays).toBe(3);
    // 3 — the null days are NOT miscounted as rest days.
    expect(workout.restDays).toBe(3);
    // Rest-day mood average reflects only the three explicit `false` days
    // (0.4, 0.45, 0.5) → 0.45, not polluted by the 0.1 unknown days.
    expect(workout.moodOnRestDays).toBe(0.45);
  });
});
