/**
 * Leadership Insights Generator
 *
 * Generates AI-powered insights for leadership/management situations.
 * Uses CBT to address common leadership distortions (imposter syndrome, people-pleasing).
 * Uses ACT to identify values being demonstrated (fairness, growth, honesty).
 */

import { callGemini } from '../ai/gemini';
import { getContextLabel } from './leadershipDetector';

// Common leadership cognitive distortions
const LEADERSHIP_DISTORTIONS = {
  imposter_syndrome: {
    label: 'Imposter Syndrome',
    description: 'Feeling unqualified or like a fraud despite evidence of competence',
    triggers: ['not qualified', 'who am i to', 'don\'t deserve', 'fraud', 'fake it'],
    reframeApproach: 'Acknowledge experience and growth'
  },
  people_pleasing: {
    label: 'People Pleasing',
    description: 'Prioritizing others\' approval over honest feedback or boundaries',
    triggers: ['worried they\'ll hate me', 'want them to like me', 'afraid of conflict', 'didn\'t want to upset'],
    reframeApproach: 'Kindness and honesty can coexist'
  },
  catastrophizing: {
    label: 'Catastrophizing',
    description: 'Expecting the worst possible outcome from a situation',
    triggers: ['disaster', 'ruin', 'never recover', 'worst', 'everything will'],
    reframeApproach: 'Consider realistic outcomes'
  },
  mind_reading: {
    label: 'Mind Reading',
    description: 'Assuming you know what others think without evidence',
    triggers: ['they probably think', 'they must be', 'i bet they', 'they\'re judging'],
    reframeApproach: 'Focus on observable behavior, not assumptions'
  },
  should_statements: {
    label: 'Should Statements',
    description: 'Rigid expectations of how you "should" have handled things',
    triggers: ['should have', 'shouldn\'t have', 'must always', 'need to be perfect'],
    reframeApproach: 'Replace "should" with "could" or "next time"'
  },
  personalization: {
    label: 'Over-Responsibility',
    description: 'Taking blame for outcomes outside your control',
    triggers: ['my fault', 'i caused', 'if only i had', 'i should have prevented'],
    reframeApproach: 'Distinguish your actions from external factors'
  }
};

// Leadership values (ACT framework)
const LEADERSHIP_VALUES = {
  fairness: ['fair', 'equitable', 'consistent', 'unbiased', 'just'],
  growth: ['develop', 'grow', 'learn', 'improve', 'potential', 'coaching'],
  honesty: ['honest', 'truth', 'transparent', 'direct', 'candid', 'authentic'],
  compassion: ['care', 'support', 'understand', 'empathy', 'kindness'],
  accountability: ['accountable', 'responsible', 'ownership', 'standards'],
  courage: ['brave', 'difficult', 'hard conversation', 'spoke up', 'stood firm'],
  respect: ['respect', 'dignity', 'valued', 'listened']
};

/**
 * Detect cognitive distortions in entry text
 * @param {string} text - Entry text
 * @returns {Array} Detected distortions with evidence
 */
export const detectLeadershipDistortions = (text) => {
  const lowerText = text.toLowerCase();
  const detected = [];

  for (const [distortionType, config] of Object.entries(LEADERSHIP_DISTORTIONS)) {
    const matchedTriggers = config.triggers.filter(trigger => lowerText.includes(trigger));

    if (matchedTriggers.length > 0) {
      detected.push({
        type: distortionType,
        label: config.label,
        description: config.description,
        evidence: matchedTriggers,
        reframeApproach: config.reframeApproach
      });
    }
  }

  return detected;
};

/**
 * Detect leadership values demonstrated in entry
 * @param {string} text - Entry text
 * @returns {Array} Detected values
 */
export const detectLeadershipValues = (text) => {
  const lowerText = text.toLowerCase();
  const detected = [];

  for (const [value, keywords] of Object.entries(LEADERSHIP_VALUES)) {
    const hasMatch = keywords.some(keyword => lowerText.includes(keyword));
    if (hasMatch) {
      detected.push(value);
    }
  }

  return detected;
};

/**
 * Generate AI-powered leadership insight
 *
 * @param {Object} entry - Journal entry
 * @param {Object} leadershipContext - Result from detectLeadershipContext
 * @returns {Object} Leadership insight with CBT/ACT analysis
 */
