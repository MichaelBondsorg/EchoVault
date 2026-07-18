import { formatHealthForAI, sleepQualityFromScore } from '../healthFormatter';

describe('health formatting contracts', () => {
  it.each([
    [85, 'excellent'],
    [70, 'good'],
    [50, 'fair'],
    [20, 'poor'],
  ])('maps sleep score %s to %s consistently', (score, expected) => {
    expect(sleepQualityFromScore(score)).toBe(expected);
  });

  it('formats a canonical workout duration in seconds as minutes once', () => {
    expect(
      formatHealthForAI({
        activity: {
          hasWorkout: true,
          workouts: [{ type: 'Running', durationSeconds: 3_600 }],
        },
      })
    ).toContain('Running (60min)');
  });
});
