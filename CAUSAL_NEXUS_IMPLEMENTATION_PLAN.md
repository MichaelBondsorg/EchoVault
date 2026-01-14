# Causal Nexus Implementation Plan

## Executive Summary

This document details the implementation of the **Causal Nexus** feature - an intelligent system that connects journal narratives with biometric data (Whoop) to surface "why" insights rather than just "what" observations.

### What We're Building
1. **Semantic Thread Management** - Track ongoing storylines across entries
2. **Causal Correlation Engine** - Cross-reference narratives with biometrics
3. **CausalBite Widget** - Visualize mind-body connections on dashboard
4. **Enhanced Insight Rotation** - Per-thread cooldowns with sentiment delta bypass

### Files Changed vs Created

| Action | File | Risk Level |
|--------|------|------------|
| **CREATE** | `src/hooks/useCausalNexus.js` | None (new) |
| **CREATE** | `src/services/threads/threadManager.js` | None (new) |
| **CREATE** | `src/services/threads/index.js` | None (new) |
| **CREATE** | `src/services/causalnexus/correlationEngine.js` | None (new) |
| **CREATE** | `src/services/causalnexus/index.js` | None (new) |
| **CREATE** | `src/components/zen/widgets/CausalBiteWidget.jsx` | None (new) |
| **CREATE** | `scripts/backfill-threads.js` | None (new) |
| **MODIFY** | `src/services/background/entryPostProcessing.js` | Low |
| **MODIFY** | `src/services/patterns/insightRotation.js` | Low |
| **MODIFY** | `src/components/zen/widgets/index.js` | Low |
| **MODIFY** | `src/hooks/useDashboardLayout.js` | Low |
| **MODIFY** | `src/services/memory/memoryGraph.js` | Low |
| **MODIFY** | `src/services/leadership/leadershipThreads.js` | Medium (bug fix) |

---

## ADDENDUM: Architectural Refinements (Post-Review)

Based on technical review, the following refinements have been incorporated:

### A1. Thread Service Consolidation

**Issue**: `leadershipThreads.js` already implements a threading system for mentee tracking. Creating a parallel `threadManager.js` fragments the architecture.

**Solution**: Create a unified `src/services/threads/` module that supports multiple thread categories:

```javascript
// Thread Categories (unified schema)
const THREAD_CATEGORIES = {
  // Causal Nexus threads
  CAREER: 'career',
  HEALTH: 'health',
  RELATIONSHIP: 'relationship',
  GROWTH: 'growth',
  SOMATIC: 'somatic',

  // Leadership threads (migrated)
  MENTORSHIP: 'mentorship',
  GROWTH_TRACKING: 'growth_tracking',
  CONFLICT_RESOLUTION: 'conflict_resolution'
};
```

**Migration Path**:
1. New unified `threads` collection: `users/{uid}/threads/{threadId}`
2. Leadership threads remain in `leadership_threads` temporarily
3. Future migration script moves `leadership_threads` → `threads` with category mapping
4. `leadershipThreads.js` becomes a thin wrapper calling unified service

### A2. APP_COLLECTION_ID Bug Fix

**Issue**: `leadershipThreads.js` hardcodes `'echo-journal'` instead of importing from config.

**Current (Broken)**:
```javascript
// src/services/leadership/leadershipThreads.js:31
const APP_COLLECTION_ID = 'echo-journal';  // WRONG
```

**Fix Required**:
```javascript
import { APP_COLLECTION_ID } from '../../config/constants';
```

**Note**: This is writing to a completely different Firestore location. Existing leadership threads may be orphaned in the wrong collection.

### A3. Memory Graph Integration

**Issue**: Threads represent "longitudinal memory" but aren't included in `getMemoryGraph()`.

**Modification** to `src/services/memory/memoryGraph.js`:

```javascript
// Line 541 - BEFORE:
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

// Line 541 - AFTER:
import { getActiveThreads } from '../threads';

export const getMemoryGraph = async (userId, options = { excludeArchived: true }) => {
  const [core, people, events, values, conversations, threads] = await Promise.all([
    getCoreMemory(userId),
    getPeople(userId, options),
    getEvents(userId, { limit: 20 }),
    getValues(userId),
    getRecentConversations(userId, 5),
    getActiveThreads(userId, { limit: 10 })  // NEW
  ]);

  return {
    core,
    people,
    events,
    values,
    conversations,
    threads,  // NEW
    summary: generateMemorySummary({ core, people, events, values, threads })
  };
};
```

**Update `generateMemorySummary()`**:
```javascript
const generateMemorySummary = ({ core, people, events, values, threads }) => {
  const parts = [];
  // ... existing code ...

  // Add thread context
  if (threads?.length > 0) {
    const activeStorylines = threads
      .slice(0, 3)
      .map(t => t.displayName)
      .join(', ');
    parts.push(`Currently tracking: ${activeStorylines}.`);
  }

  return parts.join(' ');
};
```

### A4. Similarity Threshold Adjustment

**Issue**: 0.85 threshold too restrictive for natural language variations.

**Changes**:
1. Lower semantic threshold to **0.75**
2. Use Levenshtein only for **exact slug matching** (not primary matching)
3. Prioritize embedding-based semantic matching

```javascript
// BEFORE:
const SIMILARITY_THRESHOLD = 0.85;

// AFTER:
const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;
const LEVENSHTEIN_EXACT_THRESHOLD = 0.95; // Only for near-exact matches

export const findSimilarThread = async (proposedName, activeThreads, proposedEmbedding = null) => {
  // 1. First: Try semantic embedding match (primary)
  if (proposedEmbedding) {
    for (const thread of activeThreads) {
      if (thread.embedding) {
        const similarity = cosineSimilarity(proposedEmbedding, thread.embedding);
        if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
          console.log(`[ThreadManager] Semantic match: "${proposedName}" → "${thread.displayName}" (${(similarity * 100).toFixed(1)}%)`);
          return thread;
        }
      }
    }
  }

  // 2. Fallback: Levenshtein for near-exact matches only
  for (const thread of activeThreads) {
    const similarity = calculateNameSimilarity(proposedName, thread.displayName);
    if (similarity >= LEVENSHTEIN_EXACT_THRESHOLD) {
      console.log(`[ThreadManager] Exact match: "${proposedName}" → "${thread.displayName}"`);
      return thread;
    }
  }

  return null;
};
```

### A5. Minimum Content Threshold

**Issue**: Short entries (e.g., "Good day") waste LLM calls.

**Change** in `entryPostProcessing.js`:

```javascript
// BEFORE:
if (entryId && entryContent.length > 20) {
  tasks.push(identifyThreadBackground(...));
}

// AFTER:
const MIN_CONTENT_LENGTH_FOR_THREAD = 50;

if (entryId && entryContent.length >= MIN_CONTENT_LENGTH_FOR_THREAD) {
  tasks.push(identifyThreadBackground(...));
}
```

### A6. Updated Implementation Checklist

```
Phase 0: Pre-requisites (Bug Fixes)
[ ] Fix APP_COLLECTION_ID in leadershipThreads.js
[ ] Verify no orphaned data in 'echo-journal' collection
[ ] Add threads to getMemoryGraph() return

Phase 1: Unified Thread Service
[ ] Create src/services/threads/threadManager.js (unified)
[ ] Create src/services/threads/index.js
[ ] Implement SEMANTIC_SIMILARITY_THRESHOLD = 0.75
[ ] Prioritize embedding match over Levenshtein

Phase 2: Causal Nexus Engine
[ ] Create src/services/causalnexus/correlationEngine.js
[ ] Create src/services/causalnexus/index.js
[ ] Implement all 8 correlation patterns

Phase 3: Integration
[ ] Modify entryPostProcessing.js (MIN_CONTENT_LENGTH = 50)
[ ] Modify App.jsx (add entryId)
[ ] Modify insightRotation.js (thread cooldowns)

Phase 4: UI
[ ] Create CausalBiteWidget.jsx
[ ] Register in widgets/index.js
[ ] Add to useDashboardLayout.js

Phase 5: Memory Integration
[ ] Update memoryGraph.js to include threads
[ ] Update generateMemorySummary() for thread context

Phase 6: Backfill & Testing
[ ] Create backfill-threads.js script
[ ] Test all 8 correlation patterns
[ ] Test degraded states
```

