/**
 * Advanced Insight Generator
 *
 * Combines outputs from all pattern detection services to generate
 * meaningful, actionable insights for the user.
 *
 * Features:
 * - Deduplication of similar insights
 * - Novelty detection (avoid repeating known insights)
 * - Priority scoring based on actionability and relevance
 * - Formats for different UI contexts (dashboard, chat, notifications)
 */

import { mineAssociationRules, formatRulesAsInsights } from './associationRules';
import { mineSequencePatterns, analyzeRecoveryPatterns } from './sequencePatterns';
import { detectAnomalies, getRecentAnomalies, formatAnomalyForUI } from './anomalyDetection';

/**
 * Insight priority categories
 */
const PRIORITY_LEVELS = {
  CRITICAL: 1,    // Anomalies, concerning patterns
  HIGH: 2,        // Confirmed patterns with significant impact
  MEDIUM: 3,      // Pending validation patterns
  LOW: 4,         // General observations
  INFORMATIONAL: 5 // Neutral observations
};

/**
 * Calculate priority score for an insight
 */
const calculatePriority = (insight) => {
  // Anomalies get high priority
  if (insight.source === 'anomaly') {
    return insight.severity === 'high' ? PRIORITY_LEVELS.CRITICAL : PRIORITY_LEVELS.HIGH;
  }

  // Confirmed patterns with high impact
  if (insight.validationState === 'confirmed') {
    const impactMagnitude = Math.abs(insight.moodImpact || 0);
    if (impactMagnitude >= 20) return PRIORITY_LEVELS.HIGH;
    return PRIORITY_LEVELS.MEDIUM;
  }

  // Pending validation patterns
  if (insight.validationState === 'pending_validation') {
    return PRIORITY_LEVELS.MEDIUM;
  }

  // Recovery patterns are informational but useful
  if (insight.type === 'recovery_signature') {
    return insight.totalRecoveries >= 3 ? PRIORITY_LEVELS.MEDIUM : PRIORITY_LEVELS.LOW;
  }

  return PRIORITY_LEVELS.LOW;
};

/**
 * Check if two insights are similar (for deduplication)
 */
const areSimilarInsights = (insight1, insight2) => {
  // Same source type
  if (insight1.source !== insight2.source) return false;

  // Association rules: similar if they share >70% factors
  if (insight1.factors && insight2.factors) {
    const set1 = new Set(insight1.factors);
    const set2 = new Set(insight2.factors);
    const intersection = [...set1].filter(x => set2.has(x));
    const overlapRatio = intersection.length / Math.max(set1.size, set2.size);
    return overlapRatio > 0.7;
  }

  // Sequence patterns: similar if same pattern elements
  if (insight1.pattern && insight2.pattern) {
    const overlap = insight1.pattern.filter(p => insight2.pattern.includes(p));
    return overlap.length >= Math.min(insight1.pattern.length, insight2.pattern.length) * 0.7;
  }

  return false;
};

/**
 * Deduplicate insights, keeping the most confident version
 */
const deduplicateInsights = (insights) => {
  const unique = [];

  for (const insight of insights) {
    const similarIndex = unique.findIndex(u => areSimilarInsights(u, insight));

    if (similarIndex === -1) {
      unique.push(insight);
    } else {
      // Keep the more confident or higher priority version
      const existing = unique[similarIndex];
      const existingPriority = calculatePriority(existing);
      const newPriority = calculatePriority(insight);

      if (newPriority < existingPriority ||
          (newPriority === existingPriority && (insight.confidence || 0) > (existing.confidence || 0))) {
        unique[similarIndex] = insight;
      }
    }
  }

  return unique;
};

/**
 * Check if insight is novel (not recently shown)
 */
const isNovelInsight = (insight, recentlyShown = []) => {
  return !recentlyShown.some(shown => areSimilarInsights(shown, insight));
};

/**
 * Generate all advanced insights from entries
 *
 * @param {Object[]} entries - Journal entries
 * @param {Object} options - Generation options
 * @returns {Object} Comprehensive insight analysis
 */
