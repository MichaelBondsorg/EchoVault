/**
 * Topic Coverage Service
 *
 * Read-only client for pre-computed domain coverage scores, plus
 * pure computation functions for tag-to-domain mapping and recency weighting.
 */
export const LIFE_DOMAINS = [
  'work', 'relationships', 'health', 'creativity',
  'spirituality', 'personal-growth', 'family', 'finances',
];

const HALF_LIFE_DAYS = 14;

// Keyword sets for activity/goal domain classification
const HEALTH_KEYWORDS = ['exercise', 'running', 'gym', 'yoga', 'doctor', 'medical', 'therapy', 'sleep', 'workout', 'walk', 'swim', 'hike', 'meditation', 'fitness', 'diet', 'nutrition'];
const CREATIVITY_KEYWORDS = ['painting', 'drawing', 'writing', 'music', 'art', 'photography', 'design', 'craft', 'dance', 'poetry', 'singing', 'guitar', 'piano', 'sculpt', 'compose'];
const WORK_KEYWORDS = ['meeting', 'presentation', 'project', 'deadline', 'office', 'client', 'interview', 'report', 'email', 'conference', 'promotion', 'career', 'salary', 'manager', 'boss', 'colleague'];
const PERSONAL_GROWTH_KEYWORDS = ['learn', 'study', 'read', 'course', 'self-improvement', 'growth', 'habit', 'mindset', 'skill', 'goal', 'reflection', 'journal'];
const FINANCE_KEYWORDS = ['budget', 'invest', 'save', 'money', 'finance', 'debt', 'expense', 'income', 'tax', 'retirement'];
const SPIRITUALITY_KEYWORDS = ['pray', 'worship', 'church', 'temple', 'spiritual', 'faith', 'mindfulness', 'gratitude', 'soul', 'divine'];

function matchesKeywords(content, keywords) {
  if (!content) return false;
  const lower = content.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

/**
 * Maps an entity tag to a life domain.
 * @param {{ type: string, content?: string, category?: string }} tag
 * @returns {string|null} Domain name or null if unmappable
 */
export function mapTagToDomain(tag) {
  if (!tag || !tag.type) return null;

  switch (tag.type) {
    case 'person':
      return tag.category === 'family' ? 'family' : 'relationships';

    case 'activity': {
      const content = tag.content || '';
      if (matchesKeywords(content, HEALTH_KEYWORDS)) return 'health';
      if (matchesKeywords(content, CREATIVITY_KEYWORDS)) return 'creativity';
      if (matchesKeywords(content, WORK_KEYWORDS)) return 'work';
      return null;
    }

    case 'goal': {
      const content = tag.content || '';
      if (matchesKeywords(content, WORK_KEYWORDS)) return 'work';
      if (matchesKeywords(content, PERSONAL_GROWTH_KEYWORDS)) return 'personal-growth';
      return 'personal-growth'; // default for goals
    }

    default:
      return null;
  }
}

/**
 * Computes recency weight using exponential decay with 14-day half-life.
 * @param {number} daysAgo - Number of days since entry
 * @returns {number} Weight between 0 and 1
 */
export function computeRecencyWeight(daysAgo) {
  return Math.pow(0.5, daysAgo / HALF_LIFE_DAYS);
}

/**
 * Computes normalized coverage scores across all domains from entry data.
 * @param {Array<{domains: string[], daysAgo: number}>} entries
 * @returns {Object} Map of domain → normalized score (0-1)
 */
/**
 * Gets pre-computed topic coverage data for a user.
 * @param {string} userId
 * @returns {Promise<Object|null>} Domain coverage scores or null
 */
export async function getTopicCoverage(userId) {
  const { analyticsRepository } = await import('../../repositories/analytics.js');
  const data = await analyticsRepository.getAnalyticsDoc(userId, 'topic_coverage');
  if (!data || !data.domains) return null;
  return data.domains;
}

export function computeCoverageScores(entries) {
  const domainWeights = {};
  for (const d of LIFE_DOMAINS) {
    domainWeights[d] = 0;
  }

  let totalWeight = 0;
  for (const entry of entries) {
    if (!entry.domains || entry.domains.length === 0) continue;
    const weight = computeRecencyWeight(entry.daysAgo);
    for (const domain of entry.domains) {
      if (domainWeights[domain] !== undefined) {
        domainWeights[domain] += weight;
        totalWeight += weight;
      }
    }
  }

  const scores = {};
  for (const d of LIFE_DOMAINS) {
    scores[d] = totalWeight > 0 ? domainWeights[d] / totalWeight : 0;
  }
  return scores;
}
