/**
 * Entry Post-Processing Service
 *
 * Background tasks that run after an entry is submitted.
 * These are non-blocking and run in parallel with the main analysis pipeline.
 *
 * Tasks:
 * - Refresh Core People cache (if person tags detected)
 * - Invalidate pattern cache for fresh insights
 * - Update value alignment metrics (if relevant)
 */

import { refreshCorePeopleCache } from '../social/socialTracker';
import { invalidatePatternCache } from '../patterns/cached';

// Track last cache refresh to avoid redundant updates
let lastCacheRefresh = null;
const CACHE_REFRESH_COOLDOWN = 5 * 60 * 1000; // 5 minutes between refreshes

/**
 * Run background post-processing after entry submission
 *
 * @param {Object} options
 * @param {string} options.userId - User ID
 * @param {string} options.entryContent - Entry text (for detecting if refresh is needed)
 * @param {Object} options.analysis - Entry analysis (if available)
 */
export const runEntryPostProcessing = async ({
  userId,
  entryContent = '',
  analysis = null
}) => {
  if (!userId) return;

  // Run all background tasks in parallel
  const tasks = [];

  // Task 1: Core People cache refresh (if person mentioned)
  const hasPerson = detectPersonMention(entryContent, analysis);
  if (hasPerson && shouldRefreshCache()) {
    tasks.push(refreshCorePeopleCacheBackground(userId));
  }

  // Task 2: Invalidate pattern cache for immediate insight refresh
  // This ensures the next dashboard load picks up new patterns
  tasks.push(invalidatePatternCacheBackground(userId));

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

/**
 * Detect if entry mentions a person (quick heuristic)
 */
const detectPersonMention = (content, analysis) => {
  // Check analysis tags first (most reliable)
  const tags = analysis?.tags || [];
  if (tags.some(tag => tag.includes('person:'))) {
    return true;
  }

  // Quick content heuristics
  const personPatterns = [
    /@person:/i,
    /\bwith\s+[A-Z][a-z]+\b/,  // "with Sarah"
    /\bmy\s+(friend|boss|manager|colleague|partner|mom|dad|brother|sister)\b/i
  ];

  return personPatterns.some(pattern => pattern.test(content));
};

/**
 * Check if enough time has passed since last cache refresh
 */
const shouldRefreshCache = () => {
  if (!lastCacheRefresh) return true;

  const timeSince = Date.now() - lastCacheRefresh;
  return timeSince >= CACHE_REFRESH_COOLDOWN;
};

/**
 * Background cache refresh with error handling
 */
const refreshCorePeopleCacheBackground = async (userId) => {
  try {
    console.log('[PostProcessing] Refreshing Core People cache in background...');
    lastCacheRefresh = Date.now();
    await refreshCorePeopleCache(userId);
    console.log('[PostProcessing] Core People cache refresh complete');
  } catch (error) {
    console.error('[PostProcessing] Core People cache refresh failed:', error);
    // Don't rethrow - this is a background task
  }
};

/**
 * Background pattern cache invalidation
 * Marks patterns as stale so they recompute on next dashboard load
 */
const invalidatePatternCacheBackground = async (userId) => {
  try {
    console.log('[PostProcessing] Invalidating pattern cache...');
    await invalidatePatternCache(userId);
    console.log('[PostProcessing] Pattern cache invalidated');
  } catch (error) {
    console.error('[PostProcessing] Pattern cache invalidation failed:', error);
    // Don't rethrow - this is a background task
  }
};

export default {
  runEntryPostProcessing
};
