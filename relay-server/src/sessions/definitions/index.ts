import { morningCheckin } from './morning-checkin.js';
import { eveningReflection } from './evening-reflection.js';
import { gratitudePractice } from './gratitude-practice.js';
import type { GuidedSessionDefinition, GuidedSessionType } from '../schema.js';

/**
 * All available guided session definitions
 */
export const sessionDefinitions: Record<GuidedSessionType, GuidedSessionDefinition | undefined> = {
  morning_checkin: morningCheckin,
  evening_reflection: eveningReflection,
  gratitude_practice: gratitudePractice,
  goal_setting: undefined, // TODO: Phase 3
  emotional_processing: undefined, // TODO: Phase 3
  stress_release: undefined, // TODO: Phase 3
  weekly_review: undefined, // TODO: Phase 3
  celebration: undefined, // TODO: Phase 3
  situation_processing: undefined, // TODO: Phase 3
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

export { morningCheckin, eveningReflection, gratitudePractice };