---

## Part 1: Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENTRY SAVE FLOW                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User saves entry                                                    │
│       ↓                                                              │
│  App.jsx: doSaveEntry()                                              │
│       ↓                                                              │
│  Entry saved + analyzed (existing)                                   │
│       ↓                                                              │
│  runEntryPostProcessing() ─────────────────────────────┐             │
│       ↓                                                │             │
│  [EXISTING] Cache refresh, pattern invalidation        │             │
│       ↓                                                │             │
│  [NEW] identifyThreadAssociation() ◄───────────────────┘             │
│       ↓                                                              │
│  ┌─────────────────────────────────────┐                             │
│  │  1. Load active threads             │                             │
│  │  2. Call Gemini for thread match    │                             │
│  │  3. Similarity check (dedupe)       │                             │
│  │  4. Create or append to thread      │                             │
│  │  5. Extract somatic signals         │                             │
│  └─────────────────────────────────────┘                             │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       DASHBOARD RENDER FLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Dashboard loads                                                     │
│       ↓                                                              │
│  useCausalNexus(userId) hook                                         │
│       ↓                                                              │
│  ┌─────────────────────────────────────┐                             │
│  │  1. Fetch active threads            │                             │
│  │  2. Fetch today's Whoop summary     │                             │
│  │  3. Run correlation engine          │                             │
│  │  4. Return strongest correlation    │                             │
│  └─────────────────────────────────────┘                             │
│       ↓                                                              │
│  CausalBiteWidget renders correlation                                │
│       ↓                                                              │
│  If strength < 0.5 → "Nexus Learning" state                          │
│  If strength >= 0.5 → Full causal insight                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 2: Firestore Schema

### New Collection: `users/{uid}/threads/{threadId}`

```javascript
{
  id: "databricks-career-1704067200",      // slugify(name) + timestamp
  displayName: "Databricks Career",         // Human-readable
  category: "career",                       // career | health | relationship | growth | somatic
  status: "active",                         // active | resolved | archived

  // Sentiment tracking
  sentimentBaseline: 0.72,                  // Rolling avg of last 3 entries
  sentimentHistory: [0.65, 0.78, 0.73],     // Last 3 sentiment scores

  // Somatic signals from this thread
  somaticSignals: ["tension", "fatigue"],

  // Entry references
  entryIds: ["entry123", "entry456"],
  entryCount: 2,

  // Timestamps
  createdAt: Timestamp,
  lastUpdated: Timestamp,
  lastEntryAt: Timestamp
}
```

### New Document: `users/{uid}/settings/insight_state`

```javascript
{
  thread_cooldowns: {
    "databricks-career-1704067200": {
      last_shown: Timestamp,
      last_sentiment_avg: 0.72
    }
  },

  // Existing rotation state will migrate here from localStorage
  rotation_state: {
    recentlyShown: [{ key: "...", shownAt: timestamp }],
    lastViewedAt: timestamp
  },

  updatedAt: Timestamp
}
```

---

## Part 3: New Files - Complete Code

### 3.1 `src/services/causalnexus/index.js`

```javascript
/**
 * Causal Nexus Service
 *
 * Connects journal narratives with biometric data to surface
 * "why" insights rather than just "what" observations.
 */

export {
  identifyThreadAssociation,
  getActiveThreads,
  createThread,
  appendToThread,
  resolveThread,
  findSimilarThread
} from './threadManager';

export {
  calculateCausalCorrelation,
  getCorrelationForToday,
  CORRELATION_PATTERNS
} from './correlationEngine';
```

### 3.2 `src/services/threads/threadManager.js` (Unified Thread Service)

