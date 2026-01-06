/**
 * Companion Context Service
 *
 * Enhanced RAG system for the AI Companion with tiered retrieval:
 * - Tier 1: Memory Graph (always included, ~500 tokens)
 * - Tier 2: Session Buffer (volatile memory for sync gap)
 * - Tier 3: Recent entries (last 7 days, up to 10)
 * - Tier 4: Semantically similar (top 3 full text, rest as insights)
 * - Tier 5: Entity-matched from deep history
 *
 * Token Budget: 4,500 (optimized for reasoning accuracy per Gemini feedback)
 * De-duplication: Prevents same entry appearing in multiple tiers
 */

import { cosineSimilarity } from '../ai/embeddings';
import { getMemoryGraph, formatMemoryForContext } from '../memory';
import { getSessionBuffer, formatBufferForContext, isExpired } from '../memory/sessionBuffer';

/**
 * Estimate token count for text/object
 * Rough estimate: ~4 characters per token
 */
const estimateTokens = (content) => {
  if (!content) return 0;
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return Math.ceil(str.length / 4);
};

/**
 * Truncate text to approximate token limit
 */
const truncateToTokens = (text, maxTokens) => {
  if (!text) return '';
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + '...';
};

/**
 * Calculate days since a date
 */
const daysSince = (date) => {
  if (!date) return Infinity;
  const d = date instanceof Date ? date : date?.toDate?.() || new Date(date);
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
};

/**
 * Format entry as insights only (for lower-similarity entries)
 * Saves tokens while preserving key information
 */
const formatEntryInsightsOnly = (entry) => {
  const date = entry.effectiveDate || entry.createdAt;
  const dateStr = date instanceof Date
    ? date.toLocaleDateString()
    : new Date(date?.toDate?.() || date).toLocaleDateString();

  const parts = [`[${dateStr}]`];

  if (entry.analysis?.mood_score !== undefined) {
    parts.push(`Mood: ${Math.round(entry.analysis.mood_score * 100)}%`);
  }

  if (entry.analysis?.entry_type) {
    parts.push(`Type: ${entry.analysis.entry_type}`);
  }

  const tags = entry.tags?.filter(t => t.startsWith('@')).slice(0, 5);
  if (tags?.length > 0) {
    parts.push(`Topics: ${tags.map(t => t.split(':')[1]).join(', ')}`);
  }

  return parts.join(' | ');
};

/**
 * Extract entities from query text for entity matching
 */
const extractQueryEntities = (query) => {
  const entities = [];
  const lowerQuery = query.toLowerCase();

  // Look for @ prefixed entities
  const atMatches = query.match(/@\w+:\w+/g);
  if (atMatches) {
    entities.push(...atMatches);
  }

  // Common activity keywords
  const activities = ['yoga', 'running', 'hiking', 'meditation', 'exercise', 'workout', 'gym'];
  activities.forEach(act => {
    if (lowerQuery.includes(act)) {
      entities.push(`@activity:${act}`);
    }
  });

  return [...new Set(entities)];
};

/**
 * Find entries matching specific entities
 */
const findByEntity = (entries, queryEntities, limit = 10) => {
  if (!queryEntities?.length) return [];

  const matches = [];

  for (const entry of entries) {
    if (!entry.tags?.length) continue;

    const matchCount = queryEntities.reduce((count, qe) => {
      const prefix = qe.split(':')[0];
      const value = qe.split(':')[1]?.toLowerCase();

      return count + entry.tags.filter(t => {
        if (t === qe) return true;
        if (t.startsWith(prefix) && value) {
          const tagValue = t.split(':')[1]?.toLowerCase();
          return tagValue?.includes(value) || value.includes(tagValue);
        }
        return false;
      }).length;
    }, 0);

    if (matchCount > 0) {
      matches.push({ ...entry, _entityMatchCount: matchCount });
    }
  }

  return matches
    .sort((a, b) => b._entityMatchCount - a._entityMatchCount)
    .slice(0, limit);
};

/**
 * Get companion context with tiered retrieval
 *
 * @param {Object} params
 * @param {string} params.userId - User ID
 * @param {string} params.query - Current query/message
 * @param {number[]} params.queryEmbedding - Vector embedding of query
 * @param {Object[]} params.entries - All user entries
 * @param {string} params.category - Category filter
 * @param {Object} params.sessionBuffer - Optional session buffer override
 * @param {number} params.maxTokens - Token budget (default: 4500)
 * @returns {Object} Context for companion chat
 */
