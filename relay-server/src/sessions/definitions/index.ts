import { morningCheckin } from './morning-checkin.js';
import { eveningReflection } from './evening-reflection.js';
import { gratitudePractice } from './gratitude-practice.js';
import { goalSetting } from './goal-setting.js';
import { emotionalProcessing } from './emotional-processing.js';
import { stressRelease } from './stress-release.js';
import { weeklyReview } from './weekly-review.js';
import { insightExploration } from './insight-exploration.js';
import type { GuidedSessionDefinition, GuidedSessionType } from '../schema.js';

/**
 * All available guided session definitions
 */
export const sessionDefinitions: Record<GuidedSessionType, GuidedSessionDefinition | undefined> = {
  morning_checkin: morningCheckin,
  evening_reflection: eveningReflection,
  gratitude_practice: gratitudePractice,
  goal_setting: goalSetting,
  emotional_processing: emotionalProcessing,
  stress_release: stressRelease,
  weekly_review: weeklyReview,
  celebration: undefined, // TODO: Future
  situation_processing: undefined, // TODO: Future
  insight_exploration: insightExploration,
  custom: undefined,
};

/**
 * Get a session definition by ID
 */
export const getSessionDefinition = (id: GuidedSessionType): GuidedSessionDefinition | undefined => {
  return sessionDefinitions[id];
};

/**
 * Get all available session definitions
 */
export const getAvailableSessions = (): GuidedSessionDefinition[] => {
  return Object.values(sessionDefinitions).filter(
    (def): def is GuidedSessionDefinition => def !== undefined
  );
};

/**
 * Get sessions suggested for current time
 */
export const getSuggestedSessions = (
  currentTimeOfDay: 'morning' | 'afternoon' | 'evening' | 'night',
  currentMood?: number
): GuidedSessionDefinition[] => {
  return getAvailableSessions().filter((def) => {
    // Check time of day
    if (def.suggestWhen?.timeOfDay) {
      if (!def.suggestWhen.timeOfDay.includes(currentTimeOfDay)) {
        return false;
      }
    }

    // Check mood thresholds
    if (currentMood !== undefined) {
      if (def.suggestWhen?.moodBelow !== undefined && currentMood >= def.suggestWhen.moodBelow) {
        return false;
      }
      if (def.suggestWhen?.moodAbove !== undefined && currentMood <= def.suggestWhen.moodAbove) {
        return false;
      }
    }

    return true;
  });
};

export {
  morningCheckin,
  eveningReflection,
  gratitudePractice,
  goalSetting,
  emotionalProcessing,
  stressRelease,
  weeklyReview,
  insightExploration,
};
