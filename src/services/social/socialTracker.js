/**
 * Social Connection Tracker Service
 *
 * Monitors social connection patterns to detect isolation risks
 * and encourage meaningful personal connections during stressful times.
 *
 * Key insight: Research shows that social connection is a primary
 * resilience factor. When work dominates all mentions and personal
 * connections fade, it's often an early warning of burnout.
 */

import { collection, query, where, getDocs, orderBy, limit, doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import {
  categorizeRelationship,
  categorizeAllRelationships,
  getUserRelationshipPreferences
} from './relationshipCategorizer';

// Thresholds for social health analysis
export const SOCIAL_THRESHOLDS = {
  // Less than 3 personal mentions in 14 days = isolation risk
  ISOLATION_RISK_THRESHOLD: 3,

  // Work/personal ratio above 5:1 = imbalanced
  WORK_PERSONAL_IMBALANCE_RATIO: 5,

  // Days since last mention to consider "neglected"
  NEGLECTED_DAYS_THRESHOLD: 30,

  // Minimum mentions to establish a "key relationship"
  KEY_RELATIONSHIP_THRESHOLD: 3
};

/**
 * Extract person mentions from entries
 *
 * @param {Array} entries - Journal entries with analysis
 * @returns {Array} Person mentions with context
 */
export const extractPersonMentions = (entries) => {
  const mentions = [];

  for (const entry of entries) {
    // Get person tags from analysis
    const tags = entry.analysis?.tags || entry.tags || [];
    const personTags = tags.filter(tag =>
      tag.startsWith('@person:') || tag.startsWith('person:')
    );

    for (const tag of personTags) {
      mentions.push({
        tag: tag.startsWith('@') ? tag : `@${tag}`,
        entryId: entry.id,
        entryDate: entry.createdAt?.toDate?.() || new Date(entry.createdAt),
        context: entry.content?.substring(0, 500) || '',
        sentiment: entry.analysis?.sentiment || 'neutral',
        moodScore: entry.analysis?.mood_score || 0.5
      });
    }
  }

  return mentions;
};

/**
 * Analyze social health over a time period
 *
 * @param {string} userId
 * @param {number} dateRange - Days to analyze
 * @returns {Object} Social health analysis
 */
export const analyzeSocialHealth = async (userId, dateRange = 14) => {
  try {
    // Get entries from the date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - dateRange);

    const entriesRef = collection(db, `users/${userId}/entries`);
    const entriesQuery = query(
      entriesRef,
      where('createdAt', '>=', cutoffDate),
      orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(entriesQuery);
    const entries = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Extract person mentions
    const personMentions = extractPersonMentions(entries);

    // Get user's relationship preferences
    const userPreferences = await getUserRelationshipPreferences(userId);

    // Categorize all relationships
    const categorized = await categorizeAllRelationships(personMentions, userPreferences);

    // Calculate social health metrics
    const workMentions = personMentions.filter(p => {
      const result = categorizeRelationship(p.tag, p.context, userPreferences);
      return result.category === 'work';
    });

    const personalMentions = personMentions.filter(p => {
      const result = categorizeRelationship(p.tag, p.context, userPreferences);
      return result.category === 'personal';
    });

    // Count unique people, not just mentions
    const uniqueWorkPeople = new Set(workMentions.map(p => p.tag.toLowerCase())).size;
    const uniquePersonalPeople = new Set(personalMentions.map(p => p.tag.toLowerCase())).size;

    // Calculate work/personal ratio
    const workPersonalRatio = uniquePersonalPeople > 0
      ? uniqueWorkPeople / uniquePersonalPeople
      : uniqueWorkPeople > 0 ? Infinity : 0;

    // Detect isolation risk
    const isolationRisk = uniquePersonalPeople < SOCIAL_THRESHOLDS.ISOLATION_RISK_THRESHOLD;

    // Detect imbalance
    const isImbalanced = workPersonalRatio > SOCIAL_THRESHOLDS.WORK_PERSONAL_IMBALANCE_RATIO;

    // Find neglected connections
    const neglectedConnections = await findNeglectedConnections(userId, personMentions, dateRange);

    // Generate personalized suggestions
    const suggestions = generateSocialSuggestions({
      isolationRisk,
      isImbalanced,
      neglectedConnections,
      personalMentions,
      workPersonalRatio
    });

    return {
      available: true,
      dateRange,
      totalMentions: personMentions.length,
      uniquePeople: uniqueWorkPeople + uniquePersonalPeople,
      workMentions: workMentions.length,
      personalMentions: personalMentions.length,
      uniqueWorkPeople,
      uniquePersonalPeople,
      workPersonalRatio: Math.round(workPersonalRatio * 10) / 10,
      isolationRisk,
      isImbalanced,
      riskLevel: calculateRiskLevel(isolationRisk, isImbalanced, neglectedConnections),
      neglectedConnections,
      categorized,
      suggestions,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to analyze social health:', error);
    return {
      available: false,
      error: error.message
    };
  }
};

/**
 * Find people mentioned in past but not recently
 */
export const findNeglectedConnections = async (userId, recentMentions, dateRange) => {
  try {
    const recentPersons = new Set(recentMentions.map(p => p.tag.toLowerCase()));

    // Get older entries to find historical connections
    const oldCutoff = new Date();
    oldCutoff.setDate(oldCutoff.getDate() - dateRange);

    const olderCutoff = new Date();
    olderCutoff.setDate(olderCutoff.getDate() - 180); // Look back 6 months

    const entriesRef = collection(db, `users/${userId}/entries`);
    const olderQuery = query(
      entriesRef,
      where('createdAt', '>=', olderCutoff),
      where('createdAt', '<', oldCutoff),
      orderBy('createdAt', 'desc'),
      limit(200)
    );

    const snapshot = await getDocs(olderQuery);
    const olderEntries = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const olderMentions = extractPersonMentions(olderEntries);

    // Get user preferences
    const userPreferences = await getUserRelationshipPreferences(userId);

    // Find personal connections that haven't been mentioned recently
    const neglected = [];
    const seen = new Set();

    for (const mention of olderMentions) {
      const personName = mention.tag.toLowerCase();

      if (seen.has(personName)) continue;
      if (recentPersons.has(personName)) continue;

      seen.add(personName);

      const category = categorizeRelationship(mention.tag, mention.context, userPreferences);

      // Only track neglected personal connections
      if (category.category !== 'personal') continue;

      // Calculate days since last mention
      const daysSince = Math.floor(
        (new Date() - mention.entryDate) / (1000 * 60 * 60 * 24)
      );

      if (daysSince >= SOCIAL_THRESHOLDS.NEGLECTED_DAYS_THRESHOLD) {
        neglected.push({
          tag: mention.tag,
          name: personName.replace('@person:', ''),
          lastMentioned: mention.entryDate,
          daysSince,
          lastContext: mention.context,
          lastSentiment: mention.sentiment
        });
      }
    }

    // Sort by days since (most neglected first)
    return neglected
      .sort((a, b) => b.daysSince - a.daysSince)
      .slice(0, 5); // Top 5 neglected
  } catch (error) {
    console.error('Failed to find neglected connections:', error);
    return [];
  }
};

/**
 * Calculate overall social risk level
 */
const calculateRiskLevel = (isolationRisk, isImbalanced, neglectedConnections) => {
  let riskScore = 0;

  if (isolationRisk) riskScore += 3;
  if (isImbalanced) riskScore += 2;
  if (neglectedConnections.length >= 3) riskScore += 1;

  if (riskScore >= 5) return 'high';
  if (riskScore >= 3) return 'moderate';
  if (riskScore >= 1) return 'low';
  return 'healthy';
};

/**
 * Generate personalized social connection suggestions
 */
const generateSocialSuggestions = ({
  isolationRisk,
  isImbalanced,
  neglectedConnections,
  personalMentions,
  workPersonalRatio
}) => {
  const suggestions = [];

  if (isolationRisk) {
    suggestions.push({
      type: 'isolation_alert',
      priority: 'high',
      message: 'It\'s been a while since you mentioned connecting with friends or family.',
      action: 'Consider reaching out to someone who makes you feel supported.',
      icon: 'Heart'
    });
  }

  if (isImbalanced && workPersonalRatio !== Infinity) {
    suggestions.push({
      type: 'balance_nudge',
      priority: 'medium',
      message: `Your work connections outnumber personal ones ${Math.round(workPersonalRatio)}:1.`,
      action: 'Even a quick text to a friend can help restore balance.',
      icon: 'Scale'
    });
  }

  if (neglectedConnections.length > 0) {
    const topNeglected = neglectedConnections[0];
    suggestions.push({
      type: 'reconnection',
      priority: 'medium',
      message: `You haven't mentioned ${topNeglected.name} in ${topNeglected.daysSince} days.`,
      action: `Send a quick "thinking of you" message to ${topNeglected.name}?`,
      person: topNeglected,
      icon: 'MessageCircle'
    });
  }

  // Positive reinforcement when things are good
  if (!isolationRisk && !isImbalanced && personalMentions.length >= 5) {
    suggestions.push({
      type: 'positive_reinforcement',
      priority: 'low',
      message: 'Your social connections look healthy!',
      action: 'Keep nurturing these relationships - they\'re a key part of your resilience.',
      icon: 'Sparkles'
    });
  }

  return suggestions;
};

/**
 * Get quick actions for social connection
 */
export const getSocialQuickActions = (socialHealth) => {
  const actions = [];

  if (socialHealth.neglectedConnections?.length > 0) {
    const person = socialHealth.neglectedConnections[0];
    actions.push({
      id: 'text_neglected',
      label: `Text ${person.name}`,
      description: `Last mentioned ${person.daysSince} days ago`,
      action: 'text',
      person: person.name
    });
  }

  actions.push({
    id: 'call_friend',
    label: 'Call a friend',
    description: 'Even a 5-minute call can boost your mood',
    action: 'call'
  });

  actions.push({
    id: 'schedule_hangout',
    label: 'Schedule a hangout',
    description: 'Put something on the calendar to look forward to',
    action: 'schedule'
  });

  return actions;
};

/**
 * Track when user takes a social action
 */
export const recordSocialAction = async (userId, action) => {
  try {
    const actionRef = doc(collection(db, `users/${userId}/social_actions`));

    await setDoc(actionRef, {
      type: action.type,
      person: action.person,
      action: action.action,
      completedAt: new Date(),
      outcome: action.outcome || null
    });

    return true;
  } catch (error) {
    console.error('Failed to record social action:', error);
    return false;
  }
};

/**
 * Get social connection timeline for visualization
 */
export const getSocialTimeline = async (userId, days = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const entriesRef = collection(db, `users/${userId}/entries`);
    const entriesQuery = query(
      entriesRef,
      where('createdAt', '>=', cutoffDate),
      orderBy('createdAt', 'asc')
    );

    const snapshot = await getDocs(entriesQuery);
    const entries = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    const mentions = extractPersonMentions(entries);
    const userPreferences = await getUserRelationshipPreferences(userId);

    // Group by day
    const timeline = {};

    for (const mention of mentions) {
      const dateKey = mention.entryDate.toISOString().split('T')[0];

      if (!timeline[dateKey]) {
        timeline[dateKey] = { work: 0, personal: 0, ambiguous: 0 };
      }

      const category = categorizeRelationship(mention.tag, mention.context, userPreferences);
      timeline[dateKey][category.category]++;
    }

    // Convert to array format
    const timelineArray = Object.entries(timeline).map(([date, counts]) => ({
      date,
      ...counts,
      total: counts.work + counts.personal + counts.ambiguous
    }));

    return timelineArray;
  } catch (error) {
    console.error('Failed to get social timeline:', error);
    return [];
  }
};

export default {
  extractPersonMentions,
  analyzeSocialHealth,
  findNeglectedConnections,
  getSocialQuickActions,
  recordSocialAction,
  getSocialTimeline,
  SOCIAL_THRESHOLDS
};