export const getCompanionContext = async ({
  userId,
  query,
  queryEmbedding,
  entries,
  category = null,
  sessionBuffer = null,
  maxTokens = 4500 // Reduced from 8000 per Gemini feedback
}) => {
  const tokenBudget = { used: 0, max: maxTokens };
  const context = {
    memory: null,
    sessionBuffer: null,
    recent: [],
    similar: [],
    entityMatched: []
  };
  const includedEntryIds = new Set(); // For de-duplication

  // Filter entries by category if specified
  const filteredEntries = category
    ? entries.filter(e => e.category === category)
    : entries;

  // ==========================================
  // TIER 1: Memory Graph (always included)
  // ==========================================
  try {
    const memory = await getMemoryGraph(userId, { excludeArchived: true });
    context.memory = formatMemoryForContext(memory, 500);
    tokenBudget.used += estimateTokens(context.memory);
  } catch (e) {
    console.warn('Failed to load memory graph:', e);
    context.memory = null;
  }

  // ==========================================
  // TIER 2: Session Buffer (volatile memory)
  // ==========================================
  const buffer = sessionBuffer || getSessionBuffer();

  if (buffer?.recentEntry && !isExpired(buffer.expiresAt)) {
    context.sessionBuffer = formatBufferForContext(buffer);
    tokenBudget.used += estimateTokens(context.sessionBuffer);

    // Add to de-duplication set
    if (buffer.recentEntry.id) {
      includedEntryIds.add(buffer.recentEntry.id);
    }
  }

  // ==========================================
  // TIER 3: Recent entries (last 7 days)
  // ==========================================
  const recentEntries = filteredEntries
    .filter(e => {
      if (includedEntryIds.has(e.id)) return false;
      return daysSince(e.effectiveDate || e.createdAt) <= 7;
    })
    .sort((a, b) => {
      const dateA = a.effectiveDate || a.createdAt;
      const dateB = b.effectiveDate || b.createdAt;
      const timeA = dateA instanceof Date ? dateA : dateA?.toDate?.() || new Date();
      const timeB = dateB instanceof Date ? dateB : dateB?.toDate?.() || new Date();
      return timeB - timeA;
    })
    .slice(0, 10);

  // Track included entries for de-duplication
  recentEntries.forEach(e => includedEntryIds.add(e.id));

  // Format recent entries with truncation
  context.recent = recentEntries.map(e => {
    const date = e.effectiveDate || e.createdAt;
    const dateStr = date instanceof Date
      ? date.toLocaleDateString()
      : new Date(date?.toDate?.() || date).toLocaleDateString();

    return {
      id: e.id,
      date: dateStr,
      mood: e.analysis?.mood_score,
      type: e.analysis?.entry_type,
      text: truncateToTokens(e.text, 300),
      tags: e.tags?.filter(t => t.startsWith('@')).slice(0, 5)
    };
  });
  tokenBudget.used += estimateTokens(context.recent);

  // ==========================================
  // TIER 4: Semantically similar entries
  // ==========================================
  const remainingBudget = tokenBudget.max - tokenBudget.used;
  const similarLimit = Math.min(20, Math.floor(remainingBudget / 400));

  if (queryEmbedding && similarLimit > 0) {
    const similarEntries = filteredEntries
      .filter(e => e.embedding && !includedEntryIds.has(e.id))
      .map(e => ({
        ...e,
        _similarity: cosineSimilarity(queryEmbedding, e.embedding)
      }))
      .filter(e => e._similarity > 0.25)
      .sort((a, b) => b._similarity - a._similarity)
      .slice(0, similarLimit);

    // Track for de-duplication
    similarEntries.forEach(e => includedEntryIds.add(e.id));

    // Full text for TOP 3 most similar, insights only for rest
    context.similar = similarEntries.map((e, index) => {
      const date = e.effectiveDate || e.createdAt;
      const dateStr = date instanceof Date
        ? date.toLocaleDateString()
        : new Date(date?.toDate?.() || date).toLocaleDateString();

      if (index < 3) {
        // Full text for top 3
        return {
          id: e.id,
          date: dateStr,
          similarity: Math.round(e._similarity * 100),
          mood: e.analysis?.mood_score,
          type: e.analysis?.entry_type,
          text: truncateToTokens(e.text, 500),
          tags: e.tags?.filter(t => t.startsWith('@')).slice(0, 5)
        };
      } else {
        // Insights only for the rest
        return {
          id: e.id,
          summary: formatEntryInsightsOnly(e),
          similarity: Math.round(e._similarity * 100)
        };
      }
    });
    tokenBudget.used += estimateTokens(context.similar);
  }

  // ==========================================
  // TIER 5: Entity-matched from history
  // ==========================================
  const queryEntities = extractQueryEntities(query);

  if (queryEntities.length > 0) {
    const entityMatched = findByEntity(filteredEntries, queryEntities, 10)
      .filter(e => !includedEntryIds.has(e.id));

    context.entityMatched = entityMatched.slice(0, 5).map(e => {
      const date = e.effectiveDate || e.createdAt;
      const dateStr = date instanceof Date
        ? date.toLocaleDateString()
        : new Date(date?.toDate?.() || date).toLocaleDateString();

      return {
        id: e.id,
        date: dateStr,
        matchedEntities: queryEntities.filter(qe =>
          e.tags?.some(t => t.includes(qe.split(':')[1]))
        ),
        summary: formatEntryInsightsOnly(e)
      };
    });
  }

  return {
    context,
    tokenBudget: {
      used: tokenBudget.used,
      max: tokenBudget.max,
      remaining: tokenBudget.max - tokenBudget.used
    },
    stats: {
      hasMemory: !!context.memory,
      hasSessionBuffer: !!context.sessionBuffer,
      recentCount: context.recent.length,
      similarCount: context.similar.length,
      entityMatchedCount: context.entityMatched.length,
      totalEntriesSearched: filteredEntries.length
    }
  };
};

