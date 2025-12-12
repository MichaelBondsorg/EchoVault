import { safeString } from './string';
import { safeDate } from './date';

/**
 * Sanitize raw Firestore entry data into a consistent format
 */
export const sanitizeEntry = (id, data) => {
  return {
    id: id,
    text: safeString(data.text),
    category: safeString(data.category) || 'personal',
    tags: Array.isArray(data.tags)
      ? data.tags.map(t => typeof t === 'string' ? t : (t?.text || safeString(t)))
      : [],
    title: safeString(data.title) || safeString(data.analysis?.summary) || "Untitled Memory",
    analysis: data.analysis || { mood_score: 0.5 },
    analysisStatus: data.analysisStatus || 'complete',
    embedding: data.embedding || null,
    contextualInsight: data.contextualInsight || null,
    createdAt: safeDate(data.createdAt),
    // Phase 2: Temporal context fields
    effectiveDate: data.effectiveDate ? safeDate(data.effectiveDate) : null,
    temporalContext: data.temporalContext || null,
    futureMentions: Array.isArray(data.futureMentions) ? data.futureMentions : [],
    // Enhanced context fields
    continues_situation: data.continues_situation || null,
    goal_update: data.goal_update || null,
    entry_type: data.entry_type || 'reflection',
    // Extracted tasks for mixed entries
    extracted_tasks: Array.isArray(data.extracted_tasks) ? data.extracted_tasks : null,
    // Context version for retrofit tracking (v1 = enhanced context extracted)
    context_version: data.context_version || 0
  };
};
