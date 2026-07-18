const dateParts = (instant, timezone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const requestedLocalDate = (date = new Date(), timezone = 'UTC') => {
  const instant = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(instant.getTime())) throw new Error('whoop_requested_date_invalid');
  return dateParts(instant, timezone);
};

export const normalizeWhoopSummary = (response, requestedDate, timezone) => {
  if (
    response.requestedLocalDate !== requestedDate ||
    response.date !== requestedDate ||
    response.timezone !== timezone
  ) {
    throw new Error('whoop_date_mismatch');
  }

  if (
    response.sleep?.totalHours != null &&
    (!Number.isFinite(response.sleep.totalHours) ||
      response.sleep.totalHours < 0 ||
      response.sleep.totalHours > 16)
  ) {
    throw new Error('whoop_sleep_out_of_range');
  }

  const workouts = (response.workouts || []).map((workout) => ({
    type: workout.type,
    durationSeconds: workout.durationSeconds,
    durationMinutes: Number.isFinite(workout.durationSeconds)
      ? Math.round(workout.durationSeconds / 60)
      : null,
    calories: workout.calories,
    strain: workout.strain,
    sourceRecordId: workout.sourceRecordId,
    observedStart: workout.observedStart,
    observedEnd: workout.observedEnd,
  }));

  return {
    available: Boolean(response.available),
    source: 'whoop',
    date: requestedDate,
    requestedLocalDate: requestedDate,
    timezone,
    queriedAt: response.queriedAt || new Date().toISOString(),
    sourceRecordIds: response.sourceRecordIds || {},
    observedIntervals: response.observedIntervals || {},
    sleep: response.sleep
      ? {
          totalHours: response.sleep.totalHours,
          quality: response.sleep.quality,
          score: response.sleep.score ?? null,
          stages: response.sleep.stages ?? null,
          inBed: response.sleep.inBed,
          asleep: response.sleep.asleep,
        }
      : null,
    heart: {
      restingRate: response.heartRate?.resting ?? null,
      currentRate: null,
      hrv: response.hrv?.average ?? null,
      hrvTrend: null,
      stressIndicator: response.hrv?.stressIndicator ?? null,
    },
    activity: {
      stepsToday: null,
      totalCaloriesBurned: response.strain?.calories ?? null,
      activeCaloriesBurned: response.strain?.calories ?? null,
      totalExerciseMinutes: Math.round(
        workouts.reduce((sum, workout) => sum + (workout.durationSeconds || 0), 0) / 60
      ),
      hasWorkout: workouts.length > 0,
      workouts,
    },
    recovery: response.recovery
      ? { score: response.recovery.score, status: response.recovery.status }
      : null,
    strain: response.strain
      ? { score: response.strain.score, calories: response.strain.calories }
      : null,
    hrv: response.hrv || null,
    heartRate: response.heartRate || null,
    workouts,
    hasWorkout: workouts.length > 0,
    steps: null,
  };
};
