/**
 * Memory Graph Service
 *
 * CRUD operations for the persistent memory graph that enables
 * the AI companion to truly know the user over time.
 *
 * Memory Collections:
 * - memory/core: Preferences, themes, conversation state
 * - memory/people/{personId}: People mentioned in entries
 * - memory/events/{eventId}: Significant life events
 * - memory/values/{valueId}: User values (ACT framework)
 * - memory/conversations/{conversationId}: Conversation summaries
 */

import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  Timestamp
} from 'firebase/firestore';
import { db } from '../../firebase';

// Collection paths
const APP_COLLECTION_ID = 'echo-vault-v5-fresh';
const MEMORY_SCHEMA_VERSION = 1;

/**
 * Get the base memory path for a user
 */
export const getMemoryPath = (userId) =>
  `artifacts/${APP_COLLECTION_ID}/users/${userId}/memory`;

/**
 * Get or initialize the core memory document
 */
export const getCoreMemory = async (userId) => {
  const coreRef = doc(db, getMemoryPath(userId), 'core');
  const coreSnap = await getDoc(coreRef);

  if (!coreSnap.exists()) {
    // Initialize with defaults
    const defaultCore = {
      schema_version: MEMORY_SCHEMA_VERSION,
      lastUpdated: serverTimestamp(),
      preferences: {
        communicationStyle: null, // Will be learned: "warm" | "direct" | "analytical"
        preferredName: null,
        avoidTopics: [],
        respondWellTo: [] // e.g., "validation", "practical_advice", "questions"
      },
      themes: [],
      conversationState: {
        lastTopic: null,
        pendingFollowUps: [],
        recentInsights: []
      }
    };

    await setDoc(coreRef, defaultCore);
    return { id: 'core', ...defaultCore };
  }

  return { id: 'core', ...coreSnap.data() };
};

/**
 * Update core memory preferences
 */
export const updateCoreMemory = async (userId, updates) => {
  const coreRef = doc(db, getMemoryPath(userId), 'core');
  await updateDoc(coreRef, {
    ...updates,
    lastUpdated: serverTimestamp()
  });
};

/**
 * Add a pending follow-up question
 */
export const addFollowUp = async (userId, followUp) => {
  const core = await getCoreMemory(userId);
  const pendingFollowUps = core.conversationState?.pendingFollowUps || [];

  // Limit to 5 pending follow-ups
  const updated = [...pendingFollowUps, {
    ...followUp,
    askedAt: null,
    createdAt: new Date()
  }].slice(-5);

  await updateCoreMemory(userId, {
    'conversationState.pendingFollowUps': updated
  });
};

/**
 * Mark a follow-up as asked
 */
export const markFollowUpAsked = async (userId, followUpIndex) => {
  const core = await getCoreMemory(userId);
  const pendingFollowUps = core.conversationState?.pendingFollowUps || [];

  if (pendingFollowUps[followUpIndex]) {
    pendingFollowUps[followUpIndex].askedAt = new Date();
  }

  await updateCoreMemory(userId, {
    'conversationState.pendingFollowUps': pendingFollowUps
  });
};

// ============================================
// PEOPLE MEMORY
// ============================================

/**
 * Get all people from memory
 * @param {Object} options
 * @param {boolean} options.excludeArchived - Exclude archived people (default: true)
 */