```javascript
/**
 * Thread Manager
 *
 * Manages semantic threads - ongoing storylines that connect
 * multiple journal entries around a common theme.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { APP_COLLECTION_ID } from '../../config/constants';
import { callGemini } from '../ai/gemini';
import { generateEmbedding, cosineSimilarity } from '../ai/embeddings';

// ============================================================
// CONSTANTS
// ============================================================

const THREAD_CATEGORIES = [
  // Causal Nexus categories
  'career', 'health', 'relationship', 'growth', 'somatic',
  // Leadership categories (unified)
  'mentorship', 'growth_tracking', 'conflict_resolution'
];

// Similarity thresholds (refined per review)
const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;  // Lowered from 0.85
const LEVENSHTEIN_EXACT_THRESHOLD = 0.95;    // Only for near-exact matches
const MAX_SENTIMENT_HISTORY = 3;
const MIN_CONTENT_LENGTH_FOR_THREAD = 50;    // Skip short entries

const SOMATIC_TAXONOMY = [
  'pain',        // Physical pain (knee, back, etc.)
  'tension',     // Physical stress manifestation
  'fatigue',     // Low energy
  'respiratory', // Breathing, illness
  'cognitive'    // Brain fog, focus issues
];

// ============================================================
// THREAD RETRIEVAL
// ============================================================

/**
 * Get all active threads for a user
 * @param {string} userId
 * @returns {Promise<Array>} Active threads sorted by lastUpdated
 */
export const getActiveThreads = async (userId) => {
  if (!userId) return [];

  try {
    const threadsRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads');
    const q = query(
      threadsRef,
      where('status', '==', 'active'),
      orderBy('lastUpdated', 'desc'),
      limit(20)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('[ThreadManager] Failed to get active threads:', error);
    return [];
  }
};

/**
 * Get a specific thread by ID
 * @param {string} userId
 * @param {string} threadId
 * @returns {Promise<Object|null>}
 */
export const getThread = async (userId, threadId) => {
  if (!userId || !threadId) return null;

  try {
    const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId);
    const threadDoc = await getDoc(threadRef);

    if (!threadDoc.exists()) return null;
    return { id: threadDoc.id, ...threadDoc.data() };
  } catch (error) {
    console.error('[ThreadManager] Failed to get thread:', error);
    return null;
  }
};

// ============================================================
// THREAD SIMILARITY / DEDUPLICATION
// ============================================================

/**
 * Normalize thread name for comparison
 * @param {string} name
 * @returns {string}
 */
const normalizeThreadName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const levenshteinDistance = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

/**
 * Calculate similarity between two thread names (0-1)
 * @param {string} name1
 * @param {string} name2
 * @returns {number}
 */
const calculateNameSimilarity = (name1, name2) => {
  const n1 = normalizeThreadName(name1);
  const n2 = normalizeThreadName(name2);

  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 1;

  const distance = levenshteinDistance(n1, n2);
  return 1 - (distance / maxLen);
};

/**
 * Find a similar existing thread using similarity buffer
 * PRIORITY: Semantic embedding match > Levenshtein exact match
 *
 * @param {string} proposedName - LLM-proposed thread name
 * @param {Array} activeThreads - Current active threads
 * @param {string} [proposedEmbedding] - Optional embedding for semantic match
 * @returns {Promise<Object|null>} Matched thread or null
 */
export const findSimilarThread = async (proposedName, activeThreads, proposedEmbedding = null) => {
  if (!activeThreads || activeThreads.length === 0) return null;

  // FIRST: Try semantic embedding match (primary - more flexible)
  if (proposedEmbedding) {
    try {
      for (const thread of activeThreads) {
        if (thread.embedding) {
          const similarity = cosineSimilarity(proposedEmbedding, thread.embedding);
          if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
            console.log(`[ThreadManager] Semantic match: "${proposedName}" → "${thread.displayName}" (${(similarity * 100).toFixed(1)}%)`);
            return thread;
          }
        }
      }
    } catch (error) {
      console.warn('[ThreadManager] Semantic matching failed:', error);
    }
  }

  // SECOND: Fallback to Levenshtein for near-exact matches only
  // (e.g., "Job Hunt" vs "job hunt" - same words, different case)
  for (const thread of activeThreads) {
    const similarity = calculateNameSimilarity(proposedName, thread.displayName);
    if (similarity >= LEVENSHTEIN_EXACT_THRESHOLD) {
      console.log(`[ThreadManager] Exact match: "${proposedName}" → "${thread.displayName}" (${(similarity * 100).toFixed(1)}%)`);
      return thread;
    }
  }

  return null;
};

// ============================================================
// THREAD CREATION & UPDATES
// ============================================================

/**
 * Generate a thread ID from name and timestamp
 * @param {string} name
 * @returns {string}
 */
const generateThreadId = (name) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

  const timestamp = Date.now();
  return `${slug}-${timestamp}`;
};

/**
 * Create a new thread
 * @param {string} userId
 * @param {Object} threadData
 * @returns {Promise<Object>} Created thread
 */
export const createThread = async (userId, threadData) => {
  const { displayName, category, sentiment, somaticSignals = [], entryId } = threadData;

  const threadId = generateThreadId(displayName);
  const now = Timestamp.now();

  // Generate embedding for future semantic matching
  let embedding = null;
  try {
    embedding = await generateEmbedding(displayName);
  } catch (error) {
    console.warn('[ThreadManager] Failed to generate embedding:', error);
  }

  const thread = {
    id: threadId,
    displayName,
    category: THREAD_CATEGORIES.includes(category) ? category : 'growth',
    status: 'active',
    sentimentBaseline: sentiment || 0.5,
    sentimentHistory: sentiment ? [sentiment] : [],
    somaticSignals: somaticSignals.filter(s => SOMATIC_TAXONOMY.includes(s)),
    entryIds: entryId ? [entryId] : [],
    entryCount: entryId ? 1 : 0,
    embedding,
    createdAt: now,
    lastUpdated: now,
    lastEntryAt: now
  };

  const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId);
  await setDoc(threadRef, thread);

  console.log(`[ThreadManager] Created thread: ${displayName} (${threadId})`);
  return thread;
};

/**
 * Append an entry to an existing thread
 * @param {string} userId
 * @param {string} threadId
 * @param {Object} updateData
 * @returns {Promise<void>}
 */
export const appendToThread = async (userId, threadId, updateData) => {
  const { entryId, sentiment, somaticSignals = [] } = updateData;

  const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId);
  const threadDoc = await getDoc(threadRef);

  if (!threadDoc.exists()) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const thread = threadDoc.data();
  const now = Timestamp.now();

  // Update sentiment history (keep last 3)
  let newSentimentHistory = [...(thread.sentimentHistory || [])];
  if (sentiment !== undefined) {
    newSentimentHistory.push(sentiment);
    if (newSentimentHistory.length > MAX_SENTIMENT_HISTORY) {
      newSentimentHistory = newSentimentHistory.slice(-MAX_SENTIMENT_HISTORY);
    }
  }

  // Calculate new baseline
  const newBaseline = newSentimentHistory.length > 0
    ? newSentimentHistory.reduce((a, b) => a + b, 0) / newSentimentHistory.length
    : thread.sentimentBaseline;

  // Merge somatic signals
  const existingSignals = new Set(thread.somaticSignals || []);
  const validNewSignals = somaticSignals.filter(s => SOMATIC_TAXONOMY.includes(s));
  validNewSignals.forEach(s => existingSignals.add(s));

  await updateDoc(threadRef, {
    entryIds: arrayUnion(entryId),
    entryCount: (thread.entryCount || 0) + 1,
    sentimentHistory: newSentimentHistory,
    sentimentBaseline: newBaseline,
    somaticSignals: Array.from(existingSignals),
    lastUpdated: now,
    lastEntryAt: now
  });

  console.log(`[ThreadManager] Appended entry ${entryId} to thread ${threadId}`);
};

/**
 * Resolve (close) a thread
 * @param {string} userId
 * @param {string} threadId
 * @returns {Promise<void>}
 */
export const resolveThread = async (userId, threadId) => {
  const threadRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId);

  await updateDoc(threadRef, {
    status: 'resolved',
    lastUpdated: Timestamp.now()
  });

  console.log(`[ThreadManager] Resolved thread: ${threadId}`);
};

// ============================================================
// LLM THREAD IDENTIFICATION
// ============================================================

/**
 * Build the prompt for thread identification
 * @param {string} entryText
 * @param {Array} activeThreads
 * @returns {string}
 */
const buildThreadIdentificationPrompt = (entryText, activeThreads) => {
  const threadList = activeThreads.length > 0
    ? activeThreads.map(t => `- "${t.displayName}" (${t.category})`).join('\n')
    : 'No active threads yet.';

  return `You are analyzing a journal entry to identify thematic connections.

ACTIVE THREADS:
${threadList}

JOURNAL ENTRY:
"${entryText}"

TASK:
1. Determine if this entry continues an existing thread OR starts a new one
2. Extract any somatic (body) signals mentioned
3. Estimate the emotional sentiment (0-1 scale)

SOMATIC TAXONOMY (only use these):
- pain (physical pain - knee, back, head, etc.)
- tension (physical stress, tightness)
- fatigue (tiredness, low energy)
- respiratory (breathing, illness symptoms)
- cognitive (brain fog, focus issues, mental fatigue)

