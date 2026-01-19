/**
 * Signals Repository
 *
 * Repository for signal state CRUD operations.
 * Centralizes all Firestore access for goals, insights, patterns, and contradictions.
 */

import { BaseRepository } from './base';
import { where, orderBy, Timestamp, writeBatch } from '../config/firebase';
import { db } from '../config/firebase';
import { APP_COLLECTION_ID } from '../config/constants';

// Signal states (duplicated from signalLifecycle for repository independence)
const SIGNAL_STATES = {
  GOAL_PROPOSED: 'proposed',
  GOAL_ACTIVE: 'active',
  GOAL_ACHIEVED: 'achieved',
  GOAL_ABANDONED: 'abandoned',
  GOAL_PAUSED: 'paused',
  INSIGHT_PENDING: 'pending',
  INSIGHT_VERIFIED: 'verified',
  INSIGHT_DISMISSED: 'dismissed',
  INSIGHT_ACTIONED: 'actioned',
  PATTERN_DETECTED: 'detected',
  PATTERN_CONFIRMED: 'confirmed',
  PATTERN_REJECTED: 'rejected',
  PATTERN_RESOLVED: 'resolved'
};

class SignalsRepository extends BaseRepository {
  constructor() {
    super('signal_states');
  }

  // ============================================
  // SIGNAL-SPECIFIC QUERIES
  // ============================================

  /**
   * Find signals by type
   * @param {string} userId
   * @param {string} type - 'goal', 'insight', 'pattern', 'contradiction'
   */
  async findByType(userId, type) {
    return this.findWhere(userId, [
      where('type', '==', type),
      orderBy('lastUpdated', 'desc')
    ]);
  }

  /**
   * Find signals by type and states
   * @param {string} userId
   * @param {string} type
   * @param {string[]} states
   */
  async findByTypeAndStates(userId, type, states) {
    return this.findWhere(userId, [
      where('type', '==', type),
      where('state', 'in', states)
    ]);
  }

  /**
   * Find active goals (non-terminal)
   * @param {string} userId
   */
  async findActiveGoals(userId) {
    return this.findByTypeAndStates(userId, 'goal', [
      SIGNAL_STATES.GOAL_PROPOSED,
      SIGNAL_STATES.GOAL_ACTIVE,
      SIGNAL_STATES.GOAL_PAUSED
    ]);
  }

  /**
   * Find pending insights
   * @param {string} userId
   */
  async findPendingInsights(userId) {
    return this.findByTypeAndStates(userId, 'insight', [SIGNAL_STATES.INSIGHT_PENDING]);
  }

  /**
   * Find unresolved patterns
   * @param {string} userId
   */
  async findUnresolvedPatterns(userId) {
    return this.findByTypeAndStates(userId, 'pattern', [
      SIGNAL_STATES.PATTERN_DETECTED,
      SIGNAL_STATES.PATTERN_CONFIRMED
    ]);
  }

  /**
   * Find signal by topic
   * @param {string} userId
   * @param {string} type
   * @param {string} topic
   */
  async findByTopic(userId, type, topic) {
    const signals = await this.findWhere(userId, [
      where('type', '==', type),
      where('topic', '==', topic)
    ]);

    if (signals.length === 0) return null;

    // Return most recent
    return signals.sort((a, b) =>
      (b.lastUpdated?.seconds || 0) - (a.lastUpdated?.seconds || 0)
    )[0];
  }

  /**
   * Find signals related to an entry
   * @param {string} userId
   * @param {string} entryId
   */
  async findBySourceEntry(userId, entryId) {
    return this.findWhere(userId, [
      where('sourceEntries', 'array-contains', entryId)
    ]);
  }

  /**
   * Find terminal signals (archived/completed)
   * @param {string} userId
   * @param {string} type
   */
  async findTerminalByType(userId, type) {
    const terminalStates = {
      goal: [SIGNAL_STATES.GOAL_ACHIEVED, SIGNAL_STATES.GOAL_ABANDONED],
      insight: [SIGNAL_STATES.INSIGHT_DISMISSED, SIGNAL_STATES.INSIGHT_ACTIONED],
      pattern: [SIGNAL_STATES.PATTERN_REJECTED, SIGNAL_STATES.PATTERN_RESOLVED],
      contradiction: [SIGNAL_STATES.PATTERN_REJECTED, SIGNAL_STATES.PATTERN_RESOLVED]
    };

    return this.findByTypeAndStates(userId, type, terminalStates[type] || []);
  }

  // ============================================
  // SIGNAL-SPECIFIC OPERATIONS
  // ============================================

  /**
   * Create a new signal state
   * @param {string} userId
   * @param {Object} signalData
   */
  async createSignal(userId, signalData) {
    const now = Timestamp.now();

    const signal = {
      type: signalData.type,
      topic: signalData.topic,
      state: signalData.initialState,
      stateHistory: [{
        from: null,
        to: signalData.initialState,
        at: now,
        context: signalData.context || {}
      }],
      sourceEntries: signalData.sourceEntries || [],
      metadata: signalData.metadata || {},
      exclusions: {
        excludeFromContradictions: false,
        excludeFromInsights: false,
        excludeFromPatterns: false
      },
      userFeedback: {
        verified: false,
        dismissed: false,
        dismissReason: null,
        actionTaken: null
      },
      createdAt: now,
      lastUpdated: now
    };

    return this.create(userId, signal);
  }

