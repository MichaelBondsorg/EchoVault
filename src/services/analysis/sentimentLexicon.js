/**
 * Sentiment Lexicon
 *
 * VADER-style word lists with valence scores for sentiment analysis.
 * Scores are normalized to 0-1 range (0 = very negative, 0.5 = neutral, 1 = very positive)
 *
 * Based on:
 * - VADER (Valence Aware Dictionary and sEntiment Reasoner)
 * - Mental health journaling context-specific additions
 */

// ============================================
// CORE SENTIMENT WORDS
// Scores: 0 = most negative, 0.5 = neutral, 1 = most positive
// ============================================

export const LEXICON = {
  // POSITIVE - High (0.8-1.0)
  'amazing': 0.95,
  'awesome': 0.92,
  'excellent': 0.92,
  'fantastic': 0.93,
  'incredible': 0.93,
  'wonderful': 0.92,
  'outstanding': 0.90,
  'brilliant': 0.90,
  'love': 0.88,
  'loved': 0.88,
  'loving': 0.85,
  'ecstatic': 0.95,
  'thrilled': 0.90,
  'elated': 0.92,
  'joyful': 0.90,
  'overjoyed': 0.93,
  'blissful': 0.92,
  'euphoric': 0.95,

  // POSITIVE - Medium-High (0.7-0.8)
  'happy': 0.80,
  'great': 0.82,
  'good': 0.72,
  'nice': 0.70,
  'pleasant': 0.72,
  'glad': 0.75,
  'pleased': 0.75,
  'delighted': 0.85,
  'satisfied': 0.72,
  'content': 0.70,
  'cheerful': 0.78,
  'excited': 0.82,
  'hopeful': 0.75,
  'optimistic': 0.78,
  'proud': 0.80,
  'accomplished': 0.78,
  'successful': 0.80,

  // POSITIVE - Medium (0.6-0.7)
  'okay': 0.55,
  'ok': 0.55,
  'fine': 0.58,
  'alright': 0.55,
  'better': 0.68,
  'improved': 0.68,
  'calm': 0.65,
  'peaceful': 0.75,
  'relaxed': 0.70,
  'comfortable': 0.68,
  'safe': 0.68,
  'secure': 0.68,
  'stable': 0.65,
  'balanced': 0.68,

  // GRATITUDE & APPRECIATION (0.75-0.9)
  'grateful': 0.85,
  'thankful': 0.85,
  'appreciative': 0.82,
  'appreciate': 0.80,
  'blessed': 0.85,
  'fortunate': 0.78,
  'lucky': 0.75,

  // NEGATIVE - Medium (0.3-0.45)
  'sad': 0.28,
  'unhappy': 0.30,
  'upset': 0.32,
  'disappointed': 0.35,
  'discouraged': 0.35,
  'down': 0.38,
  'low': 0.40,
  'blue': 0.38,
  'gloomy': 0.35,
  'melancholy': 0.35,
  'lonely': 0.32,
  'alone': 0.40,
  'tired': 0.40,
  'exhausted': 0.30,
  'drained': 0.32,
  'fatigued': 0.35,
  'weary': 0.35,
  'bored': 0.42,

  // NEGATIVE - Medium-High (0.2-0.3)
  'anxious': 0.28,
  'nervous': 0.32,
  'worried': 0.30,
  'stressed': 0.25,
  'overwhelmed': 0.22,
  'panicked': 0.18,
  'afraid': 0.25,
  'scared': 0.25,
  'fearful': 0.25,
  'frightened': 0.22,
  'insecure': 0.30,
  'uncertain': 0.38,
  'confused': 0.38,
  'lost': 0.35,

  // NEGATIVE - High (0.1-0.2)
  'angry': 0.18,
  'mad': 0.20,
  'furious': 0.10,
  'enraged': 0.08,
  'livid': 0.10,
  'frustrated': 0.25,
  'annoyed': 0.32,
  'irritated': 0.30,
  'aggravated': 0.28,
  'resentful': 0.22,
  'bitter': 0.25,
  'hateful': 0.10,
  'hate': 0.12,
  'hated': 0.12,
  'hating': 0.12,

  // NEGATIVE - Very High (0.0-0.1)
  'depressed': 0.12,
  'hopeless': 0.10,
  'desperate': 0.12,
  'devastated': 0.08,
  'destroyed': 0.08,
  'shattered': 0.10,
  'broken': 0.15,
  'miserable': 0.12,
  'terrible': 0.15,
  'horrible': 0.12,
  'awful': 0.15,
  'worst': 0.10,
  'worthless': 0.08,
  'useless': 0.15,
  'failure': 0.18,
  'failed': 0.22,
  'loser': 0.12,

  // MENTAL HEALTH SPECIFIC
  'healing': 0.72,
  'recovering': 0.70,
  'growing': 0.72,
  'progress': 0.70,
  'breakthrough': 0.82,
  'insight': 0.70,
  'awareness': 0.68,
  'acceptance': 0.72,
  'mindful': 0.70,
  'present': 0.65,
  'grounded': 0.70,
  'centered': 0.70,
  'supported': 0.72,
  'understood': 0.72,
  'validated': 0.75,
  'heard': 0.68,
  'seen': 0.68,
  'connected': 0.72,
  'belonging': 0.75,

  // COPING LANGUAGE
  'coping': 0.55,
  'managing': 0.58,
  'surviving': 0.45,
  'struggling': 0.35,
  'suffering': 0.20,
  'hurting': 0.25,
  'drowning': 0.15,
  'spiraling': 0.18,
  'triggered': 0.30,
  'numb': 0.35,
  'dissociating': 0.30,
  'dissociated': 0.30,
};

