/**
 * Values Tracker Service
 *
 * Tracks alignment between stated values and actual behaviors over time.
 * Uses ACT (Acceptance and Commitment Therapy) principles.
 *
 * Core concept: Values are directions, not destinations.
 * We track how consistently someone moves toward their values,
 * not whether they "achieve" them.
 */

import { collection, query, where, getDocs, doc, setDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';

// 15 core values based on ACT research and common life domains
export const CORE_VALUES = {
  health: {
    label: 'Health & Wellness',
    description: 'Physical and mental wellbeing',
    keywords: ['gym', 'workout', 'exercise', 'sleep', 'meditat', 'yoga', 'run', 'walk', 'healthy', 'diet', 'water', 'rest'],
    opposites: ['skip workout', 'junk food', 'stayed up', 'no sleep', 'exhausted', 'burned out']
  },
  connection: {
    label: 'Connection & Relationships',
    description: 'Meaningful bonds with others',
    keywords: ['friend', 'family', 'partner', 'talked to', 'hung out', 'dinner with', 'called', 'visited', 'quality time'],
    opposites: ['alone', 'isolated', 'cancelled', 'avoided', 'ghosted', 'ignored']
  },
  growth: {
    label: 'Growth & Learning',
    description: 'Personal development and learning',
    keywords: ['learned', 'course', 'book', 'studied', 'practice', 'improve', 'skill', 'challenge', 'feedback'],
    opposites: ['stagnant', 'stuck', 'gave up', 'same old', 'comfort zone']
  },
  creativity: {
    label: 'Creativity & Expression',
    description: 'Creating and expressing yourself',
    keywords: ['create', 'write', 'paint', 'music', 'design', 'build', 'art', 'project', 'idea'],
    opposites: ['blocked', 'uninspired', 'consume only', 'no ideas']
  },
  family: {
    label: 'Family',
    description: 'Family relationships and responsibilities',
    keywords: ['mom', 'dad', 'parent', 'sibling', 'kids', 'children', 'spouse', 'partner', 'home'],
    opposites: ['neglected family', 'missed', 'forgot', 'argument with']
  },
  achievement: {
    label: 'Achievement & Success',
    description: 'Accomplishing goals and succeeding',
    keywords: ['finished', 'completed', 'achieved', 'goal', 'milestone', 'promoted', 'success', 'delivered', 'shipped'],
    opposites: ['failed', 'missed deadline', 'procrastinated', 'behind']
  },
  security: {
    label: 'Security & Stability',
    description: 'Financial and emotional security',
    keywords: ['saved', 'budget', 'invest', 'stable', 'secure', 'plan', 'insurance', 'emergency fund'],
    opposites: ['overspent', 'debt', 'impulse', 'risky', 'unstable']
  },
  adventure: {
    label: 'Adventure & Novelty',
    description: 'New experiences and excitement',
    keywords: ['travel', 'new', 'explore', 'adventure', 'spontaneous', 'tried', 'discovered', 'first time'],
    opposites: ['routine', 'boring', 'same thing', 'never try']
  },
  selfcare: {
    label: 'Self-Care',
    description: 'Taking care of yourself',
    keywords: ['relax', 'rest', 'treat myself', 'massage', 'spa', 'break', 'boundaries', 'said no'],
    opposites: ['overworked', 'burned out', 'no breaks', 'pushed through', 'ignored needs']
  },
  honesty: {
    label: 'Honesty & Authenticity',
    description: 'Being true to yourself and others',
    keywords: ['honest', 'truth', 'authentic', 'real', 'genuine', 'opened up', 'admitted', 'vulnerable'],
    opposites: ['lied', 'pretended', 'fake', 'hid', 'masked', 'people-pleased']
  },
  consistency: {
    label: 'Consistency & Discipline',
    description: 'Following through on commitments',
    keywords: ['consistent', 'habit', 'routine', 'every day', 'kept promise', 'followed through', 'discipline'],
    opposites: ['broke streak', 'skipped', 'inconsistent', 'gave up', 'quit']
  },
  balance: {
    label: 'Balance & Harmony',
    description: 'Work-life balance and moderation',
    keywords: ['balance', 'moderate', 'both', 'harmony', 'boundaries', 'unplugged', 'work-life'],
    opposites: ['all work', 'overcommitted', 'no time for', 'overwhelmed', 'one-sided']
  },
  contribution: {
    label: 'Contribution & Service',
    description: 'Helping others and giving back',
    keywords: ['helped', 'volunteer', 'mentor', 'gave', 'support', 'community', 'donated', 'service'],
    opposites: ['selfish', 'ignored', 'didn\'t help', 'turned away']
  },
  learning: {
    label: 'Learning & Curiosity',
    description: 'Continuous learning and curiosity',
    keywords: ['curious', 'research', 'understand', 'question', 'explore', 'deep dive', 'figured out'],
    opposites: ['closed-minded', 'assumed', 'didn\'t bother', 'ignorant']
  },
  freedom: {
    label: 'Freedom & Autonomy',
    description: 'Independence and self-direction',
    keywords: ['choice', 'freedom', 'independent', 'my way', 'decided', 'autonomous', 'own terms'],
    opposites: ['forced', 'no choice', 'controlled', 'trapped', 'obligated']
  }
};

/**
 * Get user's value profile from Firestore
 *
 * @param {string} userId
 * @returns {Object} Value profile with priorities and history
 */
export const getValueProfile = async (userId) => {
  try {
    const profileRef = doc(db, `users/${userId}/settings`, 'valueProfile');
    const profileSnap = await getDocs(query(collection(db, `users/${userId}/settings`), where('__name__', '==', 'valueProfile')));

    if (profileSnap.empty) {
      // Return default profile
      return {
        prioritizedValues: [], // User hasn't set priorities yet
        alignmentHistory: [],
        lastUpdated: null
      };
    }

    return profileSnap.docs[0].data();
  } catch (error) {
    console.error('Failed to get value profile:', error);
    return { prioritizedValues: [], alignmentHistory: [], lastUpdated: null };
  }
};

/**
 * Save user's prioritized values
 *
 * @param {string} userId
 * @param {Array} prioritizedValues - Top 5 values in order of importance
 */
export const savePrioritizedValues = async (userId, prioritizedValues) => {
  const profileRef = doc(db, `users/${userId}/settings`, 'valueProfile');
  await setDoc(profileRef, {
    prioritizedValues,
    lastUpdated: new Date()
  }, { merge: true });
};

/**
 * Compute value alignment scores from entries
 *
 * @param {Array} entries - Journal entries
 * @param {Object} options - { dateRange, prioritizedValues }
 * @returns {Object} Alignment analysis
 */
export const computeValueAlignment = (entries, options = {}) => {
  const { prioritizedValues = Object.keys(CORE_VALUES) } = options;

  if (!entries || entries.length < 3) {
    return {
      available: false,
      reason: 'insufficient_entries',
      entriesCount: entries?.length || 0
    };
  }

  const valueStats = {};

  // Initialize stats for each value
  for (const valueKey of Object.keys(CORE_VALUES)) {
    valueStats[valueKey] = {
      stated: 0,        // Times mentioned as important
      supported: 0,     // Actions aligned with value
      violated: 0,      // Actions against value
      entries: []       // Entry references
    };
  }

  // Analyze each entry
  for (const entry of entries) {
    const text = (entry.text || '').toLowerCase();
    const actAnalysis = entry.analysis?.act_analysis;

    // Check each value
    for (const [valueKey, valueDef] of Object.entries(CORE_VALUES)) {
      // Check for supportive behaviors
      for (const keyword of valueDef.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          valueStats[valueKey].supported++;
          valueStats[valueKey].entries.push({
            id: entry.id,
            type: 'supported',
            snippet: extractSnippet(text, keyword)
          });
          break; // Count once per entry per value
        }
      }

      // Check for violating behaviors
      for (const opposite of valueDef.opposites) {
        if (text.includes(opposite.toLowerCase())) {
          valueStats[valueKey].violated++;
          valueStats[valueKey].entries.push({
            id: entry.id,
            type: 'violated',
            snippet: extractSnippet(text, opposite)
          });
          break;
        }
      }

      // Check if value was explicitly stated as important
      if (actAnalysis?.values_context) {
        const valuesContext = actAnalysis.values_context.toLowerCase();
        if (valuesContext.includes(valueKey) || valuesContext.includes(valueDef.label.toLowerCase())) {
          valueStats[valueKey].stated++;
        }
      }
    }
  }

  // Calculate alignment scores
  const byValue = {};
  for (const [valueKey, stats] of Object.entries(valueStats)) {
    const total = stats.supported + stats.violated;
    const alignmentScore = total > 0
      ? stats.supported / total
      : null; // No data

    byValue[valueKey] = {
      ...stats,
      alignmentScore,
      isPrioritized: prioritizedValues.includes(valueKey),
      label: CORE_VALUES[valueKey].label
    };
  }

  // Find biggest gap (prioritized value with lowest alignment)
  const prioritizedWithData = Object.entries(byValue)
    .filter(([key, v]) => v.isPrioritized && v.alignmentScore !== null)
    .sort((a, b) => a[1].alignmentScore - b[1].alignmentScore);

  const biggestGap = prioritizedWithData[0]?.[0] || null;

  // Find strongest alignment
  const strongest = Object.entries(byValue)
    .filter(([_, v]) => v.alignmentScore !== null && (v.supported + v.violated) >= 2)
    .sort((a, b) => b[1].alignmentScore - a[1].alignmentScore);

  const strongestAlignment = strongest[0]?.[0] || null;

  // Calculate overall alignment (weighted by prioritization)
  let overallAlignment = null;
  const scoredValues = Object.entries(byValue).filter(([_, v]) => v.alignmentScore !== null);
  if (scoredValues.length > 0) {
    const weightedSum = scoredValues.reduce((sum, [key, v]) => {
      const weight = v.isPrioritized ? 2 : 1;
      return sum + (v.alignmentScore * weight);
    }, 0);
    const totalWeight = scoredValues.reduce((sum, [key, v]) => sum + (v.isPrioritized ? 2 : 1), 0);
    overallAlignment = weightedSum / totalWeight;
  }

  return {
    available: true,
    byValue,
    overallAlignment: overallAlignment !== null ? Math.round(overallAlignment * 100) / 100 : null,
    biggestGap,
    strongestAlignment,
    entriesAnalyzed: entries.length,
    analyzedAt: new Date().toISOString()
  };
};

