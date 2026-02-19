/**
 * Premium Feature Definitions (Server-Side)
 *
 * Mirrors client-side features.js for use in Cloud Functions.
 * Feature key convention: '{domain}.{feature}'
 */
export const PREMIUM_FEATURES = {
  'reports.monthly': true,
  'reports.quarterly': true,
  'reports.annual': true,
  'voice.insights': true,
  'prompts.gaps': true,
  'guided.insight_exploration': true,
};

const ALL_KNOWN_FEATURES = [
  'reports.weekly',
  ...Object.keys(PREMIUM_FEATURES),
];

export function isKnownFeature(featureKey) {
  return ALL_KNOWN_FEATURES.includes(featureKey);
}

export function requiresPremium(featureKey) {
  return PREMIUM_FEATURES[featureKey] === true;
}