export const generateLeadershipInsight = async (entry, leadershipContext) => {
  const text = entry.text || '';
  const contexts = leadershipContext.contexts || [];
  const primaryContext = contexts[0] || 'leadership';

  // Quick pattern-based detection first
  const distortions = detectLeadershipDistortions(text);
  const values = detectLeadershipValues(text);

  // Build AI prompt for deeper analysis
  const contextLabels = contexts.map(getContextLabel).join(', ');

  const prompt = `Analyze this leadership/management journal entry and provide supportive insight.

CONTEXT: ${contextLabels}
EMOTIONAL LABOR: ${leadershipContext.emotionalLaborLevel}
PEOPLE MENTIONED: ${leadershipContext.mentionedPeople?.join(', ') || 'None specified'}

ENTRY:
"${text}"

Provide a brief, supportive analysis in JSON format:
{
  "situation_summary": "1-2 sentence summary of the leadership situation",
  "emotional_impact": "How this likely affected the writer emotionally",
  "detected_distortions": [
    {
      "type": "imposter_syndrome|people_pleasing|catastrophizing|mind_reading|should_statements|personalization",
      "evidence": "quote from entry showing this pattern",
      "reframe": "A gentle reframe (1-2 sentences, compassionate tone)"
    }
  ],
  "values_demonstrated": ["fairness", "growth", "honesty", "compassion", "accountability", "courage", "respect"],
  "strength_acknowledgment": "Acknowledge a strength shown in how they handled this",
  "self_care_reminder": "Brief self-care suggestion appropriate for this emotional labor level",
  "reflection_question": "One thoughtful question for further reflection (optional post-mortem)"
}

Be warm and supportive. Avoid clinical language. Max 2 distortions. If no clear distortions, return empty array.`;

  try {
    const response = await callGemini(prompt, '', 'gemini-2.0-flash');

    // Parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON response');
    }

    const aiInsight = JSON.parse(jsonMatch[0]);

    // Merge AI insights with pattern-detected ones
    return {
      situationSummary: aiInsight.situation_summary,
      emotionalImpact: aiInsight.emotional_impact,
      distortions: aiInsight.detected_distortions || distortions.slice(0, 2),
      valuesDisplayed: aiInsight.values_demonstrated || values,
      strengthAcknowledgment: aiInsight.strength_acknowledgment,
      selfCareReminder: aiInsight.self_care_reminder,
      reflectionQuestion: aiInsight.reflection_question,
      // Metadata
      context: primaryContext,
      emotionalLabor: leadershipContext.emotionalLabor,
      generatedAt: new Date().toISOString(),
      source: 'ai'
    };
  } catch (error) {
    console.error('Failed to generate AI leadership insight:', error);

    // Fallback to pattern-based insight
    return {
      situationSummary: `A ${getContextLabel(primaryContext).toLowerCase()} moment`,
      emotionalImpact: leadershipContext.emotionalLaborLevel === 'high'
        ? 'This kind of situation takes real emotional energy.'
        : 'Management moments like this add up.',
      distortions: distortions.slice(0, 2).map(d => ({
        type: d.type,
        evidence: d.evidence[0],
        reframe: d.reframeApproach
      })),
      valuesDisplayed: values,
      strengthAcknowledgment: 'Taking time to reflect on this shows self-awareness.',
      selfCareReminder: leadershipContext.emotionalLaborLevel === 'high'
        ? 'Consider taking a short break before your next meeting.'
        : 'Remember to pace yourself today.',
      reflectionQuestion: null,
      context: primaryContext,
      emotionalLabor: leadershipContext.emotionalLabor,
      generatedAt: new Date().toISOString(),
      source: 'pattern'
    };
  }
};

/**
 * Get a quick self-care tip based on emotional labor level
 * @param {string} laborLevel - 'high' | 'moderate' | 'low'
 * @returns {string} Self-care tip
 */
export const getQuickSelfCareTip = (laborLevel) => {
  const tips = {
    high: [
      'Take 10 minutes before your next meeting to decompress.',
      'Consider a short walk to reset your emotional energy.',
      'You handled something heavy today. Be gentle with yourself.',
      'Block 15 minutes of buffer time on your calendar.'
    ],
    moderate: [
      'Remember to hydrate and take a proper lunch break.',
      'A few deep breaths between meetings can help.',
      'You\'re doing meaningful work supporting your team.'
    ],
    low: [
      'Nice work getting that off your plate.',
      'Delegation is a leadership skill worth celebrating.'
    ]
  };

  const pool = tips[laborLevel] || tips.moderate;
  return pool[Math.floor(Math.random() * pool.length)];
};

export default {
  LEADERSHIP_DISTORTIONS,
  LEADERSHIP_VALUES,
  detectLeadershipDistortions,
  detectLeadershipValues,
  generateLeadershipInsight,
  getQuickSelfCareTip
};
