/**
 * Canonical crisis-keyword detection (server side).
 *
 * This MUST stay in sync with the client regex in src/config/constants.js
 * (CRISIS_KEYWORDS). The client and server live in separate deployable packages
 * so the definition is duplicated, but the phrase list is identical on purpose —
 * a divergence means a modified/offline client could set safety_flagged=false
 * and suppress the crisis path. The server recomputes the flag authoritatively.
 */

// Keep identical to src/config/constants.js CRISIS_KEYWORDS.
export const CRISIS_KEYWORDS_REGEX =
  /suicide|kill myself|hurt myself|end my life|want to die|better off dead|no reason to live|end it all|don't want to wake up|better off without me/i;

/**
 * Server-authoritative crisis check on entry text.
 * @param {string} text
 * @returns {boolean}
 */
export function isCrisisText(text) {
  if (!text || typeof text !== 'string') return false;
  return CRISIS_KEYWORDS_REGEX.test(text);
}
