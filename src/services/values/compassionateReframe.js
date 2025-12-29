/**
 * Compassionate Reframe Service
 *
 * Frames value gaps with compassion, acknowledging that:
 * - Values sometimes conflict and require trade-offs
 * - Context matters (deadlines, emergencies, etc.)
 * - Shame is counterproductive to behavior change
 *
 * Based on ACT principles: Values are directions, not destinations.
 * Missing a value-aligned action is information, not failure.
 */

import { CORE_VALUES } from './valuesTracker';

/**
 * Context clues that suggest a conscious trade-off rather than neglect
 */
const TRADE_OFF_CONTEXTS = {
  work_pressure: [
    'deadline', 'launch', 'crunch', 'overtime', 'urgent', 'emergency',
    'project due', 'presentation', 'client', 'boss', 'pressure'
  ],
  family_needs: [
    'sick kid', 'family emergency', 'parent needed', 'helping',
    'caregiving', 'hospital', 'appointment'
  ],
  health_issues: [
    'sick', 'injured', 'tired', 'exhausted', 'unwell', 'pain',
    'recovery', 'doctor said'
  ],
  financial_necessity: [
    'couldn\'t afford', 'saving for', 'bills', 'budget', 'money tight'
  ],
  social_obligation: [
    'couldn\'t say no', 'they needed', 'helping friend', 'wedding',
    'funeral', 'birthday'
  ]
};

/**
 * Micro-commitments for gentle course correction (5 minutes or less)
 */
const MICRO_COMMITMENTS = {
  health: [
    'Take a 5-minute stretch break',
    'Drink a full glass of water right now',
    'Step outside for 2 minutes of fresh air',
    'Do 10 deep breaths',
    'Stand up and walk around the room'
  ],
  connection: [
    'Send a quick text to someone you care about',
    'React to a friend\'s social media post',
    'Schedule a 15-min call for later this week',
    'Send a voice memo to a friend',
    'Share something you\'re grateful for with someone'
  ],
  selfcare: [
    'Close your eyes for 60 seconds',
    'Put your phone on Do Not Disturb for 30 minutes',
    'Make yourself a cup of tea',
    'Write down one thing you did well today',
    'Say "no" to one small thing today'
  ],
  growth: [
    'Read one article on a topic you\'re curious about',
    'Watch one 5-minute educational video',
    'Write down one thing you learned today',
    'Ask someone a question about their expertise',
    'Reflect on one mistake and what it taught you'
  ],
  balance: [
    'Set a hard stop time for work today',
    'Block 30 minutes of "nothing time" on your calendar',
    'Identify one thing you can delegate or skip',
    'Take a full lunch break away from your desk',
    'Unplug from work for the rest of the evening'
  ],
  creativity: [
    'Doodle for 2 minutes',
    'Take a photo of something that catches your eye',
    'Write 3 sentences about anything',
    'Listen to a song you love with full attention',
    'Rearrange something on your desk'
  ],
  consistency: [
    'Do just 2 minutes of the habit you\'ve been avoiding',
    'Set a reminder for tomorrow morning',
    'Write down your intention for tomorrow',
    'Celebrate one small win from today',
    'Forgive yourself for the streak break and restart'
  ]
};

/**
 * Analyze a value gap and generate compassionate framing
 *
 * @param {Object} valueGap - { value, alignmentScore, violations }
 * @param {Array} recentEntries - Recent entries for context
 * @returns {Object} Compassionate reframe
 */
export const generateCompassionateReframe = (valueGap, recentEntries = []) => {
  const { value, alignmentScore, violations = [] } = valueGap;
  const valueDef = CORE_VALUES[value];

  if (!valueDef) {
    return null;
  }

  // Check for trade-off context in recent entries
  const tradeOff = detectValueTradeOff(value, recentEntries);

  if (tradeOff.isTradeOff) {
    return generateTradeOffReframe(tradeOff, valueDef);
  }

  // Check if this is a pattern or one-time
  const isPattern = violations.length >= 3;

  if (isPattern) {
    return generatePatternAwarenessReframe(value, valueDef, violations);
  }

  // One-time or occasional gap
  return generateGentleAwarenessReframe(value, valueDef, alignmentScore);
};

/**
 * Detect if a value gap is due to a conscious trade-off
 */