RESPONSE FORMAT (JSON only, no markdown):
{
  "thread": {
    "action": "continue" | "new",
    "existingThreadName": "exact name if continuing, null if new",
    "proposedName": "short descriptive name if new, null if continuing",
    "category": "career" | "health" | "relationship" | "growth" | "somatic"
  },
  "somaticSignals": ["pain", "fatigue"],
  "sentiment": 0.72,
  "confidence": 0.85
}`;
};

/**
 * Parse LLM response for thread identification
 * @param {string} response
 * @returns {Object|null}
 */
const parseThreadResponse = (response) => {
  try {
    // Handle potential markdown code blocks
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate structure
    if (!parsed.thread || !parsed.thread.action) {
      console.warn('[ThreadManager] Invalid LLM response structure');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ThreadManager] Failed to parse LLM response:', error);
    return null;
  }
};

/**
 * Identify thread association for an entry using LLM
 * @param {string} userId
 * @param {string} entryId
 * @param {string} entryText
 * @param {number} [sentiment] - Pre-computed sentiment if available
 * @returns {Promise<Object>} Thread association result
 */
export const identifyThreadAssociation = async (userId, entryId, entryText, sentiment = null) => {
  if (!userId || !entryText) {
    return { success: false, error: 'Missing required parameters' };
  }

  try {
    // 1. Get active threads
    const activeThreads = await getActiveThreads(userId);

    // 2. Call LLM for thread identification
    const prompt = buildThreadIdentificationPrompt(entryText, activeThreads.slice(0, 5));

    let llmResult;
    try {
      const response = await callGemini(prompt, '');
      llmResult = parseThreadResponse(response);
    } catch (llmError) {
      console.warn('[ThreadManager] LLM failed, using fallback:', llmError.message);
      return await fallbackThreadIdentification(userId, entryId, entryText, sentiment);
    }

    if (!llmResult) {
      return await fallbackThreadIdentification(userId, entryId, entryText, sentiment);
    }

    const { thread, somaticSignals, sentiment: llmSentiment, confidence } = llmResult;
    const finalSentiment = sentiment ?? llmSentiment ?? 0.5;

    // 3. Handle thread action
    if (thread.action === 'continue' && thread.existingThreadName) {
      // Find the matching thread
      const matchedThread = activeThreads.find(
        t => normalizeThreadName(t.displayName) === normalizeThreadName(thread.existingThreadName)
      );

      if (matchedThread) {
        await appendToThread(userId, matchedThread.id, {
          entryId,
          sentiment: finalSentiment,
          somaticSignals
        });

        return {
          success: true,
          action: 'appended',
          threadId: matchedThread.id,
          threadName: matchedThread.displayName,
          somaticSignals,
          confidence
        };
      }
    }

    // 4. Creating new thread - check for similar existing first
    const proposedName = thread.proposedName || 'Unnamed Thread';
    const embedding = await generateEmbedding(proposedName).catch(() => null);
    const similarThread = await findSimilarThread(proposedName, activeThreads, embedding);

    if (similarThread) {
      // Deduplicated - append to similar thread instead
      await appendToThread(userId, similarThread.id, {
        entryId,
        sentiment: finalSentiment,
        somaticSignals
      });

      return {
        success: true,
        action: 'deduplicated',
        threadId: similarThread.id,
        threadName: similarThread.displayName,
        originalProposal: proposedName,
        somaticSignals,
        confidence
      };
    }

    // 5. Create genuinely new thread
    const newThread = await createThread(userId, {
      displayName: proposedName,
      category: thread.category,
      sentiment: finalSentiment,
      somaticSignals,
      entryId
    });

    return {
      success: true,
      action: 'created',
      threadId: newThread.id,
      threadName: newThread.displayName,
      somaticSignals,
      confidence
    };

  } catch (error) {
    console.error('[ThreadManager] Thread identification failed:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fallback thread identification when LLM is unavailable
 * Uses continues_situation metadata if present
 * @param {string} userId
 * @param {string} entryId
 * @param {string} entryText
 * @param {number} sentiment
 * @returns {Promise<Object>}
 */
const fallbackThreadIdentification = async (userId, entryId, entryText, sentiment) => {
  console.log('[ThreadManager] Using fallback thread identification');

  // Simple keyword-based somatic detection
  const somaticSignals = [];
  const text = entryText.toLowerCase();

  if (/pain|hurt|sore|ache|knee|back|head/.test(text)) somaticSignals.push('pain');
  if (/tense|tight|stress|clench/.test(text)) somaticSignals.push('tension');
  if (/tired|exhaust|fatigue|drain|sleepy/.test(text)) somaticSignals.push('fatigue');
  if (/breath|cough|sick|cold|flu/.test(text)) somaticSignals.push('respiratory');
  if (/fog|focus|concentrat|brain/.test(text)) somaticSignals.push('cognitive');

  return {
    success: true,
    action: 'fallback',
    threadId: null,
    threadName: null,
    somaticSignals,
    confidence: 0.3,
    note: 'LLM unavailable - entry processed with local heuristics'
  };
};
```

### 3.3 `src/services/causalnexus/correlationEngine.js`

```javascript
/**
 * Correlation Engine
 *
 * Cross-references semantic threads with biometric data
 * to surface causal insights.
 */

import { getActiveThreads } from './threadManager';
import { getWhoopSummary, isWhoopLinked } from '../health/whoop';

// ============================================================
// CORRELATION PATTERN DEFINITIONS
// ============================================================

/**
 * The 8 launch correlation patterns
 * Each pattern defines narrative triggers, biometric triggers, and insight templates
 */
export const CORRELATION_PATTERNS = {
  SOMATIC_OVEREXERTION: {
    id: 'somatic_overexertion',
    name: 'Somatic Overexertion',
    narrativeTriggers: ['pain', 'sore', 'knee', 'back', 'injury', 'hurt'],
    biometricCheck: (whoop, baseline) => whoop.strain?.score > (baseline?.strain || 10),
    insightTemplate: (data) => ({
      type: 'Somatic Overexertion',
      strength: 0.85,
      insight: `Your narrative mentions ${data.trigger} while your Whoop Strain is ${Math.round((data.strainDelta || 0) * 100)}% above your baseline. Your activity may be aggravating the issue.`,
      evidence: {
        narrative: data.trigger,
        biometric: `Strain: ${data.whoop.strain?.score?.toFixed(1) || 'N/A'}`
      },
      recommendation: 'Consider a recovery day or lower-intensity activity.'
    })
  },

  ADRENALINE_BUFFER: {
    id: 'adrenaline_buffer',
    name: 'Adrenaline Buffer',
    narrativeTriggers: ['great', 'excited', 'amazing', 'fantastic', 'ecstatic', 'thrilled'],
    biometricCheck: (whoop) => whoop.recovery?.score < 35,
    insightTemplate: (data) => ({
      type: 'The Adrenaline Buffer',
      strength: 0.78,
      insight: `You're feeling ${data.trigger} narratively, but your recovery is at ${data.whoop.recovery?.score}%. You may be running on adrenaline—watch for a crash.`,
      evidence: {
        narrative: `Positive sentiment (${data.trigger})`,
        biometric: `Recovery: ${data.whoop.recovery?.score}% (${data.whoop.recovery?.status})`
      },
      recommendation: 'Prioritize sleep tonight. Your body needs to catch up with your mind.'
    })
  },

  SLEEP_DEBT_IMPACT: {
    id: 'sleep_debt_impact',
    name: 'Sleep Debt Impact',
    narrativeTriggers: ['tired', 'foggy', 'focus', 'exhausted', 'drained', 'sleepy'],
    biometricCheck: (whoop) => whoop.sleep?.totalHours < 6.5,
    insightTemplate: (data) => ({
      type: 'Sleep Debt Impact',
      strength: 0.82,
      insight: `You're mentioning "${data.trigger}" after only ${data.whoop.sleep?.totalHours?.toFixed(1)} hours of sleep. The cognitive impact typically peaks 24 hours after poor sleep.`,
      evidence: {
        narrative: data.trigger,
        biometric: `Sleep: ${data.whoop.sleep?.totalHours?.toFixed(1)}h (${data.whoop.sleep?.quality || 'unknown'} quality)`
      },
      recommendation: 'Aim for an earlier bedtime tonight to reset your cognitive baseline.'
    })
  },

  MOVEMENT_MEDICINE: {
    id: 'movement_medicine',
    name: 'Movement Medicine',
    narrativeTriggers: ['exercise', 'workout', 'yoga', 'walk', 'run', 'gym', 'sterling'],
    biometricCheck: (whoop, baseline, threadData) => threadData?.moodDelta > 0.2,
    insightTemplate: (data) => ({
      type: 'Movement Medicine',
      strength: 0.75,
      insight: `Entries mentioning "${data.trigger}" show a ${Math.round((data.moodDelta || 0.2) * 100)}% mood boost. Movement is clearly your medicine.`,
      evidence: {
        narrative: `Activity mention: ${data.trigger}`,
        biometric: data.whoop.workouts?.length > 0
          ? `Today's workout: ${data.whoop.workouts[0]?.type || 'Activity'}`
          : 'Movement pattern detected'
      },
      recommendation: 'Keep this anchor in your routine—it\'s working for you.'
    })
  },

  WORK_STRESS_SOMATICS: {
    id: 'work_stress_somatics',
    name: 'Work Stress Somatics',
    narrativeTriggers: ['work', 'job', 'boss', 'deadline', 'meeting', 'project', 'pierre'],
    biometricCheck: (whoop, baseline) => {
      const currentHRV = whoop.hrv?.average;
      const baselineHRV = baseline?.hrv || 50;
      return currentHRV && currentHRV < baselineHRV * 0.85;
    },
    insightTemplate: (data) => ({
      type: 'Work Stress Somatics',
      strength: 0.80,
      insight: `Your work-related entries correlate with HRV drops. Career stress is physically tightening your nervous system.`,
      evidence: {
        narrative: `Work context: ${data.trigger}`,
        biometric: `HRV: ${data.whoop.hrv?.average?.toFixed(0)}ms (${data.whoop.hrv?.stressIndicator} stress)`
      },
      recommendation: 'Try a 2-minute breathing exercise before your next stressful meeting.'
    })
  },

  RECOVERY_PARADOX: {
    id: 'recovery_paradox',
    name: 'Recovery Paradox',
    narrativeTriggers: ['calm', 'chill', 'resting', 'relaxed', 'easy', 'lazy'],
    biometricCheck: (whoop) => whoop.strain?.score > 14,
    insightTemplate: (data) => ({
      type: 'The Recovery Paradox',
      strength: 0.72,
      insight: `You describe feeling "${data.trigger}" but your strain is ${data.whoop.strain?.score?.toFixed(1)}. Your body is still "on" even when your mind feels off.`,
      evidence: {
        narrative: `Rest narrative: ${data.trigger}`,
        biometric: `Strain: ${data.whoop.strain?.score?.toFixed(1)} (elevated)`
      },
      recommendation: 'True recovery might need more intentional downtime—consider a screen-free evening.'
    })
  },

  SOCIAL_STABILIZATION: {
    id: 'social_stabilization',
    name: 'Social Stabilization',
    narrativeTriggers: ['spencer', 'sterling', 'friend', 'family', 'together', 'hangout'],
    biometricCheck: (whoop) => whoop.recovery?.score > 60,
    insightTemplate: (data) => ({
      type: 'Social Stabilization',
      strength: 0.70,
      insight: `Entries mentioning "${data.trigger}" coincide with recovery scores above 60%. These relationships are proactively boosting your resilience.`,
      evidence: {
        narrative: `Social anchor: ${data.trigger}`,
        biometric: `Recovery: ${data.whoop.recovery?.score}% (${data.whoop.recovery?.status})`
      },
      recommendation: 'These connections are protective. Prioritize them, especially during stressful periods.'
    })
  },

  BURNOUT_LEAD_INDICATOR: {
    id: 'burnout_lead_indicator',
    name: 'Burnout Lead Indicator',
    narrativeTriggers: ['busy', 'overwhelmed', 'swamped', 'crazy', 'nonstop', 'drowning'],
    biometricCheck: (whoop, baseline) => {
      const currentRHR = whoop.heartRate?.resting;
      const baselineRHR = baseline?.rhr || 55;
      return currentRHR && currentRHR > baselineRHR * 1.1;
    },
    insightTemplate: (data) => ({
      type: 'Burnout Lead Indicator',
      strength: 0.88,
      insight: `Your "${data.trigger}" narrative combined with elevated resting heart rate suggests your body is signaling overload. This often precedes burnout by 1-2 weeks.`,
      evidence: {
        narrative: `Overwhelm signal: ${data.trigger}`,
        biometric: `Resting HR: ${data.whoop.heartRate?.resting} bpm (elevated)`
      },
      recommendation: 'This is an early warning. Consider canceling one commitment this week.'
    })
  }
};

