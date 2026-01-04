/**
 * Insight Templates Service
 *
 * Provides hypothesis-style and statement-style templates for insights.
 * Hypothesis framing presents insights as collaborative questions,
 * which feels more engaging than declarative statements.
 *
 * Example:
 * Statement: "Yoga boosts your mood by 23%"
 * Hypothesis: "I noticed you feel lighter after yoga. What makes those sessions special?"
 */

/**
 * Template definitions for each insight type
 * Each type has both 'statement' and 'hypothesis' versions
 */
export const INSIGHT_TEMPLATES = {
  // Activity sentiment patterns
  positive_activity: {
    statement: '{entityName} tends to boost your mood by {deltaPercent}%',
    hypothesis: 'I noticed you feel better around {entityName}. What makes those moments special?',
    icon: 'trending-up',
    color: 'green'
  },
  negative_activity: {
    statement: 'Your mood tends to dip {deltaPercent}% around {entityName}',
    hypothesis: 'There seems to be some friction around {entityName}. Would it help to explore that?',
    icon: 'trending-down',
    color: 'red'
  },

  // Shadow friction (intersections)
  shadow_friction: {
    statement: '{intersectionDescription}',
    hypothesis: 'I noticed {primaryName} feels different in the context of {secondaryName}. Did something shift there?',
    icon: 'users',
    color: 'violet'
  },
  shadow_friction_positive: {
    statement: '{primaryName} + {secondaryName} is especially positive (+{deltaPercent}%)',
    hypothesis: 'Something about {secondaryName} with {primaryName} really works for you. What makes it special?',
    icon: 'users',
    color: 'green'
  },
  shadow_friction_negative: {
    statement: '{primaryName} + {secondaryName} tends to be harder ({deltaPercent}% mood dip)',
    hypothesis: 'I noticed {secondaryName} with {primaryName} can be challenging. Is there tension there?',
    icon: 'users',
    color: 'amber'
  },

  // Absence warnings
  absence_warning: {
    statement: 'When {entityName} goes quiet for 2-3 days, a dip follows {correlationPercent}% of the time',
    hypothesis: 'It\'s been a bit since {entityName} came up. Might be worth reconnecting?',
    icon: 'alert-circle',
    color: 'amber'
  },
  absence_warning_active: {
    statement: '{daysSinceLastMention} days since {entityName} - this pattern sometimes precedes a dip',
    hypothesis: 'I noticed {entityName} hasn\'t come up in a few days. How are you feeling about that?',
    icon: 'alert-circle',
    color: 'amber'
  },

  // Linguistic shifts
  linguistic_shift: {
    statement: '{category} language has {direction}d {changePercent}%',
    hypothesis: 'Your language is shifting - {observation}. Does that feel accurate?',
    icon: 'message-square',
    color: 'indigo'
  },
  linguistic_shift_positive: {
    statement: '{insight}',
    hypothesis: 'I\'m noticing a positive shift in how you talk to yourself. Can you feel it too?',
    icon: 'message-square',
    color: 'green'
  },
  linguistic_shift_concerning: {
    statement: '{insight}',
    hypothesis: 'Your self-talk seems a bit harder lately. What\'s going on?',
    icon: 'message-square',
    color: 'amber'
  },

  // Temporal patterns
  best_day: {
    statement: '{dayName}s are usually your best days (avg mood: {avgMoodPercent}%)',
    hypothesis: 'I\'ve noticed {dayName}s tend to go well for you. What makes them different?',
    icon: 'sun',
    color: 'amber'
  },
  worst_day: {
    statement: '{dayName}s tend to be harder for you (avg mood: {avgMoodPercent}%)',
    hypothesis: '{dayName}s seem to be tougher. Is there a pattern there you\'ve noticed?',
    icon: 'cloud',
    color: 'blue'
  },

  // Contradictions
  pattern_contradiction: {
    statement: 'Today feels different than usual with {entityName}',
    hypothesis: 'You usually feel {expectedFeeling} with {entityName}. What\'s different today?',
    icon: 'alert-octagon',
    color: 'purple'
  },
  goal_abandonment: {
    statement: 'Goal "{goalName}" hasn\'t been mentioned in {daysSinceLastMention} days',
    hypothesis: 'I noticed "{goalName}" has been quiet. Still important, or has something shifted?',
    icon: 'target',
    color: 'orange'
  },

  // Recovery patterns
  recovery_pattern: {
    statement: 'After low moments, {recoveryActivity} has helped {recoveryPercent}% of the time',
    hypothesis: 'When things get hard, {recoveryActivity} seems to help. Worth keeping in mind?',
    icon: 'heart',
    color: 'pink'
  },

  // Mood triggers
  mood_drop_precursor: {
    statement: '{entityName} often precedes mood drops',
    hypothesis: 'I\'ve noticed mood shifts tend to follow {entityName}. Any thoughts on why?',
    icon: 'zap',
    color: 'amber'
  },
  mood_boost_precursor: {
    statement: '{entityName} often precedes mood boosts',
    hypothesis: '{entityName} seems to set up good days. Might be worth leaning into?',
    icon: 'zap',
    color: 'green'
  }
};