/**
 * Format companion context for chat prompt
 * Creates a structured context string for the AI
 */
export const formatContextForChat = (contextResult) => {
  const { context } = contextResult;
  const sections = [];

  // Memory section
  if (context.memory) {
    sections.push(`=== YOUR MEMORY OF THIS USER ===\n${context.memory}`);
  }

  // Session buffer (recent entry)
  if (context.sessionBuffer) {
    sections.push(`=== JUST NOW ===\n${context.sessionBuffer}`);
  }

  // Recent entries
  if (context.recent?.length > 0) {
    const recentLines = context.recent.map(e => {
      const mood = e.mood !== undefined ? ` (mood: ${Math.round(e.mood * 100)}%)` : '';
      const tags = e.tags?.length ? ` [${e.tags.join(', ')}]` : '';
      return `[${e.date}]${mood}${tags}\n${e.text}`;
    });
    sections.push(`=== RECENT ENTRIES (last 7 days) ===\n${recentLines.join('\n\n')}`);
  }

  // Similar entries
  if (context.similar?.length > 0) {
    const similarLines = context.similar.map(e => {
      if (e.text) {
        // Full entry
        const mood = e.mood !== undefined ? ` (mood: ${Math.round(e.mood * 100)}%)` : '';
        return `[${e.date}] ${e.similarity}% relevant${mood}\n${e.text}`;
      } else {
        // Insights only
        return `${e.summary} (${e.similarity}% relevant)`;
      }
    });
    sections.push(`=== RELATED ENTRIES ===\n${similarLines.join('\n\n')}`);
  }

  // Entity matched
  if (context.entityMatched?.length > 0) {
    const matchedLines = context.entityMatched.map(e =>
      `${e.summary} [matched: ${e.matchedEntities?.join(', ')}]`
    );
    sections.push(`=== ENTRIES MENTIONING SAME TOPICS ===\n${matchedLines.join('\n')}`);
  }

  return sections.join('\n\n');
};

/**
 * Build companion system prompt with memory
 */
export const buildCompanionSystemPrompt = (memory, preferences = {}) => {
  const style = preferences.communicationStyle || memory?.core?.preferences?.communicationStyle || 'warm';
  const name = preferences.preferredName || memory?.core?.preferences?.preferredName;
  const avoidTopics = memory?.core?.preferences?.avoidTopics || [];
  const pendingFollowUps = memory?.core?.conversationState?.pendingFollowUps?.filter(f => !f.askedAt) || [];

  let prompt = `You are a supportive companion who has known ${name || 'this person'} through their journaling journey.

COMMUNICATION STYLE: ${style}
${style === 'warm' ? '- Be empathetic, validating, and gentle. Use affirming language.' : ''}
${style === 'direct' ? '- Be clear, concise, and action-oriented. Focus on practical insights.' : ''}
${style === 'analytical' ? '- Be thoughtful, pattern-focused, and insightful. Connect dots across entries.' : ''}

GUIDELINES:
- Reference past conversations and entries naturally when relevant
- Remember important people, events, and themes from their journal
- Notice patterns but present them as gentle observations, not lectures
- Ask thoughtful follow-up questions to show you remember and care
- Never be preachy or give unsolicited advice
- Validate emotions before offering perspective`;

  if (avoidTopics.length > 0) {
    prompt += `\n\nTOPICS TO AVOID (user has dismissed insights about these):\n${avoidTopics.join(', ')}`;
  }

  if (pendingFollowUps.length > 0) {
    prompt += `\n\nFOLLOW-UP QUESTIONS TO ASK (when naturally relevant):\n${pendingFollowUps.map(f => `- ${f.question}`).join('\n')}`;
  }

  return prompt;
};

export default {
  getCompanionContext,
  formatContextForChat,
  buildCompanionSystemPrompt,
  estimateTokens,
  truncateToTokens
};
