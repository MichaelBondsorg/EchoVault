/**
 * Linguistic Pattern Detection Service
 *
 * Analyzes changes in self-talk patterns over time.
 * Detects shifts from obligation language to agency,
 * negative self-talk to positive, etc.
 *
 * Example insight: "You've used 25% fewer 'should' statements this week,
 * suggesting a shift from obligation to choice."
 */

// Linguistic markers to track
const LINGUISTIC_MARKERS = {
  obligation: {
    patterns: [
      /\bi need to\b/gi,
      /\bi have to\b/gi,
      /\bi should\b/gi,
      /\bi must\b/gi,
      /\bi ought to\b/gi,
      /\bi'm supposed to\b/gi
    ],
    category: 'obligation',
    valence: 'neutral'
  },
  agency: {
    patterns: [
      /\bi want to\b/gi,
      /\bi choose to\b/gi,
      /\bi get to\b/gi,
      /\bi decided to\b/gi,
      /\bi'm choosing\b/gi,
      /\bi prefer to\b/gi
    ],
    category: 'agency',
    valence: 'positive'
  },
  negative_self: {
    patterns: [
      /\bi always\b/gi,
      /\bi never\b/gi,
      /\bi can't\b/gi,
      /\bi'm not good at\b/gi,
      /\bi'm bad at\b/gi,
      /\bi'm terrible at\b/gi,
      /\bi'm such a\b/gi,
      /\bwhat's wrong with me\b/gi
    ],
    category: 'negative_self',
    valence: 'negative'
  },
  positive_self: {
    patterns: [
      /\bi can\b/gi,
      /\bi'm able to\b/gi,
      /\bi'm learning\b/gi,
      /\bi'm getting better at\b/gi,
      /\bi'm proud\b/gi,
      /\bi'm capable\b/gi,
      /\bi managed to\b/gi
    ],
    category: 'positive_self',
    valence: 'positive'
  },
  catastrophizing: {
    patterns: [
      /\beverything is\b/gi,
      /\bnothing works\b/gi,
      /\balways happens\b/gi,
      /\bnever works\b/gi,
      /\bthe worst\b/gi,
      /\bruined\b/gi,
      /\bdisaster\b/gi
    ],
    category: 'catastrophizing',
    valence: 'negative'
  },
  growth: {
    patterns: [
      /\bi realized\b/gi,
      /\bi learned\b/gi,
      /\bi'm starting to\b/gi,
      /\bi understand now\b/gi,
      /\bi've grown\b/gi,
      /\bprogress\b/gi,
      /\bimproving\b/gi
    ],
    category: 'growth',
    valence: 'positive'
  },
  self_compassion: {
    patterns: [
      /\bit's okay\b/gi,
      /\bi'm doing my best\b/gi,
      /\bgentle with myself\b/gi,
      /\bself-care\b/gi,
      /\bkind to myself\b/gi,
      /\bgive myself grace\b/gi
    ],
    category: 'self_compassion',
    valence: 'positive'
  },
  harsh_self: {
    patterns: [
      /\bi'm stupid\b/gi,
      /\bi'm an idiot\b/gi,
      /\bi'm lazy\b/gi,
      /\bi'm worthless\b/gi,
      /\bi'm a failure\b/gi,
      /\bi hate myself\b/gi
    ],
    category: 'harsh_self',
    valence: 'negative'
  }
};

/**
 * Count linguistic markers in text
 *
 * @param {string} text - Entry text
 * @returns {Object} Counts per category
 */
const countMarkers = (text) => {
  if (!text) return {};

  const counts = {};

  Object.entries(LINGUISTIC_MARKERS).forEach(([key, config]) => {
    let count = 0;
    config.patterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) count += matches.length;
    });
    if (count > 0) {
      counts[key] = count;
    }
  });

  return counts;
};

/**
 * Compute linguistic patterns over time
 * Compares current window to previous window
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Category filter
 * @param {number} windowDays - Days in each comparison window
 * @returns {Object[]} Array of linguistic shift patterns
 */