/**
 * Analyze value trends over time
 *
 * @param {Array} entries - Journal entries
 * @param {number} weeks - Number of weeks to analyze
 * @returns {Object} Trend analysis
 */
export const analyzeValueTrends = (entries, weeks = 4) => {
  if (!entries || entries.length < 10) {
    return { available: false, reason: 'insufficient_entries' };
  }

  const now = new Date();
  const weeklyAlignments = [];

  // Calculate alignment for each week
  for (let w = 0; w < weeks; w++) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - (w + 1) * 7);
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - w * 7);

    const weekEntries = entries.filter(e => {
      const date = e.createdAt?.toDate?.() || new Date(e.createdAt);
      return date >= weekStart && date < weekEnd;
    });

    if (weekEntries.length >= 2) {
      const alignment = computeValueAlignment(weekEntries);
      weeklyAlignments.push({
        week: w,
        weekStart: weekStart.toISOString(),
        alignment: alignment.available ? alignment : null
      });
    }
  }

  // Detect trends per value
  const trends = {};
  for (const valueKey of Object.keys(CORE_VALUES)) {
    const scores = weeklyAlignments
      .filter(w => w.alignment?.byValue?.[valueKey]?.alignmentScore !== null)
      .map(w => w.alignment.byValue[valueKey].alignmentScore);

    if (scores.length >= 2) {
      const recent = scores.slice(0, Math.ceil(scores.length / 2));
      const older = scores.slice(Math.ceil(scores.length / 2));
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
      const diff = recentAvg - olderAvg;

      if (diff > 0.1) {
        trends[valueKey] = 'improving';
      } else if (diff < -0.1) {
        trends[valueKey] = 'declining';
      } else {
        trends[valueKey] = 'stable';
      }
    }
  }

  return {
    available: true,
    weeklyAlignments,
    trends,
    improving: Object.entries(trends).filter(([_, t]) => t === 'improving').map(([k]) => k),
    declining: Object.entries(trends).filter(([_, t]) => t === 'declining').map(([k]) => k),
    stable: Object.entries(trends).filter(([_, t]) => t === 'stable').map(([k]) => k)
  };
};

/**
 * Extract a snippet around a keyword match
 */
const extractSnippet = (text, keyword, contextLength = 40) => {
  const index = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) return '';

  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + keyword.length + contextLength);

  let snippet = text.slice(start, end);
  if (start > 0) snippet = '...' + snippet;
  if (end < text.length) snippet = snippet + '...';

  return snippet;
};

export default {
  CORE_VALUES,
  getValueProfile,
  savePrioritizedValues,
  computeValueAlignment,
  analyzeValueTrends
};
