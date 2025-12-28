/**
 * Signal Lifecycle Service
 *
 * Transforms signals from stateless observations to lifecycle-aware entities.
 * Enables goals, insights, and patterns to be dismissed, verified, or resolved.
 *
 * Lifecycle States:
 * - Goals: proposed → active → achieved/abandoned/paused
 * - Insights: pending → verified/dismissed/actioned
 * - Patterns: detected → confirmed/rejected/resolved
 */

import {
  db,
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  writeBatch,
  runTransaction
} from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';

// ============================================
// SIGNAL STATES
// ============================================

export const SIGNAL_STATES = {
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

// Valid state transitions
const VALID_TRANSITIONS = {
  // Goals
  [SIGNAL_STATES.GOAL_PROPOSED]: [SIGNAL_STATES.GOAL_ACTIVE, SIGNAL_STATES.GOAL_ABANDONED],
  [SIGNAL_STATES.GOAL_ACTIVE]: [SIGNAL_STATES.GOAL_ACHIEVED, SIGNAL_STATES.GOAL_ABANDONED, SIGNAL_STATES.GOAL_PAUSED],
  [SIGNAL_STATES.GOAL_PAUSED]: [SIGNAL_STATES.GOAL_ACTIVE, SIGNAL_STATES.GOAL_ABANDONED],
  [SIGNAL_STATES.GOAL_ACHIEVED]: [], // Terminal state
  [SIGNAL_STATES.GOAL_ABANDONED]: [], // Terminal state

  // Insights
  [SIGNAL_STATES.INSIGHT_PENDING]: [SIGNAL_STATES.INSIGHT_VERIFIED, SIGNAL_STATES.INSIGHT_DISMISSED, SIGNAL_STATES.INSIGHT_ACTIONED],
  [SIGNAL_STATES.INSIGHT_VERIFIED]: [SIGNAL_STATES.INSIGHT_ACTIONED, SIGNAL_STATES.INSIGHT_DISMISSED],
  [SIGNAL_STATES.INSIGHT_ACTIONED]: [], // Terminal state
  [SIGNAL_STATES.INSIGHT_DISMISSED]: [], // Terminal state

  // Patterns
  [SIGNAL_STATES.PATTERN_DETECTED]: [SIGNAL_STATES.PATTERN_CONFIRMED, SIGNAL_STATES.PATTERN_REJECTED],
  [SIGNAL_STATES.PATTERN_CONFIRMED]: [SIGNAL_STATES.PATTERN_RESOLVED, SIGNAL_STATES.PATTERN_REJECTED],
  [SIGNAL_STATES.PATTERN_REJECTED]: [], // Terminal state
  [SIGNAL_STATES.PATTERN_RESOLVED]: [] // Terminal state
};

// ============================================
// COLLECTION REFERENCES
// ============================================

const getSignalStatesCollection = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signal_states');
};

const getInsightExclusionsCollection = (userId) => {
  return collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insight_exclusions');
};

// ============================================
// VALIDATION
// ============================================

/**
 * Check if a state transition is valid
 */
export const isValidTransition = (currentState, newState) => {
  const validNextStates = VALID_TRANSITIONS[currentState];
  if (!validNextStates) {
    console.warn(`Unknown current state: ${currentState}`);
    return false;
  }
  return validNextStates.includes(newState);
};

/**
 * Get terminal states (no further transitions possible)
 */
export const isTerminalState = (state) => {
  return VALID_TRANSITIONS[state]?.length === 0;
};

// ============================================
// SIGNAL STATE CRUD
// ============================================

/**
 * Create a new signal state
 */
