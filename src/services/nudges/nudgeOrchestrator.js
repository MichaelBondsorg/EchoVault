/**
 * Nudge Orchestrator Service
 *
 * Prevents notification fatigue by prioritizing and rate-limiting
 * nudges from different features (Burnout, Anticipatory, Social).
 *
 * Key insight: During high-stress periods, users are already overwhelmed.
 * Showing multiple wellness nudges simultaneously creates more stress,
 * not less. This orchestrator ensures only the most critical nudge appears.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

// Priority levels (higher = more urgent)
export const NUDGE_PRIORITY = {
  // Crisis-level nudges - always show
  CRISIS: 100,

  // Burnout detection - high priority
  BURNOUT_CRITICAL: 90,
  BURNOUT_HIGH: 80,

  // Anticipatory anxiety - time-sensitive
  ANTICIPATORY_IMMINENT: 75,  // Event in next few hours
  ANTICIPATORY_TODAY: 60,     // Event today

  // Social connection
  SOCIAL_ISOLATION_HIGH: 70,  // High isolation risk
  SOCIAL_ISOLATION_MODERATE: 40,

  // Follow-up prompts
  EVENT_REFLECTION: 50,       // CBT loop closure
  VALUE_CHECK: 30,

  // Gentle nudges - low priority
  SOCIAL_RECONNECTION: 25,
  POSITIVE_REINFORCEMENT: 10
};

// Minimum time between nudges of the same type
export const NUDGE_COOLDOWNS = {
  BURNOUT_CRITICAL: 4 * 60 * 60 * 1000,   // 4 hours
  BURNOUT_HIGH: 8 * 60 * 60 * 1000,       // 8 hours
  ANTICIPATORY_IMMINENT: 2 * 60 * 60 * 1000, // 2 hours
  ANTICIPATORY_TODAY: 6 * 60 * 60 * 1000,  // 6 hours
  SOCIAL_ISOLATION_HIGH: 24 * 60 * 60 * 1000, // 24 hours
  SOCIAL_ISOLATION_MODERATE: 48 * 60 * 60 * 1000, // 48 hours
  EVENT_REFLECTION: 4 * 60 * 60 * 1000,   // 4 hours
  VALUE_CHECK: 24 * 60 * 60 * 1000,       // 24 hours
  SOCIAL_RECONNECTION: 72 * 60 * 60 * 1000, // 72 hours
  POSITIVE_REINFORCEMENT: 24 * 60 * 60 * 1000 // 24 hours
};

/**
 * Get the most important nudge to show
 *
 * @param {Object} allNudges - Nudges from all features
 * @param {string} userId - User ID for rate limiting
 * @returns {Object|null} The highest priority nudge that passes rate limiting
 */
export const orchestrateNudges = async (allNudges, userId) => {
  const {
    burnoutNudge,
    anticipatoryNudge,
    socialNudge,
    valueNudge,
    reflectionPrompt
  } = allNudges;

  // Build prioritized nudge list
  const candidates = [];

  if (burnoutNudge) {
    candidates.push({
      type: burnoutNudge.riskLevel === 'critical' ? 'BURNOUT_CRITICAL' : 'BURNOUT_HIGH',
      priority: burnoutNudge.riskLevel === 'critical'
        ? NUDGE_PRIORITY.BURNOUT_CRITICAL
        : NUDGE_PRIORITY.BURNOUT_HIGH,
      nudge: burnoutNudge,
      source: 'burnout'
    });
  }

  if (anticipatoryNudge) {
    const isImminent = anticipatoryNudge.hoursUntilEvent && anticipatoryNudge.hoursUntilEvent < 4;
    candidates.push({
      type: isImminent ? 'ANTICIPATORY_IMMINENT' : 'ANTICIPATORY_TODAY',
      priority: isImminent
        ? NUDGE_PRIORITY.ANTICIPATORY_IMMINENT
        : NUDGE_PRIORITY.ANTICIPATORY_TODAY,
      nudge: anticipatoryNudge,
      source: 'anticipatory'
    });
  }

  if (socialNudge) {
    const isHighRisk = socialNudge.type === 'isolation_alert' || socialNudge.priority === 'high';
    candidates.push({
      type: isHighRisk ? 'SOCIAL_ISOLATION_HIGH' : 'SOCIAL_ISOLATION_MODERATE',
      priority: isHighRisk
        ? NUDGE_PRIORITY.SOCIAL_ISOLATION_HIGH
        : NUDGE_PRIORITY.SOCIAL_ISOLATION_MODERATE,
      nudge: socialNudge,
      source: 'social'
    });
  }

  if (valueNudge) {
    candidates.push({
      type: 'VALUE_CHECK',
      priority: NUDGE_PRIORITY.VALUE_CHECK,
      nudge: valueNudge,
      source: 'values'
    });
  }

  if (reflectionPrompt) {
    candidates.push({
      type: 'EVENT_REFLECTION',
      priority: NUDGE_PRIORITY.EVENT_REFLECTION,
      nudge: reflectionPrompt,
      source: 'anticipatory'
    });
  }

  // Sort by priority (highest first)
  candidates.sort((a, b) => b.priority - a.priority);

  // Get nudge history for rate limiting
  const history = await getNudgeHistory(userId);

  // Find the highest priority nudge that passes rate limiting
  for (const candidate of candidates) {
    if (passesRateLimit(candidate, history)) {
      // Record this nudge
      await recordNudgeShown(userId, candidate);
      return {
        ...candidate.nudge,
        _orchestrator: {
          type: candidate.type,
          priority: candidate.priority,
          source: candidate.source,
          suppressed: candidates.length - 1 // How many nudges were suppressed
        }
      };
    }
  }

  return null;
};

