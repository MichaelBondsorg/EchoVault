/**
 * Local Sentiment Analyzer
 *
 * VADER-style sentiment analysis without AI dependency.
 * Uses lexicon-based approach with handling for:
 * - Intensifiers ("very happy" → stronger positive)
 * - Negation ("not happy" → negative)
 * - Emojis
 * - Context phrases
 *
 * Performance target: <30ms for analysis
 */

import {
  LEXICON,
  INTENSIFIERS,
  NEGATORS,
  EMOJI_SENTIMENT,
  CONTEXT_PHRASES
} from './sentimentLexicon';

// Neutral baseline
const NEUTRAL_SCORE = 0.5;

// Window size for negation effect (words)
const NEGATION_WINDOW = 3;

/**
 * Analyze sentiment of text
 *
 * @param {string} text - Text to analyze
 * @param {Object} options - Analysis options
 * @param {Object} options.voiceTone - Voice tone analysis to incorporate
 * @returns {Object} Sentiment analysis result
 */
export const analyze = (text, options = {}) => {
  if (!text || typeof text !== 'string') {
    return {
      score: NEUTRAL_SCORE,
      confidence: 0.3,
      details: { reason: 'empty_input' }
    };
  }

  const startTime = performance.now();

  // Normalize and tokenize
  const normalizedText = text.toLowerCase().trim();
  const words = tokenize(normalizedText);

  // Track sentiment scores
  const sentimentScores = [];
  const matchedWords = [];
  const negatedWords = [];

  // Check for context phrases first
  const phraseScore = analyzeContextPhrases(normalizedText);
  if (phraseScore !== null) {
    sentimentScores.push(phraseScore.score);
    matchedWords.push({ text: phraseScore.phrase, score: phraseScore.score, type: 'phrase' });
  }

  // Analyze emojis
  const emojiScore = analyzeEmojis(text);
  if (emojiScore !== null) {
    sentimentScores.push(emojiScore.score);
    matchedWords.push({ text: 'emojis', score: emojiScore.score, type: 'emoji' });
  }

  // Track negation state
  let negationActive = false;
  let negationCounter = 0;

  // Analyze each word
  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Check for negators
    if (NEGATORS.includes(word)) {
      negationActive = true;
      negationCounter = NEGATION_WINDOW;
      continue;
    }

    // Decrease negation counter
    if (negationCounter > 0) {
      negationCounter--;
    } else {
      negationActive = false;
    }

    // Check for intensifier
    let intensifier = 1.0;
    if (i > 0) {
      const prevWord = words[i - 1];
      const prevTwoWords = i > 1 ? `${words[i - 2]} ${prevWord}` : '';

      if (INTENSIFIERS[prevTwoWords]) {
        intensifier = INTENSIFIERS[prevTwoWords];
      } else if (INTENSIFIERS[prevWord]) {
        intensifier = INTENSIFIERS[prevWord];
      }
    }

    // Check lexicon
    if (LEXICON[word] !== undefined) {
      let score = LEXICON[word];

      // Apply negation (flip around neutral)
      if (negationActive) {
        score = NEUTRAL_SCORE - (score - NEUTRAL_SCORE);
        negatedWords.push(word);
      }

      // Apply intensifier (amplify distance from neutral)
      if (intensifier !== 1.0) {
        const distanceFromNeutral = score - NEUTRAL_SCORE;
        score = NEUTRAL_SCORE + (distanceFromNeutral * intensifier);
        // Clamp to valid range
        score = Math.max(0, Math.min(1, score));
      }

      sentimentScores.push(score);
      matchedWords.push({
        text: word,
        score,
        type: 'word',
        negated: negationActive,
        intensified: intensifier !== 1.0
      });
    }
  }

  // Calculate final score
  let finalScore = NEUTRAL_SCORE;
  let confidence = 0.3;

  if (sentimentScores.length > 0) {
    // Weighted average - more recent matches have slightly higher weight
    const weights = sentimentScores.map((_, i) => 1 + (i * 0.1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    finalScore = sentimentScores.reduce((sum, score, i) =>
      sum + (score * weights[i]), 0) / totalWeight;

    // Confidence based on number of matches and their consistency
    const scoreVariance = calculateVariance(sentimentScores);
    const matchRatio = Math.min(1, sentimentScores.length / 5); // More matches = more confident
    const consistencyBonus = Math.max(0, 1 - scoreVariance * 2); // Less variance = more confident

    confidence = 0.3 + (matchRatio * 0.4) + (consistencyBonus * 0.3);
    confidence = Math.min(0.95, confidence);
  }

  // Incorporate voice tone if available
  if (options.voiceTone && typeof options.voiceTone.mood_score === 'number') {
    // Weight: 40% text, 60% voice (voice is more reliable for emotion)
    const voiceScore = options.voiceTone.mood_score;
    finalScore = (finalScore * 0.4) + (voiceScore * 0.6);
    confidence = Math.min(0.95, confidence + 0.1);
  }

  const analysisTime = performance.now() - startTime;

  return {
    score: Math.round(finalScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    details: {
      matchedWords,
      negatedWords,
      wordCount: words.length,
      matchCount: sentimentScores.length,
      analysisTimeMs: Math.round(analysisTime),
      hasVoiceTone: !!options.voiceTone
    }
  };
};

/**
 * Tokenize text into words
 *
 * @param {string} text - Text to tokenize
 * @returns {Array} Array of words
 */
const tokenize = (text) => {
  // Handle contractions specially
  const withContractions = text
    .replace(/n't/g, ' not')
    .replace(/\'re/g, ' are')
    .replace(/\'s/g, ' is')
    .replace(/\'ll/g, ' will')
    .replace(/\'ve/g, ' have')
    .replace(/\'d/g, ' would');

  // Split on whitespace and punctuation
  return withContractions
    .split(/[\s,.!?;:()\[\]{}""'']+/)
    .filter(word => word.length > 0);
};

/**
 * Analyze context phrases in text
 *
 * @param {string} text - Normalized text
 * @returns {Object|null} Phrase match result or null
 */
const analyzeContextPhrases = (text) => {
  for (const [phrase, score] of Object.entries(CONTEXT_PHRASES)) {
    if (text.includes(phrase)) {
      return { phrase, score };
    }
  }
  return null;
};

/**
 * Analyze emojis in text
 *
 * @param {string} text - Original text (not normalized)
 * @returns {Object|null} Emoji sentiment result or null
 */
const analyzeEmojis = (text) => {
  const emojiScores = [];

  // Extract emojis using regex
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}]/gu;

  const emojis = text.match(emojiRegex) || [];

  for (const emoji of emojis) {
    if (EMOJI_SENTIMENT[emoji] !== undefined) {
      emojiScores.push(EMOJI_SENTIMENT[emoji]);
    }
  }

  if (emojiScores.length === 0) {
    return null;
  }

  const avgScore = emojiScores.reduce((a, b) => a + b, 0) / emojiScores.length;
  return { score: avgScore, count: emojiScores.length };
};

/**
 * Calculate variance of array of numbers
 *
 * @param {Array} numbers - Array of numbers
 * @returns {number} Variance
 */
const calculateVariance = (numbers) => {
  if (numbers.length < 2) return 0;

  const mean = numbers.reduce((a, b) => a + b, 0) / numbers.length;
  const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / numbers.length;
};

/**
 * Get sentiment label from score
 *
 * @param {number} score - Sentiment score (0-1)
 * @returns {string} Label
 */
export const getLabel = (score) => {
  if (score >= 0.8) return 'very_positive';
  if (score >= 0.65) return 'positive';
  if (score >= 0.55) return 'slightly_positive';
  if (score >= 0.45) return 'neutral';
  if (score >= 0.35) return 'slightly_negative';
  if (score >= 0.2) return 'negative';
  return 'very_negative';
};

/**
 * Quick sentiment check without full analysis
 * Useful for UI previews
 *
 * @param {string} text - Text to check
 * @returns {string} Quick sentiment: 'positive', 'negative', or 'neutral'
 */
export const quickCheck = (text) => {
  if (!text) return 'neutral';

  const lower = text.toLowerCase();

  // Quick positive check
  const positiveWords = ['happy', 'good', 'great', 'love', 'excited', 'grateful', 'amazing'];
  const negativeWords = ['sad', 'angry', 'frustrated', 'anxious', 'stressed', 'hate', 'terrible'];

  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of positiveWords) {
    if (lower.includes(word)) positiveCount++;
  }

  for (const word of negativeWords) {
    if (lower.includes(word)) negativeCount++;
  }

  if (positiveCount > negativeCount) return 'positive';
  if (negativeCount > positiveCount) return 'negative';
  return 'neutral';
};

export default { analyze, getLabel, quickCheck };