const detectValueTradeOff = (sacrificedValue, entries) => {
  const combinedText = entries.map(e => e.text || '').join(' ').toLowerCase();

  // Look for context clues
  let detectedContext = null;
  let prioritizedValue = null;

  for (const [context, keywords] of Object.entries(TRADE_OFF_CONTEXTS)) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword)) {
        detectedContext = context;
        break;
      }
    }
    if (detectedContext) break;
  }

  if (!detectedContext) {
    return { isTradeOff: false };
  }

  // Map context to likely prioritized value
  const contextToValue = {
    work_pressure: 'achievement',
    family_needs: 'family',
    health_issues: 'health',
    financial_necessity: 'security',
    social_obligation: 'connection'
  };

  prioritizedValue = contextToValue[detectedContext];

  // Don't flag as trade-off if the prioritized value is the same as sacrificed
  if (prioritizedValue === sacrificedValue) {
    return { isTradeOff: false };
  }

  return {
    isTradeOff: true,
    context: formatContext(detectedContext),
    prioritizedValue,
    prioritizedLabel: CORE_VALUES[prioritizedValue]?.label || prioritizedValue,
    sacrificedValue,
    sacrificedLabel: CORE_VALUES[sacrificedValue]?.label || sacrificedValue
  };
};

/**
 * Format context for display
 */
const formatContext = (context) => {
  const labels = {
    work_pressure: 'a work deadline',
    family_needs: 'family needs',
    health_issues: 'health challenges',
    financial_necessity: 'financial priorities',
    social_obligation: 'social commitments'
  };
  return labels[context] || context;
};

/**
 * Generate reframe for conscious trade-offs
 */
const generateTradeOffReframe = (tradeOff, valueDef) => {
  const messages = [
    `You prioritized '${tradeOff.prioritizedLabel}' over '${tradeOff.sacrificedLabel}' recently because of ${tradeOff.context}. This was a conscious choice based on what mattered most in the moment.`,
    `Life sometimes asks us to choose between values. You chose '${tradeOff.prioritizedLabel}' when ${tradeOff.context} demanded it. That's not failure—it's navigation.`,
    `Values can compete. When ${tradeOff.context} required attention, you responded to what was urgent. '${tradeOff.sacrificedLabel}' isn't lost, just waiting.`
  ];

  return {
    type: 'trade_off_acknowledgment',
    tone: 'understanding',
    message: messages[Math.floor(Math.random() * messages.length)],
    prioritizedValue: tradeOff.prioritizedValue,
    sacrificedValue: tradeOff.sacrificedValue,
    context: tradeOff.context,
    rebalancePrompt: {
      question: `Now that ${tradeOff.context} has passed, how might you reconnect with '${tradeOff.sacrificedLabel}'?`,
      suggestions: [
        `Schedule one ${tradeOff.sacrificedLabel.toLowerCase()}-aligned activity this week`,
        `Set a small boundary to protect time for ${tradeOff.sacrificedLabel.toLowerCase()}`,
        `Reflect on what sustainable balance looks like for you`
      ]
    },
    microCommitment: getRandomMicroCommitment(tradeOff.sacrificedValue)
  };
};

/**
 * Generate reframe for recurring patterns
 */
const generatePatternAwarenessReframe = (value, valueDef, violations) => {
  const messages = [
    `I notice a pattern: '${valueDef.label}' has been getting less attention lately. This isn't about blame—it's information. What's making it hard to show up for this value?`,
    `'${valueDef.label}' keeps getting pushed aside. Sometimes patterns reveal what's really competing for our energy. What's been taking priority?`,
    `There's a recurring gap with '${valueDef.label}'. Rather than forcing change, let's get curious: is this value still as important to you? Or is something blocking it?`
  ];

  return {
    type: 'pattern_awareness',
    tone: 'curious',
    message: messages[Math.floor(Math.random() * messages.length)],
    value,
    patternLength: violations.length,
    reflectionPrompts: [
      `Is '${valueDef.label}' still a priority for me?`,
      `What's been getting in the way?`,
      `What would "good enough" look like for this value?`
    ],
    microCommitment: getRandomMicroCommitment(value)
  };
};

/**
 * Generate reframe for occasional gaps
 */
