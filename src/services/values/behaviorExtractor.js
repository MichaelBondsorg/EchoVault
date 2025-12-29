/**
 * Behavior Extractor Service
 *
 * Extracts actual behaviors from journal entries using AI.
 * Maps behaviors to values for alignment tracking.
 */

import { generateContent } from '../gemini';
import { CORE_VALUES } from './valuesTracker';

const BEHAVIOR_EXTRACTION_PROMPT = `Analyze this journal entry and extract specific behaviors (actions taken or not taken).

ENTRY:
"{text}"

Extract:
1. POSITIVE behaviors - concrete actions that support wellbeing or values
2. NEGATIVE behaviors - actions that undermine wellbeing or stated values
3. NEUTRAL behaviors - factual activities without clear value alignment

For each behavior:
- Be specific (not "exercised" but "went for a 30-min run")
- Include context if relevant
- Map to likely value(s): health, connection, growth, creativity, family, achievement, security, adventure, selfcare, honesty, consistency, balance, contribution, learning, freedom

Return JSON:
{
  "behaviors": [
    {
      "action": "specific behavior description",
      "type": "positive" | "negative" | "neutral",
      "values": ["value1", "value2"],
      "context": "optional context",
      "quote": "relevant phrase from entry"
    }
  ],
  "dominantValues": ["top 2-3 values demonstrated"],
  "valueTensions": ["any conflicts between values observed"]
}

RULES:
- Only extract ACTUAL behaviors, not intentions or feelings
- "I want to exercise" = intention (skip it)
- "I went to the gym" = behavior (include it)
- "I skipped my workout" = negative behavior (include it)
- Be specific and concrete
- Maximum 5 behaviors per entry`;

/**
 * Extract behaviors from a single entry using AI
 *
 * @param {Object} entry - Journal entry
 * @returns {Object} Extracted behaviors
 */
export const extractBehaviors = async (entry) => {
  const text = entry?.text || '';

  if (text.length < 20) {
    return {
      behaviors: [],
      dominantValues: [],
      valueTensions: [],
      source: 'too_short'
    };
  }

  try {
    const prompt = BEHAVIOR_EXTRACTION_PROMPT.replace('{text}', text);
    const response = await generateContent(prompt);

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackExtraction(text);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize values
    const validatedBehaviors = (parsed.behaviors || []).map(b => ({
      ...b,
      values: (b.values || []).filter(v => CORE_VALUES[v])
    }));

    return {
      behaviors: validatedBehaviors,
      dominantValues: (parsed.dominantValues || []).filter(v => CORE_VALUES[v]),
      valueTensions: parsed.valueTensions || [],
      source: 'ai'
    };
  } catch (error) {
    console.error('AI behavior extraction failed:', error);
    return fallbackExtraction(text);
  }
};

/**
 * Fallback keyword-based extraction when AI fails
 */