// ============================================
// INTENSIFIERS (multiply sentiment magnitude)
// ============================================

export const INTENSIFIERS = {
  // Strong intensifiers (1.3-1.5x)
  'extremely': 1.5,
  'incredibly': 1.5,
  'absolutely': 1.45,
  'completely': 1.4,
  'totally': 1.4,
  'utterly': 1.45,
  'deeply': 1.4,
  'profoundly': 1.45,

  // Medium intensifiers (1.15-1.3x)
  'very': 1.3,
  'really': 1.25,
  'so': 1.25,
  'quite': 1.2,
  'pretty': 1.15,
  'fairly': 1.1,
  'rather': 1.15,
  'super': 1.3,

  // Slight intensifiers (1.05-1.15x)
  'somewhat': 1.1,
  'kind of': 1.05,
  'kinda': 1.05,
  'sort of': 1.05,
  'sorta': 1.05,
  'a bit': 1.05,
  'a little': 1.05,
  'slightly': 1.05,
};

// ============================================
// NEGATORS (flip sentiment polarity)
// ============================================

export const NEGATORS = [
  'not',
  "n't",
  'no',
  'never',
  'none',
  'nobody',
  'nothing',
  'nowhere',
  'neither',
  'without',
  'barely',
  'hardly',
  'scarcely',
  'rarely',
  'seldom',
];

// ============================================
// EMOJI SENTIMENT
// ============================================

export const EMOJI_SENTIMENT = {
  // Very positive
  '😊': 0.85, '😄': 0.90, '😃': 0.88, '😁': 0.88, '🥰': 0.92, '😍': 0.90,
  '🥳': 0.92, '🎉': 0.85, '❤️': 0.88, '💕': 0.88, '✨': 0.80, '🌟': 0.80,
  '👍': 0.75, '💪': 0.78, '🙌': 0.82, '👏': 0.80,

  // Positive
  '🙂': 0.70, '😌': 0.72, '☺️': 0.75, '😊': 0.78,

  // Neutral
  '😐': 0.50, '😶': 0.50, '🤔': 0.50, '💭': 0.50,

  // Negative
  '😕': 0.38, '🙁': 0.35, '😔': 0.30, '😢': 0.25, '😭': 0.18,
  '😞': 0.30, '😥': 0.32, '😰': 0.25, '😨': 0.22, '😱': 0.15,

  // Very negative
  '😡': 0.15, '🤬': 0.10, '😤': 0.25, '💔': 0.20, '😩': 0.25,
  '😫': 0.22, '😖': 0.28, '😣': 0.28,
};

// ============================================
// CONTEXT PHRASES (multi-word expressions)
// ============================================

export const CONTEXT_PHRASES = {
  // Positive phrases
  'looking forward to': 0.78,
  'can\'t wait': 0.82,
  'on top of the world': 0.92,
  'feeling great': 0.85,
  'so happy': 0.88,
  'best day': 0.90,
  'good day': 0.75,
  'making progress': 0.72,
  'getting better': 0.72,
  'turned around': 0.70,
  'things are looking up': 0.75,
  'weight off my shoulders': 0.75,
  'breath of fresh air': 0.78,

  // Negative phrases
  'at the end of my rope': 0.12,
  'can\'t take it anymore': 0.10,
  'falling apart': 0.15,
  'breaking down': 0.15,
  'giving up': 0.18,
  'worst day': 0.12,
  'bad day': 0.28,
  'rough day': 0.32,
  'hard day': 0.35,
  'tough day': 0.35,
  'losing it': 0.20,
  'lost hope': 0.12,
  'no point': 0.15,
  'what\'s the point': 0.15,
  'sick of': 0.22,
  'tired of': 0.28,
  'fed up': 0.22,
  'had enough': 0.25,
};

export default {
  LEXICON,
  INTENSIFIERS,
  NEGATORS,
  EMOJI_SENTIMENT,
  CONTEXT_PHRASES,
};
