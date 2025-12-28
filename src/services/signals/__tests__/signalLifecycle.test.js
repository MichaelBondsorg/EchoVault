/**
 * Signal Lifecycle Service Tests
 *
 * Tests for the stateful signal model, including:
 * - State transitions
 * - Goal lifecycle
 * - Insight dismissal
 * - Pattern exclusions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SIGNAL_STATES,
  isValidTransition,
  isTerminalState
} from '../signalLifecycle';

// Mock Firebase
vi.mock('../../../config/firebase', () => ({
  db: {},
  collection: vi.fn(),
  doc: vi.fn(),
  addDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  Timestamp: {
    now: () => ({ seconds: Date.now() / 1000, nanoseconds: 0 }),
    fromDate: (date) => ({ seconds: date.getTime() / 1000, nanoseconds: 0 })
  },
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn()
  }))
}));

vi.mock('../../../config/constants', () => ({
  APP_COLLECTION_ID: 'test-app'
}));

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
  // These would be integration tests with Firebase mocked
  // For now, we test the pattern detection functions

  describe('detectsTerminationLanguage', () => {
    const { detectsTerminationLanguage } = require('../../goals/goalLifecycle');

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
    const { detectsAchievementLanguage } = require('../../goals/goalLifecycle');

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
