/**
 * Themes & Emotions-Mood Correlations
 *
 * Analyzes mood patterns based on AI-extracted themes and emotions:
 * - Themes from entry analysis (+ tags + text keyword matching)
 * - Emotions and their intensities
 * - Cognitive patterns
 *
 * Consumes ONLY adapter-normalized entries (see
 * `src/services/insights/entryAdapter.js`). `themes`/`emotions`/
 * `cognitive_patterns` are NEVER written by the current analysis pipeline —
 * the adapter resolves them as the UNKNOWN sentinel, not `null`/`[]`.
 * UNKNOWN != absent: entries whose `emotions`/`cognitivePatterns` field is
 * UNKNOWN are dropped from those specific sub-analyses entirely (never
 * counted into either the present OR the complement group) — mirrors the
 * Personal Experiments "missing tags = UNKNOWN" rule
 * (`src/services/experiments/computeResult.js`'s `exposureValueForEntry`).
 * The THEME sub-analysis is more resilient: it also matches against tags
 * and entry text, so it still functions even while `themes` itself is
 * always UNKNOWN today.
 *
 * Baseline: non-overlapping complement, computed only within the subset of
 * entries that were actually checked for the field in question (never an
 * all-entries average, and never including UNKNOWN entries on either side).
 *
 * Day-grounding: a theme/emotion/pattern must appear on at least
 * `THRESHOLDS.MIN_UNIQUE_DAYS` distinct calendar days.
 *
 * Example insights:
 * - "Entries mentioning 'gratitude' correlate with 22% higher mood"
 * - "High-intensity anxiety correlates with 25% lower mood"
 * - "Self-compassion themes correlate with 15% better mood"
 */

import {
  determineStrength,
  generateInsightId,
  countUniqueDays,
  computeComplementBaseline
} from '../utils/statisticalHelpers';
import {
  THRESHOLDS,
  CATEGORIES
} from '../utils/thresholds';
import { isUnknown } from '../../insights/entryAdapter';

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
  const themeLower = (theme || '').toLowerCase();
  return patterns.some(p => themeLower.includes(p));
};

/**
 * Whether an adapter-normalized entry matches a theme group, checking
 * every source that's actually KNOWN for this entry (themes/tags may be
 * UNKNOWN — skipped, not treated as non-matching — text is always known,
 * possibly empty).
 */
const entryMatchesTheme = (entry, config) => {
  if (!isUnknown(entry.themes) && entry.themes.some(theme => matchesThemeGroup(theme, config.patterns))) {
    return true;
  }
  if (!isUnknown(entry.tags) && entry.tags.some(tag => matchesThemeGroup(tag, config.patterns))) {
    return true;
  }
  if (entry.hasText) {
    const text = entry.text.toLowerCase();
    if (config.patterns.some(p => text.includes(p))) return true;
  }
  return false;
};

/**
 * Compute themes-mood correlations
 * @param {Array} entries - Adapter-normalized entries (entryAdapter.js)
 * @returns {Array} Themes insight objects
 */
