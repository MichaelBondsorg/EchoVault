import { useState, useEffect, useMemo } from 'react';
import { getTimePhase, getPrimaryIntent, getTimeGreeting } from '../services/temporal/time';
import { checkLongitudinalRisk } from '../services/safety';

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
 * Determine mood state based on today's entries, signals, and longitudinal trends
 * Uses the "Thermostat" logic from spec with proactive burnout detection:
 *
 * SHELTER MODE triggers when ANY of these are true:
 * - Today's effective mood < 0.35
 * - Last entry mood < 0.30
 * - 14-day longitudinal risk is detected (sustained or acute decline)
 *
 * CHEERLEADER MODE: effective_mood > 0.75
 *
 * @param {Array} todayEntries - Today's entries
 * @param {Object|null} daySummary - Pre-computed day summary (includes signals)
 * @param {Object|null} longitudinalRisk - Result from checkLongitudinalRisk
 */
const determineMoodState = (todayEntries, daySummary = null, longitudinalRisk = null) => {
  // Check longitudinal risk FIRST - this is the proactive burnout detection
  // Even if today seems fine, a 14-day downward trend should trigger shelter
  if (longitudinalRisk?.isAtRisk) {
    console.log('Shelter mode triggered by longitudinal risk:', longitudinalRisk.reason);
    return 'shelter';
  }

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

  // Cheerleader mode: high average (only if no longitudinal concerns)
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
 * 4. Longitudinal Risk (14-day trend analysis) - PROACTIVE BURNOUT DETECTION
 *
 * The longitudinal risk check enables proactive shelter mode:
 * - Even if today's mood is neutral, a 14-day downward trend triggers shelter
 * - Distinguishes between sustained decline (gradual) and acute decline (rapid)
 *
 * @param {Object} options
 * @param {Array} options.entries - All user entries (used for longitudinal analysis)
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

  // Calculate longitudinal risk from all entries (14-day window)
  // This enables PROACTIVE shelter mode for burnout detection
  const longitudinalRisk = useMemo(() => {
    if (entries.length < 5) return null; // Not enough data
    return checkLongitudinalRisk(entries);
  }, [entries]);

  // Calculate mood state considering both today's data AND longitudinal trends
  const moodState = useMemo(() => {
    if (shelterOverride) return 'neutral'; // User chose to exit shelter
    return determineMoodState(todayEntries, todaySummary, longitudinalRisk);
  }, [todayEntries, todaySummary, longitudinalRisk, shelterOverride]);

  // Determine why shelter mode was triggered (for contextual messaging)
  const shelterTrigger = useMemo(() => {
    if (moodState !== 'shelter') return null;

    // Check longitudinal risk first (proactive detection)
    if (longitudinalRisk?.isAtRisk) {
      return {
        type: 'longitudinal',
        reason: longitudinalRisk.reason,
        metrics: longitudinalRisk.metrics,
        message: getLongitudinalMessage(longitudinalRisk.reason)
      };
    }

    // Today-based triggers
    const effectiveMood = getEffectiveMood(todaySummary, todayEntries);
    const lastMood = getLastEntryMood(todayEntries);

    if (lastMood !== null && lastMood < 0.3) {
      return {
        type: 'acute',
        reason: 'low_last_entry',
        message: "Your last entry suggested you might be having a tough moment."
      };
    }

    if (effectiveMood !== null && effectiveMood < MOOD_THRESHOLDS.shelter) {
      return {
        type: 'today',
        reason: 'low_daily_mood',
        message: "Today seems to be a challenging day."
      };
    }

    return { type: 'unknown', reason: 'unspecified', message: null };
  }, [moodState, longitudinalRisk, todayEntries, todaySummary]);

  // Get primary intent based on time (unless in shelter mode)
  const primaryIntent = useMemo(() => {
    if (moodState === 'shelter') return 'support';
    return getPrimaryIntent(timePhase);
  }, [timePhase, moodState]);

  // Generate hero content with longitudinal context when applicable
  const heroContent = useMemo(() => {
    const userName = user?.displayName?.split(' ')[0] || null;
    const content = generateHeroContent(timePhase, moodState, summary, userName, carryForwardItems);

    // Add longitudinal context if shelter was triggered proactively
    if (moodState === 'shelter' && shelterTrigger?.type === 'longitudinal') {
      content.proactiveWarning = shelterTrigger.message;
      content.isProactive = true;
    }

    return content;
  }, [timePhase, moodState, summary, user, carryForwardItems, shelterTrigger]);

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

    // Longitudinal analysis
    longitudinalRisk, // Full risk assessment object (or null)
    shelterTrigger,   // Why shelter was triggered (for UI context)

    // Utilities
    averageMood,      // Number or null
    isLowMood: moodState === 'shelter',
    isHighMood: moodState === 'cheerleader',
    isProactiveShelter: shelterTrigger?.type === 'longitudinal',

    // For debugging/display
    thresholds: MOOD_THRESHOLDS
  };
};

/**
 * Get user-friendly message for longitudinal risk reason
 */
const getLongitudinalMessage = (reason) => {
  switch (reason) {
    case 'acute_decline_with_low_mood':
      return "Your mood has dropped significantly this week and is running low overall. Let's take a breather.";
    case 'acute_decline':
      return "I've noticed a quick dip in your mood this week. Want to check in with yourself?";
    case 'sustained_decline_with_low_mood':
      return "You've been running on empty for a while. It might be time for some self-care.";
    case 'sustained_decline':
      return "I'm noticing a gradual downward trend over the past couple weeks. How are you really doing?";
    case 'low_average_mood':
      return "Your mood has been consistently low lately. You deserve some support.";
    default:
      return "I've noticed some patterns that suggest you might benefit from a gentle pause.";
  }
};

export default useDashboardMode;