/**
 * Check if a nudge passes rate limiting
 */
const passesRateLimit = (candidate, history) => {
  const lastShown = history[candidate.type];
  if (!lastShown) return true;

  const cooldown = NUDGE_COOLDOWNS[candidate.type] || 24 * 60 * 60 * 1000;
  const timeSince = Date.now() - new Date(lastShown).getTime();

  // High priority nudges ignore rate limiting if critical
  if (candidate.priority >= NUDGE_PRIORITY.BURNOUT_CRITICAL) {
    return true;
  }

  return timeSince >= cooldown;
};

/**
 * Get nudge history for rate limiting
 */
const getNudgeHistory = async (userId) => {
  try {
    const historyRef = doc(db, `users/${userId}/settings/nudge_history`);
    const snapshot = await getDoc(historyRef);

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.data().history || {};
  } catch (error) {
    console.error('Failed to get nudge history:', error);
    return {};
  }
};

/**
 * Record that a nudge was shown
 */
const recordNudgeShown = async (userId, candidate) => {
  try {
    const historyRef = doc(db, `users/${userId}/settings/nudge_history`);
    const snapshot = await getDoc(historyRef);
    const existing = snapshot.exists() ? snapshot.data().history || {} : {};

    await setDoc(historyRef, {
      history: {
        ...existing,
        [candidate.type]: new Date().toISOString()
      },
      lastNudge: {
        type: candidate.type,
        source: candidate.source,
        shownAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Failed to record nudge:', error);
  }
};

/**
 * Record user's response to a nudge (for improving orchestration)
 */
export const recordNudgeResponse = async (userId, nudgeType, response) => {
  try {
    const responseRef = doc(db, `users/${userId}/settings/nudge_responses`);
    const snapshot = await getDoc(responseRef);
    const existing = snapshot.exists() ? snapshot.data().responses || [] : [];

    const newResponses = [
      ...existing.slice(-50), // Keep last 50 responses
      {
        type: nudgeType,
        response, // 'dismissed', 'acted', 'postponed'
        timestamp: new Date().toISOString()
      }
    ];

    await setDoc(responseRef, {
      responses: newResponses,
      updatedAt: new Date().toISOString()
    });

    return true;
  } catch (error) {
    console.error('Failed to record nudge response:', error);
    return false;
  }
};

/**
 * Get all pending nudges without orchestration (for debugging/admin)
 */
export const getAllPendingNudges = async (allNudges) => {
  const pending = [];

  if (allNudges.burnoutNudge) {
    pending.push({
      source: 'burnout',
      nudge: allNudges.burnoutNudge
    });
  }

  if (allNudges.anticipatoryNudge) {
    pending.push({
      source: 'anticipatory',
      nudge: allNudges.anticipatoryNudge
    });
  }

  if (allNudges.socialNudge) {
    pending.push({
      source: 'social',
      nudge: allNudges.socialNudge
    });
  }

  if (allNudges.valueNudge) {
    pending.push({
      source: 'values',
      nudge: allNudges.valueNudge
    });
  }

  if (allNudges.reflectionPrompt) {
    pending.push({
      source: 'reflection',
      nudge: allNudges.reflectionPrompt
    });
  }

  return pending;
};

/**
 * Reset nudge cooldowns (for testing or user preference)
 */
export const resetNudgeCooldowns = async (userId) => {
  try {
    const historyRef = doc(db, `users/${userId}/settings/nudge_history`);
    await setDoc(historyRef, {
      history: {},
      resetAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    console.error('Failed to reset nudge cooldowns:', error);
    return false;
  }
};

export default {
  orchestrateNudges,
  recordNudgeResponse,
  getAllPendingNudges,
  resetNudgeCooldowns,
  NUDGE_PRIORITY,
  NUDGE_COOLDOWNS
};
