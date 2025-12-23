import { useState, useEffect, useMemo } from 'react';
import { getTimePhase, getPrimaryIntent, getTimeGreeting } from '../services/temporal/time';

/**
 * Mood State Thresholds
 * - shelter: Low mood, need gentle support (< 0.35)
 * - cheerleader: High mood, celebrate wins (> 0.75)
 * - neutral: Normal mode (0.35 - 0.75)
 */
const MOOD_THRESHOLDS = {
  shelter: 0.35,
  cheerleader: 0.75
};

/**
 * Calculate average mood from entries
 * @param {Array} entries - Today's entries with analysis.mood_score
 * @returns {number|null} Average mood score or null if no valid scores
 */
const calculateAverageMood = (entries) => {
  const validScores = entries
    .map(e => e.analysis?.mood_score)
    .filter(score => typeof score === 'number' && !isNaN(score));

  if (validScores.length === 0) return null;

  return validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
};

/**
 * Get the effective mood score using dynamic weighting
 * - If daySummary has pre-computed dayScore, use it (includes signals)
 * - Otherwise fall back to entry-based calculation
 *
 * @param {Object|null} daySummary - Pre-computed day summary from Cloud Function
 * @param {Array} entries - Today's entries (fallback)
 * @returns {number|null} Effective mood score
 */
const getEffectiveMood = (daySummary, entries) => {
  // If we have a pre-computed dayScore from signals, use it
  if (daySummary && typeof daySummary.dayScore === 'number') {
    return daySummary.dayScore;
  }

  // Fallback to entry-based calculation
  return calculateAverageMood(entries);
};

/**
 * Get the most recent entry's mood score
 * @param {Array} entries - Today's entries sorted by date (newest first expected)
 * @returns {number|null}
 */
const getLastEntryMood = (entries) => {
  if (entries.length === 0) return null;

  // Sort by createdAt descending to get most recent
  const sorted = [...entries].sort((a, b) => {
    const aDate = a.createdAt instanceof Date ? a.createdAt : a.createdAt?.toDate?.() || new Date(0);
    const bDate = b.createdAt instanceof Date ? b.createdAt : b.createdAt?.toDate?.() || new Date(0);
    return bDate - aDate;
  });

  return sorted[0]?.analysis?.mood_score ?? null;
};

/**
 * Determine mood state based on today's entries and signals
 * Uses the "Thermostat" logic from spec:
 * - If effective_mood < 0.35 OR last_entry.mood < 0.3 -> shelter
 * - If effective_mood > 0.75 -> cheerleader
 * - Else -> neutral
 *
 * @param {Array} todayEntries - Today's entries
 * @param {Object|null} daySummary - Pre-computed day summary (includes signals)
 */
const determineMoodState = (todayEntries, daySummary = null) => {
  // If no entries AND no signals, neutral
  const hasSignals = daySummary && daySummary.signalCount > 0;
  if (todayEntries.length === 0 && !hasSignals) return 'neutral';

  // Get effective mood (uses signals if available, otherwise entries)
  const effectiveMood = getEffectiveMood(daySummary, todayEntries);
  const lastMood = getLastEntryMood(todayEntries);

  // Shelter mode: low average OR very low last entry
  if ((effectiveMood !== null && effectiveMood < MOOD_THRESHOLDS.shelter) ||
      (lastMood !== null && lastMood < 0.3)) {
    return 'shelter';
  }

  // Cheerleader mode: high average
  if (effectiveMood !== null && effectiveMood > MOOD_THRESHOLDS.cheerleader) {
    return 'cheerleader';
  }

  return 'neutral';
};

/**
 * Generate hero content based on mode and summary
 */
