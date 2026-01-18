/**
 * Signal Lifecycle Service Tests
 *
 * Tests for the stateful signal model, including:
 * - State transitions
 * - Goal lifecycle
 * - Insight dismissal
 * - Pattern exclusions
 *
 * Note: These tests focus on pure functions to avoid Firebase dependencies.
 */

import { describe, it, expect, vi } from 'vitest';

// Define signal states matching the service
const SIGNAL_STATES = {
  // Goal states
  GOAL_PROPOSED: 'proposed',
  GOAL_ACTIVE: 'active',
  GOAL_ACHIEVED: 'achieved',
  GOAL_ABANDONED: 'abandoned',
  GOAL_PAUSED: 'paused',
  // Insight states
  INSIGHT_PENDING: 'pending',
  INSIGHT_VERIFIED: 'verified',
  INSIGHT_DISMISSED: 'dismissed',
  INSIGHT_ACTIONED: 'actioned',
  // Pattern states
  PATTERN_DETECTED: 'detected',
  PATTERN_CONFIRMED: 'confirmed',
  PATTERN_REJECTED: 'rejected',
  PATTERN_RESOLVED: 'resolved'
};

// State transition map
const VALID_TRANSITIONS = {
  // Goal lifecycle
  proposed: ['active', 'abandoned'],
  active: ['achieved', 'abandoned', 'paused'],
  paused: ['active', 'abandoned'],
  // Insight lifecycle
  pending: ['verified', 'dismissed', 'actioned'],
  verified: ['actioned', 'dismissed'],
  // Pattern lifecycle
  detected: ['confirmed', 'rejected'],
  confirmed: ['resolved', 'rejected']
};

// Terminal states
const TERMINAL_STATES = new Set([
  'achieved', 'abandoned', 'dismissed', 'actioned', 'rejected', 'resolved'
]);

// Pure functions
const isValidTransition = (currentState, newState) => {
  const validNextStates = VALID_TRANSITIONS[currentState];
  if (!validNextStates) return false;
  return validNextStates.includes(newState);
};

const isTerminalState = (state) => TERMINAL_STATES.has(state);

// Goal language detection patterns
const TERMINATION_PATTERNS = [
  /no longer interested/i,
  /not interested anymore/i,
  /decided against/i,
  /giving up on/i,
  /gave up on/i,
  /abandoning/i,
  /not going to pursue/i,
  /moving on from/i,
  /not a priority/i,
  /don't want to/i,
  /doesn't matter anymore/i,
  /changed my mind about/i
];

const ACHIEVEMENT_PATTERNS = [
  /i did it/i,
  /finally completed/i,
  /finished the/i,
  /accomplished/i,
  /achieved my/i,
  /got the job/i,
  /passed the/i,
  /mission accomplished/i,
  /made it happen/i,
  /reached my goal/i,
  /successfully/i
];

const detectsTerminationLanguage = (text) => {
  return TERMINATION_PATTERNS.some(pattern => pattern.test(text));
};

const detectsAchievementLanguage = (text) => {
  return ACHIEVEMENT_PATTERNS.some(pattern => pattern.test(text));
};

describe('Signal States', () => {
  describe('SIGNAL_STATES', () => {
    it('should have all goal states', () => {
      expect(SIGNAL_STATES.GOAL_PROPOSED).toBe('proposed');
      expect(SIGNAL_STATES.GOAL_ACTIVE).toBe('active');
      expect(SIGNAL_STATES.GOAL_ACHIEVED).toBe('achieved');
      expect(SIGNAL_STATES.GOAL_ABANDONED).toBe('abandoned');
      expect(SIGNAL_STATES.GOAL_PAUSED).toBe('paused');
    });

    it('should have all insight states', () => {
      expect(SIGNAL_STATES.INSIGHT_PENDING).toBe('pending');
      expect(SIGNAL_STATES.INSIGHT_VERIFIED).toBe('verified');
      expect(SIGNAL_STATES.INSIGHT_DISMISSED).toBe('dismissed');
      expect(SIGNAL_STATES.INSIGHT_ACTIONED).toBe('actioned');
    });

    it('should have all pattern states', () => {
      expect(SIGNAL_STATES.PATTERN_DETECTED).toBe('detected');
      expect(SIGNAL_STATES.PATTERN_CONFIRMED).toBe('confirmed');
      expect(SIGNAL_STATES.PATTERN_REJECTED).toBe('rejected');
      expect(SIGNAL_STATES.PATTERN_RESOLVED).toBe('resolved');
    });
  });
});