export const getPeople = async (userId, options = { excludeArchived: true }) => {
  const peopleRef = collection(db, getMemoryPath(userId), 'people');

  let q = query(peopleRef, orderBy('lastMentioned', 'desc'));

  if (options.excludeArchived) {
    q = query(peopleRef, where('status', '!=', 'archived'), orderBy('lastMentioned', 'desc'));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Get a specific person by ID
 */
export const getPerson = async (userId, personId) => {
  const personRef = doc(db, getMemoryPath(userId), 'people', personId);
  const personSnap = await getDoc(personRef);

  if (!personSnap.exists()) return null;
  return { id: personSnap.id, ...personSnap.data() };
};

/**
 * Find person by name (case-insensitive)
 */
export const findPersonByName = async (userId, name) => {
  const people = await getPeople(userId, { excludeArchived: false });
  const lowerName = name.toLowerCase();

  return people.find(p =>
    p.name?.toLowerCase() === lowerName ||
    p.aliases?.some(a => a.toLowerCase() === lowerName)
  );
};

/**
 * Add or update a person in memory
 */
export const upsertPerson = async (userId, personData) => {
  const { name, relationship, sentiment, topics, entryId } = personData;

  // Check if person already exists
  const existing = await findPersonByName(userId, name);

  if (existing) {
    // Update existing person
    const personRef = doc(db, getMemoryPath(userId), 'people', existing.id);

    const updates = {
      lastMentioned: serverTimestamp(),
      mentionCount: increment(1),
      status: 'active' // Reactivate if was archived
    };

    // Update sentiment if provided
    if (sentiment !== undefined) {
      updates['sentiment.recent'] = sentiment;
      // Recalculate overall (weighted average favoring recent)
      const overall = existing.sentiment?.overall || sentiment;
      updates['sentiment.overall'] = (overall * 0.7) + (sentiment * 0.3);

      // Determine trend
      const prevOverall = existing.sentiment?.overall;
      if (prevOverall !== undefined) {
        if (sentiment > prevOverall + 0.15) updates['sentiment.trend'] = 'improving';
        else if (sentiment < prevOverall - 0.15) updates['sentiment.trend'] = 'declining';
        else updates['sentiment.trend'] = 'stable';
      }
    }

    // Add new topics
    if (topics && topics.length > 0) {
      const existingTopics = existing.topics || [];
      const topicMap = new Map(existingTopics.map(t => [t.topic, t]));

      topics.forEach(newTopic => {
        if (topicMap.has(newTopic.topic)) {
          const t = topicMap.get(newTopic.topic);
          t.frequency = (t.frequency || 0) + 1;
          if (newTopic.sentiment !== undefined) {
            t.sentiment = (t.sentiment * 0.7) + (newTopic.sentiment * 0.3);
          }
        } else {
          topicMap.set(newTopic.topic, {
            topic: newTopic.topic,
            sentiment: newTopic.sentiment || 0,
            frequency: 1
          });
        }
      });

      updates.topics = Array.from(topicMap.values());
    }

    // Add significant moment if this entry is notable
    if (entryId && personData.significantMoment) {
      updates.significantMoments = [
        ...(existing.significantMoments || []).slice(-9), // Keep last 10
        {
          date: new Date(),
          summary: personData.significantMoment,
          entryId
        }
      ];
    }

    await updateDoc(personRef, updates);
    return { id: existing.id, updated: true };
  } else {
    // Create new person
    const personRef = doc(collection(db, getMemoryPath(userId), 'people'));

    const newPerson = {
      name,
      aliases: [],
      relationship: relationship || 'unknown',
      sentiment: {
        overall: sentiment || 0,
        recent: sentiment || 0,
        trend: 'stable'
      },
      topics: topics || [],
      firstMentioned: serverTimestamp(),
      lastMentioned: serverTimestamp(),
      mentionCount: 1,
      significantMoments: [],
      status: 'active',
      archivedAt: null
    };

    await setDoc(personRef, newPerson);
    return { id: personRef.id, created: true };
  }
};

/**
 * Archive a person (relevance decay after 6+ months)
 */
export const archivePerson = async (userId, personId) => {
  const personRef = doc(db, getMemoryPath(userId), 'people', personId);
  await updateDoc(personRef, {
    status: 'archived',
    archivedAt: serverTimestamp()
  });
};

// ============================================
// EVENTS MEMORY
// ============================================

/**
 * Get all events from memory
 */
export const getEvents = async (userId, options = {}) => {
  const eventsRef = collection(db, getMemoryPath(userId), 'events');

  let q = query(eventsRef, orderBy('date', 'desc'));

  if (options.limit) {
    q = query(q, limit(options.limit));
  }

  if (options.type) {
    q = query(eventsRef, where('type', '==', options.type), orderBy('date', 'desc'));
  }

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Add an event to memory
 */
export const addEvent = async (userId, eventData) => {
  const eventRef = doc(collection(db, getMemoryPath(userId), 'events'));

  const event = {
    description: eventData.description,
    date: eventData.date || serverTimestamp(),
    type: eventData.type || 'milestone', // milestone, challenge, loss, achievement, change
    emotionalImpact: eventData.emotionalImpact || 5, // 1-10
    resolved: eventData.resolved ?? false,
    recurring: eventData.recurring ?? false,
    recurrencePattern: eventData.recurrencePattern || null,
    nextOccurrence: eventData.nextOccurrence || null,
    relatedPeople: eventData.relatedPeople || [],
    relatedGoals: eventData.relatedGoals || [],
    followUpQuestions: eventData.followUpQuestions || [],
    entryId: eventData.entryId || null,
    createdAt: serverTimestamp()
  };

  await setDoc(eventRef, event);
  return { id: eventRef.id, ...event };
};

/**
 * Update an event
 */
export const updateEvent = async (userId, eventId, updates) => {
  const eventRef = doc(db, getMemoryPath(userId), 'events', eventId);
  await updateDoc(eventRef, {
    ...updates,
    updatedAt: serverTimestamp()
  });
};

// ============================================
// VALUES MEMORY (ACT Framework)
// ============================================

/**
 * Get all values from memory
 */
export const getValues = async (userId) => {
  const valuesRef = collection(db, getMemoryPath(userId), 'values');
  const q = query(valuesRef, orderBy('importance', 'desc'));

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Find value by name
 */
export const findValueByName = async (userId, valueName) => {
  const values = await getValues(userId);
  const lowerName = valueName.toLowerCase();

  return values.find(v => v.value?.toLowerCase() === lowerName);
};

/**
 * Add or update a value
 */
export const upsertValue = async (userId, valueData) => {
  const { value, importance, source, relatedActivities, relatedPeople } = valueData;

  const existing = await findValueByName(userId, value);

  if (existing) {
    const valueRef = doc(db, getMemoryPath(userId), 'values', existing.id);

    const updates = {
      lastMentioned: serverTimestamp()
    };

    if (importance !== undefined) {
      updates.importance = importance;
    }

    // Merge related activities and people
    if (relatedActivities?.length) {
      updates.relatedActivities = [...new Set([
        ...(existing.relatedActivities || []),
        ...relatedActivities
      ])];
    }

    if (relatedPeople?.length) {
      updates.relatedPeople = [...new Set([
        ...(existing.relatedPeople || []),
        ...relatedPeople
      ])];
    }

    await updateDoc(valueRef, updates);
    return { id: existing.id, updated: true };
  } else {
    const valueRef = doc(collection(db, getMemoryPath(userId), 'values'));

    const newValue = {
      value,
      importance: importance || 5, // 1-10
      firstIdentified: serverTimestamp(),
      lastMentioned: serverTimestamp(),
      source: source || 'ai_inferred', // "user_defined" | "ai_inferred"
      userConfirmed: source === 'user_defined',
      alignmentScore: 1, // 0-1, starts high
      gaps: [],
      relatedActivities: relatedActivities || [],
      relatedPeople: relatedPeople || []
    };

    await setDoc(valueRef, newValue);
    return { id: valueRef.id, created: true };
  }
};

/**
 * Record a value-behavior gap
 */
export const recordValueGap = async (userId, valueId, gap) => {
  const valueRef = doc(db, getMemoryPath(userId), 'values', valueId);
  const valueSnap = await getDoc(valueRef);

  if (!valueSnap.exists()) return null;

  const value = valueSnap.data();

  // Only record gaps for user-defined or user-confirmed values
  if (value.source === 'ai_inferred' && !value.userConfirmed) {
    // For unconfirmed AI-inferred values, just note we should ask about this value
    return { shouldAskAboutValue: true, value: value.value };
  }

  const gaps = value.gaps || [];
  gaps.push({
    detected: new Date(),
    description: gap.description,
    entryId: gap.entryId,
    resolved: false
  });

  // Update alignment score (decreases with gaps)
  const newAlignmentScore = Math.max(0, (value.alignmentScore || 1) - 0.1);

  await updateDoc(valueRef, {
    gaps: gaps.slice(-10), // Keep last 10 gaps
    alignmentScore: newAlignmentScore
  });

  return { recorded: true };
};

/**
 * User confirms an AI-inferred value
 */
export const confirmValue = async (userId, valueId) => {
  const valueRef = doc(db, getMemoryPath(userId), 'values', valueId);
  await updateDoc(valueRef, {
    userConfirmed: true
  });
};

// ============================================
// CONVERSATIONS MEMORY
// ============================================

/**
 * Save a conversation summary
 */
export const saveConversation = async (userId, conversationData) => {
  const convRef = doc(collection(db, getMemoryPath(userId), 'conversations'));

  const conversation = {
    date: serverTimestamp(),
    mode: conversationData.mode || 'chat', // chat, voice, guided
    sessionType: conversationData.sessionType || null,
    keyDisclosures: conversationData.keyDisclosures || [],
    unresolvedQuestions: conversationData.unresolvedQuestions || [],
    emotionalArc: conversationData.emotionalArc || { start: null, end: null },
    insightsShared: conversationData.insightsShared || [],
    userBreakthroughs: conversationData.userBreakthroughs || [],
    followUpNeeded: conversationData.followUpNeeded || []
  };

  await setDoc(convRef, conversation);

  // Add any follow-ups to core memory
  if (conversation.followUpNeeded?.length > 0) {
    for (const followUp of conversation.followUpNeeded) {
      await addFollowUp(userId, {
        question: followUp,
        context: conversationData.sessionType || 'conversation'
      });
    }
  }

  return { id: convRef.id, ...conversation };
};

/**
 * Get recent conversations
 */
export const getRecentConversations = async (userId, count = 5) => {
  const convsRef = collection(db, getMemoryPath(userId), 'conversations');
  const q = query(convsRef, orderBy('date', 'desc'), limit(count));

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ============================================
// FULL MEMORY GRAPH
// ============================================

/**
 * Get the complete memory graph for a user
 * Used for RAG context
 */
export const getMemoryGraph = async (userId, options = { excludeArchived: true }) => {
  const [core, people, events, values, conversations] = await Promise.all([
    getCoreMemory(userId),
    getPeople(userId, options),
    getEvents(userId, { limit: 20 }),
    getValues(userId),
    getRecentConversations(userId, 5)
  ]);

  return {
    core,
    people,
    events,
    values,
    conversations,
    summary: generateMemorySummary({ core, people, events, values })
  };
};

/**
 * Generate a text summary of memory for context
 */
const generateMemorySummary = ({ core, people, events, values }) => {
  const parts = [];

  // Communication preferences
  if (core.preferences?.communicationStyle) {
    parts.push(`Prefers ${core.preferences.communicationStyle} communication.`);
  }
  if (core.preferences?.preferredName) {
    parts.push(`Goes by "${core.preferences.preferredName}".`);
  }

  // Key people
  const activePeople = people.filter(p => p.status !== 'archived').slice(0, 5);
  if (activePeople.length > 0) {
    const peopleStr = activePeople.map(p =>
      `${p.name} (${p.relationship}, sentiment: ${p.sentiment?.overall?.toFixed(1) || 'unknown'})`
    ).join(', ');
    parts.push(`Key people: ${peopleStr}`);
  }

  // Recent significant events
  const recentEvents = events.filter(e => !e.resolved).slice(0, 3);
  if (recentEvents.length > 0) {
    const eventsStr = recentEvents.map(e => e.description).join('; ');
    parts.push(`Recent events: ${eventsStr}`);
  }

  // Core values
  const topValues = values.slice(0, 5);
  if (topValues.length > 0) {
    const valuesStr = topValues.map(v => v.value).join(', ');
    parts.push(`Values: ${valuesStr}`);
  }

  // Themes
  if (core.themes?.length > 0) {
    const themesStr = core.themes.slice(0, 3).map(t => t.theme).join(', ');
    parts.push(`Ongoing themes: ${themesStr}`);
  }

  return parts.join(' ');
};

/**
 * Format memory graph for chat context
 * Optimized for token budget
 */
export const formatMemoryForContext = (memory, maxTokens = 500) => {
  if (!memory) return null;

  const sections = [];

  // Core preferences (always included)
  if (memory.core?.preferences) {
    const prefs = memory.core.preferences;
    const prefParts = [];
    if (prefs.communicationStyle) prefParts.push(`Style: ${prefs.communicationStyle}`);
    if (prefs.preferredName) prefParts.push(`Name: ${prefs.preferredName}`);
    if (prefs.avoidTopics?.length) prefParts.push(`Avoid: ${prefs.avoidTopics.join(', ')}`);
    if (prefParts.length > 0) {
      sections.push(`PREFERENCES: ${prefParts.join('. ')}`);
    }
  }

  // Key people (top 5 by recent activity)
  if (memory.people?.length > 0) {
    const peopleLines = memory.people.slice(0, 5).map(p => {
      const sentiment = p.sentiment?.overall;
      const sentimentLabel = sentiment > 0.3 ? 'positive' : sentiment < -0.3 ? 'strained' : 'neutral';
      return `- ${p.name} (${p.relationship}): ${sentimentLabel}`;
    });
    sections.push(`PEOPLE:\n${peopleLines.join('\n')}`);
  }

  // Pending follow-ups
  const followUps = memory.core?.conversationState?.pendingFollowUps?.filter(f => !f.askedAt);
  if (followUps?.length > 0) {
    const followUpLines = followUps.slice(0, 3).map(f => `- ${f.question}`);
    sections.push(`FOLLOW-UPS TO ASK:\n${followUpLines.join('\n')}`);
  }

  // Recent events
  if (memory.events?.length > 0) {
    const eventLines = memory.events.slice(0, 3).map(e =>
      `- ${e.description} (${e.type}${e.resolved ? ', resolved' : ''})`
    );
    sections.push(`RECENT EVENTS:\n${eventLines.join('\n')}`);
  }

  // Values
  if (memory.values?.length > 0) {
    const valueLines = memory.values.slice(0, 5).map(v => {
      const alignment = v.alignmentScore < 0.5 ? ' (gap detected)' : '';
      return `- ${v.value}${alignment}`;
    });
    sections.push(`VALUES:\n${valueLines.join('\n')}`);
  }

  return sections.join('\n\n');
};

/**
 * Cascade delete - remove memory references when an entry is deleted
 * Run as background task to avoid UI blocking
 */
export const cascadeDeleteEntry = async (userId, entryId) => {
  const batch = writeBatch(db);
  let deletedCount = 0;

  // Get all events that reference this entry
  const eventsRef = collection(db, getMemoryPath(userId), 'events');
  const eventsQuery = query(eventsRef, where('entryId', '==', entryId));
  const eventSnaps = await getDocs(eventsQuery);

  eventSnaps.forEach(snap => {
    batch.delete(snap.ref);
    deletedCount++;
  });

  // Remove significant moments from people that reference this entry
  const people = await getPeople(userId, { excludeArchived: false });
  for (const person of people) {
    if (person.significantMoments?.some(m => m.entryId === entryId)) {
      const personRef = doc(db, getMemoryPath(userId), 'people', person.id);
      batch.update(personRef, {
        significantMoments: person.significantMoments.filter(m => m.entryId !== entryId)
      });
      deletedCount++;
    }
  }

  // Remove gaps from values that reference this entry
  const values = await getValues(userId);
  for (const value of values) {
    if (value.gaps?.some(g => g.entryId === entryId)) {
      const valueRef = doc(db, getMemoryPath(userId), 'values', value.id);
      batch.update(valueRef, {
        gaps: value.gaps.filter(g => g.entryId !== entryId)
      });
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    await batch.commit();
  }

  return { deletedCount };
};

/**
 * Run relevance decay - archive entities not mentioned in 6+ months
 */
export const runRelevanceDecay = async (userId) => {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const people = await getPeople(userId, { excludeArchived: false });
  let archivedCount = 0;

  for (const person of people) {
    if (person.status !== 'archived') {
      const lastMentioned = person.lastMentioned?.toDate?.() || new Date(person.lastMentioned);
      if (lastMentioned < sixMonthsAgo) {
        await archivePerson(userId, person.id);
        archivedCount++;
      }
    }
  }

  return { archivedCount };
};

export default {
  // Core
  getCoreMemory,
  updateCoreMemory,
  addFollowUp,
  markFollowUpAsked,

  // People
  getPeople,
  getPerson,
  findPersonByName,
  upsertPerson,
  archivePerson,

  // Events
  getEvents,
  addEvent,
  updateEvent,

  // Values
  getValues,
  findValueByName,
  upsertValue,
  recordValueGap,
  confirmValue,

  // Conversations
  saveConversation,
  getRecentConversations,

  // Full graph
  getMemoryGraph,
  formatMemoryForContext,
  getMemoryPath,

  // Maintenance
  cascadeDeleteEntry,
  runRelevanceDecay
};