export const createSignalState = async (userId, signalData) => {
  const signalStatesRef = getSignalStatesCollection(userId);
  const now = Timestamp.now();

  const stateDoc = {
    type: signalData.type, // 'goal' | 'pattern' | 'insight' | 'contradiction'
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

  const docRef = await addDoc(signalStatesRef, stateDoc);
  console.log(`Created signal state: ${docRef.id} (${signalData.type}: ${signalData.topic})`);

  return { id: docRef.id, ...stateDoc };
};

/**
 * Get a signal state by ID
 */
export const getSignalState = async (userId, signalId) => {
  const signalRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signal_states', signalId);
  const docSnap = await getDoc(signalRef);

  if (!docSnap.exists()) {
    return null;
  }

  return { id: docSnap.id, ...docSnap.data() };
};

/**
 * Get signal states by type and state
 */
export const getSignalStatesByState = async (userId, type, states) => {
  const signalStatesRef = getSignalStatesCollection(userId);

  const q = query(
    signalStatesRef,
    where('type', '==', type),
    where('state', 'in', states)
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
};

/**
 * Get all signal states for a user
 */
export const getAllSignalStates = async (userId, type = null) => {
  const signalStatesRef = getSignalStatesCollection(userId);

  let q;
  if (type) {
    q = query(signalStatesRef, where('type', '==', type), orderBy('lastUpdated', 'desc'));
  } else {
    q = query(signalStatesRef, orderBy('lastUpdated', 'desc'));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
};

// Maximum stateHistory entries to prevent document bloat
// Only actual state changes are tracked, not progress updates
const MAX_STATE_HISTORY_LENGTH = 20;

/**
 * Transition a signal to a new state
 *
 * Uses Firestore transaction to prevent race conditions when
 * multiple entries are saved quickly or background sync occurs.
 */
export const transitionSignalState = async (userId, signalId, newState, context = {}) => {
  const signalRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'signal_states', signalId);

  const result = await runTransaction(db, async (transaction) => {
    const docSnap = await transaction.get(signalRef);

    if (!docSnap.exists()) {
      throw new Error(`Signal not found: ${signalId}`);
    }

    const signal = { id: docSnap.id, ...docSnap.data() };

    if (!isValidTransition(signal.state, newState)) {
      throw new Error(`Invalid transition from ${signal.state} to ${newState}`);
    }

    const now = Timestamp.now();

    // Build new history entry
    const newHistoryEntry = { from: signal.state, to: newState, at: now, context };

    // Limit stateHistory to prevent document bloat (1MB Firestore limit)
    // Keep the first entry (creation) and last N-1 entries
    let newHistory = [...(signal.stateHistory || []), newHistoryEntry];
    if (newHistory.length > MAX_STATE_HISTORY_LENGTH) {
      const firstEntry = newHistory[0];
      const recentEntries = newHistory.slice(-(MAX_STATE_HISTORY_LENGTH - 1));
      newHistory = [firstEntry, ...recentEntries];
    }

    const updateData = {
      state: newState,
      stateHistory: newHistory,
      lastUpdated: now
    };

    // Update user feedback based on state
    if (newState === SIGNAL_STATES.INSIGHT_DISMISSED || newState === SIGNAL_STATES.PATTERN_REJECTED) {
      updateData['userFeedback.dismissed'] = true;
      updateData['userFeedback.dismissReason'] = context.reason || null;
    }

    if (newState === SIGNAL_STATES.INSIGHT_VERIFIED || newState === SIGNAL_STATES.PATTERN_CONFIRMED) {
      updateData['userFeedback.verified'] = true;
    }

    if (newState === SIGNAL_STATES.INSIGHT_ACTIONED) {
      updateData['userFeedback.actionTaken'] = context.action || 'completed';
    }

    transaction.update(signalRef, updateData);

    console.log(`Transitioned signal ${signalId}: ${signal.state} → ${newState}`);

    return { ...signal, state: newState, stateHistory: newHistory };
  });

  // Trigger side effects outside the transaction
  await handleStateTransitionSideEffects(userId, result, newState, context);

  return result;
};

/**
 * Handle side effects of state transitions
 */
const handleStateTransitionSideEffects = async (userId, signal, newState, context) => {
  // When a goal is achieved or abandoned, close related contradictions
  if (signal.type === 'goal' &&
      (newState === SIGNAL_STATES.GOAL_ACHIEVED || newState === SIGNAL_STATES.GOAL_ABANDONED)) {
    await closeRelatedContradictions(userId, signal.topic);
  }

  // When an insight is dismissed, add to exclusion list
  if (newState === SIGNAL_STATES.INSIGHT_DISMISSED && context.excludePattern) {
    await addToExclusionList(userId, {
      patternType: signal.metadata?.patternType,
      context: signal.metadata?.patternContext,
      reason: context.reason,
      permanent: context.permanent || false
    });
  }
};

/**
 * Close contradictions related to a goal topic
 */
const closeRelatedContradictions = async (userId, goalTopic) => {
  const signalStatesRef = getSignalStatesCollection(userId);

  const q = query(
    signalStatesRef,
    where('type', '==', 'contradiction'),
    where('topic', '==', goalTopic),
    where('state', 'in', [SIGNAL_STATES.PATTERN_DETECTED, SIGNAL_STATES.PATTERN_CONFIRMED])
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) return;

  const batch = writeBatch(db);
  const now = Timestamp.now();

  snapshot.forEach(docSnap => {
    const data = docSnap.data();
    batch.update(docSnap.ref, {
      state: SIGNAL_STATES.PATTERN_RESOLVED,
      stateHistory: [
        ...data.stateHistory,
        { from: data.state, to: SIGNAL_STATES.PATTERN_RESOLVED, at: now, context: { resolvedBy: 'goal_termination' } }
      ],
      lastUpdated: now
    });
  });

  await batch.commit();
  console.log(`Closed ${snapshot.size} contradictions related to goal: ${goalTopic}`);
};

// ============================================
// INSIGHT EXCLUSIONS
// ============================================

/**
 * Add a pattern to the exclusion list
 */
export const addToExclusionList = async (userId, exclusionData) => {
  const exclusionsRef = getInsightExclusionsCollection(userId);
  const now = Timestamp.now();

  const exclusionDoc = {
    patternType: exclusionData.patternType,
    context: exclusionData.context || {},
    reason: exclusionData.reason || 'user_dismissed',
    permanent: exclusionData.permanent || false,
    excludedAt: now,
    expiresAt: exclusionData.permanent ? null : new Timestamp(now.seconds + 30 * 24 * 60 * 60, 0) // 30 days
  };

  await addDoc(exclusionsRef, exclusionDoc);
  console.log(`Added exclusion for pattern: ${exclusionData.patternType}`);
};

/**
 * Check if a pattern should be excluded
 */
export const isPatternExcluded = async (userId, patternType, context = {}) => {
  const exclusionsRef = getInsightExclusionsCollection(userId);
  const now = Timestamp.now();

  // Check for matching exclusions
  const q = query(
    exclusionsRef,
    where('patternType', '==', patternType)
  );

  const snapshot = await getDocs(q);

  for (const docSnap of snapshot.docs) {
    const exclusion = docSnap.data();

    // Check if permanent or not expired
    if (exclusion.permanent || (exclusion.expiresAt && exclusion.expiresAt > now)) {
      // Check if context matches (if exclusion has specific context)
      if (Object.keys(exclusion.context).length === 0) {
        return true; // Blanket exclusion for this pattern type
      }

      // Check if context keys match
      const contextMatches = Object.entries(exclusion.context).every(
        ([key, value]) => context[key] === value
      );

      if (contextMatches) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Get all active exclusions for a user
 */
export const getActiveExclusions = async (userId) => {
  const exclusionsRef = getInsightExclusionsCollection(userId);
  const now = Timestamp.now();

  const snapshot = await getDocs(exclusionsRef);

  return snapshot.docs
    .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(exclusion =>
      exclusion.permanent || (exclusion.expiresAt && exclusion.expiresAt > now)
    );
};

/**
 * Remove an exclusion
 */
export const removeExclusion = async (userId, exclusionId) => {
  const exclusionRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'insight_exclusions', exclusionId);
  await deleteDoc(exclusionRef);
  console.log(`Removed exclusion: ${exclusionId}`);
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get active goals (not terminal states)
 */
export const getActiveGoals = async (userId) => {
  return getSignalStatesByState(userId, 'goal', [
    SIGNAL_STATES.GOAL_PROPOSED,
    SIGNAL_STATES.GOAL_ACTIVE,
    SIGNAL_STATES.GOAL_PAUSED
  ]);
};

/**
 * Get pending insights (awaiting user action)
 */
export const getPendingInsights = async (userId) => {
  return getSignalStatesByState(userId, 'insight', [SIGNAL_STATES.INSIGHT_PENDING]);
};

/**
 * Get unresolved patterns
 */
export const getUnresolvedPatterns = async (userId) => {
  return getSignalStatesByState(userId, 'pattern', [
    SIGNAL_STATES.PATTERN_DETECTED,
    SIGNAL_STATES.PATTERN_CONFIRMED
  ]);
};

/**
 * Find signal state by topic
 */
export const findSignalByTopic = async (userId, type, topic) => {
  const signalStatesRef = getSignalStatesCollection(userId);

  const q = query(
    signalStatesRef,
    where('type', '==', type),
    where('topic', '==', topic)
  );

  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;

  // Return the most recent one
  const signals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  return signals.sort((a, b) => b.lastUpdated?.seconds - a.lastUpdated?.seconds)[0];
};

export default {
  SIGNAL_STATES,
  isValidTransition,
  isTerminalState,
  createSignalState,
  getSignalState,
  getSignalStatesByState,
  getAllSignalStates,
  transitionSignalState,
  addToExclusionList,
  isPatternExcluded,
  getActiveExclusions,
  removeExclusion,
  getActiveGoals,
  getPendingInsights,
  getUnresolvedPatterns,
  findSignalByTopic
};
