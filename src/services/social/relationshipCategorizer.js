/**
 * Relationship Categorizer Service
 *
 * Heuristic-based categorization of relationships as work or personal.
 * Uses tag patterns, entry context, and learned user preferences.
 */

import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

// Relationship category patterns
export const RELATIONSHIP_PATTERNS = {
  work: {
    titles: [
      'manager', 'boss', 'supervisor', 'director', 'ceo', 'cto', 'cfo',
      'colleague', 'coworker', 'teammate', 'lead', 'report', 'intern',
      'client', 'customer', 'vendor', 'contractor', 'consultant',
      'recruiter', 'interviewer', 'hr', 'pm', 'product manager',
      'engineer', 'developer', 'designer', 'analyst', 'coordinator'
    ],
    contextKeywords: [
      'meeting', 'standup', '1:1', '1on1', 'slack', 'email', 'project',
      'deadline', 'review', 'feedback', 'presentation', 'sprint',
      'office', 'work', 'job', 'company', 'team', 'department',
      'performance', 'promotion', 'salary', 'bonus', 'quarterly',
      'retro', 'planning', 'roadmap', 'stakeholder', 'sync'
    ],
    patterns: [
      /@project:/i,
      /@meeting:/i,
      /@1on1:/i,
      /work/i,
      /office/i,
      /team/i
    ]
  },
  personal: {
    titles: [
      'friend', 'buddy', 'pal', 'bestie', 'bff',
      'partner', 'spouse', 'husband', 'wife', 'boyfriend', 'girlfriend',
      'fiance', 'fiancee', 'significant other', 'so',
      'mom', 'mother', 'dad', 'father', 'parent',
      'brother', 'sister', 'sibling', 'bro', 'sis',
      'grandma', 'grandpa', 'grandmother', 'grandfather', 'grandparent',
      'aunt', 'uncle', 'cousin', 'niece', 'nephew',
      'son', 'daughter', 'kid', 'child',
      'neighbor', 'roommate', 'flatmate'
    ],
    contextKeywords: [
      'dinner', 'lunch', 'brunch', 'coffee', 'drinks', 'hangout',
      'birthday', 'anniversary', 'holiday', 'christmas', 'thanksgiving',
      'wedding', 'baby', 'vacation', 'trip', 'weekend', 'movie',
      'game', 'concert', 'party', 'bbq', 'picnic', 'beach',
      'home', 'house', 'apartment', 'visit', 'call', 'text',
      'love', 'miss', 'care', 'worried', 'proud', 'support'
    ],
    patterns: [
      /family/i,
      /home/i,
      /weekend/i,
      /birthday/i,
      /vacation/i
    ]
  }
};

/**
 * Categorize a relationship based on tag and context
 *
 * @param {string} personTag - The @person:X tag
 * @param {string} entryContext - The full entry text for context
 * @param {Object} userPreferences - User's manual categorizations
 * @returns {Object} Category and confidence
 */
export const categorizeRelationship = (personTag, entryContext = '', userPreferences = {}) => {
  const personName = personTag.replace('@person:', '').toLowerCase();

  // Check if user has manually categorized this person
  if (userPreferences[personName]) {
    return {
      category: userPreferences[personName],
      confidence: 1.0,
      source: 'user_preference'
    };
  }

  const context = entryContext.toLowerCase();
  let workScore = 0;
  let personalScore = 0;

  // Check title patterns in the tag itself
  for (const title of RELATIONSHIP_PATTERNS.work.titles) {
    if (personName.includes(title)) {
      workScore += 3;
    }
  }

  for (const title of RELATIONSHIP_PATTERNS.personal.titles) {
    if (personName.includes(title)) {
      personalScore += 3;
    }
  }

  // Check context keywords
  for (const keyword of RELATIONSHIP_PATTERNS.work.contextKeywords) {
    if (context.includes(keyword)) {
      workScore += 1;
    }
  }

  for (const keyword of RELATIONSHIP_PATTERNS.personal.contextKeywords) {
    if (context.includes(keyword)) {
      personalScore += 1;
    }
  }

  // Check regex patterns
  for (const pattern of RELATIONSHIP_PATTERNS.work.patterns) {
    if (pattern.test(context)) {
      workScore += 2;
    }
  }

  for (const pattern of RELATIONSHIP_PATTERNS.personal.patterns) {
    if (pattern.test(context)) {
      personalScore += 2;
    }
  }

  // Time-based heuristics
  const entryTime = extractTimeFromContext(context);
  if (entryTime) {
    const hour = entryTime.getHours();
    // Work hours (9-6) lean work, evening/weekend lean personal
    if (hour >= 9 && hour <= 18) {
      workScore += 0.5;
    } else if (hour >= 18 || hour <= 8) {
      personalScore += 0.5;
    }
  }

  // Calculate category
  const totalScore = workScore + personalScore;
  if (totalScore === 0) {
    return {
      category: 'ambiguous',
      confidence: 0,
      source: 'no_signals',
      workScore,
      personalScore
    };
  }

  const workRatio = workScore / totalScore;

  if (workRatio > 0.65) {
    return {
      category: 'work',
      confidence: Math.min(workRatio, 0.9),
      source: 'heuristic',
      workScore,
      personalScore
    };
  } else if (workRatio < 0.35) {
    return {
      category: 'personal',
      confidence: Math.min(1 - workRatio, 0.9),
      source: 'heuristic',
      workScore,
      personalScore
    };
  } else {
    return {
      category: 'ambiguous',
      confidence: 0.5 - Math.abs(workRatio - 0.5),
      source: 'mixed_signals',
      workScore,
      personalScore
    };
  }
};