export const computeThemesCorrelations = (entries) => {
  if (!entries || entries.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const entriesWithMood = entries.filter(e => e.mood01 != null);
  if (entriesWithMood.length < THRESHOLDS.MIN_ENTRIES) {
    return [];
  }

  const insights = [];

  // ===== THEME CORRELATIONS =====
  for (const [themeKey, config] of Object.entries(THEME_AGGREGATIONS)) {
    const presentGroup = entriesWithMood.filter(e => entryMatchesTheme(e, config));

    if (presentGroup.length < THRESHOLDS.MIN_MENTIONS) continue;

    const presentDayCount = countUniqueDays(presentGroup);
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    const presentSet = new Set(presentGroup);
    const absentGroup = entriesWithMood.filter(e => !presentSet.has(e));

    const { insufficient, moodDelta } = computeComplementBaseline({
      presentMoods: presentGroup.map(e => e.mood01),
      absentMoods: absentGroup.map(e => e.mood01)
    });
    if (insufficient) continue;
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, presentGroup.length);
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
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      themeKey,
      recommendation: themeKey === 'gratitude' && moodDelta > 0
        ? 'Consider a gratitude practice to boost mood'
        : themeKey === 'anxiety' && moodDelta < 0
        ? 'Mindfulness or breathing exercises may help with anxiety'
        : null,
      entryIds: presentGroup.map(e => e.id).filter(Boolean)
    });
  }

  // ===== EMOTION INTENSITY CORRELATIONS =====
  // Only entries with a KNOWN emotions array participate — UNKNOWN (never
  // written today) is dropped, never treated as "no emotion".
  const knownEmotionEntries = entriesWithMood.filter(e => !isUnknown(e.emotions));
  const highIntensityByEmotion = {}; // emotionKey -> entries with this emotion at 'high' intensity

  for (const entry of knownEmotionEntries) {
    for (const emotion of entry.emotions) {
      if (!emotion?.name) continue;
      const emotionKey = emotion.name.toLowerCase();
      const intensity = emotion.intensity || 'medium';
      if (intensity !== 'high') continue;
      if (!highIntensityByEmotion[emotionKey]) highIntensityByEmotion[emotionKey] = [];
      highIntensityByEmotion[emotionKey].push(entry);
    }
  }

  for (const [emotionKey, highGroup] of Object.entries(highIntensityByEmotion)) {
    const config = EMOTION_CONFIG[emotionKey];
    if (!config) continue;

    if (highGroup.length < THRESHOLDS.MIN_MENTIONS) continue;

    const presentDayCount = countUniqueDays(highGroup);
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    // Complement is the rest of the KNOWN-emotions population — never
    // UNKNOWN entries, never entries that were never checked at all.
    const highSet = new Set(highGroup);
    const absentGroup = knownEmotionEntries.filter(e => !highSet.has(e));

    const { insufficient, moodDelta } = computeComplementBaseline({
      presentMoods: highGroup.map(e => e.mood01),
      absentMoods: absentGroup.map(e => e.mood01)
    });
    if (insufficient) continue;
    // Higher threshold for emotion insights (preserved from pre-R4 tuning)
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA + 5) continue;

    const strength = determineStrength(moodDelta, highGroup.length);
    if (strength === 'weak') continue;

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
      sampleSize: highGroup.length,
      uniqueDayCount: presentDayCount,
      emotionKey,
      intensity: 'high',
      recommendation: config.valence === 'negative'
        ? `Consider strategies to manage ${config.label.toLowerCase()}`
        : `${config.label} tends to appear alongside a better mood for you`,
      entryIds: highGroup.map(e => e.id).filter(Boolean)
    });
  }

  // ===== COGNITIVE PATTERN CORRELATIONS =====
  // Only entries with a KNOWN cognitivePatterns array participate.
  const knownPatternEntries = entriesWithMood.filter(e => !isUnknown(e.cognitivePatterns));
  const presentByPattern = {}; // patternType -> entries carrying this pattern

  for (const entry of knownPatternEntries) {
    const seenTypes = new Set();
    for (const pattern of entry.cognitivePatterns) {
      const patternType = pattern?.type?.toLowerCase();
      if (!patternType || seenTypes.has(patternType)) continue;
      seenTypes.add(patternType);
      if (!presentByPattern[patternType]) presentByPattern[patternType] = [];
      presentByPattern[patternType].push(entry);
    }
  }

  for (const [patternType, presentGroup] of Object.entries(presentByPattern)) {
    if (presentGroup.length < THRESHOLDS.MIN_MENTIONS) continue;

    const presentDayCount = countUniqueDays(presentGroup);
    if (presentDayCount < THRESHOLDS.MIN_UNIQUE_DAYS) continue;

    const presentSet = new Set(presentGroup);
    const absentGroup = knownPatternEntries.filter(e => !presentSet.has(e));

    const { insufficient, moodDelta } = computeComplementBaseline({
      presentMoods: presentGroup.map(e => e.mood01),
      absentMoods: absentGroup.map(e => e.mood01)
    });
    if (insufficient) continue;
    if (Math.abs(moodDelta) < THRESHOLDS.MIN_MOOD_DELTA) continue;

    const strength = determineStrength(moodDelta, presentGroup.length);
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
      sampleSize: presentGroup.length,
      uniqueDayCount: presentDayCount,
      cognitivePattern: patternType,
      recommendation: moodDelta < 0
        ? 'This thinking pattern may be worth exploring with a therapist'
        : null,
      entryIds: presentGroup.map(e => e.id).filter(Boolean)
    });
  }

  // Sort by absolute mood delta
  insights.sort((a, b) => Math.abs(b.moodDelta) - Math.abs(a.moodDelta));

  return insights.slice(0, THRESHOLDS.MAX_PER_CATEGORY);
};

export default {
  computeThemesCorrelations
};
