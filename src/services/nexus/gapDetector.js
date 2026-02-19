/**
 * Gap Detector — Nexus Extension
 *
 * Identifies life domains the user has neglected in their journaling.
 * Reads pre-computed topic coverage data from the analytics layer,
 * checks user exclusions from the Signal Lifecycle system, and produces
 * a ranked list of domain gaps with severity scores.
 *
 * Consumers: gap prompt generator (section-13), report generator (section-05),
 * Nexus Layer 3 synthesizer (blind-spot insights).
 */

import { analyticsRepository } from '../../repositories/analytics';
import { isPatternExcluded } from '../signals/signalLifecycle';

// ============================================================
// Constants
// ============================================================

export const LIFE_DOMAINS = [
  'work', 'relationships', 'health', 'creativity',
  'spirituality', 'personal-growth', 'family', 'finances',
];

export const GAP_THRESHOLD = 0.7;
export const RECENCY_HALF_LIFE_DAYS = 14;
export const MIN_HISTORY_DAYS = 14;
export const MAX_RECENCY_PENALTY = 10.0;

export const DOMAIN_CONFIG = {
  work: {
    displayName: 'Work & Career',
    description: 'Professional life, career goals, work relationships',
    tagSignals: ['@activity:work', '@goal:career'],
    keywords: ['job', 'career', 'office', 'meeting', 'project', 'deadline'],
  },
  relationships: {
    displayName: 'Relationships',
    description: 'Friendships, romantic relationships, social connections',
    tagSignals: ['@person:non-family'],
    keywords: ['friend', 'partner', 'date', 'social'],
  },
  health: {
    displayName: 'Health & Wellness',
    description: 'Physical health, exercise, medical, sleep',
    tagSignals: ['@activity:exercise', '@activity:medical'],
    keywords: ['exercise', 'gym', 'doctor', 'sleep', 'workout', 'therapy'],
  },
  creativity: {
    displayName: 'Creativity',
    description: 'Creative pursuits, artistic expression, hobbies',
    tagSignals: ['@activity:creative'],
    keywords: ['painting', 'drawing', 'writing', 'music', 'art', 'photography'],
  },
  spirituality: {
    displayName: 'Spirituality',
    description: 'Spiritual practice, mindfulness, faith',
    tagSignals: [],
    keywords: ['pray', 'worship', 'spiritual', 'faith', 'mindfulness', 'gratitude'],
  },
  'personal-growth': {
    displayName: 'Personal Growth',
    description: 'Learning, self-improvement, skill development',
    tagSignals: ['@goal:personal'],
    keywords: ['learn', 'study', 'read', 'course', 'self-improvement', 'growth'],
  },
  family: {
    displayName: 'Family',
    description: 'Family relationships, parenting, home life',
    tagSignals: ['@person:family'],
    keywords: ['family', 'parent', 'child', 'sibling', 'home'],
  },
  finances: {
    displayName: 'Finances',
    description: 'Money management, financial goals, budgeting',
    tagSignals: [],
    keywords: ['budget', 'invest', 'save', 'money', 'finance', 'debt'],
  },
};

// ============================================================
// Core Functions
// ============================================================

/**
 * Compute the gap score for a single life domain.
 *
 * Formula: (1 - normalizedCoverage) * recencyPenalty * exclusionCheck
 *
 * @param {number} normalizedCoverage - Domain coverage ratio (0 to 1)
 * @param {number} daysSinceLastMention - Days since domain was last mentioned
 * @param {boolean} isExcluded - Whether the user has excluded this domain
 * @returns {number} Gap score (0 = no gap, higher = more severe gap)
 */
export function computeGapScore(normalizedCoverage, daysSinceLastMention, isExcluded) {
  if (isExcluded) return 0;

  const coverageGap = 1 - normalizedCoverage;
  const rawRecency = Math.pow(2, daysSinceLastMention / RECENCY_HALF_LIFE_DAYS);
  const recencyPenalty = Math.min(rawRecency, MAX_RECENCY_PENALTY);

  return coverageGap * recencyPenalty;
}

/**
 * Extract a millisecond timestamp from a Firestore-style Timestamp or raw number.
 */
function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts === 'number') return ts;
  return null;
}

/**
 * Detect life domain gaps for a user based on their journaling history.
 *
 * Reads pre-computed topic coverage from the analytics layer and checks
 * each domain against the user's Signal Lifecycle exclusions. Returns a
 * ranked list of gaps exceeding the threshold, sorted by severity.
 *
 * Returns an empty array if:
 * - Analytics data is not yet available
 * - User has less than MIN_HISTORY_DAYS of entry history
 * - firstEntryDate is missing (cannot verify history duration)
 * - All domains have sufficient coverage
 *
 * @param {string} userId - The user ID to analyze
 * @param {Object} [options] - Optional configuration
 * @param {number} [options.threshold] - Override default GAP_THRESHOLD
 * @param {number} [options.maxResults] - Limit number of returned gaps
 * @returns {Promise<Array<{domain: string, gapScore: number, lastMentionDate: Date|null, normalizedCoverage: number}>>}
 */
export async function detectGaps(userId, options = {}) {
  const threshold = options.threshold ?? GAP_THRESHOLD;
  const maxResults = options.maxResults ?? undefined;

  // Read pre-computed topic coverage
  const coverage = await analyticsRepository.getTopicCoverage(userId);
  if (!coverage || !coverage.domains) {
    return [];
  }

  // Use server timestamp from analytics document as reference time
  // to avoid client clock skew issues
  const referenceMs = toMillis(coverage.lastUpdated) ?? Date.now();

  // Check minimum history requirement
  const firstEntryMs = toMillis(coverage.firstEntryDate);
  if (!firstEntryMs) {
    return []; // Cannot verify history duration
  }

  const daysSinceFirstEntry = (referenceMs - firstEntryMs) / 86400000;
  if (daysSinceFirstEntry < MIN_HISTORY_DAYS) {
    return [];
  }

  // Compute gap score for each domain
  const gaps = [];

  for (const domain of LIFE_DOMAINS) {
    const domainData = coverage.domains[domain] || {
      normalizedCoverage: 0,
      lastMentionDate: null,
      entryCount: 0,
    };

    const normalizedCoverage = domainData.normalizedCoverage ?? 0;

    // Compute days since last mention using server reference time
    let daysSinceLastMention = 0;
    const lastMentionMs = toMillis(domainData.lastMentionDate);
    if (lastMentionMs) {
      daysSinceLastMention = (referenceMs - lastMentionMs) / 86400000;
    } else {
      // Never mentioned: use full journaling duration
      daysSinceLastMention = (referenceMs - firstEntryMs) / 86400000;
    }

    // Check exclusion (fail open on error)
    let excluded = false;
    try {
      excluded = await isPatternExcluded(userId, domain);
    } catch (error) {
      console.warn(`[gapDetector] Exclusion check failed for ${domain}, treating as non-excluded:`, error.message);
    }

    const gapScore = computeGapScore(normalizedCoverage, daysSinceLastMention, excluded);

    if (gapScore >= threshold) {
      gaps.push({
        domain,
        gapScore,
        lastMentionDate: domainData.lastMentionDate || null,
        normalizedCoverage,
      });
    }
  }

  // Sort by gap score descending
  gaps.sort((a, b) => b.gapScore - a.gapScore);

  // Apply max results limit
  if (maxResults !== undefined) {
    return gaps.slice(0, maxResults);
  }

  return gaps;
}