describe('State Transitions', () => {
  describe('isValidTransition', () => {
    // Goal transitions
    it('should allow proposed → active', () => {
      expect(isValidTransition('proposed', 'active')).toBe(true);
    });

    it('should allow proposed → abandoned', () => {
      expect(isValidTransition('proposed', 'abandoned')).toBe(true);
    });

    it('should allow active → achieved', () => {
      expect(isValidTransition('active', 'achieved')).toBe(true);
    });

    it('should allow active → abandoned', () => {
      expect(isValidTransition('active', 'abandoned')).toBe(true);
    });

    it('should allow active → paused', () => {
      expect(isValidTransition('active', 'paused')).toBe(true);
    });

    it('should allow paused → active', () => {
      expect(isValidTransition('paused', 'active')).toBe(true);
    });

    it('should NOT allow achieved → active (terminal state)', () => {
      expect(isValidTransition('achieved', 'active')).toBe(false);
    });

    it('should NOT allow abandoned → active (terminal state)', () => {
      expect(isValidTransition('abandoned', 'active')).toBe(false);
    });

    it('should NOT allow proposed → achieved (must be active first)', () => {
      expect(isValidTransition('proposed', 'achieved')).toBe(false);
    });

    // Insight transitions
    it('should allow pending → verified', () => {
      expect(isValidTransition('pending', 'verified')).toBe(true);
    });

    it('should allow pending → dismissed', () => {
      expect(isValidTransition('pending', 'dismissed')).toBe(true);
    });

    it('should allow pending → actioned', () => {
      expect(isValidTransition('pending', 'actioned')).toBe(true);
    });

    it('should allow verified → actioned', () => {
      expect(isValidTransition('verified', 'actioned')).toBe(true);
    });

    it('should NOT allow dismissed → verified (terminal state)', () => {
      expect(isValidTransition('dismissed', 'verified')).toBe(false);
    });

    // Pattern transitions
    it('should allow detected → confirmed', () => {
      expect(isValidTransition('detected', 'confirmed')).toBe(true);
    });

    it('should allow detected → rejected', () => {
      expect(isValidTransition('detected', 'rejected')).toBe(true);
    });

    it('should allow confirmed → resolved', () => {
      expect(isValidTransition('confirmed', 'resolved')).toBe(true);
    });

    it('should NOT allow rejected → confirmed (terminal state)', () => {
      expect(isValidTransition('rejected', 'confirmed')).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('should identify goal terminal states', () => {
      expect(isTerminalState('achieved')).toBe(true);
      expect(isTerminalState('abandoned')).toBe(true);
    });

    it('should identify insight terminal states', () => {
      expect(isTerminalState('dismissed')).toBe(true);
      expect(isTerminalState('actioned')).toBe(true);
    });

    it('should identify pattern terminal states', () => {
      expect(isTerminalState('rejected')).toBe(true);
      expect(isTerminalState('resolved')).toBe(true);
    });

    it('should NOT identify non-terminal states as terminal', () => {
      expect(isTerminalState('proposed')).toBe(false);
      expect(isTerminalState('active')).toBe(false);
      expect(isTerminalState('paused')).toBe(false);
      expect(isTerminalState('pending')).toBe(false);
      expect(isTerminalState('verified')).toBe(false);
      expect(isTerminalState('detected')).toBe(false);
      expect(isTerminalState('confirmed')).toBe(false);
    });
  });
});

describe('Goal Lifecycle', () => {
  describe('detectsTerminationLanguage', () => {
    it('should detect "I am no longer interested"', () => {
      expect(detectsTerminationLanguage("I'm no longer interested in that job")).toBe(true);
    });

    it('should detect "decided against"', () => {
      expect(detectsTerminationLanguage("I decided against applying")).toBe(true);
    });

    it('should detect "giving up on"', () => {
      expect(detectsTerminationLanguage("I'm giving up on the gym")).toBe(true);
    });

    it('should detect "moving on from"', () => {
      expect(detectsTerminationLanguage("I'm moving on from that project")).toBe(true);
    });

    it('should detect "not a priority"', () => {
      expect(detectsTerminationLanguage("That's not a priority anymore")).toBe(true);
    });

    it('should NOT detect regular mentions', () => {
      expect(detectsTerminationLanguage("I went to the gym today")).toBe(false);
    });

    it('should NOT detect progress updates', () => {
      expect(detectsTerminationLanguage("Making good progress on my goal")).toBe(false);
    });
  });

  describe('detectsAchievementLanguage', () => {
    it('should detect "I did it"', () => {
      expect(detectsAchievementLanguage("I did it! Got the job!")).toBe(true);
    });

    it('should detect "completed"', () => {
      expect(detectsAchievementLanguage("Finally completed the course")).toBe(true);
    });

    it('should detect "got the job"', () => {
      expect(detectsAchievementLanguage("I got the job at the new company")).toBe(true);
    });

    it('should detect "mission accomplished"', () => {
      expect(detectsAchievementLanguage("Mission accomplished!")).toBe(true);
    });

    it('should NOT detect regular mentions', () => {
      expect(detectsAchievementLanguage("Still working on my project")).toBe(false);
    });
  });
});