  /**
   * Transition a signal to a new state
   * @param {string} userId
   * @param {string} signalId
   * @param {string} newState
   * @param {Object} context
   */
  async transitionState(userId, signalId, newState, context = {}) {
    return this.updateTransaction(userId, signalId, (currentSignal) => {
      const now = Timestamp.now();

      // Build new history entry
      const newHistoryEntry = {
        from: currentSignal.state,
        to: newState,
        at: now,
        context
      };

      // Limit history to 20 entries
      let newHistory = [...(currentSignal.stateHistory || []), newHistoryEntry];
      if (newHistory.length > 20) {
        const firstEntry = newHistory[0];
        const recentEntries = newHistory.slice(-19);
        newHistory = [firstEntry, ...recentEntries];
      }

      const updates = {
        state: newState,
        stateHistory: newHistory
      };

      // Update feedback flags based on state
      if (newState === SIGNAL_STATES.INSIGHT_DISMISSED || newState === SIGNAL_STATES.PATTERN_REJECTED) {
        updates['userFeedback.dismissed'] = true;
        updates['userFeedback.dismissReason'] = context.reason || null;
      }

      if (newState === SIGNAL_STATES.INSIGHT_VERIFIED || newState === SIGNAL_STATES.PATTERN_CONFIRMED) {
        updates['userFeedback.verified'] = true;
      }

      if (newState === SIGNAL_STATES.INSIGHT_ACTIONED) {
        updates['userFeedback.actionTaken'] = context.action || 'completed';
      }

      return updates;
    });
  }

  /**
   * Close contradictions related to a goal
   * @param {string} userId
   * @param {string} goalTopic
   */
  async closeRelatedContradictions(userId, goalTopic) {
    const contradictions = await this.findWhere(userId, [
      where('type', '==', 'contradiction'),
      where('topic', '==', goalTopic),
      where('state', 'in', [SIGNAL_STATES.PATTERN_DETECTED, SIGNAL_STATES.PATTERN_CONFIRMED])
    ]);

    if (contradictions.length === 0) return;

    const batch = writeBatch(db);
    const now = Timestamp.now();

    for (const contradiction of contradictions) {
      const docRef = this.getDocRef(userId, contradiction.id);
      batch.update(docRef, {
        state: SIGNAL_STATES.PATTERN_RESOLVED,
        stateHistory: [
          ...contradiction.stateHistory,
          {
            from: contradiction.state,
            to: SIGNAL_STATES.PATTERN_RESOLVED,
            at: now,
            context: { resolvedBy: 'goal_termination' }
          }
        ],
        lastUpdated: now
      });
    }

    await batch.commit();
    console.log(`[signals] Closed ${contradictions.length} contradictions for goal: ${goalTopic}`);
  }

  /**
   * Add source entry to a signal
   * @param {string} userId
   * @param {string} signalId
   * @param {string} entryId
   */
  async addSourceEntry(userId, signalId, entryId) {
    const signal = await this.findById(userId, signalId);
    if (!signal) return;

    const sourceEntries = signal.sourceEntries || [];
    if (!sourceEntries.includes(entryId)) {
      await this.update(userId, signalId, {
        sourceEntries: [...sourceEntries, entryId]
      });
    }
  }
}

// Exclusions Repository (separate collection)
class ExclusionsRepository extends BaseRepository {
  constructor() {
    super('insight_exclusions');
  }

  /**
   * Add an exclusion
   * @param {string} userId
   * @param {Object} exclusionData
   */
  async addExclusion(userId, exclusionData) {
    const now = Timestamp.now();

    return this.create(userId, {
      patternType: exclusionData.patternType,
      context: exclusionData.context || {},
      reason: exclusionData.reason || 'user_dismissed',
      permanent: exclusionData.permanent || false,
      excludedAt: now,
      expiresAt: exclusionData.permanent
        ? null
        : new Timestamp(now.seconds + 30 * 24 * 60 * 60, 0) // 30 days
    });
  }

  /**
   * Check if a pattern is excluded
   * @param {string} userId
   * @param {string} patternType
   * @param {Object} context
   */
  async isExcluded(userId, patternType, context = {}) {
    const now = Timestamp.now();
    const exclusions = await this.findByField(userId, 'patternType', '==', patternType);

    for (const exclusion of exclusions) {
      // Check if permanent or not expired
      if (exclusion.permanent || (exclusion.expiresAt && exclusion.expiresAt > now)) {
        // Blanket exclusion if no context
        if (Object.keys(exclusion.context || {}).length === 0) {
          return true;
        }

        // Check context match
        const contextMatches = Object.entries(exclusion.context).every(
          ([key, value]) => context[key] === value
        );

        if (contextMatches) return true;
      }
    }

    return false;
  }

  /**
   * Get active exclusions
   * @param {string} userId
   */
  async findActive(userId) {
    const now = Timestamp.now();
    const exclusions = await this.findAll(userId);

    return exclusions.filter(e =>
      e.permanent || (e.expiresAt && e.expiresAt > now)
    );
  }
}

// Export singleton instances
export const signalsRepository = new SignalsRepository();
export const exclusionsRepository = new ExclusionsRepository();

// Also export classes for testing
export { SignalsRepository, ExclusionsRepository };