// ============================================================
// USER BASELINE MANAGEMENT
// ============================================================

/**
 * Get user's baseline metrics (rolling averages)
 * In production, this would be computed from historical Whoop data
 * For now, we use sensible defaults that can be personalized
 */
const getUserBaseline = async (userId) => {
  // TODO: Compute from users/{uid}/health/baseline collection
  // For now, return population defaults
  return {
    strain: 10.0,
    hrv: 50,
    rhr: 55,
    sleepHours: 7.5
  };
};

// ============================================================
// CORRELATION CALCULATION
// ============================================================

/**
 * Find narrative triggers in thread data
 * @param {Array} threads - Active threads
 * @param {Array} triggers - Trigger words to search
 * @returns {Object|null} - Matched trigger info
 */
const findNarrativeTrigger = (threads, triggers) => {
  for (const thread of threads) {
    const threadName = thread.displayName?.toLowerCase() || '';
    const somaticSignals = thread.somaticSignals || [];

    for (const trigger of triggers) {
      if (threadName.includes(trigger.toLowerCase())) {
        return { trigger, threadId: thread.id, threadName: thread.displayName };
      }

      // Check somatic signals
      if (somaticSignals.some(s => s.toLowerCase().includes(trigger.toLowerCase()))) {
        return { trigger, threadId: thread.id, threadName: thread.displayName, isSomatic: true };
      }
    }
  }

  return null;
};

/**
 * Calculate the strongest causal correlation
 * @param {Array} threads - Active semantic threads
 * @param {Object} whoop - Today's Whoop summary
 * @param {Object} baseline - User's baseline metrics
 * @returns {Object|null} - Strongest correlation or null
 */
export const calculateCausalCorrelation = async (threads, whoop, baseline) => {
  if (!threads || threads.length === 0 || !whoop || !whoop.available) {
    return null;
  }

  const correlations = [];

  // Check each pattern
  for (const [key, pattern] of Object.entries(CORRELATION_PATTERNS)) {
    const narrativeMatch = findNarrativeTrigger(threads, pattern.narrativeTriggers);

    if (!narrativeMatch) continue;

    // Get thread data for mood delta calculation
    const thread = threads.find(t => t.id === narrativeMatch.threadId);
    const threadData = {
      moodDelta: thread?.sentimentBaseline ? thread.sentimentBaseline - 0.5 : 0
    };

    // Check biometric condition
    const biometricMatch = pattern.biometricCheck(whoop, baseline, threadData);

    if (biometricMatch) {
      const insight = pattern.insightTemplate({
        trigger: narrativeMatch.trigger,
        whoop,
        strainDelta: baseline?.strain ? (whoop.strain?.score - baseline.strain) / baseline.strain : 0,
        moodDelta: threadData.moodDelta,
        threadName: narrativeMatch.threadName
      });

      correlations.push({
        patternId: pattern.id,
        patternName: pattern.name,
        ...insight,
        threadId: narrativeMatch.threadId,
        threadName: narrativeMatch.threadName
      });
    }
  }

  if (correlations.length === 0) {
    return null;
  }

  // Return strongest correlation
  correlations.sort((a, b) => b.strength - a.strength);
  return correlations[0];
};

/**
 * Get correlation for today (main entry point for hook)
 * @param {string} userId
 * @returns {Promise<Object>} Correlation result with metadata
 */
export const getCorrelationForToday = async (userId) => {
  const result = {
    correlation: null,
    activeThreads: [],
    isLoading: false,
    isDegraded: false,
    error: null
  };

  try {
    // Check Whoop linkage
    const whoopLinked = await isWhoopLinked();

    if (!whoopLinked) {
      result.isDegraded = true;
      result.degradedReason = 'whoop_not_linked';
      return result;
    }

    // Fetch data in parallel
    const [threads, whoop, baseline] = await Promise.all([
      getActiveThreads(userId),
      getWhoopSummary(),
      getUserBaseline(userId)
    ]);

    result.activeThreads = threads;

    if (!whoop?.available) {
      result.isDegraded = true;
      result.degradedReason = 'whoop_data_unavailable';
      return result;
    }

    if (threads.length === 0) {
      result.isDegraded = true;
      result.degradedReason = 'no_threads';
      return result;
    }

    // Calculate correlation
    const correlation = await calculateCausalCorrelation(threads, whoop, baseline);

    if (!correlation || correlation.strength < 0.5) {
      result.isDegraded = true;
      result.degradedReason = correlation ? 'low_confidence' : 'no_correlation';
      result.correlation = correlation; // Still include for debugging
      return result;
    }

    result.correlation = correlation;
    return result;

  } catch (error) {
    console.error('[CorrelationEngine] Failed to get correlation:', error);
    result.error = error.message;
    result.isDegraded = true;
    return result;
  }
};
```

### 3.4 `src/hooks/useCausalNexus.js`

```javascript
/**
 * useCausalNexus Hook
 *
 * Provides causal correlation data for the dashboard.
 * Connects semantic threads with biometric data to surface insights.
 */

