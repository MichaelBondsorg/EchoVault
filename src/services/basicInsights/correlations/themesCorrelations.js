/**
 * Themes & Emotions-Mood Correlations
 *
 * Analyzes mood patterns based on AI-extracted themes and emotions:
 * - Themes from entry analysis
 * - Emotions and their intensities
 * - Cognitive patterns
 *
 * Example insights:
 * - "Entries mentioning 'gratitude' show 22% higher mood"
 * - "High-intensity anxiety correlates with 25% lower mood"
 * - "Self-compassion themes correlate with 15% better mood"
 */

import {
  average,
  calculateMoodDelta,
  determineStrength,
  generateInsightId
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES
} from '../utils/thresholds';

/**
 * Theme patterns to look for and aggregate
 */
const THEME_AGGREGATIONS = {
  gratitude: {
    patterns: ['gratitude', 'grateful', 'thankful', 'appreciation'],
    label: 'Gratitude',
    emoji: '🙏'
  },
  anxiety: {
    patterns: ['anxiety', 'anxious', 'worry', 'stress', 'overwhelm'],
    label: 'Anxiety/Stress',
    emoji: '😰'
  },
  self_compassion: {
    patterns: ['self-compassion', 'self-care', 'self-kindness', 'self-acceptance'],
    label: 'Self-compassion',
    emoji: '💝'
  },
  achievement: {
    patterns: ['achievement', 'accomplishment', 'success', 'progress', 'milestone'],
    label: 'Achievement',
    emoji: '🏆'
  },
  connection: {
    patterns: ['connection', 'belonging', 'community', 'support', 'love'],
    label: 'Connection',
    emoji: '🤝'
  },
  creativity: {
    patterns: ['creativity', 'creative', 'inspiration', 'art', 'creation'],
    label: 'Creativity',
    emoji: '🎨'
  },
  growth: {
    patterns: ['growth', 'learning', 'development', 'improvement', 'progress'],
    label: 'Personal Growth',
    emoji: '🌱'
  },
  conflict: {
    patterns: ['conflict', 'argument', 'disagreement', 'tension', 'frustration'],
    label: 'Conflict',
    emoji: '⚡'
  }
};

/**
 * Emotion configurations for correlation
 */
const EMOTION_CONFIG = {
  // Positive emotions
  joy: { label: 'Joy', emoji: '😊', valence: 'positive' },
  happiness: { label: 'Happiness', emoji: '😄', valence: 'positive' },
  contentment: { label: 'Contentment', emoji: '😌', valence: 'positive' },
  excitement: { label: 'Excitement', emoji: '🤩', valence: 'positive' },
  hope: { label: 'Hope', emoji: '🌟', valence: 'positive' },
  love: { label: 'Love', emoji: '❤️', valence: 'positive' },
  gratitude: { label: 'Gratitude', emoji: '🙏', valence: 'positive' },
  // Negative emotions
  sadness: { label: 'Sadness', emoji: '😢', valence: 'negative' },
  anxiety: { label: 'Anxiety', emoji: '😰', valence: 'negative' },
  anger: { label: 'Anger', emoji: '😠', valence: 'negative' },
  fear: { label: 'Fear', emoji: '😨', valence: 'negative' },
  frustration: { label: 'Frustration', emoji: '😤', valence: 'negative' },
  loneliness: { label: 'Loneliness', emoji: '😔', valence: 'negative' },
  guilt: { label: 'Guilt', emoji: '😞', valence: 'negative' }
};

/**
 * Check if a theme matches any pattern in a group
 */
const matchesThemeGroup = (theme, patterns) => {
  const themeLower = theme.toLowerCase();
  return patterns.some(p => themeLower.includes(p));
};

/**
 * Compute themes-mood correlations
 * @param {Array} entries - Journal entries with mood scores
 * @returns {Array} Themes insight objects
 */