export const computeLinguisticPatterns = (entries, category = null, windowDays = 14) => {
  const filtered = category ? entries.filter(e => e.category === category) : entries;

  if (filtered.length < 5) return [];

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const previousWindowStart = new Date(windowStart.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // Separate entries into current and previous windows
  const currentWindow = filtered.filter(e => {
    const date = getEntryDate(e);
    return date >= windowStart && date <= now;
  });

  const previousWindow = filtered.filter(e => {
    const date = getEntryDate(e);
    return date >= previousWindowStart && date < windowStart;
  });

  if (currentWindow.length < 2 || previousWindow.length < 2) {
    return [];
  }

  // Aggregate text from each window
  const currentText = currentWindow.map(e => e.text || '').join(' ');
  const previousText = previousWindow.map(e => e.text || '').join(' ');

  // Count markers in each window
  const currentCounts = countMarkers(currentText);
  const previousCounts = countMarkers(previousText);

  // Normalize by entry count
  const currentEntryCount = currentWindow.length;
  const previousEntryCount = previousWindow.length;

  // Calculate shifts
  const patterns = [];

  Object.keys(LINGUISTIC_MARKERS).forEach(key => {
    const currentRate = (currentCounts[key] || 0) / currentEntryCount;
    const previousRate = (previousCounts[key] || 0) / previousEntryCount;

    // Skip if no meaningful data
    if (previousRate === 0 && currentRate === 0) return;

    // Calculate change
    let changePercent;
    if (previousRate === 0) {
      changePercent = currentRate > 0 ? 100 : 0; // New appearance
    } else {
      changePercent = Math.round(((currentRate - previousRate) / previousRate) * 100);
    }

    // Only report significant changes (>20%)
    if (Math.abs(changePercent) < 20) return;

    const config = LINGUISTIC_MARKERS[key];
    const direction = changePercent > 0 ? 'increase' : 'decrease';
    const sentiment = determineSentiment(key, changePercent);

    // Store raw data - let insightTemplates.js handle formatting
    // This avoids double-wrapping messages in hypothesis templates
    patterns.push({
      type: 'linguistic_shift',
      category: key,
      valence: config.valence,
      direction,
      changePercent: Math.abs(changePercent),
      currentRate: Number(currentRate.toFixed(2)),
      previousRate: Number(previousRate.toFixed(2)),
      currentCount: currentCounts[key] || 0,
      previousCount: previousCounts[key] || 0,
      windowDays,
      sentiment,
      // Raw data for template interpolation (no pre-formatted insight)
      // insightTemplates.js will generate the final message
      entityName: getCategoryDisplayName(key)
    });
  });

  // Sort by significance (larger changes first)
  return patterns.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
};

/**
 * Get entry date (handles Firestore timestamps)
 */
const getEntryDate = (entry) => {
  const dateField = entry.effectiveDate || entry.createdAt;
  return dateField instanceof Date ? dateField : dateField?.toDate?.() || new Date();
};

/**
 * Get display name for a category
 */
const getCategoryDisplayName = (category) => {
  const names = {
    obligation: 'obligation language',
    agency: 'agency language',
    negative_self: 'negative self-talk',
    positive_self: 'positive self-talk',
    catastrophizing: 'all-or-nothing thinking',
    growth: 'growth mindset',
    self_compassion: 'self-compassion',
    harsh_self: 'self-criticism'
  };
  return names[category] || category;
};

/**
 * Determine sentiment of a shift (for UI coloring)
 */
const determineSentiment = (category, changePercent) => {
  const config = LINGUISTIC_MARKERS[category];

  if (config.valence === 'positive') {
    return changePercent > 0 ? 'positive' : 'concerning';
  } else if (config.valence === 'negative') {
    return changePercent > 0 ? 'concerning' : 'positive';
  }

  // Neutral categories (like obligation)
  if (category === 'obligation') {
    return changePercent > 0 ? 'concerning' : 'positive';
  }

  return 'neutral';
};

/**
 * Get notable shifts for dashboard display
 * Returns only the most significant shifts
 *
 * @param {Object[]} entries - All entries
 * @param {string} category - Category filter
 * @returns {Object[]} Top linguistic shifts
 */
export const getNotableLinguisticShifts = (entries, category = null) => {
  const allPatterns = computeLinguisticPatterns(entries, category, 14);

  // Return top 3 most significant positive shifts
  return allPatterns
    .filter(p => p.sentiment === 'positive' || p.changePercent > 30)
    .slice(0, 3);
};

export default {
  computeLinguisticPatterns,
  getNotableLinguisticShifts,
  LINGUISTIC_MARKERS
};
