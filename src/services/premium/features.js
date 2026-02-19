/**
 * Premium Feature Definitions
 *
 * Maps feature keys to whether they require premium subscription.
 * Features not listed here (or set to false) are available to all users.
 *
 * Feature key convention: '{domain}.{feature}'
 */
export const PREMIUM_FEATURES = {
  'reports.monthly': true,
  'reports.quarterly': true,
  'reports.annual': true,
  'voice.insights': true,
  'prompts.gaps': true,
  'guided.insight_exploration': true,
  // 'reports.weekly' is intentionally omitted -- it is FREE for all users
};

/**
 * Free features not in PREMIUM_FEATURES but still known to the system.
 */
const FREE_FEATURES = ['reports.weekly'];

/**
 * All known feature keys (both free and premium), derived automatically.
 */
const ALL_KNOWN_FEATURES = [
  ...FREE_FEATURES,
  ...Object.keys(PREMIUM_FEATURES),
];

/**
 * Check if a feature key is known to the system.
 * @param {string} featureKey
 * @returns {boolean}
 */
export function isKnownFeature(featureKey) {
  return ALL_KNOWN_FEATURES.includes(featureKey);
}

/**
 * Check if a feature key requires premium.
 * @param {string} featureKey
 * @returns {boolean}
 */
export function requiresPremium(featureKey) {
  return PREMIUM_FEATURES[featureKey] === true;
}