/**
 * Format an insight using templates
 *
 * @param {Object} pattern - The pattern data
 * @param {string} style - 'hypothesis' or 'statement'
 * @returns {string} Formatted insight text
 */
export const formatInsight = (pattern, style = 'hypothesis') => {
  const templateKey = getTemplateKey(pattern);
  const template = INSIGHT_TEMPLATES[templateKey];

  if (!template) {
    // Fallback to existing message
    return pattern.message || pattern.insight || 'No insight available';
  }

  const templateString = template[style] || template.statement;
  return interpolate(templateString, pattern);
};

/**
 * Determine which template to use based on pattern data
 */
const getTemplateKey = (pattern) => {
  const type = pattern.type;

  // Handle subtypes
  if (type === 'shadow_friction') {
    if (pattern.sentiment === 'positive') return 'shadow_friction_positive';
    if (pattern.sentiment === 'negative') return 'shadow_friction_negative';
    return 'shadow_friction';
  }

  if (type === 'absence_warning') {
    if (pattern.isActiveWarning) return 'absence_warning_active';
    return 'absence_warning';
  }

  if (type === 'linguistic_shift') {
    if (pattern.sentiment === 'positive') return 'linguistic_shift_positive';
    if (pattern.sentiment === 'concerning') return 'linguistic_shift_concerning';
    return 'linguistic_shift';
  }

  return type;
};

/**
 * Generate dynamic observation text for linguistic shifts
 */
const getLinguisticObservation = (data) => {
  // If there's already a computed insight/message, use it
  if (data.insight || data.message) {
    return data.insight || data.message;
  }

  // Generate based on category and direction
  const category = data.category;
  const direction = data.direction;

  const observations = {
    obligation: {
      decrease: 'less "should" and "must" - more self-compassion',
      increase: 'more "should" language - are expectations building up?'
    },
    agency: {
      increase: 'more "I want" and "I choose" - growing sense of ownership',
      decrease: 'less agency language lately'
    },
    negative_self: {
      decrease: 'gentler self-talk - fewer harsh absolutes',
      increase: 'more self-critical language appearing'
    },
    positive_self: {
      increase: 'more self-encouragement and acknowledgment',
      decrease: 'less positive self-talk lately'
    },
    catastrophizing: {
      decrease: 'less black-and-white thinking',
      increase: 'more all-or-nothing language appearing'
    },
    growth: {
      increase: 'more "I\'m learning" and "I realized" - reflective growth',
      decrease: 'fewer growth-oriented observations'
    },
    self_compassion: {
      increase: 'more kindness toward yourself',
      decrease: 'less self-compassion in your words'
    },
    harsh_self: {
      decrease: 'less harsh self-judgment - that\'s healthy',
      increase: 'more critical self-talk - be gentle with yourself'
    }
  };

  return observations[category]?.[direction] || 'a shift in your self-talk';
};

/**
 * Interpolate variables into template string
 *
 * @param {string} template - Template with {variable} placeholders
 * @param {Object} data - Data object with variable values
 * @returns {string} Interpolated string
 */
const interpolate = (template, data) => {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (data.hasOwnProperty(key)) {
      return data[key];
    }

    // Handle computed fields
    switch (key) {
      case 'avgMoodPercent':
        return Math.round((data.avgMood || 0.5) * 100);
      case 'expectedFeeling':
        return data.avgMood > 0.6 ? 'better' : data.avgMood < 0.4 ? 'challenged' : 'neutral';
      case 'intersectionDescription':
        return data.insight || data.message || '';
      case 'observation':
        return getLinguisticObservation(data);
      default:
        return match; // Keep placeholder if no data
    }
  });
};

/**
 * Get template metadata (icon, color) for a pattern type
 *
 * @param {string} type - Pattern type
 * @returns {Object} { icon, color }
 */
export const getTemplateStyle = (type) => {
  const template = INSIGHT_TEMPLATES[type];
  if (!template) {
    return { icon: 'sparkles', color: 'secondary' };
  }
  return {
    icon: template.icon,
    color: template.color
  };
};

/**
 * Convert all insights in a list to hypothesis style
 *
 * @param {Object[]} patterns - Array of patterns
 * @returns {Object[]} Patterns with hypothesis-style messages
 */
export const toHypothesisStyle = (patterns) => {
  return patterns.map(pattern => ({
    ...pattern,
    message: formatInsight(pattern, 'hypothesis'),
    originalMessage: pattern.message
  }));
};

/**
 * User preference for insight style
 * Can be stored in user settings
 */
export const INSIGHT_STYLES = {
  HYPOTHESIS: 'hypothesis',
  STATEMENT: 'statement',
  MIXED: 'mixed' // Alternate between styles
};

export default {
  INSIGHT_TEMPLATES,
  formatInsight,
  getTemplateStyle,
  toHypothesisStyle,
  INSIGHT_STYLES
};
