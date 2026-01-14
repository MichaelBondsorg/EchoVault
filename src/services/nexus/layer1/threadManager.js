/**
 * Thread Manager
 *
 * Manages semantic threads with full metamorphosis support.
 * Threads track ongoing storylines across entries with evolution tracking.
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
import { db } from '../../../config/firebase';
import { APP_COLLECTION_ID } from '../../../config/constants';
import { callGemini } from '../../ai/gemini';
import { generateEmbedding, cosineSimilarity } from '../../ai/embeddings';
import { extractSomaticSignals, SOMATIC_TAXONOMY } from './somaticExtractor';

// ============================================================
// CONSTANTS
// ============================================================

const THREAD_CATEGORIES = [
  'career', 'health', 'relationship', 'growth', 'somatic',
  'financial', 'housing', 'creative', 'social'
];

const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;
const EVOLUTION_SIMILARITY_THRESHOLD = 0.50;
const MIN_CONTENT_LENGTH = 50;
const MAX_ACTIVE_THREADS = 10;

// ============================================================
// THREAD RETRIEVAL
// ============================================================

/**
 * Get all active threads for a user
 */
export const getActiveThreads = async (userId) => {
  if (!userId) return [];

  try {
    const threadsRef = collection(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads'
    );

    const q = query(
      threadsRef,
      where('status', 'in', ['active', 'evolved']),
      orderBy('lastUpdated', 'desc'),
      limit(MAX_ACTIVE_THREADS)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('[ThreadManager] Failed to get threads:', error);
    return [];
  }
};

/**
 * Get thread by ID
 */
export const getThread = async (userId, threadId) => {
  if (!userId || !threadId) return null;

  try {
    const threadRef = doc(
      db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
    );
    const threadDoc = await getDoc(threadRef);

    if (!threadDoc.exists()) return null;
    return { id: threadDoc.id, ...threadDoc.data() };
  } catch (error) {
    console.error('[ThreadManager] Failed to get thread:', error);
    return null;
  }
};

/**
 * Get full thread lineage (root to current)
 */
export const getThreadLineage = async (userId, threadId) => {
  const thread = await getThread(userId, threadId);
  if (!thread) return [];

  const lineage = [thread];

  // Walk backward to root
  let currentId = thread.predecessorId;
  while (currentId) {
    const predecessor = await getThread(userId, currentId);
    if (!predecessor) break;
    lineage.unshift(predecessor);
    currentId = predecessor.predecessorId;
  }

  return lineage;
};

/**
 * Get thread descendants (current to latest)
 */
export const getThreadDescendants = async (userId, threadId) => {
  const thread = await getThread(userId, threadId);
  if (!thread) return [];

  const descendants = [thread];

  let currentId = thread.successorId;
  while (currentId) {
    const successor = await getThread(userId, currentId);
    if (!successor) break;
    descendants.push(successor);
    currentId = successor.successorId;
  }

  return descendants;
};

// ============================================================
// SIMILARITY & MATCHING
// ============================================================

const normalizeThreadName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const calculateNameSimilarity = (name1, name2) => {
  const n1 = normalizeThreadName(name1);
  const n2 = normalizeThreadName(name2);

  // Levenshtein distance
  const matrix = [];
  for (let i = 0; i <= n2.length; i++) matrix[i] = [i];
  for (let j = 0; j <= n1.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= n2.length; i++) {
    for (let j = 1; j <= n1.length; j++) {
      if (n2.charAt(i - 1) === n1.charAt(j - 1)) {
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

  const maxLen = Math.max(n1.length, n2.length);
  if (maxLen === 0) return 1;
  return 1 - (matrix[n2.length][n1.length] / maxLen);
};

/**
 * Find similar thread using semantic matching
 */
export const findSimilarThread = async (proposedName, activeThreads, embedding = null) => {
  if (!activeThreads?.length) return null;

  // 1. Try semantic embedding match (primary)
  if (embedding) {
    for (const thread of activeThreads) {
      if (thread.embedding) {
        const similarity = cosineSimilarity(embedding, thread.embedding);
        if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
          console.log(`[ThreadManager] Semantic match: "${proposedName}" → "${thread.displayName}" (${(similarity * 100).toFixed(1)}%)`);
          return { thread, matchType: 'semantic', similarity };
        }
      }
    }
  }

  // 2. Try name similarity for exact matches
  for (const thread of activeThreads) {
    const similarity = calculateNameSimilarity(proposedName, thread.displayName);
    if (similarity >= 0.95) {
      console.log(`[ThreadManager] Name match: "${proposedName}" → "${thread.displayName}"`);
      return { thread, matchType: 'exact', similarity };
    }
  }

  return null;
};

/**
 * Find potential evolution candidates
 */
export const findEvolutionCandidates = async (proposedName, category, activeThreads, embedding = null) => {
  const candidates = [];

  // Filter to same category
  const sameCategoryThreads = activeThreads.filter(t => t.category === category);

  for (const thread of sameCategoryThreads) {
    let similarity = 0;

    if (embedding && thread.embedding) {
      similarity = cosineSimilarity(embedding, thread.embedding);
    }

    // Threads in same category with moderate similarity are evolution candidates
    if (similarity >= EVOLUTION_SIMILARITY_THRESHOLD && similarity < SEMANTIC_SIMILARITY_THRESHOLD) {
      candidates.push({
        thread,
        similarity,
        potentialEvolution: true
      });
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity);
};

// ============================================================
// THREAD CREATION & UPDATES
// ============================================================

const generateThreadId = (name) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `${slug}-${Date.now()}`;
};

/**
 * Create a new thread
 */
export const createThread = async (userId, threadData) => {
  const {
    displayName,
    category,
    sentiment,
    somaticSignals = [],
    entryId,
    rootThreadId = null,
    predecessorId = null,
    evolutionType = null,
    evolutionContext = null
  } = threadData;

  const threadId = generateThreadId(displayName);
  const now = Timestamp.now();

  // Generate embedding
  let embedding = null;
  try {
    embedding = await generateEmbedding(displayName);
  } catch (error) {
    console.warn('[ThreadManager] Embedding generation failed:', error);
  }

  // Get valid somatic signal IDs
  const validSomaticIds = Object.values(SOMATIC_TAXONOMY).map(t => t.id);

  const thread = {
    id: threadId,
    displayName,
    category: THREAD_CATEGORIES.includes(category) ? category : 'growth',
    status: 'active',

    // Metamorphosis tracking
    rootThreadId: rootThreadId || threadId,
    predecessorId,
    successorId: null,
    evolutionType,
    evolutionContext,

    // Sentiment tracking
    sentimentBaseline: sentiment || 0.5,
    sentimentHistory: sentiment ? [sentiment] : [],
    sentimentTrajectory: 'stable',

    // Emotional arc
    emotionalArc: [{
      date: now.toDate().toISOString().split('T')[0],
      sentiment: sentiment || 0.5,
      event: 'Thread created'
    }],

    // Somatic signals
    somaticSignals: somaticSignals.filter(s => validSomaticIds.includes(s)),
    somaticFrequency: {},

    // Entry references
    entryIds: entryId ? [entryId] : [],
    entryCount: entryId ? 1 : 0,

    // Embedding
    embedding,

    // Timestamps
    createdAt: now,
    lastUpdated: now,
    lastEntryAt: now,
    resolvedAt: null
  };

  // Initialize somatic frequency
  for (const signal of thread.somaticSignals) {
    thread.somaticFrequency[signal] = 1;
  }

  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );
  await setDoc(threadRef, thread);

  // If this is an evolution, update predecessor
  if (predecessorId) {
    await updateDoc(
      doc(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', predecessorId),
      {
        successorId: threadId,
        status: 'evolved',
        lastUpdated: now
      }
    );
  }

  console.log(`[ThreadManager] Created thread: ${displayName} (${threadId})`);
  return thread;
};

/**
 * Append entry to existing thread
 */
export const appendToThread = async (userId, threadId, updateData) => {
  const { entryId, sentiment, somaticSignals = [], event = null } = updateData;

  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );
  const threadDoc = await getDoc(threadRef);

  if (!threadDoc.exists()) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const thread = threadDoc.data();
  const now = Timestamp.now();

  // Update sentiment history
  let newSentimentHistory = [...(thread.sentimentHistory || [])];
  if (sentiment !== undefined && sentiment !== null) {
    newSentimentHistory.push(sentiment);
    if (newSentimentHistory.length > 10) {
      newSentimentHistory = newSentimentHistory.slice(-10);
    }
  }

  // Calculate new baseline and trajectory
  const newBaseline = newSentimentHistory.length > 0
    ? newSentimentHistory.reduce((a, b) => a + b, 0) / newSentimentHistory.length
    : thread.sentimentBaseline;

  const trajectory = calculateTrajectory(newSentimentHistory);

  // Update emotional arc
  const newArc = [...(thread.emotionalArc || [])];
  if (sentiment !== undefined && sentiment !== null) {
    newArc.push({
      date: now.toDate().toISOString().split('T')[0],
      sentiment,
      event: event || 'Entry added'
    });
  }

  // Update somatic frequency
  const newSomaticFrequency = { ...(thread.somaticFrequency || {}) };
  const existingSomatics = new Set(thread.somaticSignals || []);

  for (const signal of somaticSignals) {
    existingSomatics.add(signal);
    newSomaticFrequency[signal] = (newSomaticFrequency[signal] || 0) + 1;
  }

  await updateDoc(threadRef, {
    entryIds: arrayUnion(entryId),
    entryCount: (thread.entryCount || 0) + 1,
    sentimentHistory: newSentimentHistory,
    sentimentBaseline: newBaseline,
    sentimentTrajectory: trajectory,
    emotionalArc: newArc,
    somaticSignals: Array.from(existingSomatics),
    somaticFrequency: newSomaticFrequency,
    lastUpdated: now,
    lastEntryAt: now
  });

  console.log(`[ThreadManager] Appended to thread: ${thread.displayName}`);
};

/**
 * Resolve (close) a thread
 */
export const resolveThread = async (userId, threadId, resolution = null) => {
  const now = Timestamp.now();

  const threadRef = doc(
    db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads', threadId
  );

  await updateDoc(threadRef, {
    status: 'resolved',
    resolution,
    resolvedAt: now,
    lastUpdated: now
  });

  console.log(`[ThreadManager] Resolved thread: ${threadId}`);
};

/**
 * Calculate sentiment trajectory
 */
const calculateTrajectory = (history) => {
  if (history.length < 3) return 'stable';

  const recent = history.slice(-3);
  const earlier = history.slice(-6, -3);

  if (earlier.length === 0) return 'stable';

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const delta = recentAvg - earlierAvg;

  // Calculate variance
  const variance = recent.reduce((sum, val) => sum + Math.pow(val - recentAvg, 2), 0) / recent.length;

  if (variance > 0.04) return 'volatile'; // High variance (0.2^2)
  if (delta > 0.1) return 'improving';
  if (delta < -0.1) return 'declining';
  return 'stable';
};

// ============================================================
// LLM THREAD IDENTIFICATION
// ============================================================

/**
 * Build prompt for thread identification with evolution support
 */
const buildThreadIdentificationPrompt = (entryText, activeThreads, archivedThreads = []) => {
  const activeList = activeThreads.length > 0
    ? activeThreads.map(t => `- "${t.displayName}" (${t.category}, sentiment: ${Math.round((t.sentimentBaseline || 0.5) * 100)}%)`).join('\n')
    : 'No active threads.';

  const archivedList = archivedThreads.length > 0
    ? archivedThreads.slice(0, 3).map(t => `- "${t.displayName}" (${t.category}, ${t.status})`).join('\n')
    : 'No recent archived threads.';

  return `You are analyzing a journal entry to identify thematic connections and potential story evolution.

ACTIVE THREADS:
${activeList}

RECENTLY ARCHIVED/EVOLVED THREADS:
${archivedList}

JOURNAL ENTRY:
"${entryText.slice(0, 2000)}"

TASK:
1. Determine if this entry:
   a) Continues an existing active thread (same topic)
   b) Represents a METAMORPHOSIS (new topic in same life domain - e.g., "Databricks" evolving to "Anthropic")
   c) Starts a genuinely new thread (new life domain)
2. Extract somatic (body) signals
3. Estimate emotional sentiment (0-1)
4. If metamorphosis: identify the predecessor thread and explain the evolution

SOMATIC SIGNALS (only use these):
- pain, tension, fatigue, respiratory, digestive, cognitive, sleep_disturbance, cardiovascular

RESPONSE FORMAT (JSON only, no markdown):
{
  "thread": {
    "action": "continue" | "metamorphosis" | "new",
    "existingThreadName": "exact name if continuing, null otherwise",
    "proposedName": "short descriptive name if new/metamorphosis",
    "category": "career" | "health" | "relationship" | "growth" | "somatic" | "housing" | "financial" | "creative" | "social",
    "metamorphosis": {
      "predecessorName": "thread this evolved from, if applicable",
      "evolutionType": "pivot" | "continuation" | "resolution",
      "evolutionContext": "brief explanation of the evolution"
    }
  },
  "somaticSignals": ["signal_id"],
  "sentiment": 0.72,
  "confidence": 0.85,
  "arcEvent": "Brief description for emotional arc (e.g., 'Interview scheduled')"
}`;
};

/**
 * Parse LLM response
 */
const parseThreadResponse = (response) => {
  try {
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.thread?.action) {
      console.warn('[ThreadManager] Invalid response structure');
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ThreadManager] Parse error:', error);
    return null;
  }
};

/**
 * Main entry point: Identify thread association for an entry
 */
export const identifyThreadAssociation = async (userId, entryId, entryText, sentiment = null) => {
  if (!userId || !entryText || entryText.length < MIN_CONTENT_LENGTH) {
    return { success: false, error: 'Invalid input' };
  }

  try {
    // Get active and recent archived threads
    const activeThreads = await getActiveThreads(userId);

    // Get recently archived for evolution detection
    const threadsRef = collection(db, 'artifacts', APP_COLLECTION_ID, 'users', userId, 'threads');
    let archivedThreads = [];
    try {
      const archivedQuery = query(
        threadsRef,
        where('status', 'in', ['resolved', 'evolved', 'archived']),
        orderBy('lastUpdated', 'desc'),
        limit(5)
      );
      const archivedSnapshot = await getDocs(archivedQuery);
      archivedThreads = archivedSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      // Index may not exist yet, continue without archived threads
      console.warn('[ThreadManager] Could not fetch archived threads:', e.message);
    }

    // Call LLM
    const prompt = buildThreadIdentificationPrompt(entryText, activeThreads, archivedThreads);
    let llmResult;

    try {
      const response = await callGemini(prompt, '');
      llmResult = parseThreadResponse(response);
    } catch (llmError) {
      console.warn('[ThreadManager] LLM failed:', llmError);
      return fallbackIdentification(userId, entryId, entryText, sentiment);
    }

    if (!llmResult) {
      return fallbackIdentification(userId, entryId, entryText, sentiment);
    }

    const { thread, somaticSignals, sentiment: llmSentiment, confidence, arcEvent } = llmResult;
    const finalSentiment = sentiment ?? llmSentiment ?? 0.5;

    // Handle based on action
    switch (thread.action) {
      case 'continue': {
        const matchedThread = activeThreads.find(
          t => normalizeThreadName(t.displayName) === normalizeThreadName(thread.existingThreadName || '')
        );

        if (matchedThread) {
          await appendToThread(userId, matchedThread.id, {
            entryId,
            sentiment: finalSentiment,
            somaticSignals: somaticSignals || [],
            event: arcEvent
          });

          return {
            success: true,
            action: 'appended',
            threadId: matchedThread.id,
            threadName: matchedThread.displayName,
            somaticSignals: somaticSignals || [],
            confidence
          };
        }
        // Fall through to new if match not found
      }

      case 'metamorphosis': {
        // Find predecessor
        let predecessorThread = null;
        if (thread.metamorphosis?.predecessorName) {
          predecessorThread = [...activeThreads, ...archivedThreads].find(
            t => normalizeThreadName(t.displayName) === normalizeThreadName(thread.metamorphosis.predecessorName)
          );
        }

        const newThread = await createThread(userId, {
          displayName: thread.proposedName || 'Unnamed Thread',
          category: thread.category || 'growth',
          sentiment: finalSentiment,
          somaticSignals: somaticSignals || [],
          entryId,
          rootThreadId: predecessorThread?.rootThreadId || predecessorThread?.id,
          predecessorId: predecessorThread?.id,
          evolutionType: thread.metamorphosis?.evolutionType || 'pivot',
          evolutionContext: thread.metamorphosis?.evolutionContext
        });

        return {
          success: true,
          action: 'metamorphosis',
          threadId: newThread.id,
          threadName: newThread.displayName,
          predecessorId: predecessorThread?.id,
          predecessorName: predecessorThread?.displayName,
          evolutionContext: thread.metamorphosis?.evolutionContext,
          somaticSignals: somaticSignals || [],
          confidence
        };
      }

      case 'new':
      default: {
        // Check for duplicates first
        const proposedName = thread.proposedName || 'Unnamed Thread';
        let embedding = null;
        try {
          embedding = await generateEmbedding(proposedName);
        } catch (e) {
          // Continue without embedding
        }
        const similar = await findSimilarThread(proposedName, activeThreads, embedding);

        if (similar) {
          // Deduplicate
          await appendToThread(userId, similar.thread.id, {
            entryId,
            sentiment: finalSentiment,
            somaticSignals: somaticSignals || [],
            event: arcEvent
          });

          return {
            success: true,
            action: 'deduplicated',
            threadId: similar.thread.id,
            threadName: similar.thread.displayName,
            originalProposal: proposedName,
            somaticSignals: somaticSignals || [],
            confidence
          };
        }

        // Create new thread
        const newThread = await createThread(userId, {
          displayName: proposedName,
          category: thread.category || 'growth',
          sentiment: finalSentiment,
          somaticSignals: somaticSignals || [],
          entryId
        });

        return {
          success: true,
          action: 'created',
          threadId: newThread.id,
          threadName: newThread.displayName,
          somaticSignals: somaticSignals || [],
          confidence
        };
      }
    }
  } catch (error) {
    console.error('[ThreadManager] Identification failed:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Fallback identification when LLM unavailable
 */
const fallbackIdentification = async (userId, entryId, entryText, sentiment) => {
  const signals = extractSomaticSignals(entryText);

  return {
    success: true,
    action: 'fallback',
    threadId: null,
    threadName: null,
    somaticSignals: signals.map(s => s.signalId),
    confidence: 0.3,
    note: 'LLM unavailable - processed with heuristics only'
  };
};