export const computeThemesCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Filter entries with mood scores
  const entriesWithMood = entries.filter(e => e.analysis?.mood_score != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  // Calculate baseline mood
  const allMoods = entriesWithMood.map(e => e.analysis.mood_score);
  const baselineMood = average(allMoods);

  const insights = [];

  // ===== THEME CORRELATIONS =====
  for (const [themeKey, config] of Object.entries(THEME_AGGREGATIONS)) {
    const matchingEntries = entriesWithMood.filter(entry => {
      const themes = entry.analysis?.themes || [];
      return themes.some(theme => matchesThemeGroup(theme, config.patterns));
    });

    if (matchingEntries.length < THRESHOLDS.MIN_MENTIONS) continue;

    const themeMood = average(matchingEntries.map(e => e.analysis.mood_score));
    const moodDelta = calculateMoodDelta(themeMood, baselineMood);

    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, matchingEntries.length);
    if (strength === 'weak') continue;

    const direction = moodDelta > 0 ? 'positive' : 'negative';

    insights.push({
      id: generateInsightId(CATEGORIES.THEMES, `theme_${themeKey}`),
      category: CATEGORIES.THEMES,
      insight: moodDelta > 0
        ? `${config.emoji} ${config.label} themes correlate with ${Math.abs(moodDelta)}% higher mood`
        : `${config.emoji} ${config.label} themes correlate with ${Math.abs(moodDelta)}% lower mood`,
      moodDelta,
      direction,
      strength,
      sampleSize: matchingEntries.length,
      themeKey,
      recommendation: themeKey === 'gratitude' && moodDelta > 0
        ? 'Consider a gratitude practice to boost mood'
        : themeKey === 'anxiety' && moodDelta < 0
        ? 'Mindfulness or breathing exercises may help with anxiety'
        : null,
      entryIds: matchingEntries.map(e => e.id || e.entryId).filter(Boolean)
    });
  }

  // ===== EMOTION INTENSITY CORRELATIONS =====
  const emotionStats = {};

  for (const entry of entriesWithMood) {
    const emotions = entry.analysis?.emotions || [];

    for (const emotion of emotions) {
      if (!emotion.name) continue;

      const emotionKey = emotion.name.toLowerCase();
      const intensity = emotion.intensity || 'medium';

      if (!emotionStats[emotionKey]) {
        emotionStats[emotionKey] = {
          high: { moods: [], entryIds: [] },
          medium: { moods: [], entryIds: [] },
          low: { moods: [], entryIds: [] },
          all: { moods: [], entryIds: [] }
        };
      }

      const mood = entry.analysis.mood_score;
      const entryId = entry.id || entry.entryId;

      emotionStats[emotionKey][intensity].moods.push(mood);
      if (entryId) emotionStats[emotionKey][intensity].entryIds.push(entryId);
      emotionStats[emotionKey].all.moods.push(mood);
      if (entryId) emotionStats[emotionKey].all.entryIds.push(entryId);
    }
  }

  // Generate insights for high-intensity emotions
  for (const [emotionKey, stats] of Object.entries(emotionStats)) {
    const config = EMOTION_CONFIG[emotionKey];
    if (!config) continue;

    // Check for enough high-intensity occurrences
    if (stats.high.moods.length >= THRESHOLDS.MIN_MENTIONS) {
      const highIntensityMood = average(stats.high.moods);
      const moodDelta = calculateMoodDelta(highIntensityMood, baselineMood);

      if (Math.abs(moodDelta) >= THRESHOLDS.MIN_MOOD_DELTA + 5) { // Higher threshold for emotion insights
        const strength = determineStrength(moodDelta, stats.high.moods.length);

        if (strength !== 'weak') {
          const direction = moodDelta > 0 ? 'positive' : 'negative';

          insights.push({
            id: generateInsightId(CATEGORIES.THEMES, `emotion_high_${emotionKey}`),
            category: CATEGORIES.THEMES,
            insight: config.valence === 'positive'
              ? `${config.emoji} High ${config.label.toLowerCase()} correlates with ${Math.abs(moodDelta)}% higher mood`
              : `${config.emoji} High ${config.label.toLowerCase()} correlates with ${Math.abs(moodDelta)}% lower mood`,
            moodDelta,
            direction,
            strength,
            sampleSize: stats.high.moods.length,
            emotionKey,
            intensity: 'high',
            recommendation: config.valence === 'negative'
              ? `Consider strategies to manage ${config.label.toLowerCase()}`
              : `${config.label} seems to boost your mood - cultivate it`,
            entryIds: stats.high.entryIds
          });
        }
      }
    }
  }

  // ===== COGNITIVE PATTERN CORRELATIONS =====
  const cognitivePatternStats = {};

  for (const entry of entriesWithMood) {
    const patterns = entry.analysis?.cognitive_patterns || [];

    for (const pattern of patterns) {
      const patternType = pattern.type?.toLowerCase();
      if (!patternType) continue;

      if (!cognitivePatternStats[patternType]) {
        cognitivePatternStats[patternType] = { moods: [], entryIds: [] };
      }

      cognitivePatternStats[patternType].moods.push(entry.analysis.mood_score);
      const entryId = entry.id || entry.entryId;
      if (entryId) cognitivePatternStats[patternType].entryIds.push(entryId);
    }
  }

  // Generate insights for cognitive patterns
  for (const [patternType, stats] of Object.entries(cognitivePatternStats)) {
    if (stats.moods.length < THRESHOLDS.MIN_MENTIONS) continue;

    const patternMood = average(stats.moods);
    const moodDelta = calculateMoodDelta(patternMood, baselineMood);

    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, stats.moods.length);
    if (strength === 'weak') continue;

    const direction = moodDelta > 0 ? 'positive' : 'negative';
    const label = patternType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    insights.push({
      id: generateInsightId(CATEGORIES.THEMES, `cognitive_${patternType}`),
      category: CATEGORIES.THEMES,
      insight: moodDelta > 0
        ? `🧠 "${label}" thinking correlates with ${Math.abs(moodDelta)}% higher mood`
        : `🧠 "${label}" thinking correlates with ${Math.abs(moodDelta)}% lower mood`,
      moodDelta,
      direction,
      strength,
      sampleSize: stats.moods.length,
      cognitivePattern: patternType,
      recommendation: moodDelta < 0
        ? 'This thinking pattern may be worth exploring with a therapist'
        : null,
      entryIds: stats.entryIds
    });
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeThemesCorrelations
};
