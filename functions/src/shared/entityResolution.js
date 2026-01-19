/**
 * Entity Resolution Helpers
 *
 * Utilities for fuzzy name matching and entity resolution.
 * Used to correct Whisper transcription errors when matching
 * mentioned names to known entities.
 */

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);

  const matrix = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calculate similarity ratio between two strings (0-1)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity ratio
 */
export function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return 1 - distance / maxLen;
}

/**
 * Find best matching entity from a list
 * @param {string} needle - String to match
 * @param {Array<{name: string, ...}>} entities - Entities to search
 * @param {number} threshold - Minimum similarity threshold (default: 0.7)
 * @returns {Object|null} Best matching entity or null
 */
export function findBestMatch(needle, entities, threshold = 0.7) {
  if (!needle || !entities?.length) return null;

  const needleLower = needle.toLowerCase().trim();
  let bestMatch = null;
  let bestScore = 0;

  for (const entity of entities) {
    const entityName = (entity.name || '').toLowerCase().trim();

    // Exact match
    if (entityName === needleLower) {
      return { entity, score: 1, exact: true };
    }

    // Check aliases if present
    const aliases = entity.aliases || [];
    for (const alias of aliases) {
      if (alias.toLowerCase().trim() === needleLower) {
        return { entity, score: 1, exact: true, matchedAlias: alias };
      }
    }

    // Fuzzy match
    const score = similarityRatio(needleLower, entityName);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      bestMatch = { entity, score, exact: false };
    }

    // Also check aliases for fuzzy match
    for (const alias of aliases) {
      const aliasScore = similarityRatio(needleLower, alias.toLowerCase().trim());
      if (aliasScore > bestScore && aliasScore >= threshold) {
        bestScore = aliasScore;
        bestMatch = { entity, score: aliasScore, exact: false, matchedAlias: alias };
      }
    }
  }

  return bestMatch;
}

/**
 * Extract potential entity mentions from text
 * Simple heuristic: looks for capitalized words that might be names
 * @param {string} text - Text to search
 * @returns {string[]} Potential entity mentions
 */
export function extractPotentialMentions(text) {
  if (!text) return [];

  // Match capitalized words (potential names)
  // Excludes common sentence starters
  const commonWords = new Set([
    'I', 'The', 'A', 'An', 'This', 'That', 'It', 'My', 'We', 'They',
    'He', 'She', 'His', 'Her', 'Their', 'Our', 'Your', 'Its'
  ]);

  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];

  return matches
    .filter(m => !commonWords.has(m))
    .filter((v, i, a) => a.indexOf(v) === i); // unique
}

export default {
  levenshteinDistance,
  similarityRatio,
  findBestMatch,
  extractPotentialMentions
};