const generateHeroContent = (timePhase, moodState, summary, userName, carryForwardItems = []) => {
  const greeting = getTimeGreeting(userName);

  // Shelter mode overrides time phase
  if (moodState === 'shelter') {
    return {
      type: 'shelter',
      title: "It's okay to have a hard day.",
      subtitle: "Sometimes we just need to be gentle with ourselves.",
      cbtReframe: summary?.challenges?.cbt_reframe || null,
      action: {
        label: 'Vent',
        type: 'voice_record'
      }
    };
  }

  switch (timePhase) {
    case 'morning':
      return {
        type: 'morning',
        title: greeting,
        subtitle: "One small win to chase today?",
        carriedForward: carryForwardItems,
        intentionPrompt: "What's your intention for today?"
      };

    case 'evening':
      return {
        type: 'evening',
        title: summary?.one_liner || greeting,
        subtitle: summary?.one_liner ? null : "Time to reflect on your day",
        wins: summary?.wins?.items || [],
        isQuote: !!summary?.one_liner
      };

    case 'midday':
    default:
      // Get next 2 tasks for momentum
      const nextTasks = [
        ...(summary?.action_items?.carried_forward || []),
        ...(summary?.action_items?.today || [])
      ].slice(0, 2);

      return {
        type: 'midday',
        title: greeting,
        subtitle: "How's your momentum?",
        nextTasks,
        energyPrompt: "How is your energy right now?"
      };
  }
};

/**
 * useDashboardMode Hook
 *
 * Determines the dashboard mode based on:
 * 1. Time of Day (morning/midday/evening)
 * 2. User's Mood (neutral/shelter/cheerleader)
 * 3. Signal-based scoring (when available)
 *
 * @param {Object} options
 * @param {Array} options.entries - All user entries
 * @param {Array} options.todayEntries - Today's filtered entries
 * @param {Object} options.summary - Current day summary (from synthesis)
 * @param {Object} options.todaySummary - Today's day_summary from signals (from Cloud Function)
 * @param {Object} options.user - Current user object
 * @param {Array} options.carryForwardItems - Tasks carried from yesterday
 * @param {boolean} options.shelterOverride - Force exit shelter mode
 *
 * @returns {Object} Dashboard mode state
 */
export const useDashboardMode = ({
  entries = [],
  todayEntries = [],
  summary = null,
  todaySummary = null,  // Signal-based day summary from Cloud Function
  user = null,
  carryForwardItems = [],
  shelterOverride = false
}) => {
  const [timePhase, setTimePhase] = useState(() => getTimePhase());

  // Update time phase every minute
  useEffect(() => {
    const updatePhase = () => {
      setTimePhase(getTimePhase());
    };

    // Check every minute
    const interval = setInterval(updatePhase, 60000);

    return () => clearInterval(interval);
  }, []);

  // Calculate mood state from today's entries
  const moodState = useMemo(() => {
    if (shelterOverride) return 'neutral'; // User chose to exit shelter
    return determineMoodState(todayEntries);
  }, [todayEntries, shelterOverride]);

  // Get primary intent based on time (unless in shelter mode)
  const primaryIntent = useMemo(() => {
    if (moodState === 'shelter') return 'support';
    return getPrimaryIntent(timePhase);
  }, [timePhase, moodState]);

  // Generate hero content
  const heroContent = useMemo(() => {
    const userName = user?.displayName?.split(' ')[0] || null;
    return generateHeroContent(timePhase, moodState, summary, userName, carryForwardItems);
  }, [timePhase, moodState, summary, user, carryForwardItems]);

  // Calculate average mood for display
  const averageMood = useMemo(() => {
    return calculateAverageMood(todayEntries);
  }, [todayEntries]);

  return {
    // Core mode indicators
    timePhase,        // 'morning' | 'midday' | 'evening'
    moodState,        // 'neutral' | 'shelter' | 'cheerleader'
    primaryIntent,    // 'plan' | 'reflect' | 'integrate' | 'support'

    // Derived content
    heroContent,      // Object with title, subtitle, and mode-specific data

    // Utilities
    averageMood,      // Number or null
    isLowMood: moodState === 'shelter',
    isHighMood: moodState === 'cheerleader',

    // For debugging/display
    thresholds: MOOD_THRESHOLDS
  };
};

export default useDashboardMode;
