/**
 * colorMap.js — Centralized Semantic Color Mapping Utility
 *
 * Provides four mapping functions that translate semantic categories into
 * Hearthside palette Tailwind class strings with built-in dark mode support.
 * Also exports hex color values for JavaScript-only consumers (e.g., canvas-confetti).
 *
 * @color-safe annotation convention:
 * Lines with intentional off-palette colors (crisis red, brand logos, etc.)
 * should include a /* @color-safe *\/ comment so verification greps skip them.
 * Example: className="[off-palette-class]" /* @color-safe: crisis button *\/
 */

/* TAILWIND_SAFELIST
 * All Tailwind classes used in mapping objects below.
 * This block ensures Tailwind's content scanner detects every class.
 *
 * bg-honey-100 bg-honey-200 bg-honey-800 bg-honey-900
 * bg-hearth-100 bg-hearth-200 bg-hearth-800
 * bg-terra-100 bg-terra-200 bg-terra-800 bg-terra-900
 * bg-sage-100 bg-sage-200 bg-sage-800 bg-sage-900
 * bg-lavender-100 bg-lavender-200 bg-lavender-800 bg-lavender-900
 * bg-accent-light
 *
 * text-honey-700 text-honey-300 text-honey-800
 * text-hearth-700 text-hearth-300 text-hearth-600
 * text-terra-700 text-terra-300 text-terra-800
 * text-sage-700 text-sage-300 text-sage-800
 * text-lavender-700 text-lavender-300 text-lavender-800
 * text-accent-dark
 *
 * border-honey-200 border-honey-700
 * border-hearth-200 border-hearth-700
 * border-terra-200 border-terra-700 border-terra-300
 * border-sage-200 border-sage-700
 * border-lavender-200 border-lavender-700
 * border-accent-light
 *
 * dark:bg-honey-900/30 dark:bg-honey-800/30 dark:bg-honey-900/20
 * dark:bg-hearth-800/30 dark:bg-hearth-800/20
 * dark:bg-terra-900/30 dark:bg-terra-900/40 dark:bg-terra-800/30
 * dark:bg-sage-900/30 dark:bg-sage-800/30
 * dark:bg-lavender-900/30 dark:bg-lavender-800/30
 * dark:bg-accent-dark
 *
 * dark:text-honey-300 dark:text-honey-200
 * dark:text-hearth-300 dark:text-hearth-200
 * dark:text-terra-300 dark:text-terra-200
 * dark:text-sage-300 dark:text-sage-200
 * dark:text-lavender-300 dark:text-lavender-200
 * dark:text-accent-light
 *
 * dark:border-honey-700 dark:border-honey-800
 * dark:border-hearth-700
 * dark:border-terra-700 dark:border-terra-800
 * dark:border-sage-700 dark:border-sage-800
 * dark:border-lavender-700 dark:border-lavender-800
 * dark:border-accent-dark
 */

// Freeze helper — prevents consumers from accidentally mutating shared mappings
function freezeMap(map) {
  for (const value of Object.values(map)) {
    Object.freeze(value);
  }
  return Object.freeze(map);
}

// ============================================
// Entry Type Colors
// ============================================

const ENTRY_TYPE_MAP = freezeMap({
  task: {
    bg: 'bg-honey-100 dark:bg-honey-900/30',
    text: 'text-honey-700 dark:text-honey-300',
  },
  mixed: {
    bg: 'bg-hearth-100 dark:bg-hearth-800/30',
    text: 'text-hearth-700 dark:text-hearth-300',
  },
  vent: {
    bg: 'bg-terra-100 dark:bg-terra-900/30',
    text: 'text-terra-700 dark:text-terra-300',
  },
  reflection: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/30',
    text: 'text-lavender-700 dark:text-lavender-300',
  },
});

const ENTRY_TYPE_FALLBACK = Object.freeze({
  bg: 'bg-hearth-100 dark:bg-hearth-800/20',
  text: 'text-hearth-600 dark:text-hearth-300',
});

export function getEntryTypeColors(type) {
  return ENTRY_TYPE_MAP[type] || ENTRY_TYPE_FALLBACK;
}

// ============================================
// Pattern Type Colors
// ============================================

const PATTERN_TYPE_MAP = freezeMap({
  // Positive — sage
  weekly_high: {
    bg: 'bg-sage-100 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-700',
    text: 'text-sage-700 dark:text-sage-300',
  },
  best_day: {
    bg: 'bg-sage-100 dark:bg-sage-900/30',
    border: 'border-sage-200 dark:border-sage-700',
    text: 'text-sage-700 dark:text-sage-300',
  },
  positive_activity: {
    bg: 'bg-sage-200 dark:bg-sage-800/30',
    border: 'border-sage-200 dark:border-sage-700',
    text: 'text-sage-800 dark:text-sage-200',
  },

  // Negative — terra
  worst_day: {
    bg: 'bg-terra-100 dark:bg-terra-900/30',
    border: 'border-terra-200 dark:border-terra-700',
    text: 'text-terra-700 dark:text-terra-300',
  },
  negative_activity: {
    bg: 'bg-terra-100 dark:bg-terra-900/30',
    border: 'border-terra-200 dark:border-terra-700',
    text: 'text-terra-700 dark:text-terra-300',
  },

  // Reflective — lavender
  weekly_low: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-700',
    text: 'text-lavender-700 dark:text-lavender-300',
  },
  trigger_correlation: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/30',
    border: 'border-lavender-200 dark:border-lavender-700',
    text: 'text-lavender-700 dark:text-lavender-300',
  },

  // Warning/contradiction — terra dark
  sentiment_contradiction: {
    bg: 'bg-terra-200 dark:bg-terra-900/40',
    border: 'border-terra-300 dark:border-terra-800',
    text: 'text-terra-800 dark:text-terra-200',
  },
  avoidance_contradiction: {
    bg: 'bg-terra-200 dark:bg-terra-900/40',
    border: 'border-terra-300 dark:border-terra-800',
    text: 'text-terra-800 dark:text-terra-200',
  },
  goal_abandonment: {
    bg: 'bg-terra-200 dark:bg-terra-800/30',
    border: 'border-terra-300 dark:border-terra-800',
    text: 'text-terra-800 dark:text-terra-200',
  },

  // Recovery — honey/accent
  recovery_pattern: {
    bg: 'bg-honey-200 dark:bg-honey-800/30',
    border: 'border-honey-200 dark:border-honey-700',
    text: 'text-honey-800 dark:text-honey-200',
  },
});

