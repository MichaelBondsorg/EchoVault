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
// MOOD01 CONVENTION (R4 T3)
// ============================================================
// Runtime `mood`/`analysis.mood_score` is stored 0-1 (see
// docs/superpowers/plans/2026-07-22-r4-insight-integrity.md). All
// `moodDelta` values computed/stored by this file stay on that native 0-1
// scale — consumers that render them as "N points" (recommendationEngine)
// are responsible for the 0-1 -> 0-100 display conversion.
//
// This module's OUTCOME claims (an activity "worked" because a same-day
// mood reading followed a text mention of it) are suppressed at the
// orchestrator seam (RISKY_CLAIMS_ENABLED, ratified decision 4) — a text
// mention is not verified completion, and same-entry mood is an
// association, not a measured causal outcome. That's a structural
// limitation Phase 1's typed extraction work addresses (DR finding 13,
// shared with open-loops quality); this file just keeps the arithmetic
// correct underneath the gate.

// ============================================================
// INTERVENTION DEFINITIONS
// ============================================================

// R4 T3 (DR finding 5, privacy sweep): generic category patterns only — no
// proper nouns (pet names, partner names, gym brands, app self-reference).
export const INTERVENTION_PATTERNS = {
  // Physical
  yoga: {
    category: 'physical',
    patterns: [/yoga/i, /flow/i, /vinyasa/i, /c3/i, /pilates/i],
    measureWindow: { same_day: true, next_day: true }
  },
  fitness_class: {
    category: 'physical',
    patterns: [/hiit/i, /boutique fitness/i, /fitness class/i, /spin class/i],
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
  pet_walk: {
    category: 'relational',
    patterns: [/walked.*dog/i, /dog.*walk/i, /walked.*pet/i, /pet.*walk/i],
    measureWindow: { same_day: true, next_day: true }
  },
  partner_time: {
    category: 'relational',
    patterns: [/\bpartner\b/i, /boyfriend/i, /girlfriend/i, /\bspouse\b/i],
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
    patterns: [/paint/i, /built/i, /created/i, /app/i],
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

  // Whoop shape fix (R4 T3): `whoopHistory` is `{available, days: [...]}` —
  // an ARRAY of per-day summaries keyed by `requestedLocalDate` (see
  // `src/services/health/whoop.js`'s `getWhoopHistory`/`whoopTransforms.js`)
  // — not a plain object indexable by date string. The old
  // `whoopHistory[date]` lookup always returned `undefined`, so no
  // intervention ever accrued HRV/recovery evidence at all.
  const whoopByDate = new Map(
    (whoopHistory?.days || [])
      .filter(d => d?.requestedLocalDate)
      .map(d => [d.requestedLocalDate, d])
  );

  for (const occurrence of interventionOccurrences) {
    const date = occurrence.entryDate;
    if (!date) continue;

    const nextDate = getNextDate(date);

    // Find same-day mood. `!= null` (not truthy) so a genuine mood of 0
    // (Mood01: the lowest valid value) isn't silently dropped.
    const sameDayMood = occurrence.entryMood;

    // Find baseline mood: the 7 days STRICTLY BEFORE this occurrence.
    // Previously `isWithinDays` compared absolute distance in either
    // direction, so entries AFTER the intervention day could leak into its
    // own "baseline" (look-ahead bias — a future day's mood can't be a
    // baseline for a day that hasn't happened yet from that day's
    // perspective).
    const baselineMoods = allEntries
      .filter(e => {
        const eDate = e.date || e.createdAt?.toDate?.()?.toISOString?.().split('T')[0];
        return isPriorWithinDays(eDate, date, 7);
      })
      .map(e => e.mood ?? e.analysis?.mood_score)
      .filter(m => m != null);

    const baselineMood = baselineMoods.length > 0
      ? baselineMoods.reduce((a, b) => a + b, 0) / baselineMoods.length
      : 0.5; // Mood01 neutral default (was `50`, a 0-100-scale value)

    if (sameDayMood != null) {
      const moodDelta = sameDayMood - baselineMood;
      effectiveness.global.moodDelta.push(moodDelta);
    }

    // Whoop metrics
    if (whoopByDate.size > 0) {
      const todayWhoop = whoopByDate.get(date);
      const nextDayWhoop = whoopByDate.get(nextDate);

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

  // Mood impact. Mood01: `moodDelta` is a native 0-1-scale delta, so a
  // "30-point" swing is 0.30, not 30 (was dividing by 30 against a value
  // that maxes out around 1, so mood essentially never contributed).
  if (metrics.moodDelta.length >= 3) {
    const avgMoodDelta = metrics.moodDelta.reduce((a, b) => a + b, 0) / metrics.moodDelta.length;
    score += Math.min(avgMoodDelta / 0.30, 0.25);  // Max +0.25 from mood
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

/**
 * Was `isWithinDays`: took `Math.abs` of the distance, so it accepted
 * dates on EITHER side of the reference date — future entries could leak
 * into a "baseline" for a day that hadn't happened yet from that day's
 * perspective (R4 T3). Now requires `candidateDate` to be strictly BEFORE
 * `referenceDate`, within `days`.
 */
const isPriorWithinDays = (candidateDate, referenceDate, days) => {
  if (!candidateDate || !referenceDate) return false;
  const c = new Date(candidateDate);
  const r = new Date(referenceDate);
  const diffDays = (r - c) / (1000 * 60 * 60 * 24);
  return diffDays > 0 && diffDays <= days;
};