/**
 * Extract time context from entry text
 */
const extractTimeFromContext = (context) => {
  // Look for time patterns
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)?/i,
    /(morning|afternoon|evening|night)/i
  ];

  for (const pattern of timePatterns) {
    const match = context.match(pattern);
    if (match) {
      // Return a rough time estimate
      if (match[1]?.toLowerCase() === 'morning') return new Date().setHours(9, 0, 0, 0);
      if (match[1]?.toLowerCase() === 'afternoon') return new Date().setHours(14, 0, 0, 0);
      if (match[1]?.toLowerCase() === 'evening') return new Date().setHours(19, 0, 0, 0);
      if (match[1]?.toLowerCase() === 'night') return new Date().setHours(21, 0, 0, 0);
    }
  }

  return null;
};

/**
 * Get user's relationship preferences (manual categorizations)
 */
export const getUserRelationshipPreferences = async (userId) => {
  try {
    const prefsRef = doc(db, `users/${userId}/settings/relationship_categories`);
    const snapshot = await getDoc(prefsRef);

    if (!snapshot.exists()) {
      return {};
    }

    return snapshot.data().categories || {};
  } catch (error) {
    console.error('Failed to get relationship preferences:', error);
    return {};
  }
};

/**
 * Save a user's manual categorization for a person
 */
export const saveRelationshipCategory = async (userId, personName, category) => {
  const prefsRef = doc(db, `users/${userId}/settings/relationship_categories`);

  try {
    const snapshot = await getDoc(prefsRef);
    const existing = snapshot.exists() ? snapshot.data().categories || {} : {};

    await setDoc(prefsRef, {
      categories: {
        ...existing,
        [personName.toLowerCase()]: category
      },
      updatedAt: new Date()
    }, { merge: true });

    return true;
  } catch (error) {
    console.error('Failed to save relationship category:', error);
    return false;
  }
};

/**
 * Batch categorize all person mentions with confidence scores
 */
export const categorizeAllRelationships = async (personMentions, userPreferences = {}) => {
  const categorized = {
    work: [],
    personal: [],
    ambiguous: []
  };

  const seen = new Set();

  for (const mention of personMentions) {
    const personName = mention.tag.replace('@person:', '').toLowerCase();

    // Deduplicate by person name
    if (seen.has(personName)) continue;
    seen.add(personName);

    // Build context from all mentions of this person
    const allContexts = personMentions
      .filter(m => m.tag.toLowerCase() === mention.tag.toLowerCase())
      .map(m => m.context || '')
      .join(' ');

    const result = categorizeRelationship(mention.tag, allContexts, userPreferences);

    const enrichedMention = {
      ...mention,
      name: personName,
      ...result
    };

    categorized[result.category].push(enrichedMention);
  }

  return {
    work: categorized.work.sort((a, b) => b.confidence - a.confidence),
    personal: categorized.personal.sort((a, b) => b.confidence - a.confidence),
    ambiguous: categorized.ambiguous,
    summary: {
      workCount: categorized.work.length,
      personalCount: categorized.personal.length,
      ambiguousCount: categorized.ambiguous.length,
      needsUserInput: categorized.ambiguous.length > 0
    }
  };
};

export default {
  categorizeRelationship,
  categorizeAllRelationships,
  getUserRelationshipPreferences,
  saveRelationshipCategory,
  RELATIONSHIP_PATTERNS
};
