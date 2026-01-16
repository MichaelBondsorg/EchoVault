/**
 * Intervention Tracker
 *
 * Tracks what activities/behaviors the user does and measures their
 * effectiveness on mood and biometrics.
 * Includes environment-aware tracking for sunshine exposure,
 * outdoor activities, and light therapy.
 */

import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { extractHealthSignals } from '../../health/healthFormatter';
import { extractEnvironmentSignals } from '../../environment/environmentFormatter';

// ============================================================
// INTERVENTION DEFINITIONS
// ============================================================

export const INTERVENTION_PATTERNS = {
  // Physical
  yoga: {
    category: 'physical',
    patterns: [/yoga/i, /flow/i, /vinyasa/i, /c3/i, /pilates/i],
    measureWindow: { same_day: true, next_day: true }
  },
  barrys: {
    category: 'physical',
    patterns: [/barry'?s/i, /barrys/i],
    measureWindow: { same_day: true, next_day: true }
  },
  gym: {
    category: 'physical',
    patterns: [/gym/i, /lift/i, /workout/i, /lifted/i, /weights/i],
    measureWindow: { same_day: true, next_day: true }
  },
  walk: {
    category: 'physical',
    patterns: [/walk/i, /walked/i, /walking/i, /hike/i],
    measureWindow: { same_day: true }
  },
  bike: {
    category: 'physical',
    patterns: [/bike/i, /ride/i, /cycling/i, /rode/i],
    measureWindow: { same_day: true, next_day: true }
  },

  // Relational
  sterling_walk: {
    category: 'relational',
    patterns: [/sterling/i, /walked.*dog/i, /dog.*walk/i],
    measureWindow: { same_day: true, next_day: true }
  },
  spencer_time: {
    category: 'relational',
    patterns: [/spencer/i, /boyfriend/i],
    measureWindow: { same_day: true }
  },
  social: {
    category: 'relational',
    patterns: [/dinner with/i, /hung out/i, /met up/i, /friends/i, /called/i],
    measureWindow: { same_day: true }
  },

  // Behavioral
  acts_of_service: {
    category: 'behavioral',
    patterns: [/cleaned.*for/i, /helped/i, /made.*for/i, /cooked.*for/i],
    measureWindow: { same_day: true, next_day: true }
  },
  creative: {
    category: 'behavioral',
    patterns: [/paint/i, /built/i, /created/i, /echovault/i, /app/i],
    measureWindow: { same_day: true }
  },

  // Recovery
  rest_day: {
    category: 'recovery',
    patterns: [/rest/i, /took it easy/i, /relaxed/i, /lazy day/i],
    measureWindow: { same_day: true, next_day: true }
  },
  sleep_focus: {
    category: 'recovery',
    patterns: [/slept in/i, /extra sleep/i, /early to bed/i],
    measureWindow: { next_day: true }
  },

  // Outdoor/Light exposure
  outdoor_time: {
    category: 'light_exposure',
    patterns: [/outside/i, /outdoors/i, /in the sun/i, /sunshine/i],
    measureWindow: { same_day: true }
  },
  morning_light: {
    category: 'light_exposure',
    patterns: [/morning walk/i, /walked this morning/i, /morning sun/i, /morning outside/i],
    measureWindow: { same_day: true, next_day: true }
  },
  nature_time: {
    category: 'light_exposure',
    patterns: [/park/i, /beach/i, /trail/i, /garden/i, /nature/i],
    measureWindow: { same_day: true }
  }
};

/**
 * Environment-based interventions (detected from environmentContext)
 */
export const ENVIRONMENT_INTERVENTIONS = {
  high_sunshine_day: {
    category: 'environment',
    condition: (env) => env?.sunshinePercent >= 60,
    measureWindow: { same_day: true }
  },
  low_sunshine_day: {
    category: 'environment',
    condition: (env) => env?.sunshinePercent != null && env.sunshinePercent < 30,
    measureWindow: { same_day: true }
  },
  sunny_weather: {
    category: 'environment',
    condition: (env) => /sunny|clear/i.test(env?.weatherLabel || ''),
    measureWindow: { same_day: true }
  },
  rainy_weather: {
    category: 'environment',
    condition: (env) => /rain|storm|drizzle/i.test(env?.weatherLabel || ''),
    measureWindow: { same_day: true }
  },
  warm_weather: {
    category: 'environment',
    condition: (env) => env?.temperature != null && env.temperature >= 70,
    measureWindow: { same_day: true }
  },
  cold_weather: {
    category: 'environment',
    condition: (env) => env?.temperature != null && env.temperature < 45,
    measureWindow: { same_day: true }
  }
};

/**
 * Health-based interventions (detected from healthContext)
 */
export const HEALTH_INTERVENTIONS = {
  good_sleep_night: {
    category: 'health',
    condition: (health) => health?.sleepScore >= 80 || health?.sleepHours >= 8,
    measureWindow: { same_day: true }
  },
  poor_sleep_night: {
    category: 'health',
    condition: (health) => health?.sleepScore < 50 || (health?.sleepHours != null && health.sleepHours < 6),
    measureWindow: { same_day: true }
  },
  workout_day: {
    category: 'health',
    condition: (health) => health?.hadWorkout === true,
    measureWindow: { same_day: true, next_day: true }
  },
  high_recovery_day: {
    category: 'health',
    condition: (health) => health?.recoveryScore >= 67,
    measureWindow: { same_day: true }
  },
  low_recovery_day: {
    category: 'health',
    condition: (health) => health?.recoveryScore != null && health.recoveryScore < 34,
    measureWindow: { same_day: true }
  },
  high_strain_day: {
    category: 'health',
    condition: (health) => health?.strainScore >= 15,
    measureWindow: { same_day: true, next_day: true }
  },
  active_day: {
    category: 'health',
    condition: (health) => health?.steps >= 8000,
    measureWindow: { same_day: true }
  },
  sedentary_day: {
    category: 'health',
    condition: (health) => health?.steps != null && health.steps < 3000,
    measureWindow: { same_day: true }
  }
};

// ============================================================
// DETECTION & TRACKING
// ============================================================

/**
 * Detect interventions in an entry
 * Includes narrative (text-based), environment, and health interventions
 */
export const detectInterventionsInEntry = (entry) => {
  const text = entry.content || entry.text || '';
  const detected = [];
  const entryDate = entry.date || entry.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
  const entryMood = entry.mood || entry.analysis?.mood_score;

  // Detect narrative interventions (text-based)
  for (const [name, config] of Object.entries(INTERVENTION_PATTERNS)) {
    const matched = config.patterns.some(pattern => pattern.test(text));

    if (matched) {
      detected.push({
        intervention: name,
        interventionType: 'narrative',
        category: config.category,
        entryId: entry.id,
        entryDate,
        entryMood
      });
    }
  }

  // Detect environment interventions (from environmentContext)
  if (entry.environmentContext) {
    const env = extractEnvironmentSignals(entry.environmentContext);
    for (const [name, config] of Object.entries(ENVIRONMENT_INTERVENTIONS)) {
      try {
        if (config.condition(env)) {
          detected.push({
            intervention: name,
            interventionType: 'environment',
            category: config.category,
            entryId: entry.id,
            entryDate,
            entryMood,
            environmentData: {
              sunshinePercent: env.sunshinePercent,
              weatherLabel: env.weatherLabel,
              temperature: env.temperature
            }
          });
        }
      } catch (e) {
        // Condition check failed, skip
      }
    }
  }

  // Detect health interventions (from healthContext)
  if (entry.healthContext) {
    const health = extractHealthSignals(entry.healthContext);
    for (const [name, config] of Object.entries(HEALTH_INTERVENTIONS)) {
      try {
        if (config.condition(health)) {
          detected.push({
            intervention: name,
            interventionType: 'health',
            category: config.category,
            entryId: entry.id,
            entryDate,
            entryMood,
            healthData: {
              sleepHours: health.sleepHours,
              sleepScore: health.sleepScore,
              recoveryScore: health.recoveryScore,
              strainScore: health.strainScore,
              steps: health.steps,
              hadWorkout: health.hadWorkout
            }
          });
        }
      } catch (e) {
        // Condition check failed, skip
      }
    }
  }

  return detected;
};

/**
 * Calculate intervention effectiveness from historical data
 */
export const calculateInterventionEffectiveness = (interventionOccurrences, allEntries, whoopHistory) => {
  const effectiveness = {
    global: { moodDelta: [], hrvDelta: [], recoveryDelta: [] },
    contextual: {}
  };

  for (const occurrence of interventionOccurrences) {
    const date = occurrence.entryDate;
    if (!date) continue;

    const nextDate = getNextDate(date);

    // Find same-day mood
    const sameDayMood = occurrence.entryMood;

    // Find baseline mood (last 7 days excluding this day)
    const baselineMoods = allEntries
      .filter(e => {
        const eDate = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
        return eDate !== date && isWithinDays(eDate, date, 7);
      })
      .map(e => e.mood || e.analysis?.mood_score)
      .filter(Boolean);

    const baselineMood = baselineMoods.length > 0
      ? baselineMoods.reduce((a, b) => a + b, 0) / baselineMoods.length
      : 50;

    if (sameDayMood) {
      const moodDelta = sameDayMood - baselineMood;
      effectiveness.global.moodDelta.push(moodDelta);
    }

    // Whoop metrics
    if (whoopHistory) {
      const todayWhoop = whoopHistory[date];
      const nextDayWhoop = whoopHistory[nextDate];

      if (nextDayWhoop?.hrv?.average && todayWhoop?.hrv?.average) {
        effectiveness.global.hrvDelta.push(
          nextDayWhoop.hrv.average - todayWhoop.hrv.average
        );
      }

      if (nextDayWhoop?.recovery?.score) {
        effectiveness.global.recoveryDelta.push(nextDayWhoop.recovery.score);
      }
    }
  }

  // Calculate statistics
  const calcStats = (arr) => {
    if (arr.length === 0) return null;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = Math.sqrt(
      arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length
    );
    return { mean: Math.round(mean * 10) / 10, stdDev: Math.round(stdDev * 10) / 10 };
  };

  return {
    global: {
      moodDelta: calcStats(effectiveness.global.moodDelta),
      hrvDelta: calcStats(effectiveness.global.hrvDelta),
      nextDayRecovery: calcStats(effectiveness.global.recoveryDelta),
      score: calculateEffectivenessScore(effectiveness.global)
    },
    sampleSize: interventionOccurrences.length
  };
};

/**
 * Calculate overall effectiveness score (0-1)
 */
const calculateEffectivenessScore = (metrics) => {
  let score = 0.5;  // Neutral baseline

  // Mood impact
  if (metrics.moodDelta.length >= 3) {
    const avgMoodDelta = metrics.moodDelta.reduce((a, b) => a + b, 0) / metrics.moodDelta.length;
    score += Math.min(avgMoodDelta / 30, 0.25);  // Max +0.25 from mood
  }

  // HRV impact
  if (metrics.hrvDelta.length >= 3) {
    const avgHRVDelta = metrics.hrvDelta.reduce((a, b) => a + b, 0) / metrics.hrvDelta.length;
    score += Math.min(avgHRVDelta / 20, 0.15);  // Max +0.15 from HRV
  }

  // Recovery impact
  if (metrics.recoveryDelta.length >= 3) {
    const avgRecovery = metrics.recoveryDelta.reduce((a, b) => a + b, 0) / metrics.recoveryDelta.length;
    if (avgRecovery > 60) score += 0.1;
  }

  return Math.max(0, Math.min(1, score));
};

// ============================================================
// STORAGE
// ============================================================

/**
 * Update intervention data in Firestore
 */
export const updateInterventionData = async (userId, entries, whoopHistory) => {
  if (!userId || !entries) return null;

  console.log('[InterventionTracker] Updating intervention data...');

  // Detect all interventions
  const allInterventions = {};

  for (const entry of entries) {
    const detected = detectInterventionsInEntry(entry);

    for (const intervention of detected) {
      const name = intervention.intervention;
      if (!allInterventions[name]) {
        allInterventions[name] = {
          category: intervention.category,
          occurrences: []
        };
      }
      allInterventions[name].occurrences.push(intervention);
    }
  }

  // Calculate effectiveness for each
  const interventionData = { interventions: {} };

  for (const [name, data] of Object.entries(allInterventions)) {
    const effectiveness = calculateInterventionEffectiveness(
      data.occurrences,
      entries,
      whoopHistory
    );

    interventionData.interventions[name] = {
      category: data.category,
      totalOccurrences: data.occurrences.length,
      effectiveness
    };
  }

  // Save to Firestore
  try {
    const interventionRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'interventions'
    );

    await setDoc(interventionRef, {
      ...interventionData,
      lastUpdated: Timestamp.now()
    });

    console.log(`[InterventionTracker] Tracked ${Object.keys(interventionData.interventions).length} interventions`);
  } catch (error) {
    console.error('[InterventionTracker] Failed to save:', error);
  }

  return interventionData;
};

/**
 * Get intervention data
 */
export const getInterventionData = async (userId) => {
  if (!userId) return null;

  try {
    const interventionRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'nexus', 'interventions'
    );

    const docSnap = await getDoc(interventionRef);
    if (!docSnap.exists()) return null;

    return docSnap.data();
  } catch (error) {
    console.error('[InterventionTracker] Failed to get data:', error);
    return null;
  }
};

// ============================================================
// UTILITIES
// ============================================================

const getNextDate = (dateStr) => {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  date.setDate(date.getDate() + 1);
  return date.toISOString().split('T')[0];
};

const isWithinDays = (date1, date2, days) => {
  if (!date1 || !date2) return false;
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffDays = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24));
  return diffDays <= days;
};