const fallbackExtraction = (text) => {
  const lowerText = text.toLowerCase();
  const behaviors = [];
  const detectedValues = new Set();

  // Check for common behavior patterns
  const behaviorPatterns = [
    // Health
    { pattern: /went to (the )?gym/i, type: 'positive', values: ['health'], action: 'Went to the gym' },
    { pattern: /skipped (my )?(workout|gym|exercise)/i, type: 'negative', values: ['health'], action: 'Skipped workout' },
    { pattern: /went (for a |on a )?(run|jog|walk)/i, type: 'positive', values: ['health'], action: 'Went for exercise' },
    { pattern: /meditat(ed|ion)/i, type: 'positive', values: ['health', 'selfcare'], action: 'Meditated' },
    { pattern: /got (only )?\d+ hours? (of )?sleep/i, type: 'neutral', values: ['health'], action: 'Sleep noted' },

    // Connection
    { pattern: /called (my )?(mom|dad|parent|friend|partner)/i, type: 'positive', values: ['connection', 'family'], action: 'Called family/friend' },
    { pattern: /had (lunch|dinner|coffee) with/i, type: 'positive', values: ['connection'], action: 'Meal with someone' },
    { pattern: /cancelled (on|plans|meeting)/i, type: 'negative', values: ['connection'], action: 'Cancelled social plans' },

    // Achievement
    { pattern: /finished (the |my )?project/i, type: 'positive', values: ['achievement'], action: 'Finished a project' },
    { pattern: /missed (the |my )?deadline/i, type: 'negative', values: ['achievement', 'consistency'], action: 'Missed deadline' },
    { pattern: /procrastinat/i, type: 'negative', values: ['achievement', 'consistency'], action: 'Procrastinated' },

    // Self-care
    { pattern: /took (a )?break/i, type: 'positive', values: ['selfcare', 'balance'], action: 'Took a break' },
    { pattern: /worked (through|late|all)/i, type: 'negative', values: ['balance', 'selfcare'], action: 'Overworked' },
    { pattern: /said no to/i, type: 'positive', values: ['selfcare', 'honesty'], action: 'Set a boundary' }
  ];

  for (const { pattern, type, values, action } of behaviorPatterns) {
    if (pattern.test(lowerText)) {
      behaviors.push({
        action,
        type,
        values,
        quote: lowerText.match(pattern)?.[0] || '',
        context: null
      });
      values.forEach(v => detectedValues.add(v));
    }
  }

  return {
    behaviors,
    dominantValues: Array.from(detectedValues).slice(0, 3),
    valueTensions: [],
    source: 'fallback'
  };
};

/**
 * Batch extract behaviors for multiple entries
 *
 * @param {Array} entries - Journal entries
 * @param {Object} options - { useAI: boolean }
 * @returns {Array} Entries with behavior data
 */
export const batchExtractBehaviors = async (entries, options = {}) => {
  const { useAI = true } = options;

  const results = [];

  for (const entry of entries) {
    // Check if entry already has behavior data
    if (entry.behaviorExtraction?.behaviors?.length > 0) {
      results.push({
        entryId: entry.id,
        ...entry.behaviorExtraction
      });
      continue;
    }

    if (useAI) {
      // Rate limit - one request per 200ms
      await new Promise(resolve => setTimeout(resolve, 200));
      const extraction = await extractBehaviors(entry);
      results.push({
        entryId: entry.id,
        ...extraction
      });
    } else {
      const extraction = fallbackExtraction(entry.text || '');
      results.push({
        entryId: entry.id,
        ...extraction
      });
    }
  }

  return results;
};

/**
 * Aggregate behaviors across entries for value alignment
 *
 * @param {Array} behaviorExtractions - From batchExtractBehaviors
 * @returns {Object} Aggregated behavior stats
 */
export const aggregateBehaviors = (behaviorExtractions) => {
  const valueStats = {};

  // Initialize stats for each value
  for (const valueKey of Object.keys(CORE_VALUES)) {
    valueStats[valueKey] = {
      positive: [],
      negative: [],
      neutral: []
    };
  }

  // Aggregate by value
  for (const extraction of behaviorExtractions) {
    for (const behavior of extraction.behaviors || []) {
      for (const valueKey of behavior.values || []) {
        if (valueStats[valueKey]) {
          valueStats[valueKey][behavior.type].push({
            action: behavior.action,
            quote: behavior.quote,
            entryId: extraction.entryId
          });
        }
      }
    }
  }

  // Calculate summaries
  const summary = {};
  for (const [valueKey, stats] of Object.entries(valueStats)) {
    const total = stats.positive.length + stats.negative.length;
    summary[valueKey] = {
      positiveCount: stats.positive.length,
      negativeCount: stats.negative.length,
      neutralCount: stats.neutral.length,
      alignmentScore: total > 0 ? stats.positive.length / total : null,
      examples: {
        positive: stats.positive.slice(0, 3),
        negative: stats.negative.slice(0, 3)
      }
    };
  }

  return {
    byValue: summary,
    totalBehaviors: behaviorExtractions.reduce((sum, e) => sum + (e.behaviors?.length || 0), 0),
    entriesWithBehaviors: behaviorExtractions.filter(e => e.behaviors?.length > 0).length
  };
};

export default {
  extractBehaviors,
  batchExtractBehaviors,
  aggregateBehaviors
};