import { useState, useEffect, useCallback } from 'react';
import { getCorrelationForToday, getActiveThreads } from '../services/causalnexus';

/**
 * Hook for accessing Causal Nexus data
 * @param {string} userId - Current user ID
 * @returns {Object} Causal nexus state and actions
 */
export const useCausalNexus = (userId) => {
  const [state, setState] = useState({
    correlation: null,
    activeThreads: [],
    isLoading: true,
    isDegraded: false,
    degradedReason: null,
    error: null,
    lastUpdated: null
  });

  /**
   * Fetch correlation data
   */
  const fetchCorrelation = useCallback(async () => {
    if (!userId) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        isDegraded: true,
        degradedReason: 'no_user'
      }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const result = await getCorrelationForToday(userId);

      setState({
        correlation: result.correlation,
        activeThreads: result.activeThreads || [],
        isLoading: false,
        isDegraded: result.isDegraded || false,
        degradedReason: result.degradedReason || null,
        error: result.error || null,
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error('[useCausalNexus] Fetch failed:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        isDegraded: true,
        error: error.message
      }));
    }
  }, [userId]);

  /**
   * Refresh correlation data
   */
  const refresh = useCallback(() => {
    fetchCorrelation();
  }, [fetchCorrelation]);

  // Initial fetch
  useEffect(() => {
    fetchCorrelation();
  }, [fetchCorrelation]);

  // Refresh every 30 minutes while mounted
  useEffect(() => {
    const interval = setInterval(fetchCorrelation, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchCorrelation]);

  return {
    // State
    correlation: state.correlation,
    activeThreads: state.activeThreads,
    isLoading: state.isLoading,
    isDegraded: state.isDegraded,
    degradedReason: state.degradedReason,
    error: state.error,
    lastUpdated: state.lastUpdated,

    // Actions
    refresh
  };
};

export default useCausalNexus;
```

### 3.5 `src/components/zen/widgets/CausalBiteWidget.jsx`

```javascript
/**
 * CausalBiteWidget
 *
 * Visualizes causal correlations between journal narratives
 * and biometric data on the Bento dashboard.
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Brain,
  Heart,
  AlertTriangle,
  Zap,
  Moon,
  Users,
  Flame,
  ArrowRight,
  Loader2
} from 'lucide-react';
import GlassCard from '../GlassCard';
import { useCausalNexus } from '../../../hooks/useCausalNexus';

// Icon mapping for correlation types
const CORRELATION_ICONS = {
  'Somatic Overexertion': Activity,
  'The Adrenaline Buffer': Zap,
  'Sleep Debt Impact': Moon,
  'Movement Medicine': Heart,
  'Work Stress Somatics': Brain,
  'The Recovery Paradox': AlertTriangle,
  'Social Stabilization': Users,
  'Burnout Lead Indicator': Flame
};

// Color mapping for correlation types
const CORRELATION_COLORS = {
  'Somatic Overexertion': 'text-red-400',
  'The Adrenaline Buffer': 'text-yellow-400',
  'Sleep Debt Impact': 'text-blue-400',
  'Movement Medicine': 'text-green-400',
  'Work Stress Somatics': 'text-purple-400',
  'The Recovery Paradox': 'text-orange-400',
  'Social Stabilization': 'text-teal-400',
  'Burnout Lead Indicator': 'text-red-500'
};

/**
 * Skeleton loader for learning state
 */
const NexusLearningState = () => (
  <div className="flex flex-col h-full justify-center items-center p-4 text-center">
    <motion.div
      animate={{
        opacity: [0.5, 1, 0.5],
        scale: [0.98, 1, 0.98]
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut"
      }}
      className="mb-3"
    >
      <Brain className="w-8 h-8 text-warm-400/50" />
    </motion.div>

    <p className="text-warm-300/70 text-sm">
      Observing your mind-body patterns...
    </p>
    <p className="text-warm-400/50 text-xs mt-1">
      Keep logging to unlock causal insights
    </p>

    {/* Skeleton bars */}
    <div className="mt-4 w-full space-y-2">
      <motion.div
        className="h-2 bg-warm-700/30 rounded"
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
      <motion.div
        className="h-2 bg-warm-700/30 rounded w-3/4"
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
      />
    </div>
  </div>
);

/**
 * Active correlation display
 */