export const generateAdvancedInsights = async (entries, options = {}) => {
  const {
    recentlyShown = [],
    maxInsights = 10,
    includeAnomalies = true,
    includeSequences = true,
    includeRecovery = true
  } = options;

  const allInsights = [];

  // 1. Mine association rules
  try {
    const rules = mineAssociationRules(entries);
    const ruleInsights = formatRulesAsInsights(rules)
      .filter(r => r.validationState !== 'hidden')
      .map(r => ({
        ...r,
        source: 'association_rule',
        priority: calculatePriority(r)
      }));
    allInsights.push(...ruleInsights);
  } catch (e) {
    console.error('Association rule mining failed:', e);
  }

  // 2. Mine sequence patterns
  if (includeSequences) {
    try {
      const sequences = mineSequencePatterns(entries);
      const sequenceInsights = sequences.map(s => ({
        id: s.id,
        type: 'sequence',
        source: 'sequence_pattern',
        message: s.explanation,
        pattern: s.pattern,
        occurrences: s.occurrences,
        moodImpact: -Math.round(s.avgMoodDrop * 100),
        confidence: Math.round(s.confidence * 100),
        validationState: s.validationState,
        priority: calculatePriority({ ...s, validationState: s.validationState })
      }));
      allInsights.push(...sequenceInsights);
    } catch (e) {
      console.error('Sequence pattern mining failed:', e);
    }
  }

  // 3. Analyze recovery patterns
  if (includeRecovery) {
    try {
      const recovery = analyzeRecoveryPatterns(entries);
      if (recovery.insight) {
        allInsights.push({
          id: recovery.id,
          type: 'recovery_signature',
          source: 'recovery_analysis',
          message: recovery.insight,
          detail: recovery.yourPattern,
          totalRecoveries: recovery.totalRecoveries,
          avgRecoveryDays: recovery.avgRecoveryDays,
          commonFactors: recovery.commonFactors,
          validationState: recovery.validationState,
          priority: calculatePriority(recovery)
        });
      }
    } catch (e) {
      console.error('Recovery pattern analysis failed:', e);
    }
  }

  // 4. Detect anomalies
  if (includeAnomalies) {
    try {
      const anomalies = detectAnomalies(entries);
      const recentAnomalies = getRecentAnomalies(anomalies, 14); // Last 2 weeks

      const anomalyInsights = recentAnomalies.slice(0, 3).map(a => {
        const formatted = formatAnomalyForUI(a);
        return {
          ...formatted,
          source: 'anomaly',
          type: 'anomaly',
          severity: formatted.severity,
          priority: calculatePriority({ source: 'anomaly', severity: formatted.severity })
        };
      });
      allInsights.push(...anomalyInsights);
    } catch (e) {
      console.error('Anomaly detection failed:', e);
    }
  }

  // 5. Deduplicate
  const uniqueInsights = deduplicateInsights(allInsights);

  // 6. Filter for novelty
  const novelInsights = uniqueInsights.filter(i => isNovelInsight(i, recentlyShown));

  // 7. Sort by priority
  const sortedInsights = novelInsights.sort((a, b) => a.priority - b.priority);

  // 8. Limit results
  const limitedInsights = sortedInsights.slice(0, maxInsights);

  // Generate summary stats
  const stats = {
    totalGenerated: allInsights.length,
    afterDeduplication: uniqueInsights.length,
    afterNoveltyFilter: novelInsights.length,
    returned: limitedInsights.length,
    bySource: {
      association_rule: limitedInsights.filter(i => i.source === 'association_rule').length,
      sequence_pattern: limitedInsights.filter(i => i.source === 'sequence_pattern').length,
      recovery_analysis: limitedInsights.filter(i => i.source === 'recovery_analysis').length,
      anomaly: limitedInsights.filter(i => i.source === 'anomaly').length
    },
    byPriority: {
      critical: limitedInsights.filter(i => i.priority === PRIORITY_LEVELS.CRITICAL).length,
      high: limitedInsights.filter(i => i.priority === PRIORITY_LEVELS.HIGH).length,
      medium: limitedInsights.filter(i => i.priority === PRIORITY_LEVELS.MEDIUM).length,
      low: limitedInsights.filter(i => i.priority === PRIORITY_LEVELS.LOW).length
    }
  };

  return {
    insights: limitedInsights,
    stats,
    generatedAt: new Date().toISOString()
  };
};

/**
 * Format insights for dashboard display
 */
export const formatForDashboard = (insights) => {
  return insights.map(insight => ({
    id: insight.id,
    type: insight.type || insight.source,
    icon: getInsightIcon(insight),
    title: getInsightTitle(insight),
    message: insight.message,
    detail: insight.detail || insight.detailedExplanation,
    sentiment: insight.moodImpact > 0 ? 'positive' : insight.moodImpact < 0 ? 'negative' : 'neutral',
    confidence: insight.confidence,
    validationState: insight.validationState,
    canDismiss: insight.validationState !== 'hidden',
    canConfirm: insight.validationState === 'pending_validation'
  }));
};

/**
 * Format insights for chat context
 */
export const formatForChat = (insights) => {
  const relevantInsights = insights
    .filter(i => i.validationState === 'confirmed')
    .slice(0, 5);

  if (relevantInsights.length === 0) return null;

  const lines = relevantInsights.map(i => `- ${i.message}`);

  return `PATTERN INSIGHTS (share naturally when relevant):\n${lines.join('\n')}`;
};

/**
 * Get icon for insight type
 */
const getInsightIcon = (insight) => {
  const icons = {
    association_rule: insight.moodImpact > 0 ? 'trending-up' : 'trending-down',
    sequence_pattern: 'git-branch',
    recovery_analysis: 'heart',
    anomaly: 'alert-circle'
  };
  return icons[insight.source] || 'lightbulb';
};

/**
 * Get title for insight
 */
const getInsightTitle = (insight) => {
  if (insight.title) return insight.title;

  const titles = {
    association_rule: insight.moodImpact > 0 ? 'Mood Booster Found' : 'Mood Pattern Detected',
    sequence_pattern: 'Sequence Pattern',
    recovery_analysis: 'Your Recovery Style',
    anomaly: 'Unusual Entry'
  };
  return titles[insight.source] || 'Insight';
};

/**
 * Get top insight for notification
 */
export const getTopInsightForNotification = (insights) => {
  if (insights.length === 0) return null;

  const topInsight = insights[0];

  return {
    title: getInsightTitle(topInsight),
    body: topInsight.message.substring(0, 100) + (topInsight.message.length > 100 ? '...' : ''),
    data: {
      insightId: topInsight.id,
      type: topInsight.source
    }
  };
};

export default {
  generateAdvancedInsights,
  formatForDashboard,
  formatForChat,
  getTopInsightForNotification,
  PRIORITY_LEVELS
};