const generateGentleAwarenessReframe = (value, valueDef, alignmentScore) => {
  const percentage = Math.round((1 - alignmentScore) * 100);

  const messages = [
    `Your '${valueDef.label}' alignment has some room to grow. No judgment—just an invitation to notice.`,
    `'${valueDef.label}' hasn't been as present lately. That's okay. Values ebb and flow. Here's a tiny way to reconnect:`,
    `A gentle nudge: '${valueDef.label}' could use some attention. Not a big overhaul—just a small step.`
  ];

  return {
    type: 'gentle_awareness',
    tone: 'warm',
    message: messages[Math.floor(Math.random() * messages.length)],
    value,
    alignmentScore,
    microCommitment: getRandomMicroCommitment(value)
  };
};

/**
 * Get a random micro-commitment for a value
 */
const getRandomMicroCommitment = (value) => {
  // Map related values to commitment categories
  const valueToCategory = {
    health: 'health',
    connection: 'connection',
    family: 'connection',
    selfcare: 'selfcare',
    balance: 'balance',
    growth: 'growth',
    learning: 'growth',
    creativity: 'creativity',
    consistency: 'consistency',
    achievement: 'consistency',
    // Default fallbacks
    security: 'balance',
    adventure: 'creativity',
    honesty: 'selfcare',
    contribution: 'connection',
    freedom: 'selfcare'
  };

  const category = valueToCategory[value] || 'selfcare';
  const commitments = MICRO_COMMITMENTS[category] || MICRO_COMMITMENTS.selfcare;

  return {
    action: commitments[Math.floor(Math.random() * commitments.length)],
    duration: '5 minutes or less',
    value: value
  };
};

/**
 * Generate a complete compassionate report for all value gaps
 *
 * @param {Object} alignment - From computeValueAlignment
 * @param {Array} entries - Recent entries
 * @returns {Object} Full report with reframes
 */
export const generateCompassionateReport = (alignment, entries = []) => {
  if (!alignment?.available || !alignment?.byValue) {
    return { available: false };
  }

  const gaps = [];
  const strengths = [];

  for (const [valueKey, stats] of Object.entries(alignment.byValue)) {
    if (stats.alignmentScore === null) continue;

    if (stats.alignmentScore < 0.5 && stats.violated > 0) {
      const reframe = generateCompassionateReframe({
        value: valueKey,
        alignmentScore: stats.alignmentScore,
        violations: stats.entries.filter(e => e.type === 'violated')
      }, entries);

      if (reframe) {
        gaps.push({
          value: valueKey,
          label: CORE_VALUES[valueKey].label,
          alignmentScore: stats.alignmentScore,
          reframe
        });
      }
    } else if (stats.alignmentScore >= 0.7 && stats.supported >= 2) {
      strengths.push({
        value: valueKey,
        label: CORE_VALUES[valueKey].label,
        alignmentScore: stats.alignmentScore,
        supportedCount: stats.supported
      });
    }
  }

  // Sort gaps by severity (lowest alignment first)
  gaps.sort((a, b) => a.alignmentScore - b.alignmentScore);

  // Generate overall message
  const overallMessage = generateOverallMessage(gaps, strengths, alignment.overallAlignment);

  return {
    available: true,
    gaps: gaps.slice(0, 3), // Top 3 gaps only
    strengths: strengths.slice(0, 3),
    overallAlignment: alignment.overallAlignment,
    overallMessage,
    generatedAt: new Date().toISOString()
  };
};

/**
 * Generate overall compassionate message
 */
const generateOverallMessage = (gaps, strengths, overallAlignment) => {
  if (overallAlignment >= 0.7) {
    return {
      tone: 'celebratory',
      message: `You're living in strong alignment with your values. ${strengths[0]?.label} is particularly vibrant right now.`
    };
  }

  if (overallAlignment >= 0.5) {
    return {
      tone: 'balanced',
      message: `You're navigating a balance between values. Some are thriving (${strengths[0]?.label || 'a few'}), others need attention.`
    };
  }

  if (gaps.length > 0 && gaps[0].reframe?.type === 'trade_off_acknowledgment') {
    return {
      tone: 'understanding',
      message: `Life has been demanding lately. Your values are still there—some just got quieter while you handled what was urgent.`
    };
  }

  return {
    tone: 'gentle',
    message: `Your values could use some reconnection. That's not failure—it's an invitation. Start small.`
  };
};

export default {
  generateCompassionateReframe,
  generateCompassionateReport,
  MICRO_COMMITMENTS
};