const NexusActiveState = ({ correlation }) => {
  const Icon = CORRELATION_ICONS[correlation.type] || Brain;
  const colorClass = CORRELATION_COLORS[correlation.type] || 'text-warm-400';

  return (
    <div className="flex flex-col h-full p-3">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-5 h-5 ${colorClass}`} />
        <span className={`text-xs font-medium ${colorClass}`}>
          {correlation.type}
        </span>
        <span className="ml-auto text-xs text-warm-500">
          {Math.round(correlation.strength * 100)}% match
        </span>
      </div>

      {/* Evidence Bridge */}
      <div className="flex items-center gap-2 mb-3 text-xs">
        <div className="flex-1 bg-warm-800/50 rounded px-2 py-1 truncate">
          <span className="text-warm-400">{correlation.evidence?.narrative}</span>
        </div>
        <ArrowRight className="w-3 h-3 text-warm-500 flex-shrink-0" />
        <div className="flex-1 bg-warm-800/50 rounded px-2 py-1 truncate">
          <span className="text-warm-400">{correlation.evidence?.biometric}</span>
        </div>
      </div>

      {/* Insight */}
      <p className="text-warm-200 text-sm leading-relaxed flex-1">
        {correlation.insight}
      </p>

      {/* Recommendation */}
      {correlation.recommendation && (
        <div className="mt-2 pt-2 border-t border-warm-700/50">
          <p className="text-warm-400 text-xs italic">
            {correlation.recommendation}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Main CausalBite Widget Component
 */
const CausalBiteWidget = ({
  user,
  isEditing = false,
  onDelete,
  size = '2x1'
}) => {
  const {
    correlation,
    isLoading,
    isDegraded,
    degradedReason
  } = useCausalNexus(user?.uid);

  // Determine what to render
  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 text-warm-400 animate-spin" />
        </div>
      );
    }

    if (isDegraded || !correlation) {
      return <NexusLearningState />;
    }

    return <NexusActiveState correlation={correlation} />;
  };

  return (
    <GlassCard
      size={size}
      isEditing={isEditing}
      onDelete={onDelete}
      className="overflow-hidden"
    >
      {renderContent()}
    </GlassCard>
  );
};

export default CausalBiteWidget;
```

---

## Part 4: Modified Files

### 4.1 `src/services/background/entryPostProcessing.js` (MODIFIED)

**Changes**: Add thread identification as a new background task.

```javascript
// ADD these imports at top
import { identifyThreadAssociation } from '../threads';

// MODIFY runEntryPostProcessing function - ADD Task 3

export const runEntryPostProcessing = async ({
  userId,
  entryId,        // ADD this parameter
  entryContent = '',
  analysis = null
}) => {
  if (!userId) return;

  // Run all background tasks in parallel
  const tasks = [];

  // Task 1: Core People cache refresh (if person mentioned) - EXISTING
  const hasPerson = detectPersonMention(entryContent, analysis);
  if (hasPerson && shouldRefreshCache()) {
    tasks.push(refreshCorePeopleCacheBackground(userId));
  }

  // Task 2: Invalidate pattern cache - EXISTING
  tasks.push(invalidatePatternCacheBackground(userId));

  // Task 3: Thread identification - NEW
  // Skip short entries to save LLM costs (refined per review)
  const MIN_CONTENT_LENGTH_FOR_THREAD = 50;
  if (entryId && entryContent.length >= MIN_CONTENT_LENGTH_FOR_THREAD) {
    tasks.push(identifyThreadBackground(userId, entryId, entryContent, analysis));
  }

  // Execute all tasks (fire and forget)
  if (tasks.length > 0) {
    Promise.allSettled(tasks).then(results => {
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn('[PostProcessing] Some background tasks failed:', failures);
      }
    });
  }
};

// ADD this new function
/**
 * Background thread identification
 * Associates entry with semantic threads via LLM
 */
const identifyThreadBackground = async (userId, entryId, entryContent, analysis) => {
  try {
    console.log('[PostProcessing] Identifying thread association...');

    const sentiment = analysis?.mood_score;
    const result = await identifyThreadAssociation(userId, entryId, entryContent, sentiment);

    if (result.success) {
      console.log(`[PostProcessing] Thread ${result.action}: ${result.threadName || 'N/A'}`);
    } else {
      console.warn('[PostProcessing] Thread identification returned:', result);
    }
  } catch (error) {
    console.error('[PostProcessing] Thread identification failed:', error);
    // Don't rethrow - this is a background task
  }
};
```

### 4.2 `src/App.jsx` (MODIFIED)

**Changes**: Pass `entryId` to post-processing. Find the existing call (~line 1000-1004).

```javascript
// FIND this existing code block (approximately lines 1000-1004):
runEntryPostProcessing({
  userId: user.uid,
  entryContent: finalTex,
  analysis: updateData.analysis
});

// REPLACE WITH:
runEntryPostProcessing({
  userId: user.uid,
  entryId: entryRef.id,  // ADD this line
  entryContent: finalTex,
  analysis: updateData.analysis
});
```

### 4.3 `src/components/zen/widgets/index.js` (MODIFIED)

**Changes**: Register CausalBiteWidget.

```javascript
// ADD import at top
import CausalBiteWidget from './CausalBiteWidget';

// MODIFY WIDGET_COMPONENTS object - ADD entry
const WIDGET_COMPONENTS = {
  hero: HeroWidget,
  prompt: PromptWidget,
  stats: MiniStatsWidget,
  tasks: TasksWidget,
  goals: GoalsWidget,
  heatmap: MoodHeatmapWidget,
  stories: StoriesWidget,
  nexus: CausalBiteWidget,  // ADD this line
  // Future widgets
  trend: null,
  digest: null,
};
```

### 4.4 `src/hooks/useDashboardLayout.js` (MODIFIED)

**Changes**: Add CausalBite to widget definitions.

```javascript
// FIND WIDGET_DEFINITIONS object and ADD this entry:

const WIDGET_DEFINITIONS = {
  // ... existing widgets ...

  // ADD this new widget definition
  causal_nexus: {
    id: 'causal_nexus',
    type: 'nexus',
    name: 'Mind-Body Nexus',
    description: 'See how your journal connects with your biometrics',
    defaultSize: '2x1',
    icon: 'Brain'
  },
};
```

### 4.5 `src/services/patterns/insightRotation.js` (MODIFIED)

**Changes**: Add per-thread cooldown support with sentiment delta bypass.

```javascript
// ADD these constants at top
const THREAD_COOLDOWN_HOURS = 48;
const SENTIMENT_DELTA_THRESHOLD = 0.20;

// ADD these new functions

/**
 * Get thread cooldown state from Firestore
 * @param {string} userId
 * @returns {Promise<Object>}
 */
export const getThreadCooldowns = async (userId) => {
  try {
    const stateRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'insight_state');
    const stateDoc = await getDoc(stateRef);

    if (!stateDoc.exists()) {
      return {};
    }

    return stateDoc.data().thread_cooldowns || {};
  } catch (error) {
    console.error('[InsightRotation] Failed to get thread cooldowns:', error);
    return {};
  }
};

/**
 * Update thread cooldown after showing insight
 * @param {string} userId
 * @param {string} threadId
 * @param {number} currentSentiment
 */
export const updateThreadCooldown = async (userId, threadId, currentSentiment) => {
  try {
    const stateRef = doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'settings', 'insight_state');

    await setDoc(stateRef, {
      thread_cooldowns: {
        [threadId]: {
          last_shown: Timestamp.now(),
          last_sentiment_avg: currentSentiment
        }
      },
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (error) {
    console.error('[InsightRotation] Failed to update thread cooldown:', error);
  }
};

/**
 * Check if thread insight should be shown (cooldown + sentiment delta)
 * @param {Object} cooldownData - Existing cooldown data for thread
 * @param {number} currentSentiment - Current thread sentiment
 * @returns {boolean}
 */
export const shouldShowThreadInsight = (cooldownData, currentSentiment) => {
  if (!cooldownData || !cooldownData.last_shown) {
    return true; // Never shown before
  }

  const lastShown = cooldownData.last_shown.toDate?.() || new Date(cooldownData.last_shown);
  const hoursSinceShown = (Date.now() - lastShown.getTime()) / (1000 * 60 * 60);

  // Cooldown expired
  if (hoursSinceShown >= THREAD_COOLDOWN_HOURS) {
    return true;
  }

  // Check sentiment delta bypass
  const lastSentiment = cooldownData.last_sentiment_avg || 0.5;
  const sentimentDelta = Math.abs(currentSentiment - lastSentiment);

  if (sentimentDelta >= SENTIMENT_DELTA_THRESHOLD) {
    console.log(`[InsightRotation] Sentiment delta bypass: ${(sentimentDelta * 100).toFixed(1)}%`);
    return true;
  }

  return false;
};

// ADD imports at top (if not already present)
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db, APP_COLLECTION_ID } from '../firebase';
```

---

## Part 5: Backfill Script

### 5.1 `scripts/backfill-threads.js`

```javascript
#!/usr/bin/env node
/**
 * Thread Backfill Script
 *
 * Processes the last 30 days of entries to create initial semantic threads.
 * Run after a user first connects Whoop or on-demand.
 *
 * Usage: node scripts/backfill-threads.js <userId>
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { identifyThreadAssociation } from '../src/services/causalnexus/threadManager.js';

// Initialize Firebase Admin
const app = initializeApp({
  credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS)
});
const db = getFirestore(app);

const APP_COLLECTION_ID = process.env.APP_COLLECTION_ID || 'echovault';
const BACKFILL_DAYS = 30;
const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES_MS = 2000;

/**
 * Get entries from last N days
 */
async function getRecentEntries(userId, days) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const entriesRef = db
    .collection('artifacts')
    .doc(APP_COLLECTION_ID)
    .collection('users')
    .doc(userId)
    .collection('entries');

  const snapshot = await entriesRef
    .where('createdAt', '>=', Timestamp.fromDate(cutoffDate))
    .orderBy('createdAt', 'asc')
    .get();

  return snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

/**
 * Process entries in batches
 */
async function processEntries(userId, entries) {
  console.log(`Processing ${entries.length} entries in batches of ${BATCH_SIZE}...`);

  let processed = 0;
  let threadsCreated = 0;
  let entriesAppended = 0;
  let errors = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const text = entry.content || entry.text || '';
        if (text.length < 20) return { skipped: true };

        const sentiment = entry.analysis?.mood_score;
        return identifyThreadAssociation(userId, entry.id, text, sentiment);
      })
    );

    for (const result of results) {
      processed++;

      if (result.status === 'rejected') {
        errors++;
        console.error(`  Error: ${result.reason}`);
      } else if (result.value?.success) {
        if (result.value.action === 'created') {
          threadsCreated++;
          console.log(`  Created thread: ${result.value.threadName}`);
        } else if (result.value.action === 'appended' || result.value.action === 'deduplicated') {
          entriesAppended++;
        }
      }
    }

    console.log(`  Processed ${processed}/${entries.length}`);

    // Rate limiting
    if (i + BATCH_SIZE < entries.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  return { processed, threadsCreated, entriesAppended, errors };
}

/**
 * Main execution
 */
async function main() {
  const userId = process.argv[2];

  if (!userId) {
    console.error('Usage: node backfill-threads.js <userId>');
    process.exit(1);
  }

  console.log(`\n=== Thread Backfill ===`);
  console.log(`User: ${userId}`);
  console.log(`Backfill period: Last ${BACKFILL_DAYS} days\n`);

  try {
    const entries = await getRecentEntries(userId, BACKFILL_DAYS);
    console.log(`Found ${entries.length} entries\n`);

    if (entries.length === 0) {
      console.log('No entries to process.');
      return;
    }

    const stats = await processEntries(userId, entries);

    console.log(`\n=== Complete ===`);
    console.log(`Processed: ${stats.processed}`);
    console.log(`Threads created: ${stats.threadsCreated}`);
    console.log(`Entries appended: ${stats.entriesAppended}`);
    console.log(`Errors: ${stats.errors}`);

  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

main();
```

---

## Part 6: Integration Safety Analysis

### 6.1 Risk Assessment

| Component | Risk | Mitigation |
|-----------|------|------------|
| `entryPostProcessing.js` | Low | Only adds new task, doesn't modify existing tasks |
| `App.jsx` | Very Low | Single line addition (`entryId` parameter) |
| `widgets/index.js` | Very Low | Only adds new entry to component map |
| `useDashboardLayout.js` | Very Low | Only adds new widget definition |
| `insightRotation.js` | Low | New functions only, existing functions unchanged |

### 6.2 Failure Modes & Graceful Degradation

| Failure | Impact | Handling |
|---------|--------|----------|
| Gemini API down | Thread identification fails | Fallback to local heuristics, entry still saves |
| Whoop API down | No biometric data | `isDegraded: true`, CausalBite shows learning state |
| No active threads | No correlations possible | `isDegraded: true`, learning state shown |
| Firestore write fails | Thread not persisted | Logged to console, entry unaffected |
| Low correlation strength | No actionable insight | Learning state shown (strength < 0.5) |

### 6.3 Existing Functionality Protection

**Entry Save Flow** (App.jsx):
- Post-processing runs AFTER entry is saved
- All post-processing tasks are fire-and-forget
- Entry save success is independent of thread identification
- User sees success immediately; threads process in background

**Dashboard Render** (Widgets):
- CausalBiteWidget handles all error states internally
- Loading state shows spinner
- Degraded state shows learning UI
- Never throws, never blocks other widgets

**Insight System** (insightRotation.js):
- New functions are additive only
- Existing `getRotatedInsights` unchanged
- Thread cooldowns stored in separate Firestore document
- No changes to localStorage rotation logic

### 6.4 Performance Considerations

| Operation | Frequency | Cost |
|-----------|-----------|------|
| Thread identification | Per entry save | 1 Gemini call + 1 embedding |
| Correlation calculation | Dashboard load | 3 Firestore reads + 1 Whoop API |
| Thread similarity check | Per new thread | Up to 5 embedding comparisons |

**Optimizations Built In**:
- 30-minute refresh interval for correlations
- Top 5 threads only sent to LLM
- Levenshtein check before expensive embedding match
- Background processing doesn't block UI

---

## Part 7: Testing Checklist

### 7.1 Unit Tests Needed

```
[ ] threadManager.js
    [ ] normalizeThreadName handles edge cases
    [ ] levenshteinDistance calculates correctly
    [ ] findSimilarThread returns match above threshold
    [ ] findSimilarThread returns null below threshold
    [ ] createThread generates valid ID
    [ ] appendToThread updates sentiment history correctly
    [ ] parseThreadResponse handles malformed JSON
    [ ] fallbackThreadIdentification extracts somatic signals

[ ] correlationEngine.js
    [ ] Each of 8 patterns triggers correctly
    [ ] Patterns don't trigger on missing data
    [ ] calculateCausalCorrelation returns strongest match
    [ ] getCorrelationForToday handles missing Whoop gracefully

[ ] useCausalNexus.js
    [ ] Returns loading state initially
    [ ] Returns degraded state when Whoop not linked
    [ ] refresh() triggers new fetch
```

### 7.2 Integration Tests Needed

```
[ ] Entry save → thread created in Firestore
[ ] Entry save → existing thread updated
[ ] Dashboard load → correlation displayed
[ ] Whoop disconnected → learning state shown
[ ] Gemini failure → fallback used, entry saved
```

### 7.3 Manual Testing Scenarios

```
[ ] New user with no entries → learning state
[ ] User with entries, no Whoop → learning state with "connect Whoop" hint
[ ] User with Whoop + entries → correlation shown
[ ] Save entry mentioning pain + high Whoop strain → Somatic Overexertion
[ ] Save entry mentioning "great" + low recovery → Adrenaline Buffer
[ ] Thread deduplication: "Job Hunt" and "job hunt" → same thread
[ ] 48h cooldown: same thread insight not shown twice
[ ] Sentiment delta: major mood shift bypasses cooldown
```

---

## Part 8: Implementation Order

### Phase 1: Foundation (Day 1)
1. Create `src/services/causalnexus/` directory
2. Implement `threadManager.js` (without LLM, fallback only)
3. Implement `correlationEngine.js` (all 8 patterns)
4. Implement `useCausalNexus.js` hook
5. Test with mock data

### Phase 2: UI (Day 2)
1. Create `CausalBiteWidget.jsx`
2. Register in `widgets/index.js`
3. Add to `useDashboardLayout.js`
4. Test learning state and active state

### Phase 3: Integration (Day 3)
1. Modify `entryPostProcessing.js`
2. Modify `App.jsx` (add entryId)
3. Add LLM integration to threadManager
4. Test end-to-end entry → thread flow

### Phase 4: Polish (Day 4)
1. Implement saliency filter updates
2. Create backfill script
3. Test all 8 correlation patterns
4. Test degraded states

---

## Part 9: Environment Variables

No new environment variables required. Uses existing:
- `GEMINI_API_KEY` (via Cloud Functions)
- Firebase configuration (existing)
- Whoop integration (existing)

---

## Part 10: Rollout Plan

### Stage 1: Shadow Mode
- Deploy thread identification
- Log results but don't display
- Monitor for errors and LLM costs

### Stage 2: Beta Widget
- Add CausalBiteWidget to AVAILABLE_WIDGETS
- Don't add to DEFAULT_LAYOUT
- Let users manually add it

### Stage 3: Full Launch
- Add to DEFAULT_LAYOUT for new users
- Run 30-day backfill for existing users
- Monitor engagement metrics

---

## Appendix: Quick Reference

### New Files
```
src/services/causalnexus/index.js
src/services/causalnexus/threadManager.js
src/services/causalnexus/correlationEngine.js
src/hooks/useCausalNexus.js
src/components/zen/widgets/CausalBiteWidget.jsx
scripts/backfill-threads.js
```

### Modified Files
```
src/services/background/entryPostProcessing.js  (add thread task)
src/App.jsx                                      (add entryId param)
src/components/zen/widgets/index.js              (register widget)
src/hooks/useDashboardLayout.js                  (add widget def)
src/services/patterns/insightRotation.js         (add thread cooldowns)
```

### Firestore Collections
```
users/{uid}/threads/{threadId}                   (NEW)
users/{uid}/settings/insight_state               (NEW)
```