const PATTERN_TYPE_FALLBACK = Object.freeze({
  bg: 'bg-honey-100 dark:bg-honey-900/20',
  border: 'border-honey-200 dark:border-honey-700',
  text: 'text-honey-700 dark:text-honey-300',
});

export function getPatternTypeColors(type) {
  return PATTERN_TYPE_MAP[type] || PATTERN_TYPE_FALLBACK;
}

// ============================================
// Entity Type Colors
// ============================================

const ENTITY_TYPE_MAP = freezeMap({
  '@person': {
    bg: 'bg-terra-100 dark:bg-terra-900/30',
    text: 'text-terra-700 dark:text-terra-300',
  },
  '@place': {
    bg: 'bg-sage-100 dark:bg-sage-900/30',
    text: 'text-sage-700 dark:text-sage-300',
  },
  '@goal': {
    bg: 'bg-honey-100 dark:bg-honey-900/30',
    text: 'text-honey-700 dark:text-honey-300',
  },
  '@activity': {
    bg: 'bg-lavender-100 dark:bg-lavender-900/30',
    text: 'text-lavender-700 dark:text-lavender-300',
  },
  '@event': {
    bg: 'bg-honey-200 dark:bg-honey-800/30',
    text: 'text-honey-800 dark:text-honey-200',
  },
  '@food': {
    bg: 'bg-terra-100 dark:bg-terra-800/30',
    text: 'text-terra-700 dark:text-terra-300',
  },
  '@media': {
    bg: 'bg-lavender-100 dark:bg-lavender-800/30',
    text: 'text-lavender-700 dark:text-lavender-300',
  },
});

const ENTITY_TYPE_FALLBACK = Object.freeze({
  bg: 'bg-hearth-100 dark:bg-hearth-800/20',
  text: 'text-hearth-600 dark:text-hearth-300',
});

export function getEntityTypeColors(type) {
  return ENTITY_TYPE_MAP[type] || ENTITY_TYPE_FALLBACK;
}

// ============================================
// Therapeutic Framework Colors
// ============================================

// Note: Therapeutic keys use UPPERCASE (ACT, CBT, DBT, RAIN)
// while entry/pattern/entity keys use lowercase/snake_case.
const THERAPEUTIC_MAP = freezeMap({
  ACT: {
    bg: 'bg-sage-100 dark:bg-sage-900/30',
    text: 'text-sage-700 dark:text-sage-300',
    border: 'border-sage-200 dark:border-sage-700',
  },
  CBT: {
    bg: 'bg-lavender-100 dark:bg-lavender-900/30',
    text: 'text-lavender-700 dark:text-lavender-300',
    border: 'border-lavender-200 dark:border-lavender-700',
  },
  DBT: {
    bg: 'bg-terra-100 dark:bg-terra-900/30',
    text: 'text-terra-700 dark:text-terra-300',
    border: 'border-terra-200 dark:border-terra-700',
  },
  RAIN: {
    bg: 'bg-honey-100 dark:bg-honey-900/30',
    text: 'text-honey-700 dark:text-honey-300',
    border: 'border-honey-200 dark:border-honey-700',
  },
  celebration: {
    bg: 'bg-sage-200 dark:bg-sage-800/30',
    text: 'text-sage-800 dark:text-sage-200',
    border: 'border-sage-200 dark:border-sage-800',
  },
  committed_action: {
    bg: 'bg-honey-200 dark:bg-honey-800/30',
    text: 'text-honey-800 dark:text-honey-200',
    border: 'border-honey-200 dark:border-honey-800',
  },
  values: {
    bg: 'bg-lavender-200 dark:bg-lavender-800/30',
    text: 'text-lavender-800 dark:text-lavender-200',
    border: 'border-lavender-200 dark:border-lavender-800',
  },
});

const THERAPEUTIC_FALLBACK = Object.freeze({
  bg: 'bg-hearth-100 dark:bg-hearth-800/20',
  text: 'text-hearth-600 dark:text-hearth-300',
  border: 'border-hearth-200 dark:border-hearth-700',
});

export function getTherapeuticColors(framework) {
  return THERAPEUTIC_MAP[framework] || THERAPEUTIC_FALLBACK;
}

// ============================================
// Hex Color Exports (for JS-only consumers)
// ============================================

export const HEX_COLORS = Object.freeze({
  honey: '#E8A84C',
  honeyLight: '#FCC44F',
  terra: '#C4725A',
  sage: '#7A9E7E',
  sageLight: '#9DC0A3',
  lavender: '#9B8EC4',
  lavenderLight: '#B5A7D4',
  hearth: '#8E7A66',
  accent: '#D4918C',
});
